import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { logUserActivity } from '@/lib/activity/user-activity'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message || 'Invalid login credentials' },
        { status: 401 }
      )
    }

    const [appUser] = await db
      .select({
        id: users.id,
        role: users.role,
        brand: users.brand,
        isActive: users.isActive,
      })
      .from(users)
      .where(and(
        eq(users.supabaseId, data.user.id),
        isNull(users.deletedAt)
      ))
      .limit(1)

    // signInWithPassword has ALREADY minted a session cookie by this point, so an app-level
    // rejection has to tear it down — otherwise the browser keeps a valid Supabase session and
    // the proxy (lib/supabase/middleware.ts) waves it through on cookie presence alone.
    if (!appUser || !appUser.isActive) {
      await supabase.auth.signOut()
      return NextResponse.json(
        {
          error: appUser
            ? 'Your account is inactive. Please contact your administrator to reactivate it.'
            : 'This account does not have dashboard access. Please contact your administrator.',
          code: appUser ? 'account_inactive' : 'no_access',
        },
        { status: 403 }
      )
    }

    const redirectTo = appUser.role === 'md'
      ? '/purchase-orders'
      : '/dashboard'

    // The audit write must never be able to fail a sign-in — the session cookie is already set by
    // this point, so throwing here would 500 a user who is, in fact, successfully logged in.
    try {
      await logUserActivity({
        actor: {
          id: appUser.id,
          supabaseId: data.user.id,
          email: data.user.email || email,
          brand: appUser.brand || null,
        },
        eventType: 'login',
        routePath: '/auth/login',
        sectionKey: 'auth/login',
        metadata: {
          redirectTo,
        },
        request,
      })
    } catch (activityError) {
      console.error('Failed to record login activity:', activityError)
    }

    return NextResponse.json({
      success: true,
      redirectTo,
    })
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error)
    return NextResponse.json({ error: 'Unable to sign in right now' }, { status: 500 })
  }
}
