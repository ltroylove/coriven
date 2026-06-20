import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

/**
 * Server-only Supabase client using the service role key.
 * Bypasses RLS — use ONLY in server-side code (API routes, Server Actions).
 * Never import this in client components.
 */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
