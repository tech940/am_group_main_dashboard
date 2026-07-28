import 'server-only'

import type { CallyzerCall } from '@/lib/callyzer/client'

/**
 * All Call Analysis metrics, computed in-memory from the cached raw call log.
 *
 * Nothing here talks to Callyzer — that is the point. Because every metric is derived locally, a
 * date/agent/type filter change is a few ms of array work instead of a rate-limited upstream round
 * trip. It also means the definitions are OURS and consistent across every sub-section (Callyzer's
 * own endpoints disagree with each other on "connected", for instance).
 */

// Callyzer's own rule, matched so our numbers reconcile with their dashboard: a call counts as
// connected when it lasted more than 2 seconds.
const CONNECTED_MIN_SECONDS = 2

/** Below this many calls in an hour, a connect rate is not a rate — it is a coin flip. */
const MIN_HOUR_VOLUME_FOR_RATE = 10

export type CallFilters = {
  startDate?: string | null // yyyy-mm-dd inclusive
  endDate?: string | null // yyyy-mm-dd inclusive
  agent?: string | null // emp_number
  callType?: string | null
  minDuration?: number | null
  search?: string | null
}

export type CallAnalyticsPayload = ReturnType<typeof buildAnalytics>

const isConnected = (c: CallyzerCall) => c.duration > CONNECTED_MIN_SECONDS

/**
 * @param resolvedNames phone10 -> the customer name we resolved from OUR records, so search can
 *   find it. Without this the haystack is Callyzer's own client_name, which is the literal string
 *   "Unknown" on 97.1% of rows — meaning typing the very name the page just displayed found nothing.
 */
export function filterCalls(
  calls: CallyzerCall[],
  f: CallFilters,
  resolvedNames?: Map<string, string>,
): CallyzerCall[] {
  const search = (f.search || '').trim().toLowerCase()
  const agent = (f.agent || '').trim()
  const callType = (f.callType || '').trim().toLowerCase()
  const minDuration = Number(f.minDuration) || 0

  return calls.filter((c) => {
    if (f.startDate && c.callDate < f.startDate) return false
    if (f.endDate && c.callDate > f.endDate) return false
    if (agent && agent !== 'all' && c.empNumber !== agent) return false
    if (callType && callType !== 'all' && c.callType.toLowerCase() !== callType) return false
    if (minDuration && c.duration < minDuration) return false
    if (search) {
      const resolved = resolvedNames?.get(last10(c.clientNumber)) || ''
      const hay = `${c.clientNumber} ${c.clientName} ${resolved} ${c.empName} ${c.note}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
}

/** Local copy of the phone10 rule — analytics must not import the server-only matcher. */
function last10(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

function hhmmss(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

/**
 * @param excluded phone10 -> why it is not a customer (the lead-routing trunk, or our own staff).
 *   These are kept OUT of the customer lists but NOT out of the headline call counts — the trunk is
 *   real traffic, and hiding it would understate how many calls the dealership actually handles.
 *   It is reported separately as `channels` instead.
 */
export function buildAnalytics(
  calls: CallyzerCall[],
  excluded?: Map<string, { label: string; reason: string }>,
) {
  const total = calls.length
  let incoming = 0, outgoing = 0, missed = 0, rejected = 0
  let duration = 0, incomingDuration = 0, outgoingDuration = 0
  let connected = 0, withRecording = 0

  const byDay = new Map<string, { date: string; calls: number; connected: number; duration: number; missed: number }>()
  const byHour = new Map<number, { calls: number; connected: number; duration: number }>()
  const byWeekday = new Map<number, { calls: number; connected: number; duration: number }>()
  const byAgent = new Map<string, {
    empNumber: string; empName: string; tags: string[]
    calls: number; incoming: number; outgoing: number; missed: number; rejected: number
    connected: number; duration: number; clients: Set<string>; recordings: number
  }>()
  const byClient = new Map<string, {
    number: string; name: string; calls: number; incoming: number; outgoing: number
    missed: number; connected: number; duration: number; lastDate: string; lastTime: string; agents: Set<string>
  }>()

  for (const c of calls) {
    const type = c.callType.toLowerCase()
    if (type === 'incoming') { incoming++; incomingDuration += c.duration }
    else if (type === 'outgoing') { outgoing++; outgoingDuration += c.duration }
    else if (type === 'missed') missed++
    else if (type === 'rejected') rejected++

    duration += c.duration
    const conn = isConnected(c)
    if (conn) connected++
    if (c.recordingUrl) withRecording++

    // ── daily
    const day = byDay.get(c.callDate) || { date: c.callDate, calls: 0, connected: 0, duration: 0, missed: 0 }
    day.calls++; day.duration += c.duration
    if (conn) day.connected++
    if (type === 'missed') day.missed++
    byDay.set(c.callDate, day)

    // ── hour of day (call_time is HH:mm:ss, customer timezone — no TZ maths needed)
    const hour = Number(c.callTime.slice(0, 2))
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      const h = byHour.get(hour) || { calls: 0, connected: 0, duration: 0 }
      h.calls++; h.duration += c.duration
      if (conn) h.connected++
      byHour.set(hour, h)
    }

    // ── weekday
    const dt = new Date(`${c.callDate}T00:00:00`)
    if (!Number.isNaN(dt.getTime())) {
      const wd = dt.getDay()
      const w = byWeekday.get(wd) || { calls: 0, connected: 0, duration: 0 }
      w.calls++; w.duration += c.duration
      if (conn) w.connected++
      byWeekday.set(wd, w)
    }

    // ── agent
    const aKey = c.empNumber || c.empName
    const a = byAgent.get(aKey) || {
      empNumber: c.empNumber, empName: c.empName, tags: c.empTags,
      calls: 0, incoming: 0, outgoing: 0, missed: 0, rejected: 0,
      connected: 0, duration: 0, clients: new Set<string>(), recordings: 0,
    }
    a.calls++; a.duration += c.duration
    if (type === 'incoming') a.incoming++
    else if (type === 'outgoing') a.outgoing++
    else if (type === 'missed') a.missed++
    else if (type === 'rejected') a.rejected++
    if (conn) a.connected++
    if (c.recordingUrl) a.recordings++
    if (c.clientNumber) a.clients.add(c.clientNumber)
    byAgent.set(aKey, a)

    // ── client
    if (c.clientNumber) {
      const cl = byClient.get(c.clientNumber) || {
        number: c.clientNumber, name: c.clientName, calls: 0, incoming: 0, outgoing: 0,
        missed: 0, connected: 0, duration: 0, lastDate: '', lastTime: '', agents: new Set<string>(),
      }
      cl.calls++; cl.duration += c.duration
      if (type === 'incoming') cl.incoming++
      else if (type === 'outgoing') cl.outgoing++
      else if (type === 'missed') cl.missed++
      if (conn) cl.connected++
      if (c.clientName && c.clientName !== 'Unknown') cl.name = c.clientName
      if (`${c.callDate} ${c.callTime}` > `${cl.lastDate} ${cl.lastTime}`) { cl.lastDate = c.callDate; cl.lastTime = c.callTime }
      if (c.empName) cl.agents.add(c.empName)
      byClient.set(c.clientNumber, cl)
    }
  }

  const activeDays = byDay.size

  // ── split the non-customers out of the client lists. Everything above this line already counted
  // them, which is deliberate: they are real calls.
  const isExcluded = (number: string) => excluded?.get(last10(number))
  const clientValues = Array.from(byClient.values())
  const customerRows = clientValues.filter((c) => !isExcluded(c.number))
  const excludedRows = clientValues.filter((c) => isExcluded(c.number))

  const uniqueClients = customerRows.length

  /** The trunk reported as what it is: a channel, with its own answer rate. */
  const channels = excludedRows
    .map((c) => {
      const meta = isExcluded(c.number)
      return {
        number: c.number,
        label: meta?.label || 'Excluded',
        reason: meta?.reason || 'trunk',
        calls: c.calls,
        incoming: c.incoming,
        outgoing: c.outgoing,
        missed: c.missed,
        connected: c.connected,
        duration: c.duration,
        durationLabel: hhmmss(c.duration),
        missedRate: c.calls ? Math.round((c.missed / c.calls) * 100) : 0,
      }
    })
    .sort((a, b) => b.calls - a.calls)

  // ── missed opportunities: clients we NEVER connected with in this window. This is the
  // commercially interesting cut — every one is a person who tried to reach the dealership, or whom
  // we tried to reach, and no conversation ever happened.
  const neverConnected = customerRows
    .filter((c) => c.connected === 0)
    .sort((a, b) => b.calls - a.calls || b.missed - a.missed)

  const dailyTrend = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))

  const hourly = Array.from({ length: 24 }, (_, h) => {
    const v = byHour.get(h) || { calls: 0, connected: 0, duration: 0 }
    return {
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      calls: v.calls,
      connected: v.connected,
      duration: v.duration,
      connectRate: v.calls ? Math.round((v.connected / v.calls) * 100) : 0,
      // An hour holding one 5-second call scores 100% and outranks the working day. The panel tells
      // a manager to plan calling windows around this chart, so a rate on a handful of calls is
      // not just noise — it is bad advice. The UI must not treat these as rankable.
      reliable: v.calls >= MIN_HOUR_VOLUME_FOR_RATE,
    }
  })

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const weekday = WEEKDAYS.map((label, i) => {
    const v = byWeekday.get(i) || { calls: 0, connected: 0, duration: 0 }
    return {
      day: label,
      short: label.slice(0, 3),
      calls: v.calls,
      connected: v.connected,
      duration: v.duration,
      connectRate: v.calls ? Math.round((v.connected / v.calls) * 100) : 0,
    }
  })

  const agents = Array.from(byAgent.values())
    .map((a) => ({
      empNumber: a.empNumber,
      empName: a.empName,
      tags: a.tags,
      calls: a.calls,
      incoming: a.incoming,
      outgoing: a.outgoing,
      missed: a.missed,
      rejected: a.rejected,
      connected: a.connected,
      duration: a.duration,
      durationLabel: hhmmss(a.duration),
      uniqueClients: a.clients.size,
      recordings: a.recordings,
      connectRate: a.calls ? Math.round((a.connected / a.calls) * 100) : 0,
      avgDuration: a.connected ? Math.round(a.duration / a.connected) : 0,
    }))
    .sort((a, b) => b.calls - a.calls)

  const clients = customerRows
    .map((c) => ({
      number: c.number,
      name: c.name,
      calls: c.calls,
      incoming: c.incoming,
      outgoing: c.outgoing,
      missed: c.missed,
      connected: c.connected,
      duration: c.duration,
      durationLabel: hhmmss(c.duration),
      lastDate: c.lastDate,
      lastTime: c.lastTime,
      agents: Array.from(c.agents),
    }))
    .sort((a, b) => b.calls - a.calls || b.duration - a.duration)

  return {
    summary: {
      totalCalls: total,
      incoming,
      outgoing,
      missed,
      rejected,
      connected,
      notConnected: total - connected,
      connectRate: total ? Math.round((connected / total) * 100) : 0,
      totalDuration: duration,
      totalDurationLabel: hhmmss(duration),
      incomingDuration,
      outgoingDuration,
      avgCallDuration: connected ? Math.round(duration / connected) : 0,
      uniqueClients,
      activeDays,
      avgCallsPerDay: activeDays ? Math.round(total / activeDays) : 0,
      withRecording,
      recordingCoverage: total ? Math.round((withRecording / total) * 100) : 0,
      neverConnectedClients: neverConnected.length,
      agentCount: agents.length,
      // Reported, not hidden: these calls ARE in every count above.
      excludedCalls: excludedRows.reduce((n, c) => n + c.calls, 0),
      excludedNumbers: excludedRows.length,
    },
    channels,
    callTypeMix: [
      { name: 'Incoming', value: incoming },
      { name: 'Outgoing', value: outgoing },
      { name: 'Missed', value: missed },
      { name: 'Rejected', value: rejected },
    ].filter((x) => x.value > 0),
    dailyTrend,
    hourly,
    weekday,
    agents,
    // Both lists are capped. The totals travel with them so the UI can say "showing 100 of 140"
    // instead of announcing an uncapped count above a truncated table.
    topClients: clients.slice(0, 50),
    topClientsTotal: clients.length,
    neverConnectedTotal: neverConnected.length,
    neverConnected: neverConnected.slice(0, 100).map((c) => ({
      number: c.number,
      name: c.name,
      calls: c.calls,
      missed: c.missed,
      lastDate: c.lastDate,
      lastTime: c.lastTime,
      agents: Array.from(c.agents),
    })),
  }
}
