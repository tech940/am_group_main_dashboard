import { NextResponse } from 'next/server'
import { asc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { mgPriceDetails } from '@/lib/db/schema'
import { canApproveMgProformaForUser } from '@/lib/mg-proforma/access'
import { ensureMgUserProfile } from '@/lib/mg-proforma/server'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'

function rows(result: unknown) {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows
  }
  return []
}

export async function GET() {
  try {
    const accessResponse = await requireBrandApiAccess('mg')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await requirePermission(appUser, 'mg.proforma.view')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    const profile = await ensureMgUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [priceRows, modelRows, trimRows, bankRows, insuranceRows, priceColourRows, fuelRows, vehicleColorRows] = await Promise.all([
      db.select().from(mgPriceDetails).where(sql`LEFT(model, 2) <> '__'`).orderBy(asc(mgPriceDetails.model), asc(mgPriceDetails.trimDescription)),
      db.execute(sql`SELECT DISTINCT model FROM mg_price_details WHERE NULLIF(TRIM(model), '') IS NOT NULL AND LEFT(model, 2) <> '__' ORDER BY model`),
      db.execute(sql`SELECT DISTINCT model, trim_description FROM mg_price_details WHERE NULLIF(TRIM(trim_description), '') IS NOT NULL AND LEFT(model, 2) <> '__' ORDER BY model, trim_description`),
      db.execute(sql`
        SELECT DISTINCT COALESCE(NULLIF(TRIM(bank_name), ''), NULLIF(TRIM(hyp), '')) AS bank_name, bank_branch
        FROM mg_price_details
        WHERE COALESCE(NULLIF(TRIM(bank_name), ''), NULLIF(TRIM(hyp), '')) IS NOT NULL
        ORDER BY bank_name, bank_branch
      `),
      db.execute(sql`SELECT DISTINCT insurance_company FROM mg_price_details WHERE NULLIF(TRIM(insurance_company), '') IS NOT NULL ORDER BY insurance_company`),
      db.execute(sql`SELECT DISTINCT colour FROM mg_price_details WHERE NULLIF(TRIM(colour), '') IS NOT NULL ORDER BY colour`),
      db.execute(sql`
        SELECT DISTINCT fuel_type
        FROM mg_proformas
        WHERE deleted_at IS NULL AND NULLIF(TRIM(fuel_type), '') IS NOT NULL
        ORDER BY fuel_type
      `),
      db.execute(sql`
        SELECT DISTINCT vehicle_color
        FROM mg_proformas
        WHERE deleted_at IS NULL AND NULLIF(TRIM(vehicle_color), '') IS NOT NULL
        ORDER BY vehicle_color
      `),
    ])

    return NextResponse.json({
      currentUser: {
        id: appUser.id,
        email: appUser.email,
        fullName: appUser.fullName,
        role: appUser.role,
        isApprover: await canApproveMgProformaForUser(appUser, profile.approver),
      },
      profile,
      prices: priceRows,
      models: rows(modelRows).map((row) => String(row.model || '')).filter(Boolean),
      trims: rows(trimRows),
      banks: rows(bankRows),
      insuranceCompanies: rows(insuranceRows).map((row) => String(row.insurance_company || '')).filter(Boolean),
      priceColours: rows(priceColourRows).map((row) => String(row.colour || '').trim()).filter(Boolean),
      fuelTypes: Array.from(new Set(['DIESEL', 'PETROL', 'ELECTRIC', ...rows(fuelRows).map((row) => String(row.fuel_type || '').trim()).filter(Boolean)])),
      vehicleColours: Array.from(new Set([
        ...rows(vehicleColorRows).map((row) => String(row.vehicle_color || '').trim()).filter(Boolean),
        ...rows(priceColourRows).map((row) => String(row.colour || '').trim()).filter(Boolean),
      ])),
    })
  } catch (error) {
    console.error('Error in GET /api/brands/mg/proforma/options:', error)
    return NextResponse.json({ error: 'Failed to load MG Proforma options' }, { status: 500 })
  }
}
