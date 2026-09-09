import { NextResponse, type NextRequest } from 'next/server';
import { AuthorizationResponseError, ResponseBodyError } from 'oauth4webapi';

import { cookieNames, type DaimonConfig } from '../config.js';
import { completeAuthorization } from '../oauth.js';
import { storeTokens } from '../session.js';
import { isLocalPath } from './login.js';

/**
 * The `redirect_uri` registered with pistis for this client.
 *
 * pistis sends the browser here carrying either `code` or `error`. A code is
 * single-use — replaying one revokes every token descended from it — so the
 * state and verifier cookies are cleared on the way out whatever the outcome.
 *
 * The state check and the `error` case are both `completeAuthorization`'s, and
 * both happen before the code is spent.
 */
export function createCallbackRoute(config: DaimonConfig) {
  const names = cookieNames(config);

  const signInFailedUrl = (request: NextRequest, reason: string): URL => {
    const url = new URL(config.signedOutPath, request.nextUrl.origin);

    url.searchParams.set('error', reason);

    return url;
  };

  /** Drops the one-shot cookies; they are worthless after a single exchange. */
  const finish = (
    request: NextRequest,
    response: NextResponse,
  ): NextResponse => {
    for (const name of [names.state, names.verifier, names.returnTo]) {
      if (request.cookies.has(name)) {
        response.cookies.delete(name);
      }
    }

    return response;
  };

  return async function GET(request: NextRequest): Promise<NextResponse> {
    const failed = (reason: string) =>
      finish(request, NextResponse.redirect(signInFailedUrl(request, reason)));

    const expectedState = request.cookies.get(names.state)?.value;
    const verifier = request.cookies.get(names.verifier)?.value;

    // No cookies means no request this browser started — an expired attempt, a
    // bookmarked callback, or someone else's link.
    if (!expectedState || !verifier) {
      return failed('The sign-in attempt was incomplete. Please try again.');
    }

    try {
      await storeTokens(
        config,
        await completeAuthorization(
          config,
          request.nextUrl.searchParams,
          expectedState,
          verifier,
        ),
      );
    } catch (cause) {
      return failed(describe(cause));
    }

    const returnTo = request.cookies.get(names.returnTo)?.value;
    const destination = isLocalPath(returnTo) ? returnTo : '/';

    return finish(
      request,
      NextResponse.redirect(new URL(destination, request.nextUrl.origin)),
    );
  };
}

/**
 * What to put in front of the person.
 *
 * pistis's own wording is preferred where there is any — it knows why it said
 * no — and anything else becomes a flat retry, because the remaining failures
 * are a mismatched state or an unreachable authorization server, neither of
 * which a visitor can act on.
 */
function describe(cause: unknown): string {
  if (
    cause instanceof AuthorizationResponseError ||
    cause instanceof ResponseBodyError
  ) {
    return cause.error_description ?? cause.error;
  }

  // Nothing above recognised this, and the visitor is about to be told
  // something deliberately vague — so the real cause is worth keeping.
  console.error('The token exchange with pistis failed:', cause);

  return 'The sign-in attempt could not be verified. Please try again.';
}
