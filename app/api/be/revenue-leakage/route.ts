import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createDbGate } from '@/lib/db/concurrency'
import {
  buildLeakageQuery,
  buildLeakageTrendQuery,
  mapLeakageRows,
  type LeakageBrand,
} from '@/lib/be/revenue-leakage'

export const dynamic = 'force-dynamic'
// Two grouped scans over a 142k-row table; a cold pooler connection alone costs ~1.8s.
export const maxDuration = 60

/**
 * Revenue-leakage panel for the Hyundai / Platinum Business Excellence overview.
 *
 * Everything is returned DEALER-WISE — main_dealer_code collapses every branch onto one code, so it
 * is deliberately not used; source_dealer_code is the real outlet.
 */
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const brandParam = searchParams.get('brand')
    const brand: LeakageBrand =
      brandParam === 'platinum' ? 'platinum' : brandParam === 'kia' ? 'kia' : 'hyundai'

    // Dates. Default to current month (MTD) rather than 12-month rolling:
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const rawStart = searchParams.get('startDate')
    const rawEnd = searchParams.get('endDate')
    const endDate = rawEnd && /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? rawEnd : iso(today)
    const currentMonthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    const startDate =
      rawStart && /^\d{4}-\d{2}-\d{2}$/.test(rawStart)
        ? rawStart
        : currentMonthStart

    // ⚠️ The BE overview passes a BRANCH ('JAMMU', 'KATHUA', 'RS_PURA'), not a dealer code. Comparing
    // it to source_dealer_code directly matched nothing and the panel rendered empty for every
    // branch. The brand's canonical filter owns the branch -> code mapping; pass the value straight
    // through and let it normalise.
    const dealerParam = searchParams.get('dealer')
    const dealerCode = dealerParam && dealerParam !== 'all' ? dealerParam : null

    // Gated: an unbounded fan-out against the production pooler stalls forever. See
    // lib/db/concurrency.ts — this is the bug that took the insurance section down.
    const gate = createDbGate()
    const [byDealerRaw, trendRaw] = await Promise.all([
      gate(() => db.execute(buildLeakageQuery(brand, { dealerCode, startDate, endDate }))),
      gate(() => db.execute(buildLeakageTrendQuery(brand, { dealerCode, startDate, endDate }))),
    ])

    const byDealer = mapLeakageRows(Array.isArray(byDealerRaw) ? (byDealerRaw as Record<string, unknown>[]) : [])

    // Group totals, summed from the dealer rows so the table and the header can never disagree.
    const sum = (pick: (r: (typeof byDealer)[number]) => number) => byDealer.reduce((n, r) => n + pick(r), 0)
    const totalLabour = sum((r) => r.labourAmt)
    const totalAmt = sum((r) => r.totalAmt)
    const totals = {
      dealers: byDealer.length,
      ros: sum((r) => r.ros),
      totalAmt,
      labourAmt: totalLabour,
      partAmt: sum((r) => r.partAmt),
      zeroLabour: sum((r) => r.zeroLabour),
      zeroParts: sum((r) => r.zeroParts),
      zeroBoth: sum((r) => r.zeroBoth),
      zeroTotal: sum((r) => r.zeroTotal),
      negativeTotal: sum((r) => r.negativeTotal),
      totalDisc: sum((r) => r.totalDisc),
      labourDisc: sum((r) => r.labourDisc),
      partDisc: sum((r) => r.partDisc),
      discRunningRepair: sum((r) => r.discRunningRepair),
      discAccidental: sum((r) => r.discAccidental),
      discPaidService: sum((r) => r.discPaidService),
      paidServiceZeroLabour: sum((r) => r.paidServiceZeroLabour),
      freeServiceRos: sum((r) => r.freeServiceRos),
      discVsLabourPct: totalLabour > 0 ? Math.round((sum((r) => r.labourDisc) / totalLabour) * 1000) / 10 : 0,
      discVsTotalPct: totalAmt > 0 ? Math.round((sum((r) => r.totalDisc) / totalAmt) * 1000) / 10 : 0,
    }

    const trendRows = (Array.isArray(trendRaw) ? trendRaw : []) as Record<string, unknown>[]
    const num = (v: unknown) => {
      const x = Number(v)
      return Number.isFinite(x) ? x : 0
    }

    return NextResponse.json({
      brand,
      window: { startDate, endDate },
      byDealer,
      totals,
      trend: trendRows.map((r) => ({
        monthKey: String(r.month_key || ''),
        dealer: String(r.dealer || ''),
        ros: num(r.ros),
        totalAmt: num(r.total_amt),
        labourAmt: num(r.labour_amt),
        totalDisc: num(r.total_disc),
        labourDisc: num(r.labour_disc),
        zeroBoth: num(r.zero_both),
      })),
    })
  } catch (error) {
    console.error('[be:revenue-leakage:error]', error)
    const message = error instanceof Error ? error.message : 'Failed to compute revenue leakage'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
