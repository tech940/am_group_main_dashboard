import { NextResponse } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaPriceDetails } from '@/lib/db/schema'
import { canApproveKiaProformaForUser } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { requirePermission } from '@/lib/permissions/service'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

import { normalizeBankName } from '@/lib/kia/bank-utils'

export const dynamic = 'force-dynamic'

function normalizedValue(value: unknown) {
  return String(value || '').trim()
}

function distinctSorted(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

async function loadKiaOptionsData() {
  return getCachedData('kia:proforma:options:data', async () => {
    // Prices/models/trims come from the priced rows. The FULL bank-branch master list also lives in
    // kiaPriceDetails (under model '__BANK_BRANCH__') so every branch is selectable in the HYP
    // dropdown — not only the ~156 branches that happen to sit on a priced row.
    const allPriceDetails = await db
      .select()
      .from(kiaPriceDetails)

    const priceRows = allPriceDetails.filter((row) => !row.model.startsWith('__'))

    const models = distinctSorted(priceRows.map((row) => normalizedValue(row.model)))
    const trims = priceRows
      .filter((row) => normalizedValue(row.trimDescription))
      .map((row) => ({
        model: normalizedValue(row.model),
        trim_description: normalizedValue(row.trimDescription),
      }))

    const banks = allPriceDetails
      .map((row) => ({
        bank_name: normalizeBankName(row.bankName || row.hyp),
        bank_branch: normalizedValue(row.bankBranch),
      }))
      .filter((row) => row.bank_name && row.bank_branch)
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

    // profile + options are independent — they were awaited one after the other, paying two serial
    // pooler round trips (~225ms each) before the response could start. isApprover genuinely depends
    // on profile.approver, so it stays a second wave (and was previously hidden inside the JSON literal).
    const lite = new URL(request.url).searchParams.get('lite') === '1'
    const [profile, optionsData] = await Promise.all([
      ensureKiaUserProfile(appUser),
      loadKiaOptionsData(),
    ])
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isApprover = await canApproveKiaProformaForUser(appUser, profile.approver)

    return NextResponse.json({
      currentUser: {
        id: appUser.id,
        email: appUser.email,
        fullName: appUser.fullName,
        role: appUser.role,
        isApprover,
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
