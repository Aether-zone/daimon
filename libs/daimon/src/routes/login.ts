import { NextResponse, type NextRequest } from 'next/server';

import { cookieNames, type DaimonConfig } from '../config.js';
import { beginAuthorization } from '../oauth.js';

/**
 * Starts the authorization code flow: parks the `state` and PKCE verifier in
 * short-lived cookies and sends the browser to pistis's consent screen.
 *
 * The verifier is written here and read only by the callback, which is what
 * binds the resulting code to this browser — one intercepted elsewhere cannot
 * be redeemed.
 */
export function createLoginRoute(config: DaimonConfig) {
  const names = cookieNames(config);

  return async function GET(request: NextRequest): Promise<NextResponse> {
    const { url, state, verifier } = await beginAuthorization(config);

    const response = NextResponse.redirect(url);

    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // Long enough to type a password, short enough that an abandoned attempt
      // does not linger.
      maxAge: 10 * 60,
    };

    response.cookies.set(names.state, state, options);
    response.cookies.set(names.verifier, verifier, options);

    // Where to land afterwards. Only a path is kept: an absolute URL here would
    // be an open redirect, letting anyone bounce a visitor off this origin.
    const returnTo = request.nextUrl.searchParams.get('returnTo');

    if (isLocalPath(returnTo)) {
      response.cookies.set(names.returnTo, returnTo, options);
    }

    return response;
  };
}

/** A path on this origin, and not a protocol-relative URL to another one. */
export function isLocalPath(value: string | undefined | null): value is string {
  return Boolean(value?.startsWith('/') && !value.startsWith('//'));
}
