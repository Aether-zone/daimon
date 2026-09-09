import * as oauth from 'oauth4webapi';

import { readClaims } from './claims.js';
import type { DaimonConfig } from './config.js';

/**
 * An aether-zone app as an OAuth client of pistis, the authorization server.
 *
 * No app built on this holds accounts of its own: pistis keeps the people,
 * their passwords and their organization memberships, and an app here only
 * ever sees the tokens pistis signs.
 *
 * The flow itself — PKCE, the state check, the code exchange, refreshing — is
 * `oauth4webapi`'s. What lives here is the part that is genuinely local: which
 * pistis to talk to, and the one place pistis departs from what discovery
 * would suggest (see {@link DaimonConfig.consentUrl}).
 */

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface UserInfo {
  sub: string;
  name: string;
  email: string;
  updated_at: number;
}

/** What `/api/auth/login` has to park in cookies until the callback. */
export interface Authorization {
  url: string;
  state: string;
  verifier: string;
}

/*
 * pistis runs over plain HTTP in development (`http://localhost:3001`), which
 * oauth4webapi refuses unless told. The flag only permits what the configured
 * issuer already commits to — an https issuer is still https — so it is keyed
 * off the URL rather than off NODE_ENV.
 */
const httpOptions = (config: DaimonConfig) => ({
  [oauth.allowInsecureRequests]: new URL(config.issuer).protocol === 'http:',
});

const clientOf = (config: DaimonConfig): oauth.Client => ({
  client_id: config.clientId,
});

/*
 * The metadata document, fetched once per process and per issuer.
 *
 * Keyed by issuer rather than held in one variable, because this module is now
 * shared: two apps in one process — or one app reconfigured in a test — would
 * otherwise be served the first issuer's document forever.
 *
 * A rejected promise is not kept: caching one would turn a single failed
 * request — pistis not up yet, say — into an outage lasting until restart.
 */
const metadata = new Map<string, Promise<oauth.AuthorizationServer>>();

function authorizationServer(
  config: DaimonConfig,
): Promise<oauth.AuthorizationServer> {
  const cached = metadata.get(config.issuer);

  if (cached) {
    return cached;
  }

  const issuer = new URL(config.issuer);

  const pending = (async () => {
    const response = await oauth.discoveryRequest(issuer, {
      // RFC 8414 rather than OpenID Connect Discovery: pistis is an OAuth 2.0
      // server, issues no id_token, and serves its document at
      // /.well-known/oauth-authorization-server.
      algorithm: 'oauth2',
      ...httpOptions(config),
    });

    return oauth.processDiscoveryResponse(issuer, response);
  })();

  metadata.set(config.issuer, pending);

  pending.catch(() => {
    metadata.delete(config.issuer);
  });

  return pending;
}

/**
 * Starts the authorization code flow.
 *
 * The verifier is returned for the caller to park in a cookie and hand back at
 * the callback: that is what binds the resulting code to this browser, so one
 * intercepted elsewhere cannot be redeemed. PKCE is used even though these are
 * confidential clients, because a secret alone does not bind a code to a
 * browser.
 */
export async function beginAuthorization(
  config: DaimonConfig,
): Promise<Authorization> {
  const state = oauth.generateRandomState();
  const verifier = oauth.generateRandomCodeVerifier();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
  });

  // The consent app, not the discovered authorization_endpoint — see above.
  return { url: `${config.consentUrl}?${params}`, state, verifier };
}

/**
 * Validates the callback and exchanges its code for tokens.
 *
 * The state check happens inside `validateAuthResponse`, before the code is
 * spent, and an `error` in the callback is raised from there too — so a
 * response that did not come from the request this browser started never
 * reaches the token endpoint (RFC 6749 §10.12).
 */
export async function completeAuthorization(
  config: DaimonConfig,
  callbackParameters: URLSearchParams,
  expectedState: string,
  verifier: string,
): Promise<TokenResponse> {
  const as = await authorizationServer(config);
  const client = clientOf(config);

  const params = oauth.validateAuthResponse(
    as,
    { ...client, client_secret: config.clientSecret },
    callbackParameters,
    expectedState,
  );

  const response = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    // The secret goes in the body; pistis accepts that or a Basic header.
    oauth.ClientSecretPost(config.clientSecret),
    params,
    config.redirectUri,
    verifier,
    httpOptions(config),
  );

  return asTokenResponse(
    await oauth.processAuthorizationCodeResponse(as, client, response),
  );
}

export async function refreshTokens(
  config: DaimonConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const as = await authorizationServer(config);
  const client = clientOf(config);

  const response = await oauth.refreshTokenGrantRequest(
    as,
    client,
    oauth.ClientSecretPost(config.clientSecret),
    refreshToken,
    httpOptions(config),
  );

  return asTokenResponse(
    await oauth.processRefreshTokenResponse(as, client, response),
  );
}

/**
 * `expires_in` is optional in the spec and so in the library's type, but every
 * caller here needs a number to set a cookie lifetime with. pistis always sends
 * it; an hour is the same default pistis itself applies.
 */
function asTokenResponse(tokens: oauth.TokenEndpointResponse): TokenResponse {
  return {
    access_token: tokens.access_token,
    token_type: 'Bearer',
    expires_in: tokens.expires_in ?? 3600,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
  };
}

/** The signed-in person's name and email. Requires the `profile` scope. */
export async function fetchUserInfo(
  config: DaimonConfig,
  accessToken: string,
): Promise<UserInfo | null> {
  try {
    const as = await authorizationServer(config);
    const client = clientOf(config);

    // The subject the token names, so a userinfo document about anyone else is
    // refused rather than written into this browser's profile cookie.
    const subject = readClaims(accessToken)?.sub;

    const info = await oauth.processUserInfoResponse(
      as,
      client,
      subject ?? oauth.skipSubjectCheck,
      await oauth.userInfoRequest(as, client, accessToken, httpOptions(config)),
    );

    return info as unknown as UserInfo;
  } catch {
    // A missing profile is not a failed sign-in: the session still has a usable
    // token, and the name is only ever rendered.
    return null;
  }
}
