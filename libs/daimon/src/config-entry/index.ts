/**
 * Config and claims, with nothing that touches the server runtime.
 *
 * Separate from the root entry because the proxy (Next 16's `middleware`) runs
 * in a runtime where `server-only` and `next/headers` throw, and it still needs
 * to know what this app's session cookie is called.
 */
export * from '../claims.js';
export * from '../config.js';
export * from '../proxy.js';
