import { NextResponse, type NextRequest } from 'next/server';

import { cookieNames } from './config.js';

/**
 * Sends anyone without a session to pistis to sign in.
 *
 * Lives in the server-free entry point on purpose: this runs in the proxy
 * runtime, where `server-only` and `next/headers` throw, and where resolving a
 * full `DaimonConfig` would demand `OAUTH_CLIENT_SECRET` — a credential
 * with no business being there. Only the cookie prefix is needed.
 *
 * Named `proxy` rather than `middleware`: Next 16 renamed the convention, and
 * the file has to sit beside `app/` to be picked up at all.
 */

export interface ProxyOptions {
  /** Which cookies to look for. Only the prefix is used. */
  cookiePrefix: string;
  /**
   * Reachable signed out: the OAuth round trip, and where it lands on failure.
   * Matched exactly or as a path prefix.
   */
  publicPrefixes?: string[];
  /** Where an unauthenticated visitor is sent to start the flow. */
  loginPath?: string;
  /** What an unauthenticated `/api/` call is told. */
  unauthenticatedMessage?: string;
}

const DEFAULT_PUBLIC_PREFIXES = ['/api/auth', '/signed-out'];

/*
 * There is deliberately no `config` export here to go with the handler.
 *
 * Next parses a proxy's `export const config` statically, at compile time, so
 * it has to be an object literal in the app's own file — `export const config =
 * somethingImported` is refused, and so is `matcher: [AN_IMPORTED_CONSTANT]`.
 * An export from here could not be used in the one place it would be needed, so
 * each app writes its own matcher. The one both currently use is in the README.
 */

/**
 * Builds the proxy handler.
 *
 * It only checks that a token cookie is *present*. Verifying one is not
 * possible here and would not be worth much anyway: the resource server is the
 * authority, and it validates every token against pistis's signing keys, so a
 * forged cookie buys nothing but an empty page.
 */
export function createProxy(options: ProxyOptions) {
  const { accessToken: accessTokenCookie } = cookieNames(options);
  const publicPrefixes = options.publicPrefixes ?? DEFAULT_PUBLIC_PREFIXES;
  const loginPath = options.loginPath ?? '/api/auth/login';
  const unauthenticatedMessage =
    options.unauthenticatedMessage ??
    'Your session has expired. Sign in again.';

  return function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (
      publicPrefixes.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      )
    ) {
      return NextResponse.next();
    }

    if (request.cookies.has(accessTokenCookie)) {
      return NextResponse.next();
    }

    // Route handlers are called by fetch and XHR, which would follow a redirect
    // to the consent screen and report pistis's HTML as a perfectly good 200.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { message: unauthenticatedMessage },
        { status: 401 },
      );
    }

    const signIn = new URL(loginPath, request.nextUrl.origin);

    // Come back to whatever they were reaching for once pistis is done.
    signIn.searchParams.set('returnTo', pathname + request.nextUrl.search);

    return NextResponse.redirect(signIn);
  };
}
