import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getAllCalls } from '@/lib/callyzer/client'
import { filterCalls, type CallFilters } from '@/lib/callyzer/analytics'
import { matchCustomers, phone10 } from '@/lib/customer-identity/phone-match'

export const dynamic = 'force-dynamic'

/** Paginated raw call log for the Recordings / Call Log tab. Served from the same cached rows. */
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
    const recordingsOnly = params.get('recordingsOnly') === 'true'
    const page = Math.max(1, Number(params.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(10, Number(params.get('pageSize')) || 25))

    const all = await getAllCalls({ startDate: filters.startDate, endDate: filters.endDate })

    // Same as the analytics route: a search must be able to find the name we display, not just
    // Callyzer's "Unknown". Only pays the extra query when a search term is actually present.
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

    let rows = filterCalls(all, filters, resolvedNames)
    if (recordingsOnly) rows = rows.filter((c) => Boolean(c.recordingUrl))

    const total = rows.length
    const slice = rows.slice((page - 1) * pageSize, page * pageSize)

    const matches = await matchCustomers(slice.map((c) => c.clientNumber)).catch(() => new Map())

    return NextResponse.json({
      rows: slice.map((c) => {
        const m = matches.get(phone10(c.clientNumber))
        return {
          id: c.id,
          clientNumber: c.clientNumber,
          clientName: c.clientName,
          duration: c.duration,
          callType: c.callType,
          callDate: c.callDate,
          callTime: c.callTime,
          note: c.note,
          empName: c.empName,
          empTags: c.empTags,
          // The upstream recording URL is deliberately NOT sent to the browser — Callyzer serves
          // recordings from a PUBLIC, unauthenticated, guessable path. The client gets an opaque id
          // and streams through our own authenticated proxy instead.
          hasRecording: Boolean(c.recordingUrl),
          matchedName: m?.customerName || null,
          matchedBooking: m?.bookingNumber || null,
          matchedModel: m?.model || null,
          matchedSource: m?.source || null,
        }
      }),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('Call log fetch failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load call log' },
      { status: 500 },
    )
  }
}
