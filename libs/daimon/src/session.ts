import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';

import { readClaims, type OrganizationMembership } from './claims.js';
import { cookieNames, type DaimonConfig } from './config.js';
import { fetchUserInfo, refreshTokens, type TokenResponse } from './oauth.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface Session {
  user: SessionUser;
  accessToken: string;
  /**
   * The token's `client_id` — the boundary loculus files objects under, and
   * worth rendering so it is obvious whose objects a console can see.
   *
   * Falls back to the configured id rather than to an empty string: the two
   * only differ if pistis issued a token for a client this app is not, which is
   * a misconfiguration the resource server will reject anyway.
   */
  clientId: string;
  /**
   * The `orgs` claim, read off the access token rather than stored beside it:
   * the token is the only thing pistis signed, so anything kept separately
   * could drift out of agreement with what the api will actually enforce.
   *
   * Empty unless the `organizations` scope was granted.
   */
  organizations: Record<string, OrganizationMembership>;
}

/**
 * Tokens live in httpOnly cookies, so no script on the page can read them and
 * the browser never holds a bearer credential it could leak. The consequence is
 * that everything needing the token runs server-side — the browser reaches a
 * resource server only through its own app's route handlers, which is also why
 * those apis need no CORS configuration.
 */
function tokenCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

/** A month. Long enough that a person is not signed out over a weekend. */
const PERSISTENT_MAX_AGE = 60 * 60 * 24 * 30;

export async function storeTokens(
  config: DaimonConfig,
  tokens: TokenResponse,
): Promise<void> {
  const names = cookieNames(config);
  const jar = await cookies();
  const options = tokenCookie();

  jar.set(names.accessToken, tokens.access_token, {
    ...options,
    maxAge: tokens.expires_in,
  });
  jar.set(names.expiresAt, String(Date.now() + tokens.expires_in * 1000), {
    ...options,
    maxAge: tokens.expires_in,
  });

  if (tokens.refresh_token) {
    // Outlives the access token by design: it is the only thing that can get a
    // new one without sending the person back through pistis.
    jar.set(names.refreshToken, tokens.refresh_token, {
      ...options,
      maxAge: PERSISTENT_MAX_AGE,
    });
  }

  const profile = await fetchUserInfo(config, tokens.access_token);

  if (profile) {
    jar.set(
      names.profile,
      JSON.stringify({
        id: profile.sub,
        name: profile.name,
        email: profile.email,
      }),
      { ...options, maxAge: PERSISTENT_MAX_AGE },
    );
  }
}

export async function clearSession(config: DaimonConfig): Promise<void> {
  const names = cookieNames(config);
  const jar = await cookies();

  for (const name of [
    names.accessToken,
    names.refreshToken,
    names.expiresAt,
    names.profile,
  ]) {
    jar.delete(name);
  }
}

/**
 * Builds this app's `getSession`.
 *
 * A factory rather than a plain function because of the memoization: React's
 * `cache` has to wrap one long-lived function for the deduplication to mean
 * anything, and the config has to be bound before that happens.
 *
 * The memoization is not an optimization. A layout and the page inside it
 * render concurrently and both want the session; without it they would both
 * notice the same expired token and both spend the same refresh token — which
 * pistis treats as a replay, and answers by revoking the whole family.
 */
export function createGetSession(
  config: DaimonConfig,
): () => Promise<Session | null> {
  return cache(async function getSession(): Promise<Session | null> {
    const names = cookieNames(config);
    const jar = await cookies();

    const accessToken = jar.get(names.accessToken)?.value;
    const expiresAt = Number(jar.get(names.expiresAt)?.value ?? 0);
    const refreshToken = jar.get(names.refreshToken)?.value;
    const user = readProfile(jar.get(names.profile)?.value);

    // Refresh a minute early, so a token cannot expire between this check and
    // the request it is about to authorize.
    if (accessToken && user && expiresAt - 60_000 > Date.now()) {
      return sessionOf(config, user, accessToken);
    }

    if (!refreshToken) {
      return null;
    }

    try {
      const tokens = await refreshTokens(config, refreshToken);

      await storeTokens(config, tokens);

      const refreshed =
        user ?? readProfile((await cookies()).get(names.profile)?.value);

      return refreshed
        ? sessionOf(config, refreshed, tokens.access_token)
        : null;
    } catch {
      // pistis revokes a whole token family when a refresh token is replayed,
      // so a failure here usually means this session is genuinely finished.
      await clearSession(config);

      return null;
    }
  });
}

function sessionOf(
  config: DaimonConfig,
  user: SessionUser,
  accessToken: string,
): Session {
  const claims = readClaims(accessToken);

  return {
    user,
    accessToken,
    clientId: claims?.client_id ?? config.clientId,
    organizations: claims?.orgs ?? {},
  };
}

function readProfile(raw: string | undefined): SessionUser | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}
