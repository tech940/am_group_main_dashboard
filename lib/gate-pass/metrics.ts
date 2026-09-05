/**
 * Every number the gate register reports, defined ONCE.
 *
 * ⚠️ Client-safe on purpose (no 'server-only', no db import). The detail view, the KPI strip, the
 * CSV export and any future report all call these, so "late", "distance" and "duration" cannot come
 * to mean three different things on three screens. That drift is not hypothetical here: this
 * codebase has shipped two contradictory days-of-supply formulas under one label, and a stage
 * inference duplicated into three files that disagreed.
 *
 * Every function returns null rather than a guess when an input is missing. A missing odometer is
 * "not recorded", which is a different fact from "0 km", and a register that quietly prints 0 for
 * an unrecorded reading is worse than one that admits the gap.
 */

export type GatePassMetricInput = {
  status: string
  createdAt: string | Date | null
  approvedAt: string | Date | null
  expectedReturnAt: string | Date | null
  gateOutAt: string | Date | null
  gateInAt: string | Date | null
  gateOutOdo: string | number | null
  gateInOdo: string | number | null
  gateOutPhotoPaths?: Record<string, string> | null
  gateInPhotoPaths?: Record<string, string> | null
  gateOutSignaturePath?: string | null
  gateInSignaturePath?: string | null
}

function ms(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function minutesBetween(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null
  return Math.round((to - from) / 60_000)
}

/** "2h 4m", "9m", "3d 2h". Compact enough for a table cell, exact enough to act on. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  const abs = Math.abs(Math.round(minutes))
  if (abs < 60) return `${abs}m`
  const days = Math.floor(abs / 1440)
  const hours = Math.floor((abs % 1440) / 60)
  const mins = abs % 60
  if (days > 0) return `${days}d ${hours}h`
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export type GatePassMetrics = {
  /** created → approved. How long the requester waited on a decision. */
  approvalMinutes: number | null
  /**
   * approved → gate out. How long the car sat approved before it actually moved.
   * Worth watching on its own: a large gap here means passes are being raised far ahead of the
   * trip, or approved and then forgotten — neither shows up in trip duration.
   */
  dispatchMinutes: number | null
  /** gate out → gate in. The trip itself. */
  tripMinutes: number | null
  /** Odometer difference. Null when either reading is missing. */
  distanceKm: number | null
  /**
   * Positive = late. Measured at RETURN for a closed pass, and against NOW for one still out —
   * two different questions that must not share a field. `lateBasis` says which was used.
   */
  lateMinutes: number | null
  lateBasis: 'returned' | 'still_out' | null
  /** True only when we can actually tell. A pass with no return time is not "on time". */
  onTime: boolean | null
  /** A closing reading below the opening one — a typo, or the wrong car. Never silently corrected. */
  odometerWentBackwards: boolean
  evidence: GatePassEvidence
}

export type GatePassEvidence = {
  outVehiclePhoto: boolean
  outOdometerPhoto: boolean
  outSignature: boolean
  inVehiclePhoto: boolean
  inOdometerPhoto: boolean
  inSignature: boolean
  /** Of the checks that APPLY at this stage, how many are present. */
  captured: number
  expected: number
  complete: boolean
}

function evidenceFor(input: GatePassMetricInput): GatePassEvidence {
  const out = input.gateOutPhotoPaths ?? {}
  const back = input.gateInPhotoPaths ?? {}

  const e = {
    outVehiclePhoto: Boolean(out.vehicle_front),
    outOdometerPhoto: Boolean(out.odometer),
    outSignature: Boolean(input.gateOutSignaturePath),
    inVehiclePhoto: Boolean(back.vehicle_front),
    inOdometerPhoto: Boolean(back.odometer),
    inSignature: Boolean(input.gateInSignaturePath),
  }

  /*
   * Only count what could have been captured yet. Scoring a pass that has not left as "0 of 6"
   * would make every live pass look non-compliant and train people to ignore the number.
   */
  const hasOut = Boolean(input.gateOutAt)
  const hasIn = Boolean(input.gateInAt)
  const applicable: boolean[] = []
  if (hasOut) applicable.push(e.outVehiclePhoto, e.outOdometerPhoto, e.outSignature)
  if (hasIn) applicable.push(e.inVehiclePhoto, e.inOdometerPhoto, e.inSignature)

  return {
    ...e,
    captured: applicable.filter(Boolean).length,
    expected: applicable.length,
    complete: applicable.length > 0 && applicable.every(Boolean),
  }
}

export function gatePassMetrics(input: GatePassMetricInput, now: Date = new Date()): GatePassMetrics {
  const created = ms(input.createdAt)
  const approved = ms(input.approvedAt)
  const due = ms(input.expectedReturnAt)
  const out = ms(input.gateOutAt)
  const back = ms(input.gateInAt)
  const odoOut = num(input.gateOutOdo)
  const odoIn = num(input.gateInOdo)

  let lateMinutes: number | null = null
  let lateBasis: GatePassMetrics['lateBasis'] = null
  if (due !== null && back !== null) {
    lateMinutes = minutesBetween(due, back)
    lateBasis = 'returned'
  } else if (due !== null && input.status === 'out') {
    lateMinutes = minutesBetween(due, now.getTime())
    lateBasis = 'still_out'
  }

  return {
    approvalMinutes: minutesBetween(created, approved),
    dispatchMinutes: minutesBetween(approved, out),
    tripMinutes: minutesBetween(out, back),
    distanceKm: odoOut !== null && odoIn !== null ? odoIn - odoOut : null,
    lateMinutes,
    lateBasis,
    onTime: lateMinutes === null ? null : lateMinutes <= 0,
    odometerWentBackwards: odoOut !== null && odoIn !== null && odoIn < odoOut,
    evidence: evidenceFor(input),
  }
}

export type GatePassSummary = {
  total: number
  outNow: number
  overdueNow: number
  awaitingApproval: number
  completedTrips: number
  onTimeReturns: number
  /** Null rather than 0 when nothing has completed — 0% and "no data" are different answers. */
  onTimeRate: number | null
  medianTripMinutes: number | null
  medianApprovalMinutes: number | null
  medianDispatchMinutes: number | null
  totalDistanceKm: number | null
  passesMissingEvidence: number
  odometerAnomalies: number
}

/**
 * Median, not mean. One demo car kept overnight by mistake would drag a mean so far that the
 * typical trip becomes unreadable — and the typical trip is the thing a manager is trying to see.
 */
function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 0 ? Math.round((clean[mid - 1] + clean[mid]) / 2) : clean[mid]
}

export function summariseGatePasses(
  rows: GatePassMetricInput[],
  now: Date = new Date(),
): GatePassSummary {
  const all = rows.map((r) => ({ row: r, m: gatePassMetrics(r, now) }))
  const completed = all.filter(({ row }) => row.status === 'returned')
  const distances = all.map(({ m }) => m.distanceKm).filter((d): d is number => d !== null && d >= 0)

  return {
    total: rows.length,
    outNow: rows.filter((r) => r.status === 'out').length,
    overdueNow: all.filter(({ m }) => m.lateBasis === 'still_out' && (m.lateMinutes ?? 0) > 0).length,
    awaitingApproval: rows.filter((r) => r.status === 'pending_approval').length,
    completedTrips: completed.length,
    onTimeReturns: completed.filter(({ m }) => m.onTime === true).length,
    onTimeRate: completed.length === 0
      ? null
      : Math.round((completed.filter(({ m }) => m.onTime === true).length / completed.length) * 100),
    medianTripMinutes: median(completed.map(({ m }) => m.tripMinutes).filter((v): v is number => v !== null)),
    medianApprovalMinutes: median(all.map(({ m }) => m.approvalMinutes).filter((v): v is number => v !== null)),
    medianDispatchMinutes: median(all.map(({ m }) => m.dispatchMinutes).filter((v): v is number => v !== null)),
    totalDistanceKm: distances.length === 0 ? null : distances.reduce((a, b) => a + b, 0),
    // Only a pass that HAS a gate event can be missing evidence for it.
    passesMissingEvidence: all.filter(({ m }) => m.evidence.expected > 0 && !m.evidence.complete).length,
    odometerAnomalies: all.filter(({ m }) => m.odometerWentBackwards).length,
  }
}
