import { NextResponse, type NextRequest } from 'next/server';

import type { DaimonConfig } from '../config.js';
import { clearSession } from '../session.js';

/**
 * Signs out of this app only.
 *
 * The pistis session is untouched, so signing in again may not ask for a
 * password — that is single sign-on working, not a bug. The access token also
 * stays valid at the resource server until it expires; pistis's
 * `/oauth/revoke` is what would end it sooner.
 */
export function createLogoutRoute(config: DaimonConfig) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    await clearSession(config);

    return NextResponse.redirect(
      new URL(config.signedOutPath, request.nextUrl.origin),
      // 303 so the browser follows with GET rather than repeating the POST.
      { status: 303 },
    );
  };
}
