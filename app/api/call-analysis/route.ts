import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getAllCalls, getSyncState } from '@/lib/callyzer/client'
import { buildAnalytics, filterCalls, type CallFilters } from '@/lib/callyzer/analytics'
import { matchCustomers, phone10 } from '@/lib/callyzer/customer-match'
import { getExcludedNumbers } from '@/lib/callyzer/excluded-numbers'

export const dynamic = 'force-dynamic'

/**
 * Everything the Call Analysis page needs, in ONE request.
 *
 * Speed model: this NEVER talks to Callyzer. A background job (lib/callyzer/sync.ts) mirrors the
 * call log into `callyzer_calls`; this route reads that table. The reason is measured — Callyzer
 * serves ~2.7s per 100-row page and rejects concurrency, so paging ~1.9k calls live took ~54s and
 * hung the page. Date bounds are pushed into SQL against the indexed `call_date`; every metric is
 * then computed in memory over that slice, so a filter change is milliseconds of array work.
 */
export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewCallAnalysis(appUser.role)) {
    return NextResponse.json({ error: 'You do not have access to Call Analysis.' }, { status: 403 })
  }

  try {
    const params = new URL(request.url).searchParams
    const filters: CallFilters = {
      startDate: params.get('startDate'),
      endDate: params.get('endDate'),
      agent: params.get('agent'),
      callType: params.get('callType'),
      minDuration: Number(params.get('minDuration')) || null,
      search: params.get('search'),
    }

    // Date bounds go into SQL (call_date is indexed); the rest is in-memory on the slice.
    const [all, syncState, excluded] = await Promise.all([
      getAllCalls({ startDate: filters.startDate, endDate: filters.endDate }),
      getSyncState(),
      getExcludedNumbers(),
    ])

    // Only when the user is actually searching: resolve our own customer names for every number in
    // range first, so a search for "Sahil Sharma" matches the name the page displays rather than
    // Callyzer's client_name, which is "Unknown" on 97% of rows. Skipped otherwise — it is a query.
    let resolvedNames: Map<string, string> | undefined
    if (filters.search?.trim()) {
      const inRange = Array.from(new Set(all.map((c) => c.clientNumber)))
      const m = await matchCustomers(inRange).catch(() => new Map())
      resolvedNames = new Map(
        Array.from(m.values())
          .filter((v) => v.customerName)
          .map((v) => [v.phone10, v.customerName as string]),
      )
    }

    const scoped = filterCalls(all, filters, resolvedNames)
    const analytics = buildAnalytics(scoped, excluded)

    // Attach known customers to the two lists where a name actually changes the decision.
    const lookup = [
      ...analytics.topClients.map((c) => c.number),
      ...analytics.neverConnected.map((c) => c.number),
    ]
    const matches = await matchCustomers(lookup).catch(() => new Map())
    const decorate = <T extends { number: string; name: string }>(row: T) => {
      const m = matches.get(phone10(row.number))
      return {
        ...row,
        matchedName: m?.customerName || null,
        matchedBooking: m?.bookingNumber || null,
        matchedModel: m?.model || null,
        matchedStatus: m?.status || null,
        matchedConsultant: m?.consultant || null,
        matchedSource: m?.source || null,
      }
    }

    // Filter facets come from the FULL dataset, never the filtered slice, so options never vanish
    // as the user narrows down.
    const agentFacet = Array.from(
      new Map(all.map((c) => [c.empNumber, { number: c.empNumber, name: c.empName, tags: c.empTags }])).values()
    ).sort((a, b) => a.name.localeCompare(b.name))
    const dates = all.map((c) => c.callDate).filter(Boolean).sort()

    return NextResponse.json({
      ...analytics,
      topClients: analytics.topClients.map(decorate),
      neverConnected: analytics.neverConnected.map(decorate),
      syncState,
      facets: {
        agents: agentFacet,
        callTypes: ['Incoming', 'Outgoing', 'Missed', 'Rejected'],
        minDate: dates[0] || null,
        maxDate: dates[dates.length - 1] || null,
        totalCallsAvailable: all.length,
      },
    })
  } catch (error) {
    console.error('Call analysis failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to load call analysis'
    // Missing key is a configuration problem, not a server fault — say so plainly.
    const status = message.includes('CALLYZER_API_KEY') ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
