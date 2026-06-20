import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'

/**
 * Server-side Supabase client with session awareness.
 * Uses @supabase/ssr to read/write auth cookies via Next.js cookies().
 * Import this in Server Components, Server Actions, and Route Handlers
 * where you need the current user's session.
 */
export async function createAuthServerClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll can fail in Server Components (read-only context).
            // This is expected — middleware handles the refresh instead.
          }
        },
      },
    }
  )
}
