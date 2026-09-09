/**
 * What an app has to say about itself to be an OAuth client of pistis.
 *
 * Everything here was a hardcoded default in akouo's and loculus's copies of
 * this flow. Naming them is what let the two copies become one: the files
 * differed in these six values, a cookie prefix, and prose.
 */
export interface DaimonConfig {
  /**
   * Public origin of pistis. This is the `iss` claim its tokens carry and the
   * value the resource server verifies against, so it must match exactly.
   * Everything except the authorization redirect is discovered from it.
   */
  issuer: string;
  /**
   * The pistis **web app**, where a person actually signs in.
   *
   * Deliberately not the discovered `authorization_endpoint`:
   * `GET /api/oauth/authorize` answers with JSON describing the pending
   * request rather than redirecting to a login page, so pointing a browser at
   * it renders raw JSON. The consent screen is a separate application driving
   * that endpoint.
   */
  consentUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  /**
   * Prefix for this app's cookies, so two aether-zone apps on the same host
   * during development do not read each other's session.
   */
  cookiePrefix: string;
  /** Where signing out lands, and where a failed authorization comes back to. */
  signedOutPath: string;
}

/** The names this app's cookies actually go under. */
export interface DaimonCookieNames {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  profile: string;
  /** Transient, for one in-flight authorization request. */
  state: string;
  verifier: string;
  returnTo: string;
}

/**
 * Takes only the prefix, not a whole {@link DaimonConfig}, because the proxy
 * needs these names and cannot have the config: resolving one demands
 * `OAUTH_CLIENT_SECRET`, which has no business in the middleware runtime.
 */
export function cookieNames(
  config: Pick<DaimonConfig, 'cookiePrefix'>,
): DaimonCookieNames {
  const at = (suffix: string) => `${config.cookiePrefix}.${suffix}`;

  return {
    accessToken: at('access_token'),
    refreshToken: at('refresh_token'),
    expiresAt: at('expires_at'),
    profile: at('profile'),
    state: at('oauth_state'),
    verifier: at('oauth_verifier'),
    returnTo: at('return_to'),
  };
}

/** What an app supplies; the rest is read from the environment. */
export interface DaimonDefaults {
  cookiePrefix: string;
  clientId: string;
  redirectUri: string;
  scopes?: string;
  consentUrl?: string;
  issuer?: string;
  signedOutPath?: string;
}

/**
 * Builds the config from the environment, falling back to the app's defaults.
 *
 * The missing secret is refused here rather than at the token exchange, where
 * pistis answers `invalid_client` — which reads as "this client is not
 * registered" rather than "this app was started without its secret".
 */
export function resolveConfig(defaults: DaimonDefaults): DaimonConfig {
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;

  if (!clientSecret) {
    throw new Error(
      'OAUTH_CLIENT_SECRET is not set. This app cannot complete the token ' +
        'exchange with pistis without it — add it to web/.env.',
    );
  }

  return {
    issuer:
      process.env.OAUTH_ISSUER ?? defaults.issuer ?? 'http://localhost:3001',
    consentUrl:
      process.env.OAUTH_CONSENT_URL ??
      defaults.consentUrl ??
      'http://localhost:3002/login',
    clientId: process.env.OAUTH_CLIENT_ID ?? defaults.clientId,
    clientSecret,
    redirectUri: process.env.OAUTH_REDIRECT_URI ?? defaults.redirectUri,
    scopes: (process.env.OAUTH_SCOPES ?? defaults.scopes ?? 'profile email')
      .split(' ')
      .filter((scope) => scope.length > 0),
    cookiePrefix: defaults.cookiePrefix,
    signedOutPath: defaults.signedOutPath ?? '/signed-out',
  };
}
