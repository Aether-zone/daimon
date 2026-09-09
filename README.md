# daimon

The pistis OAuth client for aether-zone's Next.js apps: the authorization code
flow, the session cookies it lands in, and the route handlers that drive it.

There is no application in this repository. `libs/daimon` is the only package,
and the workspace exists to build, test and publish it.

## Why it exists

akouo and loculus each carried their own copy of this flow — `lib/oauth.ts`,
`lib/session.ts`, and four route handlers under `app/api/auth/`. The copies had
drifted: loculus had memoized `getSession` with React's `cache` to stop a layout
and its page racing to spend the same refresh token, and akouo had not, so akouo
could still lose a whole token family to a concurrent render. Everything else
differed only in a cookie prefix, six configuration values, and prose.

## Entry points

| Import | What it is | Safe where |
| --- | --- | --- |
| `@aether-zone/daimon` | `createAuth`, the session, the route handlers, the api client, the failure responder | Server components, route handlers, server actions |
| `@aether-zone/daimon/ui` | `AuthShell`, `createSignedOutPage` | Anywhere React renders |
| `@aether-zone/daimon/config` | `cookieNames`, `resolveConfig`, `createProxy`, the claim types | Anywhere, including the proxy |
| `@aether-zone/daimon/upload` | `putToSignedUrl`, `cancelledOr` | The browser |
| `@aether-zone/daimon/format` | `formatBytes`, `initials` | Anywhere |

The split is load-bearing rather than tidy. The root entry reaches for
`server-only` and `next/headers`, which throw the moment they are pulled into a
client or middleware bundle — and the proxy still needs to know what this app's
session cookie is called. `/config` is what it imports instead.

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
    scopes: 'profile email',
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
flow that is genuinely per-app — akouo answers with the person's organizations,
loculus with the OAuth client its objects belong to:

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
in the app's own file — Next parses that object statically, at compile time, so
`export const config = somethingImported` is refused, and so is
`matcher: [AN_IMPORTED_CONSTANT]`. daimon therefore exports no matcher: it could
not be used in the one place it would be needed. Both apps use this one:

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
| `consentUrl` | `OAUTH_CONSENT_URL` | The pistis **web app**, not the discovered `authorization_endpoint` — see below. |
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

## Commands

```sh
pnpm build       # tsup: ESM and .d.ts into libs/daimon/dist
pnpm test        # vitest
pnpm typecheck
pnpm lint
pnpm format
```

Run one file with
`pnpm --filter @aether-zone/daimon exec vitest run src/failure.spec.ts`.

## What the tests cover, and what they do not

92 tests across `config`, `claims`, `api`, `failure`, `proxy`, `upload` and
`format`. They lean hardest on the places where consolidating the two apps'
copies could have changed behaviour quietly:

- **`format.spec.ts`** pins the edges each app's copy got wrong — loculus
  rendered 999_999 B as "1000 kB", akouo rendered a NaN as "NaN kB" and capped
  at GB.
- **`failure.spec.ts`** pins the message precedence in both directions. The two
  apps genuinely disagree about whether the api's message or the route's own
  wording wins, and merging them nearly flipped loculus's silently.
- **`upload.spec.ts`** drives a controllable `XMLHttpRequest`, because the thing
  worth testing is the event wiring: which listener settles the promise, and
  whether the abort listener is removed once it has.

Not covered: `oauth.ts`, which is `oauth4webapi` driving a live discovery
document; `session.ts`, which needs `next/headers`; and the two components under
`ui/`. All three want a running pistis or a browser, and are better served by
the apps' own end-to-end tests than by mocks of the libraries underneath them.

## Publishing

`libs/daimon` is the only publishable package. It has no version history yet and
is consumed locally by path:

```json
"@aether-zone/daimon": "file:../../daimon/libs/daimon"
```

That works for a checkout with the repos side by side and does not work in CI or
a Docker build. Publishing it properly is blocked on the same unresolved
question as organon: `@aether-zone/kosmos` publishes to GitHub Packages,
`@aether-zone/organon` names npmjs, and no `.npmrc` in any repo routes the scope
to either.
