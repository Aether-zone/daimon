/**
 * Calling an aether-zone resource server with the session's access token.
 *
 * akouo and loculus each grew their own copy of this: the same `classify`, the
 * same `request`, the same `apiGet`/`apiPost`/`apiDelete` over the same result
 * union. What actually differed was how a path becomes a URL — loculus joins it
 * to a base, akouo resolves the organization the person is working in and can
 * fail before any request is made — so that is the one thing left to the caller.
 */

/** The failures every aether-zone api can produce. */
export type BaseFailureReason =
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'unavailable';

/**
 * A failed call.
 *
 * Generic in the extra reasons an app's resolver can add, rather than carrying
 * the union of everything any app might need: both apps map reasons with an
 * exhaustive `Record<ApiFailure['reason'], …>`, so a reason one of them cannot
 * produce would still force it to write a case for something unreachable.
 */
export interface ApiFailure<ExtraReason extends string = never> {
  ok: false;
  reason: BaseFailureReason | ExtraReason;
  /** The api's own message, where it sent one worth showing. */
  message?: string;
  /**
   * The parsed error body, for callers mapping per-field validation messages
   * onto a form. Null when there was no body, or none that parsed.
   */
  body?: ApiErrorBody | null;
}

export type ApiResult<T, ExtraReason extends string = never> =
  | { ok: true; data: T }
  | ApiFailure<ExtraReason>;

/**
 * What an aether-zone api sends when it refuses.
 *
 * Covers both shapes in use: Nest's `{ message, errors }` validation body, and
 * the RFC 9457 problem document organon's filter renders.
 */
export interface ApiErrorBody {
  message?: string;
  detail?: string;
  title?: string;
  errors?: { path?: string; message?: string }[];
}

/** Where a path points, and what to authorize the request with. */
export interface ResolvedTarget {
  ok: true;
  url: string;
  accessToken: string;
}

/**
 * Turns a path into a URL and a token, or refuses before anything is sent.
 *
 * This is the seam. loculus joins the path to a base URL; akouo prefixes the
 * organization the person is working in and answers `noOrganization` when they
 * belong to none — a refusal with no request behind it, which is why this
 * returns a failure rather than throwing.
 */
export type TargetResolver<ExtraReason extends string = never> = (
  path: string,
) => Promise<ResolvedTarget | ApiFailure<ExtraReason>>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * A 400 folds into `notFound` alongside 404 on purpose.
 *
 * Both apis answer 400 for a malformed id and 404 for a real miss, and either
 * way there is nothing for the caller to act on. loculus additionally answers
 * 404 for a key owned by another OAuth client — telling that apart from a
 * genuine miss would answer "does this key exist" for anyone willing to ask.
 */
export function classify(status: number): BaseFailureReason {
  if (status === 401) return 'unauthenticated';
  // 403 is the api refusing this caller, which is a different thing from an
  // expired token and must not trigger a re-login.
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 400) return 'notFound';

  return 'unavailable';
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  return (await response.json().catch(() => null)) as ApiErrorBody | null;
}

/** The readable part of an error body, whichever shape it arrived in. */
function messageOf(body: ApiErrorBody | null): string | undefined {
  return body?.message ?? body?.detail ?? undefined;
}

export interface ApiClient<ExtraReason extends string = never> {
  get<T>(path: string): Promise<ApiResult<T, ExtraReason>>;
  post<T>(path: string, payload: unknown): Promise<ApiResult<T, ExtraReason>>;
  put<T>(path: string, payload: unknown): Promise<ApiResult<T, ExtraReason>>;
  del(path: string): Promise<{ ok: true } | ApiFailure<ExtraReason>>;
  /**
   * The raw response, body unread — for streaming a file through without
   * buffering it. Any status counts as reached, so a route mirroring this
   * passes 206 and 416 back as faithfully as 200, which is what makes seeking
   * work. Only a request that never landed comes back as a failure.
   */
  raw(
    path: string,
    init?: RequestInit,
  ): Promise<{ ok: true; response: Response } | ApiFailure<ExtraReason>>;
}

/**
 * Builds a client over one resolver.
 *
 * Every failure carries both `message` and `body`: loculus renders the message,
 * akouo maps `body.errors` onto its forms, and reading the body once here means
 * neither has to decide which of the two it is getting.
 */
export function createApiClient<ExtraReason extends string = never>(
  resolve: TargetResolver<ExtraReason>,
): ApiClient<ExtraReason> {
  async function send(
    path: string,
    method: HttpMethod,
    payload?: unknown,
  ): Promise<{ ok: true; response: Response } | ApiFailure<ExtraReason>> {
    const target = await resolve(path);

    if (!target.ok) {
      return target;
    }

    try {
      const response = await fetch(target.url, {
        method,
        headers: {
          Authorization: `Bearer ${target.accessToken}`,
          ...(payload === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        cache: 'no-store',
      });

      if (!response.ok) {
        const body = await readErrorBody(response);

        return {
          ok: false,
          reason: classify(response.status),
          message: messageOf(body),
          body,
        };
      }

      return { ok: true, response };
    } catch (error) {
      console.error(`${method} ${path} failed:`, error);

      return { ok: false, reason: 'unavailable' };
    }
  }

  async function json<T>(
    path: string,
    method: HttpMethod,
    payload?: unknown,
  ): Promise<ApiResult<T, ExtraReason>> {
    const result = await send(path, method, payload);

    if (!result.ok) {
      return result;
    }

    try {
      return { ok: true, data: (await result.response.json()) as T };
    } catch (error) {
      console.error(`${method} ${path} returned unparseable JSON:`, error);

      return { ok: false, reason: 'unavailable', body: null };
    }
  }

  return {
    get: <T>(path: string) => json<T>(path, 'GET'),
    post: <T>(path: string, payload: unknown) => json<T>(path, 'POST', payload),
    put: <T>(path: string, payload: unknown) => json<T>(path, 'PUT', payload),

    /** DELETE answers 204, so there is no body to read. */
    async del(path: string) {
      const result = await send(path, 'DELETE');

      return result.ok ? ({ ok: true } as const) : result;
    },

    async raw(path: string, init: RequestInit = {}) {
      const target = await resolve(path);

      if (!target.ok) {
        return target;
      }

      try {
        return {
          ok: true as const,
          response: await fetch(target.url, {
            ...init,
            headers: {
              Authorization: `Bearer ${target.accessToken}`,
              ...init.headers,
            },
            cache: 'no-store',
          }),
        };
      } catch (error) {
        console.error(`${init.method ?? 'GET'} ${path} (raw) failed:`, error);

        return { ok: false as const, reason: 'unavailable' as const };
      }
    },
  };
}
