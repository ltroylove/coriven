---
datecreated: "2026-07-04"
lastupdated: "2026-07-04T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-015"
deciders: "Roy Love"
product:
  - "coriven"
tags: [tray, tauri, auth, bearer, jwt, api, supabase, desktop]
relateddocuments:
  - "docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md"
  - "docs/implementation/_main/epic-6-tauri-tray.md"
  - "apps/web/src/lib/supabase/api-server.ts"
---

# ADR-015: Bearer JWT Auth for Desktop Tray API Routes

**Status**: Accepted **Date**: 2026-07-04 **Deciders**: Roy Love **Related**: ADR-014 (Tauri tray as Epic 6), Epic 6 (Tauri Tray)

---

## Context

The Tauri tray (Epic 6) polls four backend API routes to drive its UI — due reminders, snooze, daily briefing, and pending approvals:

- `GET /api/tasks/due`
- `POST /api/tasks/[id]/snooze`
- `GET /api/briefing/today`
- `GET /api/approvals/pending`

All four routes authenticated exclusively via HTTP cookies (`createAuthServerClient` from `@supabase/ssr`). This is appropriate for browser callers (Next.js pages, Server Components) where the Supabase SSR library manages session cookies automatically.

The desktop tray is a different runtime context:

1. **No shared cookie jar.** The tray's Rust HTTP client (`reqwest`) makes standalone HTTP requests outside of any browser session. Supabase session cookies are managed by the webview for the in-app browser experience, but the background polling loop runs in Rust — it has no access to those cookies.
2. **The tray holds a Supabase access token.** After the user authenticates through the webview, the tray stores and periodically refreshes a Supabase JWT access token in the OS keychain (blueprint §13 / ADR-014 security requirement). This token is the tray's only credential.
3. **Middleware redirects unauthenticated API requests to `/signin`.** `apps/web/src/middleware.ts` 302-redirects any request without a valid session to `/signin`. A Rust `reqwest` client receives HTML, not JSON, and cannot follow the redirect usefully — the tray sees a 302 to a sign-in page and authentication fails entirely.

The combination means: tray Bearer requests → middleware 302 → sign-in HTML → tray cannot authenticate.

**Forces at play:**

- Browser callers (pages, Server Actions) use cookies and must continue to work without change.
- The tray's reqwest poller uses `Authorization: Bearer <access_token>` — the standard HTTP auth mechanism for machine clients.
- Supabase supports validating a JWT Bearer token server-side via `supabase.auth.getUser()` when the token is passed as a global Authorization header to the Supabase client.
- RLS must remain the tenant-isolation boundary in both auth paths; no path should bypass it.
- The middleware redirect to `/signin` is correct for browser navigations but wrong for API machine clients (which should receive 401, not redirect HTML).

---

## Considered Options

- **Option 1: Bearer support on the 4 API routes via a dual-path helper** — detect `Authorization: Bearer` header; if present, build a Supabase client with that JWT as the global Authorization header (validated by Supabase on `getUser()`); otherwise fall back to the existing cookie client. Stop middleware from redirecting Bearer-carrying `/api/*` requests.
- **Option 2: Cookie-in-tray** — embed Supabase session cookies in the tray's reqwest client alongside the access token. Requires cookie-jar management in Rust, re-implementing SSR cookie logic, and tight coupling between the tray and Next.js session internals — fragile and non-standard.
- **Option 3: Separate tray-specific token (e.g. signed HMAC secret)** — issue a dedicated long-lived API secret for the tray. Bypasses Supabase auth entirely, requires a new token issuance and rotation mechanism, and loses RLS user-scoping (the secret would need to carry user identity separately).
- **Option 4: Do nothing** — tray polling remains broken; desktop delivery surface is non-functional.

---

## Decision

**We have decided on Option 1: accept Supabase JWTs via `Authorization: Bearer` on the 4 tray-consumed API routes, validated server-side by Supabase, with RLS applying in both auth paths. Middleware bypasses its `/signin` redirect for API requests that carry a Bearer token.**

### Why This Choice

**Key factors:**

1. **Standard pattern for machine clients.** Bearer JWT is the HTTP-standard mechanism for server-to-server and desktop-to-server auth. The tray already holds a Supabase access token; using it directly avoids any new credential type.
2. **Genuine server-side validation.** Supabase validates the JWT on every `getUser()` call when the token is present as the global Authorization header. We never trust the token blindly — if it is expired or malformed, `getUser()` returns null and the route returns 401. This is the same security guarantee as the cookie path.
3. **RLS is unchanged.** In the Bearer path, the Supabase client runs as the authenticated user (the JWT encodes the user ID). RLS policies apply at the database level under that user, providing the same tenant-isolation guarantee as the cookie path.
4. **Cookie path is entirely unmodified.** The helper (`createApiServerClient`) checks for a `Bearer` prefix; any request without one falls through to the existing `createAuthServerClient()`. No existing browser call changes behaviour.
5. **Surgical middleware fix.** The middleware already has allowlists for `/api/auth` and public pages. Adding a bypass for `isApiRoute && hasBearerToken` is minimal and targeted: the route handler validates the token and returns 401 if invalid. An API client receiving a 302 to HTML is always incorrect behaviour; 401 is the correct contract.
6. **Single helper, two entry paths.** Consolidating both auth paths in one helper (`createApiServerClient`) keeps the logic auditable and DRY. Future routes that need to serve both browser and tray callers use the same helper with no additional plumbing.

**Implementation:**

```typescript
// apps/web/src/lib/supabase/api-server.ts
export async function createApiServerClient(request: Request) {
  const authHeader = request.headers.get('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length)
    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        cookies: { getAll: () => [], setAll: () => {} },
      },
    )
  }

  return createAuthServerClient() // cookie path unchanged
}
```

```typescript
// apps/web/src/middleware.ts (added guard)
const isApiRoute = pathname.startsWith('/api/')
const hasBearerToken = request.headers.get('Authorization')?.startsWith('Bearer ') ?? false

if (!user && !isAuthRoute && !isApiAuthRoute && !isPublicPage) {
  if (isApiRoute && hasBearerToken) {
    return supabaseResponse // let route return 401 for invalid token
  }
  // browser redirect unchanged
}
```

---

## Consequences

### Positive

- The Tauri tray can authenticate to the backend using its stored Supabase access token — the 302→HTML failure is eliminated.
- Browser callers (pages, Server Components, the web UI) are unaffected; their cookie-based auth path is unchanged.
- The API now has two well-defined auth entry paths — both validated by Supabase, both subject to RLS — consolidated in a single auditable helper.
- No new credential type, no new token issuance mechanism, no new infrastructure.
- The middleware change is surgical and backward-compatible: it only affects API routes with an explicit Bearer header, which previously received a redirect (always wrong for machine clients).

### Negative

- The API now has two auth entry paths, which slightly increases conceptual surface. Mitigated by having them in one helper.
- A Bearer token that arrives without a session cookie does not get its session refreshed by middleware (the middleware's cookie-refresh path runs with the cookie client). The tray handles its own token refresh via Tauri secure storage and the Supabase JS client in the webview — this is expected and consistent with the desktop model.

### Mitigation Strategies

- **Token validation is non-negotiable.** `getUser()` is always called; a missing or invalid token returns 401. No path skips validation.
- **Tokens must never be logged.** The helper extracts the token only to pass it to Supabase — it is not written to logs anywhere.
- **RLS is the per-user isolation guarantee.** The JWT encodes the user's ID; RLS policies enforce scoping at the DB layer. Application-level `eq('user_id', user.id)` filters (used in the service-client path for some routes) remain as defence-in-depth.
- **Short-lived access tokens.** The tray uses Supabase's standard short-lived access tokens (1 hour) and refreshes them via the webview's Supabase JS client. The Bearer path is not a pathway to long-lived static credentials.

---

## References

- ADR-014: `docs/architecture/decisions/ADR-014-tauri-tray-windows-first.md`
- Epic 6: `docs/implementation/_main/epic-6-tauri-tray.md`
- Helper: `apps/web/src/lib/supabase/api-server.ts`
- Middleware: `apps/web/src/middleware.ts`
- Routes: `apps/web/src/app/api/tasks/due/route.ts`, `apps/web/src/app/api/tasks/[id]/snooze/route.ts`, `apps/web/src/app/api/briefing/today/route.ts`, `apps/web/src/app/api/approvals/pending/route.ts`
- Supabase SSR docs: `@supabase/ssr` `createServerClient` with `global.headers`

---

**Last Updated**: 2026-07-04
