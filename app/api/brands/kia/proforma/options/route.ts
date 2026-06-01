import { NextResponse } from 'next/server'
import { asc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaPriceDetails } from '@/lib/db/schema'
import { canApproveKiaProforma } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'

export const dynamic = 'force-dynamic'

function rows(result: unknown) {
  return Array.isArray(result) ? result as Record<string, unknown>[] : []
}

export async function GET() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await ensureKiaUserProfile(appUser)
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [priceRows, modelRows, trimRows, bankRows, insuranceRows] = await Promise.all([
    db.select().from(kiaPriceDetails).where(sql`LEFT(model, 2) <> '__'`).orderBy(asc(kiaPriceDetails.model), asc(kiaPriceDetails.trimDescription)),
    db.execute(sql`SELECT DISTINCT model FROM kia_price_details WHERE NULLIF(TRIM(model), '') IS NOT NULL AND LEFT(model, 2) <> '__' ORDER BY model`),
    db.execute(sql`SELECT DISTINCT model, trim_description FROM kia_price_details WHERE NULLIF(TRIM(trim_description), '') IS NOT NULL AND LEFT(model, 2) <> '__' ORDER BY model, trim_description`),
    db.execute(sql`
      SELECT DISTINCT COALESCE(NULLIF(TRIM(bank_name), ''), NULLIF(TRIM(hyp), '')) AS bank_name, bank_branch
      FROM kia_price_details
      WHERE COALESCE(NULLIF(TRIM(bank_name), ''), NULLIF(TRIM(hyp), '')) IS NOT NULL
      ORDER BY bank_name, bank_branch
    `),
    db.execute(sql`SELECT DISTINCT insurance_company FROM kia_price_details WHERE NULLIF(TRIM(insurance_company), '') IS NOT NULL ORDER BY insurance_company`),
  ])

  return NextResponse.json({
    currentUser: {
      id: appUser.id,
      email: appUser.email,
      fullName: appUser.fullName,
      role: appUser.role,
      isApprover: canApproveKiaProforma(appUser.role, profile.approver),
    },
    profile,
    prices: priceRows,
    models: rows(modelRows).map((row) => String(row.model || '')).filter(Boolean),
    trims: rows(trimRows),
    banks: rows(bankRows),
    insuranceCompanies: rows(insuranceRows).map((row) => String(row.insurance_company || '')).filter(Boolean),
  })
}
