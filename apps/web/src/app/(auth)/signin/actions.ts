'use server'

import { redirect } from 'next/navigation'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

export async function signIn(email: string, password: string, next?: string) {
  const supabase = await createAuthServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  const destination = next && next.startsWith('/') ? next : '/tasks'
  redirect(destination)
}

export async function signOut() {
  const supabase = await createAuthServerClient()
  await supabase.auth.signOut()
  redirect('/signin')
}
