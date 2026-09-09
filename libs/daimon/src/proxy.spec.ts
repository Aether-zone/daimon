import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { createProxy } from './proxy.js';

const proxy = createProxy({ cookiePrefix: 'testapp' });

/** A request to `path`, optionally carrying a session cookie. */
function request(path: string, { signedIn = false } = {}) {
  const next = new NextRequest(new URL(path, 'https://app.test'));

  if (signedIn) {
    next.cookies.set('testapp.access_token', 'token-123');
  }

  return next;
}

describe('signed out', () => {
  it('sends a page request to the login route', () => {
    const response = proxy(request('/meetings'));
    const location = new URL(response.headers.get('location') as string);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/api/auth/login');
  });

  it('remembers where they were going, query string included', () => {
    const response = proxy(request('/meetings?filter=recent'));
    const location = new URL(response.headers.get('location') as string);

    expect(location.searchParams.get('returnTo')).toBe(
      '/meetings?filter=recent',
    );
  });

  it('answers an api call with 401 rather than a redirect', async () => {
    // Route handlers are called by fetch and XHR, which would follow a redirect
    // to the consent screen and report pistis's HTML as a perfectly good 200.
    const response = proxy(request('/api/objects/presign'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      message: 'Your session has expired. Sign in again.',
    });
  });
});

describe('signed in', () => {
  it('lets a page through on the presence of the cookie alone', () => {
    // Verifying the token is not possible here and would not be worth much: the
    // resource server validates it against pistis's keys, so a forged cookie
    // buys nothing but an empty page.
    const response = proxy(request('/meetings', { signedIn: true }));

    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('looks for this app’s cookie, not another’s', () => {
    const next = new NextRequest(new URL('/meetings', 'https://app.test'));

    next.cookies.set('otherapp.access_token', 'token-123');

    expect(proxy(next).headers.get('location')).toContain('/api/auth/login');
  });
});

describe('public prefixes', () => {
  it.each([
    '/api/auth/login',
    '/api/auth/callback',
    '/signed-out',
    '/signed-out?error=nope',
  ])('lets %s through signed out', (path) => {
    // The OAuth round trip, and where it lands on failure. Guarding these would
    // be a redirect loop.
    expect(proxy(request(path)).headers.get('location')).toBeNull();
  });

  it('matches a prefix exactly or as a path, not as a substring', () => {
    // `/signed-outside` is not `/signed-out`.
    expect(proxy(request('/signed-outside')).headers.get('location')).toContain(
      '/api/auth/login',
    );
  });

  it('takes the app’s own list when it has one', () => {
    const custom = createProxy({
      cookiePrefix: 'testapp',
      publicPrefixes: ['/public'],
    });

    expect(custom(request('/public/page')).headers.get('location')).toBeNull();
    expect(custom(request('/signed-out')).headers.get('location')).toContain(
      '/api/auth/login',
    );
  });
});
