import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Browser-safe Supabase client.
 * Uses the anon key — RLS enforces row-level access.
 * Import this in client components and API routes that don't need admin access.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
