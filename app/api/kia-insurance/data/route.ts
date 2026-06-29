import { NextResponse } from 'next/server'
import { fetchAll } from '@/lib/kia-insurance/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await fetchAll('kia_insurance')
    return NextResponse.json({ rows, total: rows.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
