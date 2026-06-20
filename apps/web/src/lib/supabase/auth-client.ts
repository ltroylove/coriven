import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

/**
 * Browser-safe Supabase client with session awareness.
 * Uses @supabase/ssr to manage auth cookies automatically.
 * Import this in client components that need auth state (signin, signup).
 */
export function createAuthClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
