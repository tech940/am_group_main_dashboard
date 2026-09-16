import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import {
  upsertDailyCommitments,
  clearDailyCommitment,
  readDailyCommitments,
  upsertTeamAssignments,
  isCommitmentScope,
  type CommitmentScope,
} from '@/lib/kia/commitments'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'

export const dynamic = 'force-dynamic'

/**
 * Recording what consultants COMMIT TO for a day, and which team they report to.
 *
 * ⚠️ NOTHING HERE WRITES AN ACHIEVEMENT. What actually happened is read from the DMS report feeds —
 * the same ones Sales Report reads — in lib/kia/sales-target-plan.ts. The moment this route accepts
 * an "achieved" number, the section starts disagreeing with Sales Report and the workbook's whole
 * failure mode comes back.
 *
 * ⚠️ THE SAME GATES AS THE PAGE, in the same order: brand scope, then `kia.sales_performance.view`,
 * then the manager role list. Guard/API desync is this codebase's recurring defect class.
 */
const TARGET_MANAGER_ROLES = new Set(['general_manager', 'sales_manager', 'sales_head', 'md', 'eba', 'admin', 'developer'])

async function gate() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse }

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const permission = await requirePermission(appUser, 'kia.sales_performance.view')
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }) }

  return { appUser }
}

/**
 * What is already committed for one outlet, so the form opens on what is there.
 *
 * ⚠️ `?scope=` SELECTS WHICH PROMISE IS BEING READ — 'day' (the default) or 'month'. Without it the
 * monthly form would open showing the 1st-of-the-month DAY commitments, which is a different set of
 * numbers that happens to share a date.
 */
export async function GET(request: Request) {
  try {
    const g = await gate()
    if (g.response) return g.response

    const { searchParams } = new URL(request.url)
    const dealerCode = searchParams.get('outlet') || searchParams.get('dealer_code') || ''
    const date = searchParams.get('date') || ''
    if (!dealerCode || !date) {
      return NextResponse.json({ error: 'An outlet and a date are required' }, { status: 400 })
    }

    const scopeParam = searchParams.get('scope')
    const scope: CommitmentScope = isCommitmentScope(scopeParam) ? scopeParam : 'day'

    const rows = await readDailyCommitments(dealerCode, date, scope)
    return NextResponse.json({ date, outlet: dealerCode, scope, entries: rows }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    })
  } catch (error) {
    console.error('Failed to read KIA daily commitments:', error)
    return NextResponse.json({ error: 'Failed to read commitments' }, { status: 400 })
  }
}

export async function POST(request: Request) {
  try {
    const g = await gate()
    if (g.response) return g.response
    const appUser = g.appUser!

    // Reading is open to the section; COMMITTING is a manager's act.
    if (!TARGET_MANAGER_ROLES.has(appUser.role)) {
      return NextResponse.json({ error: 'Only managers can record commitments.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      outlet?: string
      date?: string
      scope?: string
      entries?: unknown
      teams?: unknown
      year?: number
      month?: number
    }

    const outlet = String(body.outlet || '')
    if (!outlet) return NextResponse.json({ error: 'An outlet is required' }, { status: 400 })

    let saved = 0
    let teamsUpdated = 0

    if (body.date && Array.isArray(body.entries)) {
      const result = await upsertDailyCommitments(appUser, {
        dealerCode: outlet,
        date: String(body.date),
        /* Unrecognised scope falls back to 'day' rather than erroring — the narrower of the two. */
        scope: isCommitmentScope(body.scope) ? body.scope : 'day',
        entries: body.entries as Parameters<typeof upsertDailyCommitments>[1]['entries'],
      })
      saved = result.saved
    }

    /*
     * Team assignments ride along in the same save because they are edited on the same screen, but
     * they live on kia_sales_targets per MONTH — a person's team is not a property of one day.
     */
    if (Array.isArray(body.teams) && body.year && body.month) {
      const result = await upsertTeamAssignments(appUser, {
        dealerCode: outlet,
        year: Number(body.year),
        month: Number(body.month),
        entries: body.teams as { consultantName: string; teamLeader: string | null }[],
      })
      teamsUpdated = result.updated
    }

    if (saved > 0 || teamsUpdated > 0) {
      await invalidateCachePattern('kia:sales-target-plan:*')
    }

    return NextResponse.json({ saved, teamsUpdated })
  } catch (error) {
    console.error('Failed to save KIA daily commitments:', error)
    // ⚠️ The message is ours, never the driver's — a raw one names columns and constraints.
    const message = error instanceof Error && /required|YYYY-MM-DD|Invalid period/.test(error.message)
      ? error.message
      : 'Failed to save commitments'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/**
 * Removes one consultant's commitment for one day.
 *
 * ⚠️ NOT THE SAME AS SAVING ZEROS. A row of zeros is "I commit to nothing today" — a real decision on
 * a day with no stock. No row is "nobody has been asked". The screen must be able to say both.
 */
export async function DELETE(request: Request) {
  try {
    const g = await gate()
    if (g.response) return g.response
    if (!TARGET_MANAGER_ROLES.has(g.appUser!.role)) {
      return NextResponse.json({ error: 'Only managers can change commitments.' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const scopeParam = searchParams.get('scope')
    const result = await clearDailyCommitment({
      dealerCode: searchParams.get('outlet') || '',
      date: searchParams.get('date') || '',
      consultantName: searchParams.get('consultant') || '',
      /* ⚠️ Scoped, or clearing one day would delete that person's whole month commitment with it. */
      scope: isCommitmentScope(scopeParam) ? scopeParam : 'day',
    })
    await invalidateCachePattern('kia:sales-target-plan:*')
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to clear a KIA daily commitment:', error)
    return NextResponse.json({ error: 'Failed to clear the commitment' }, { status: 400 })
  }
}
