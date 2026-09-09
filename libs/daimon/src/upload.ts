/**
 * Putting a file straight at the object store, from the browser.
 *
 * The bytes never pass through an application: the api signs a URL, and this
 * spends it. What is shared is only that middle step — how a path becomes a
 * presigned URL, and what "the object arrived" means afterwards, differ per app
 * and stay there.
 *
 * XHR rather than `fetch`, because only XHR reports upload progress, and
 * anything worth uploading directly is big enough to owe a progress bar.
 */

/** Why an upload stopped. */
export interface UploadFailure {
  ok: false;
  error: string;
  /** Distinguishes a person cancelling from anything going wrong. */
  cancelled?: boolean;
}

export interface PutMessages {
  /** The signature was refused — usually expired, or the file no longer matches. */
  forbidden?: string;
  /** Any other non-2xx from the store. */
  failed?: string;
  /** The request never landed. See {@link DEFAULT_PUT_MESSAGES.unreachable}. */
  unreachable?: string;
  cancelled?: string;
}

export const DEFAULT_PUT_MESSAGES: Required<PutMessages> = {
  forbidden:
    'The store refused the upload — the link has expired, or the file no longer matches what it was signed for.',
  failed: 'The file could not be stored. Try again.',
  /*
   * XHR reports a cross-origin failure as a bare error with no status, so this
   * is also where a missing CORS policy on the bucket lands. Worth naming: it
   * is the one part of a direct upload that is configured on the store rather
   * than in any application.
   */
  unreachable:
    'The browser could not reach the object store. Check that the bucket allows PUT from this origin.',
  cancelled: 'Upload cancelled.',
};

export interface PutOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  messages?: PutMessages;
}

/**
 * PUTs one file at a presigned URL.
 *
 * `content-type` is set to the file's own, because that is what the api signed
 * the URL for. `Content-Length` is the browser's to set and it will not let a
 * script override it, which is fine: it is the file's real size either way.
 */
export function putToSignedUrl(
  uploadUrl: string,
  file: File,
  options: PutOptions = {},
): Promise<{ ok: true } | UploadFailure> {
  const messages = { ...DEFAULT_PUT_MESSAGES, ...options.messages };
  const { onProgress, signal } = options;

  return new Promise((resolve) => {
    const request = new XMLHttpRequest();

    request.open('PUT', uploadUrl);
    request.setRequestHeader(
      'content-type',
      file.type || 'application/octet-stream',
    );

    const abort = () => request.abort();

    signal?.addEventListener('abort', abort);

    const settle = (result: { ok: true } | UploadFailure) => {
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total);
      }
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        settle({ ok: true });

        return;
      }

      settle({
        ok: false,
        error: request.status === 403 ? messages.forbidden : messages.failed,
      });
    });

    request.addEventListener('error', () =>
      settle({ ok: false, error: messages.unreachable }),
    );

    request.addEventListener('abort', () =>
      settle({ ok: false, error: messages.cancelled, cancelled: true }),
    );

    request.send(file);
  });
}

/**
 * An aborted request, or the given fallback.
 *
 * For the `fetch` steps either side of the PUT, which reject with an
 * `AbortError` rather than reporting through a handler.
 */
export function cancelledOr(error: unknown, fallback: string): UploadFailure {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      ok: false,
      error: DEFAULT_PUT_MESSAGES.cancelled,
      cancelled: true,
    };
  }

  return { ok: false, error: fallback };
}
