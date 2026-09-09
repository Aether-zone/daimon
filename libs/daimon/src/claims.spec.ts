import { describe, expect, it } from 'vitest';

import { readClaims } from './claims.js';

const segment = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Shaped like a JWT. Only the payload is ever read. */
const tokenOf = (claims: object) =>
  `${segment({ alg: 'RS256' })}.${segment(claims)}.signature`;

describe('readClaims', () => {
  it('reads the claims a session is built from', () => {
    const token = tokenOf({
      sub: 'user-1',
      client_id: 'loculus',
      scope: 'profile email',
    });

    expect(readClaims(token)).toMatchObject({
      sub: 'user-1',
      client_id: 'loculus',
      scope: 'profile email',
    });
  });

  it('reads the orgs claim, which only some tokens carry', () => {
    const token = tokenOf({
      sub: 'user-1',
      orgs: { 'org-1': { role: 'admin', name: 'Acme', slug: 'acme' } },
    });

    expect(readClaims(token)?.orgs?.['org-1']).toEqual({
      role: 'admin',
      name: 'Acme',
      slug: 'acme',
    });
  });

  it('handles a payload with characters base64url encodes differently', () => {
    // Plain base64 would produce + and /, which a URL-safe decoder rejects.
    const token = tokenOf({ sub: 'user-1', name: 'Ada ~ Lovelace ?+/' });

    expect(readClaims(token)?.sub).toBe('user-1');
  });

  it.each([
    ['not-a-jwt', 'no segments'],
    ['', 'empty'],
    ['header.', 'an empty payload'],
    [
      `${segment({ alg: 'RS256' })}.not-valid-json!.sig`,
      'an unreadable payload',
    ],
  ])('answers null for %p — %s', (token) => {
    // Nothing here is a permission: an unreadable token yields no claims rather
    // than throwing at whatever was about to render.
    expect(readClaims(token)).toBeNull();
  });

  it('does not verify the signature, and is only ever used where that is safe', () => {
    // The signature is nonsense and the claims still come back — the resource
    // server is what actually checks the token.
    const token = `${segment({ alg: 'RS256' })}.${segment({ sub: 'anyone' })}.forged`;

    expect(readClaims(token)?.sub).toBe('anyone');
  });
});
