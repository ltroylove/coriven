import { createServerClient } from '@supabase/ssr'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import type { Database } from '@/types/supabase'

/**
 * Bearer-aware server-side Supabase client for API route handlers.
 *
 * Resolution order:
 *   1. If the incoming request carries `Authorization: Bearer <token>`, create
 *      a Supabase client authenticated with that JWT.  The token is passed as a
 *      global Authorization header so `supabase.auth.getUser()` validates it
 *      server-side against Supabase's auth service and RLS applies under that
 *      user identity.  No cookies are read or written in this path.
 *   2. Otherwise, fall back to the cookie-based `createAuthServerClient()` so
 *      that existing browser callers continue to work without any change.
 *
 * Security:
 *   - The JWT is validated by Supabase on every `getUser()` call; we never trust
 *     it blindly.
 *   - RLS remains the tenant-isolation guarantee in both paths.
 *   - The token value is never logged.
 *
 * Use this in the 4 tray-consumed API routes (tasks/due, tasks/[id]/snooze,
 * briefing/today, approvals/pending) in place of the bare `createAuthServerClient`.
 */
export async function createApiServerClient(request: Request) {
  const authHeader = request.headers.get('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length)

    // Build a Supabase server client whose every request carries the caller's
    // JWT in the Authorization header.  This causes getUser() to validate the
    // token with Supabase rather than relying on cookies.
    const client = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        // No cookies needed — the desktop tray cannot set/read them.
        cookies: {
          getAll: () => [],
          setAll: () => {},
        },
      },
    )

    return client
  }

  // Cookie path: identical behaviour to what all routes used before.
  return createAuthServerClient()
}
