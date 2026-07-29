import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/config/env-config'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    env.supabase.url,
    env.supabase.anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and the
  // auth verification call. Supabase may refresh the session and write cookies.
  // issues with users being randomly logged out.

  let authenticated = false
  try {
    const { data, error } = await supabase.auth.getClaims()
    authenticated = !error && typeof data?.claims?.sub === 'string'
  } catch {
    // A stale local clock can make a server-valid JWT look expired. Do not
    // consume the refresh token in Proxy; the page/API data-access guard will
    // perform the definitive server-side check once.
  }

  // Public paths that must never require authentication (allowlist takes priority)
  const publicPaths = [
    '/brands/kia/payment-approvals/submit',
    '/brands/kia/approvals/submit',
    '/brands/hyundai/discount-approvals/submit',
  ]
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path))

  // Protected routes
  const protectedPaths = ['/dashboard', '/workshop', '/recon', '/inventory', '/reports', '/team', '/admin', '/brands', '/purchase-orders', '/am-finance']
  const isProtectedPath = !isPublicPath && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))
  const hasAuthCookie = request.cookies.getAll().some(({ name, value }) => (
    name.startsWith('sb-')
    && name.includes('auth-token')
    && Boolean(value)
  ))

  if (!authenticated && !hasAuthCookie && isProtectedPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Redirect to dashboard if user is logged in and tries to access login page
  if (authenticated && request.nextUrl.pathname === '/auth/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
