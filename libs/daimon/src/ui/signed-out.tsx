import type { ReactNode } from 'react';

import { AuthShell, type AuthShellBrand } from './auth-shell.js';

export interface SignedOutPageOptions {
  /** How this app refers to itself in the copy. */
  appName: string;
  brand: AuthShellBrand;
  /** Where the sign-in form posts. */
  loginPath?: string;
  /** The sign-in control. See below for why this is passed in. */
  signInButton: ReactNode;
}

/**
 * Where signing out lands, and where a failed authorization comes back to.
 *
 * Deliberately not a sign-in form: no app built on daimon has a password field,
 * and the only way in is a round trip through pistis.
 *
 * The button is a GET form rather than a link because kosmos's `Button` renders
 * a real `<button>` with no `asChild` escape hatch. A GET form is the same
 * navigation and, unlike an onClick handler, still works before any JavaScript
 * has loaded — which matters on the one page someone reaches when their session
 * has just failed. The button itself is passed in rather than imported, so this
 * library does not depend on kosmos.
 */
export function createSignedOutPage({
  appName,
  brand,
  loginPath = '/api/auth/login',
  signInButton,
}: SignedOutPageOptions) {
  return async function SignedOutPage({
    searchParams,
  }: {
    searchParams: Promise<{ error?: string }>;
  }) {
    const { error } = await searchParams;

    return (
      <AuthShell
        title={error ? 'Sign-in did not complete' : 'Signed out'}
        description={
          error ??
          `You are signed out of ${appName}. Your session on the authorization server is untouched.`
        }
        brand={brand}
        footer={
          <>
            Accounts live in pistis, the aether-zone authorization server.{' '}
            {appName} keeps no password of its own.
          </>
        }
      >
        <form action={loginPath} method="get" className="mt-8">
          {signInButton}
        </form>
      </AuthShell>
    );
  };
}
