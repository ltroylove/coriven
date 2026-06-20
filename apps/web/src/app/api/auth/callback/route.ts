import { NextResponse } from 'next/server'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/tasks'

  if (code) {
    const supabase = await createAuthServerClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
