# @aether-zone/daimon

The pistis OAuth client for aether-zone's Next.js apps: the authorization code
flow, the session cookies it lands in, and the route handlers that drive it.

```sh
pnpm add @aether-zone/daimon
```

Peers: `next` ≥ 16, `oauth4webapi` ≥ 3, and `react` ≥ 19 for the `/ui` entry
point (optional — the rest of the library does not need it).

## Entry points

The split is load-bearing rather than tidy. The root entry reaches for
`server-only` and `next/headers`, which throw the moment they are pulled into a
client or middleware bundle — and the proxy still needs to know what this app's
session cookie is called.

| Import | What it is | Safe where |
| --- | --- | --- |
| `@aether-zone/daimon` | `createAuth`, the session, the route handlers, the api client, the failure responder | Server components, route handlers, server actions |
| `@aether-zone/daimon/ui` | `AuthShell`, `createSignedOutPage` | Anywhere React renders |
| `@aether-zone/daimon/config` | `cookieNames`, `resolveConfig`, `createProxy`, the claim types | Anywhere, including the proxy |
| `@aether-zone/daimon/upload` | `putToSignedUrl`, `cancelledOr` | The browser |
| `@aether-zone/daimon/format` | `formatBytes`, `initials` | Anywhere |

## Wiring an app up

One file, and everything downstream takes the session from it rather than
reading the environment again:

```ts
// web/lib/auth.ts
import 'server-only';

import { createAuth } from '@aether-zone/daimon';

export const auth = createAuth({
    cookiePrefix: 'loculus',
    clientId: 'loculus',
    redirectUri: 'http://localhost:3112/api/auth/callback',
    scopes: 'profile email organizations',
});

export const getSession = auth.getSession;
```

Next.js will not accept a route from a library, so each app keeps four one-line
files that re-export the handlers:

```ts
// web/app/api/auth/login/route.ts
import { auth } from '@/lib/auth';

export const GET = auth.routes.login;
```

`login`, `callback` and `logout` need nothing else. The session route is
deliberately *not* in `auth.routes`, because its body is the one part of this
flow that is genuinely per-app:

```ts
// web/app/api/auth/session/route.ts
import { createSessionRoute } from '@aether-zone/daimon';

import { auth } from '@/lib/auth';

export const GET = createSessionRoute(auth.getSession, (session) => ({
    user: session?.user ?? null,
    clientId: session?.clientId ?? null,
}));
```

### The proxy

`createProxy` supplies the handler. The `config` beside it has to be written out
in the app's own file — Next parses that object statically, so
`export const config = somethingImported` is refused, and so is
`matcher: [AN_IMPORTED_CONSTANT]`. This library therefore exports no matcher: it
could not be used in the one place it would be needed.

```ts
// web/proxy.ts
import { createProxy } from '@aether-zone/daimon/config';

export default createProxy({ cookiePrefix: 'loculus' });

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
```

Without a matcher the proxy runs on every request, including `_next/static` and
images, and the sign-in redirect blocks CSS and JS from loading.

## Configuration

`createAuth` takes the app's defaults; the environment overrides each one.

| Default | Environment | Notes |
| --- | --- | --- |
| `cookiePrefix` | — | Not overridable: changing it signs everyone out. |
| `clientId` | `OAUTH_CLIENT_ID` | |
| `redirectUri` | `OAUTH_REDIRECT_URI` | Must be registered with pistis. |
| `scopes` | `OAUTH_SCOPES` | Space-separated. `organizations` is what puts the `orgs` claim on the token. |
| `issuer` | `OAUTH_ISSUER` | Must equal the `iss` claim exactly. |
| `consentUrl` | `OAUTH_CONSENT_URL` | The pistis **web app**, not the discovered `authorization_endpoint`. |
| `signedOutPath` | — | Where signing out lands, and where a failed authorization comes back to. |

`OAUTH_CLIENT_SECRET` has no default and no app-level fallback. A missing one
fails at startup rather than at the token exchange, where pistis answers
`invalid_client` — which reads as "this client is not registered" rather than
"this app was started without its secret".

### The one place pistis departs from discovery

`consentUrl` is the pistis web app. `GET /api/oauth/authorize` answers with JSON
describing the pending request rather than redirecting to a login page, so
pointing a browser at the discovered `authorization_endpoint` renders raw JSON.
The consent screen is a separate application driving that endpoint, and it is
where a person is actually sent.

## Why the session is memoized

`getSession` is wrapped in React's `cache`. That is not an optimization: a
layout and the page inside it render concurrently and both want the session.
Without it, both notice the same expired access token and both spend the same
refresh token — which pistis treats as a replay, and answers by revoking the
whole family.

## License

MIT
