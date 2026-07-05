import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session — validates JWT with Supabase on every request.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Allow auth routes, the public landing page, and public assets through without a session check
  const isAuthRoute = pathname.startsWith('/signin')
  const isApiAuthRoute = pathname.startsWith('/api/auth')
  const isPublicPage = pathname === '/'

  // API requests carrying a Bearer token must NOT be redirected to /signin.
  // The route handler validates the JWT and returns 401 when invalid.
  // Redirecting to HTML sign-in for a machine client is always wrong.
  const isApiRoute = pathname.startsWith('/api/')
  const hasBearerToken = request.headers.get('Authorization')?.startsWith('Bearer ') ?? false

  if (!user && !isAuthRoute && !isApiAuthRoute && !isPublicPage) {
    if (isApiRoute && hasBearerToken) {
      // Let the route handler validate the token and return 401 if needed.
      return supabaseResponse
    }
    const url = request.nextUrl.clone()
    url.pathname = '/signin'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
