/** A role in an organization, as pistis defines it. Ordered by authority. */
export type MembershipRole = 'owner' | 'admin' | 'member';

/**
 * One entry of the access token's `orgs` claim.
 *
 * `role` is the fact every access decision turns on. `name` and `slug` are for
 * display and are only as fresh as the token — a rename in pistis shows up at
 * the next refresh — so nothing should ever key on them.
 */
export interface OrganizationMembership {
  role: MembershipRole;
  name: string;
  slug: string;
}

/**
 * Claims of a pistis access token (RFC 9068 §2.2).
 *
 * `orgs` is optional because it is only present when the `organizations` scope
 * was granted — akouo asks for it, loculus does not.
 */
export interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  scope: string;
  orgs?: Record<string, OrganizationMembership>;
}

/**
 * Reads the claims out of an access token **without verifying the signature**.
 *
 * Safe only because of what it is used for: naming the client an object will
 * belong to, choosing what to render, and picking an organization to put in a
 * URL. Every request that acts on a claim is checked by the resource server,
 * which verifies the same token against pistis's published keys. Nothing
 * decoded here is a permission.
 */
export function readClaims(accessToken: string): AccessTokenClaims | null {
  const payload = accessToken.split('.')[1];

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as AccessTokenClaims;
  } catch {
    return null;
  }
}
