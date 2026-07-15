import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Sign-out that CLEARS THE COOKIE and lands the user back on the login page with an explanation.
 *
 * A Server Component cannot clear cookies, so a page guard that finds a deactivated user has no way
 * to end the session inline — it has to redirect through a Route Handler, which is this. /api/* is
 * excluded from the proxy matcher, so nothing intercepts it; once the cookie is gone the login page
 * is reachable again (the proxy bounces cookie-holders away from /auth/login).
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const requestUrl = new URL(request.url)
  const reason = requestUrl.searchParams.get('reason')
  const target = new URL('/auth/login', requestUrl.origin)
  if (reason) target.searchParams.set('reason', reason)

  return NextResponse.redirect(target, { status: 303 })
}

export async function POST() {
  const supabase = await createClient()
  
  const { error } = await supabase.auth.signOut()
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ success: true })
}

// Made with Bob
