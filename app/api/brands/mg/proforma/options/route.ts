import { NextResponse } from 'next/server'
import { asc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { mgPriceDetails } from '@/lib/db/schema'
import { canApproveMgProformaForUser } from '@/lib/mg-proforma/access'
import { ensureMgUserProfile } from '@/lib/mg-proforma/server'
import { requirePermission } from '@/lib/permissions/service'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'

function rows(result: unknown) {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows
  }
  return []
}

function normalizedValue(value: unknown) {
  return String(value || '').trim()
}

function distinctSorted(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

async function loadMgOptionsData() {
  return getCachedData('mg:proforma:options:data', async () => {
    const [priceRows, fuelRows, vehicleColorRows] = await Promise.all([
      db.select().from(mgPriceDetails).where(sql`LEFT(model, 2) <> '__'`).orderBy(asc(mgPriceDetails.model), asc(mgPriceDetails.trimDescription)),
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

    const models = distinctSorted(priceRows.map((row) => normalizedValue(row.model)))
    const trims = priceRows
      .filter((row) => normalizedValue(row.trimDescription))
      .map((row) => ({
        model: normalizedValue(row.model),
        trim_description: normalizedValue(row.trimDescription),
      }))

    const banks = priceRows
      .map((row) => ({
        bank_name: normalizedValue(row.bankName) || normalizedValue(row.hyp),
        bank_branch: normalizedValue(row.bankBranch),
      }))
      .filter((row) => row.bank_name)
      .filter((row, index, source) => source.findIndex((candidate) => (
        candidate.bank_name === row.bank_name && candidate.bank_branch === row.bank_branch
      )) === index)
      .sort((a, b) => a.bank_name.localeCompare(b.bank_name) || a.bank_branch.localeCompare(b.bank_branch))

    const insuranceCompanies = distinctSorted(priceRows.map((row) => normalizedValue(row.insuranceCompany)))
    const priceColours = distinctSorted(priceRows.map((row) => normalizedValue(row.colour)))
    const fuelTypes = distinctSorted([
      'DIESEL',
      'PETROL',
      'ELECTRIC',
      ...rows(fuelRows).map((row) => normalizedValue(row.fuel_type)),
    ])
    const vehicleColours = distinctSorted([
      ...rows(vehicleColorRows).map((row) => normalizedValue(row.vehicle_color)),
      ...priceColours,
    ])

    return {
      prices: priceRows,
      models,
      trims,
      banks,
      insuranceCompanies,
      priceColours,
      fuelTypes,
      vehicleColours,
    }
  }, CACHE_TTL.DASHBOARD)
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

    const optionsData = await loadMgOptionsData()

    return NextResponse.json({
      currentUser: {
        id: appUser.id,
        email: appUser.email,
        fullName: appUser.fullName,
        role: appUser.role,
        isApprover: await canApproveMgProformaForUser(appUser, profile.approver),
      },
      profile,
      ...optionsData,
    })
  } catch (error) {
    console.error('Error in GET /api/brands/mg/proforma/options:', error)
    return NextResponse.json({ error: 'Failed to load MG Proforma options' }, { status: 500 })
  }
}
