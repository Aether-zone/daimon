import {
  resolveConfig,
  type DaimonConfig,
  type DaimonDefaults,
} from './config.js';
import {
  createCallbackRoute,
  createLoginRoute,
  createLogoutRoute,
} from './routes/index.js';
import {
  clearSession,
  createGetSession,
  storeTokens,
  type Session,
} from './session.js';
import type { TokenResponse } from './oauth.js';

export * from './api.js';
export * from './claims.js';
export * from './config.js';
export * from './failure.js';
export * from './oauth.js';
export * from './routes/index.js';
export {
  clearSession,
  createGetSession,
  storeTokens,
  type Session,
  type SessionUser,
} from './session.js';

/** Everything an app needs, with its config bound in once. */
export interface Auth {
  config: DaimonConfig;
  /**
   * The current session, refreshing the access token when it is close to
   * expiry. Null for a signed-out visitor, which is an ordinary state rather
   * than an error.
   *
   * Memoized per request — see `createGetSession` for why that matters.
   */
  getSession: () => Promise<Session | null>;
  signOut: () => Promise<void>;
  storeTokens: (tokens: TokenResponse) => Promise<void>;
  /** Route handlers, for an app's `app/api/auth/*` files to re-export. */
  routes: {
    login: ReturnType<typeof createLoginRoute>;
    callback: ReturnType<typeof createCallbackRoute>;
    logout: ReturnType<typeof createLogoutRoute>;
  };
}

/**
 * Wires one app up as an OAuth client of pistis.
 *
 * Call this once, in the app's own `lib/auth.ts`, and export what it returns.
 * Everything downstream — route handlers, layouts, server actions — takes the
 * config from there rather than reading the environment again.
 *
 * The session route is deliberately absent from `routes`: its body is the one
 * part of this flow that is genuinely per-app, so build it with
 * `createSessionRoute(auth.getSession, ...)` where the app can say what
 * belongs in it.
 */
export function createAuth(defaults: DaimonDefaults): Auth {
  const config = resolveConfig(defaults);
  const getSession = createGetSession(config);

  return {
    config,
    getSession,
    signOut: () => clearSession(config),
    storeTokens: (tokens: TokenResponse) => storeTokens(config, tokens),
    routes: {
      login: createLoginRoute(config),
      callback: createCallbackRoute(config),
      logout: createLogoutRoute(config),
    },
  };
}
