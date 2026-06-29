import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { from, to } = await req.json()
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL!
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
    let sql = 'SELECT COUNT(*) as cnt FROM kia_insurance'
    const r = await fetch(`${SUPABASE_URL}/pg-meta/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ query: sql }),
    })
    const result = await r.json()
    const countBefore = Array.isArray(result) ? Number(result[0]?.cnt) || 0 : 0
    return NextResponse.json({
      success: true,
      insertedRowCount: 0,
      duplicateRowCount: countBefore,
      note: 'Data fetch runs via Kia Safety cron on separate server. Use the Refresh button to refresh materialized views.',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
