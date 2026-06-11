import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
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
        role: users.role,
      })
      .from(users)
      .where(and(
        eq(users.supabaseId, data.user.id),
        eq(users.isActive, true),
        isNull(users.deletedAt)
      ))
      .limit(1)

    return NextResponse.json({
      success: true,
      redirectTo: appUser?.role === 'finance_head'
        ? '/finance-orders'
        : appUser?.role === 'md'
          ? '/purchase-orders'
          : '/dashboard',
    })
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error)
    return NextResponse.json({ error: 'Unable to sign in right now' }, { status: 500 })
  }
}
