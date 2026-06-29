import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL!
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const sql = 'REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1; REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;'
    const r = await fetch(`${SUPABASE_URL}/pg-meta/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) {
      const t = await r.text()
      throw new Error(t.substring(0, 200))
    }
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
