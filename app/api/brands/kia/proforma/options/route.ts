import { NextResponse } from 'next/server'
import { asc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaPriceDetails } from '@/lib/db/schema'
import { canApproveKiaProformaForUser } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { requirePermission } from '@/lib/permissions/service'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'

function normalizedValue(value: unknown) {
  return String(value || '').trim()
}

function distinctSorted(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

async function loadKiaOptionsData() {
  return getCachedData('kia:proforma:options:data', async () => {
    const priceRows = await db
      .select()
      .from(kiaPriceDetails)
      .where(sql`LEFT(model, 2) <> '__'`)
      .orderBy(asc(kiaPriceDetails.model), asc(kiaPriceDetails.trimDescription))

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

    return {
      prices: priceRows,
      models,
      trims,
      banks,
      insuranceCompanies,
    }
  }, CACHE_TTL.DASHBOARD)
}

export async function GET(request: Request) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await requirePermission(appUser, 'kia.proforma.view')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    const profile = await ensureKiaUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const lite = new URL(request.url).searchParams.get('lite') === '1'
    const optionsData = await loadKiaOptionsData()

    return NextResponse.json({
      currentUser: {
        id: appUser.id,
        email: appUser.email,
        fullName: appUser.fullName,
        role: appUser.role,
        isApprover: await canApproveKiaProformaForUser(appUser, profile.approver),
      },
      profile,
      ...optionsData,
      prices: lite ? [] : optionsData.prices,
    })
  } catch (error) {
    console.error('Error in GET /api/brands/kia/proforma/options:', error)
    return NextResponse.json({ error: 'Failed to load Kia Proforma options' }, { status: 500 })
  }
}
