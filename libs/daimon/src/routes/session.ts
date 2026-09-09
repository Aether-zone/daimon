import { NextResponse } from 'next/server';

import type { Session } from '../session.js';

/**
 * Who is signed in, for client components. Never the access token — that stays
 * in an httpOnly cookie the browser cannot read.
 *
 * `body` is the one part of this that is genuinely per-app: akouo answers with
 * the person's organizations and the active one, loculus with the OAuth client
 * its objects belong to. Everything else — reading the session, withholding
 * the token, shaping the response — is the same either way.
 */
export function createSessionRoute(
  getSession: () => Promise<Session | null>,
  body: (session: Session | null) => Promise<unknown> | unknown = (
    session,
  ) => ({
    user: session?.user ?? null,
  }),
) {
  return async function GET(): Promise<NextResponse> {
    return NextResponse.json(await body(await getSession()));
  };
}
