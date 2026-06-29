import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('call_logs').select('*').order('call_date', { ascending: false })
    if (error) {
      if (error.message?.includes('relation') || error.code === '42P01') {
        return NextResponse.json({ logs: [] })
      }
      throw error
    }
    return NextResponse.json({ logs: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
