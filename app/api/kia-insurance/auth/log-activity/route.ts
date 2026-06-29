import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { action, page, details } = await req.json()
    try {
      await supabaseAdmin.from('auth_activities').insert({
        user_id: 'main-dashboard', username: 'User',
        action: action || 'view', page: page || '',
        details: details || {}, created_at: new Date().toISOString(),
      })
    } catch (_) {}
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ success: false })
  }
}
