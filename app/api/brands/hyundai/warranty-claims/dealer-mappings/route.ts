import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'

export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await db.execute(sql`
    SELECT dealer_code, dealer_name, is_active, updated_at
    FROM hyundai_warranty_dealer_mappings
    ORDER BY dealer_code
  `)
  return NextResponse.json({ mappings: result })
}

export async function PUT(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (appUser.role !== 'admin' && appUser.role !== 'super_admin') {
    return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 })
  }
  const payload = await request.json() as { dealerCode?: string; dealerName?: string; isActive?: boolean }
  const dealerCode = String(payload.dealerCode || '').trim().toUpperCase()
  const dealerName = String(payload.dealerName || '').trim()
  if (!dealerCode || !dealerName) return NextResponse.json({ error: 'Dealer code and name are required' }, { status: 400 })
  await db.execute(sql`
    INSERT INTO hyundai_warranty_dealer_mappings (dealer_code, dealer_name, is_active, updated_by, updated_at)
    VALUES (${dealerCode}, ${dealerName}, ${payload.isActive !== false}, ${appUser.id}::uuid, now())
    ON CONFLICT (dealer_code) DO UPDATE SET
      dealer_name = EXCLUDED.dealer_name,
      is_active = EXCLUDED.is_active,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `)
  return NextResponse.json({ message: 'Dealer mapping saved' })
}
