import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cookieNames, resolveConfig, type DaimonDefaults } from './config.js';

const defaults: DaimonDefaults = {
  cookiePrefix: 'testapp',
  clientId: 'testapp',
  redirectUri: 'http://localhost:3000/api/auth/callback',
};

describe('cookieNames', () => {
  it('namespaces every cookie under the app’s prefix', () => {
    // Two aether-zone apps on the same host in development must not read each
    // other's session.
    expect(cookieNames({ cookiePrefix: 'akouo' })).toEqual({
      accessToken: 'akouo.access_token',
      refreshToken: 'akouo.refresh_token',
      expiresAt: 'akouo.expires_at',
      profile: 'akouo.profile',
      state: 'akouo.oauth_state',
      verifier: 'akouo.oauth_verifier',
      returnTo: 'akouo.return_to',
    });
  });

  it('needs only the prefix, so the proxy can call it', () => {
    // Resolving a whole config would demand OAUTH_CLIENT_SECRET, which has no
    // business in the proxy runtime.
    expect(cookieNames({ cookiePrefix: 'loculus' }).accessToken).toBe(
      'loculus.access_token',
    );
  });
});

describe('resolveConfig', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('OAUTH_')) {
        delete process.env[key];
      }
    }

    process.env.OAUTH_CLIENT_SECRET = 'shhh';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('refuses to start without a client secret', () => {
    delete process.env.OAUTH_CLIENT_SECRET;

    // Failing here rather than at the token exchange, where pistis answers
    // `invalid_client` — which reads as "this client is not registered".
    expect(() => resolveConfig(defaults)).toThrow(/OAUTH_CLIENT_SECRET/);
  });

  it('takes the app’s defaults when the environment says nothing', () => {
    const config = resolveConfig(defaults);

    expect(config.clientId).toBe('testapp');
    expect(config.redirectUri).toBe('http://localhost:3000/api/auth/callback');
    expect(config.scopes).toEqual(['profile', 'email']);
    expect(config.signedOutPath).toBe('/signed-out');
  });

  it('lets the environment override each of them', () => {
    process.env.OAUTH_CLIENT_ID = 'from-env';
    process.env.OAUTH_ISSUER = 'https://pistis.example';
    process.env.OAUTH_CONSENT_URL = 'https://pistis.example/login';
    process.env.OAUTH_REDIRECT_URI = 'https://app.example/api/auth/callback';

    const config = resolveConfig(defaults);

    expect(config.clientId).toBe('from-env');
    expect(config.issuer).toBe('https://pistis.example');
    expect(config.consentUrl).toBe('https://pistis.example/login');
    expect(config.redirectUri).toBe('https://app.example/api/auth/callback');
  });

  it('splits scopes on spaces and drops the empties', () => {
    process.env.OAUTH_SCOPES = 'profile  email   organizations ';

    expect(resolveConfig(defaults).scopes).toEqual([
      'profile',
      'email',
      'organizations',
    ]);
  });

  it('does not let the environment change the cookie prefix', () => {
    // Changing it would sign everyone out, so it is the app's alone.
    process.env.OAUTH_COOKIE_PREFIX = 'somethingelse';

    expect(resolveConfig(defaults).cookiePrefix).toBe('testapp');
  });
});
