import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelledOr, putToSignedUrl, DEFAULT_PUT_MESSAGES } from './upload.js';

/**
 * A controllable XMLHttpRequest.
 *
 * A real one — jsdom's included — would want a server to talk to, and the point
 * here is the event wiring: which listener settles the promise, and what it
 * settles with. `send` records and waits; the test drives the outcome.
 */
class FakeXhr {
  static last: FakeXhr | null = null;

  status = 0;
  method?: string;
  url?: string;
  sent?: unknown;
  aborted = false;
  readonly headers: Record<string, string> = {};

  private readonly listeners: Record<string, ((event?: unknown) => void)[]> =
    {};
  private readonly uploadListeners: Record<
    string,
    ((event?: unknown) => void)[]
  > = {};

  readonly upload = {
    addEventListener: (type: string, handler: (event?: unknown) => void) => {
      (this.uploadListeners[type] ??= []).push(handler);
    },
  };

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  addEventListener(type: string, handler: (event?: unknown) => void) {
    (this.listeners[type] ??= []).push(handler);
  }

  send(body: unknown) {
    this.sent = body;
  }

  abort() {
    this.aborted = true;
    this.emit('abort');
  }

  /** Drive the outcome from the test. */
  emit(type: string, event?: unknown) {
    for (const handler of this.listeners[type] ?? []) {
      handler(event);
    }
  }

  emitProgress(loaded: number, total: number, lengthComputable = true) {
    for (const handler of this.uploadListeners.progress ?? []) {
      handler({ loaded, total, lengthComputable });
    }
  }

  finishWith(status: number) {
    this.status = status;
    this.emit('load');
  }
}

function stubXhr() {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);

  return () => FakeXhr.last as FakeXhr;
}

const file = (name = 'a.mp3', type = 'audio/mpeg') =>
  ({ name, type, size: 5 }) as unknown as File;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.last = null;
});

describe('putToSignedUrl', () => {
  it('PUTs the file to the signed url with its own content type', async () => {
    const xhr = stubXhr();
    const promise = putToSignedUrl('https://store.test/obj?sig=1', file());

    xhr().finishWith(200);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(xhr().method).toBe('PUT');
    expect(xhr().url).toBe('https://store.test/obj?sig=1');
    // The api signed this content type into the URL; a mismatch is refused by
    // the store.
    expect(xhr().headers['content-type']).toBe('audio/mpeg');
  });

  it('falls back to a permissive type when the browser knows none', async () => {
    const xhr = stubXhr();
    const promise = putToSignedUrl('https://store.test/obj', file('a.bin', ''));

    xhr().finishWith(200);
    await promise;

    expect(xhr().headers['content-type']).toBe('application/octet-stream');
  });

  it.each([200, 201, 204])('treats %i as stored', async (status) => {
    const xhr = stubXhr();
    const promise = putToSignedUrl('https://store.test/obj', file());

    xhr().finishWith(status);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('reports progress as a fraction', async () => {
    const xhr = stubXhr();
    const seen: number[] = [];
    const promise = putToSignedUrl('https://store.test/obj', file(), {
      onProgress: (fraction) => seen.push(fraction),
    });

    xhr().emitProgress(25, 100);
    xhr().emitProgress(100, 100);
    xhr().finishWith(200);
    await promise;

    expect(seen).toEqual([0.25, 1]);
  });

  it('ignores a progress event that cannot be measured', async () => {
    const xhr = stubXhr();
    const seen: number[] = [];
    const promise = putToSignedUrl('https://store.test/obj', file(), {
      onProgress: (fraction) => seen.push(fraction),
    });

    xhr().emitProgress(0, 0, false);
    xhr().finishWith(200);
    await promise;

    expect(seen).toEqual([]);
  });

  it('names the expired signature on a 403', async () => {
    const xhr = stubXhr();
    const promise = putToSignedUrl('https://store.test/obj', file());

    xhr().finishWith(403);

    await expect(promise).resolves.toEqual({
      ok: false,
      error: DEFAULT_PUT_MESSAGES.forbidden,
    });
  });

  it('lets the caller reword a failure', async () => {
    const xhr = stubXhr();
    const promise = putToSignedUrl('https://store.test/obj', file(), {
      messages: { forbidden: 'The upload link has expired. Try again.' },
    });

    xhr().finishWith(403);

    await expect(promise).resolves.toMatchObject({
      error: 'The upload link has expired. Try again.',
    });
  });

  it('reports any other refusal plainly', async () => {
    const xhr = stubXhr();
    const promise = putToSignedUrl('https://store.test/obj', file());

    xhr().finishWith(500);

    await expect(promise).resolves.toEqual({
      ok: false,
      error: DEFAULT_PUT_MESSAGES.failed,
    });
  });

  it('points at the bucket’s CORS policy when the request never lands', async () => {
    // XHR reports a cross-origin failure as a bare error with no status, so
    // this is also where a missing CORS policy lands — the one part of a direct
    // upload configured on the store rather than in either application.
    const xhr = stubXhr();
    const promise = putToSignedUrl('https://store.test/obj', file());

    xhr().emit('error');

    await expect(promise).resolves.toEqual({
      ok: false,
      error: DEFAULT_PUT_MESSAGES.unreachable,
    });
    expect(DEFAULT_PUT_MESSAGES.unreachable).toMatch(/PUT from this origin/);
  });

  describe('cancelling', () => {
    it('aborts the request when the signal fires', async () => {
      const xhr = stubXhr();
      const controller = new AbortController();
      const promise = putToSignedUrl('https://store.test/obj', file(), {
        signal: controller.signal,
      });

      controller.abort();

      await expect(promise).resolves.toEqual({
        ok: false,
        error: 'Upload cancelled.',
        cancelled: true,
      });
      expect(xhr().aborted).toBe(true);
    });

    it('marks it cancelled rather than failed, so a caller can tell', () => {
      expect(cancelledOr(new Error('boom'), 'fallback')).toEqual({
        ok: false,
        error: 'fallback',
      });

      expect(
        cancelledOr(new DOMException('aborted', 'AbortError'), 'fallback'),
      ).toEqual({ ok: false, error: 'Upload cancelled.', cancelled: true });
    });

    it('stops listening to the signal once it has settled', async () => {
      const xhr = stubXhr();
      const controller = new AbortController();
      const promise = putToSignedUrl('https://store.test/obj', file(), {
        signal: controller.signal,
      });

      xhr().finishWith(200);
      await promise;

      // A signal aborted after the upload finished must not reach a dead
      // request — the listener is removed when the promise settles.
      controller.abort();

      expect(xhr().aborted).toBe(false);
    });
  });
});
