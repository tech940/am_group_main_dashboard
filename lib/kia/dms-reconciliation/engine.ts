/**
 * KIA DMS reconciliation engine — pure. Given our bookings and the DMS bookings (already folded from
 * the three DMS feeds by load.ts), decide which DMS booking each of ours is, and where the two disagree.
 *
 * ── The DMS side, as measured (2026-09-18) ──────────────────────────────────────────────────────
 * A DMS booking is (booking_no, customer_id). NOT (dealer, booking_no): Jammu and Udhampur reuse the
 * same B-numbers, and one booking is often listed under BOTH dealers with different statuses —
 * B202600358 still read "Booking" under JK501 from 13 Jul after JK402's listing moved it to "Retail".
 * On (booking_no, customer_id) the joins are near-perfect: 948/949 sales rows, 757/757 receipts.
 * The receipt feed carries no phone, PAN or chassis — it reaches a customer ONLY through this key.
 *
 * ── Our side ───────────────────────────────────────────────────────────────────────────────────
 * kia_bookings stores no DMS id (4 hand-reconciled exceptions in metadata.dmsBookingNo). So the
 * bridge is identifiers, strongest first (MATCH_TIER_LABEL). Tiers 1–4 link; 5+ are only "possible"
 * and go to Needs Review — the owner's rule is never to link two customers on a hunch.
 *
 * ── Classification ─────────────────────────────────────────────────────────────────────────────
 * One exception per booking at most — the most severe disagreement. Aligned bookings produce nothing:
 * this is an exceptions list, not a second copy of the bookings table.
 */
import {
  CONFIDENT_MATCH_MAX_TIER,
  DMS_PAID_THRESHOLD,
  MATCH_TIER_LABEL,
  OUR_STAGE_LABEL,
  RECON_TYPE_META,
  type OurStage,
  type ReconExceptionType,
  type ReconKind,
  type ReconSeverity,
} from './types'
import { daysBetween, isInstitutionalName, modelsAgree, namesAgree } from './normalize'

export type OurBookingInput = {
  id: string
  bookingNumber: string
  status: string
  heldFromStatus: string | null
  dealerCode: string | null
  customerName: string
  /** Last 10 digits, or ''. */
  phone: string
  /** Validated PAN, or ''. In memory only — never persisted or served. */
  pan: string
  /** Normalised allocated_vin, or ''. */
  vin: string
  dmsBookingNo: string | null
  model: string | null
  variant: string | null
  /** yyyy-mm-dd — the booking date entered on the booking, else its creation date (IST). */
  bookingDate: string
  /** yyyy-mm-dd (IST) when marked delivered. */
  deliveredOn: string | null
  /** Accounts confirmed payment here, or the booking is past that step, or ₹7L+ recorded here. */
  paymentProgressed: boolean
}

export type DmsBookingInput = {
  key: string
  bookingNo: string
  customerId: string
  /** Latest status across both dealer listings. */
  status: string | null
  outletDealer: string | null
  customerName: string | null
  registrationName: string | null
  phones: string[]
  pans: string[]
  vins: string[]
  model: string | null
  variant: string | null
  bookingDate: string | null
  deliveryDate: string | null
  invoiceNo: string | null
  invoiceDate: string | null
  firstRetailSeen: string | null
  firstInvoiceSeen: string | null
  firstCancelSeen: string | null
  received: number
  receiptCount: number
  lastReceiptDate: string | null
  /** The receipt date on which the running total first passed DMS_PAID_THRESHOLD. */
  paidCrossedOn: string | null
  latestActivity: string | null
}

export type ReconCandidate = {
  key: string
  bookingNo: string
  status: string | null
  tier: number
  gapDays: number | null
  modelAgrees: boolean
}

export type ReconItem = {
  itemKey: string
  kind: ReconKind
  type: ReconExceptionType
  severity: ReconSeverity
  bookingId: string | null
  bookingNumber: string | null
  ourStatus: string | null
  ourStage: OurStage | null
  dms: DmsBookingInput | null
  matchTier: number | null
  matchLabel: string | null
  matchNote: string | null
  eventDate: string
  /** The month an item is filed under (owner): our booking's date, or the DMS booking date if none. */
  bookingDate: string | null
  headline: string
  customerName: string | null
  dealerCode: string | null
  model: string | null
  variant: string | null
  candidates: ReconCandidate[]
}

export type ReconStats = {
  ourBookings: number
  matched: number
  review: number
  unmatchedOurs: number
  dmsBookings: number
  unmatchedDms: number
  byTier: Record<string, number>
}

const CANCELLED = new Set(['BOOKING CANCEL', 'INVOICE CANCEL'])
const STAGE_RANK: Record<string, number> = { RETAIL: 4, INVOICE: 3, ASSIGNMENT: 2, BOOKING: 1 }

export function dmsState(d: DmsBookingInput) {
  const status = String(d.status || '').trim().toUpperCase()
  const cancelled = CANCELLED.has(status)
  const delivered = !cancelled && (status === 'RETAIL' || Boolean(d.deliveryDate))
  const invoiced = !cancelled && !delivered && (status === 'INVOICE' || Boolean(d.invoiceNo))
  const paid = d.received > DMS_PAID_THRESHOLD
  return { cancelled, delivered, invoiced, paid, rank: cancelled ? 0 : delivered ? 4 : invoiced ? 3 : STAGE_RANK[status] ?? 1 }
}

export function dmsStageLabel(d: DmsBookingInput | null): string {
  if (!d) return 'Not found'
  const s = dmsState(d)
  if (s.cancelled) return String(d.status)
  if (s.delivered) return 'Delivered'
  if (s.invoiced) return 'Invoiced'
  const status = String(d.status || '').trim()
  return status === 'Assignment' ? 'Allotted' : status || 'Booking'
}

const STATUS_STAGE: Record<string, OurStage> = {
  draft: 'booking',
  booking_created: 'booking',
  pending: 'booking',
  proforma_generated: 'proforma',
  vehicle_allocated: 'allotted',
  transferring: 'allotted',
  transfer_requested: 'allotted',
  finance_pending: 'allotted',
  payment_confirmed: 'paid',
  ready_delivery: 'paid',
  delivered: 'delivered',
  cancelled: 'closed',
  repeated_booking: 'closed',
  fake_booking: 'closed',
  demo_vehicle: 'closed',
}
const OUR_RANK: Record<OurStage, number> = { closed: 0, booking: 1, proforma: 2, on_hold: 2, allotted: 3, paid: 4, delivered: 5 }

export function ourStage(status: string, heldFromStatus?: string | null): OurStage {
  const s = String(status || '').trim().toLowerCase()
  if (s === 'on_hold') return 'on_hold'
  return STATUS_STAGE[s] ?? (heldFromStatus ? STATUS_STAGE[String(heldFromStatus).toLowerCase()] ?? 'booking' : 'booking')
}
function ourRank(b: OurBookingInput) {
  const stage = ourStage(b.status, b.heldFromStatus)
  if (stage === 'on_hold') return OUR_RANK[ourStage(String(b.heldFromStatus || 'booking_created'))]
  return OUR_RANK[stage]
}

function fmtDate(iso: string | null) {
  if (!iso) return 'an unknown date'
  const [y, m, d] = iso.split('-').map(Number)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return `${d} ${month} ${y}`
}
function fmtRupees(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

/** The single most severe disagreement between our booking and its DMS booking, or null if aligned. */
export function classify(b: OurBookingInput, d: DmsBookingInput | null): { type: ReconExceptionType; severity: ReconSeverity; eventDate: string; headline: string } | null {
  const stage = ourStage(b.status, b.heldFromStatus)
  const stageLabel = OUR_STAGE_LABEL[stage]
  const rank = ourRank(b)
  const delivered = stage === 'delivered'
  const closed = stage === 'closed'

  if (!d) {
    if (delivered && b.deliveredOn) {
      return { type: 'internal_ahead', severity: 'medium', eventDate: b.deliveredOn, headline: `Delivered here on ${fmtDate(b.deliveredOn)}; no matching DMS booking found.` }
    }
    return null
  }
  const s = dmsState(d)
  const fallback = d.latestActivity ?? d.bookingDate ?? b.bookingDate

  if (s.delivered && !delivered) {
    const on = d.deliveryDate ?? d.firstRetailSeen ?? fallback
    return { type: 'dms_delivered', severity: 'critical', eventDate: on, headline: `DMS delivered on ${fmtDate(on)}; here it is still at ${stageLabel}.` }
  }
  if (s.invoiced && rank < OUR_RANK.paid) {
    const on = d.invoiceDate ?? d.firstInvoiceSeen ?? fallback
    return { type: 'dms_invoiced', severity: 'high', eventDate: on, headline: `DMS invoiced on ${fmtDate(on)}; here it is still at ${stageLabel}.` }
  }
  if (s.paid && !s.delivered && !s.invoiced && !delivered && !b.paymentProgressed) {
    const on = d.paidCrossedOn ?? d.lastReceiptDate ?? fallback
    return { type: 'dms_paid', severity: 'high', eventDate: on, headline: `DMS has received ${fmtRupees(d.received)}; payment is not confirmed here (${stageLabel}).` }
  }
  if (s.cancelled && !closed) {
    const on = d.firstCancelSeen ?? fallback
    return { type: 'dms_cancelled', severity: delivered ? 'high' : 'medium', eventDate: on, headline: `${d.status} in DMS on ${fmtDate(on)}; still ${stageLabel} here.` }
  }
  if (delivered && !s.delivered && !s.cancelled && b.deliveredOn) {
    return { type: 'internal_ahead', severity: 'medium', eventDate: b.deliveredOn, headline: `Delivered here on ${fmtDate(b.deliveredOn)}; DMS still shows ${dmsStageLabel(d)}.` }
  }
  return null
}

type Scored = ReconCandidate & { d: DmsBookingInput; cancelled: boolean; stageRank: number; absGap: number }

/** Every DMS booking that shares an identifier with `b`, scored. Prior purchases are excluded. */
export function scoreCandidates(b: OurBookingInput, index: DmsIndex): Scored[] {
  const found = new Map<string, DmsBookingInput>()
  const add = (list?: DmsBookingInput[]) => list?.forEach((d) => found.set(d.key, d))
  if (b.dmsBookingNo) add(index.byNo.get(b.dmsBookingNo.toUpperCase()))
  if (b.vin) add(index.byVin.get(b.vin))
  if (b.pan) add(index.byPan.get(b.pan))
  if (b.phone) add(index.byPhone.get(b.phone))

  const out: Scored[] = []
  for (const d of found.values()) {
    const noMatch = Boolean(b.dmsBookingNo) && d.bookingNo.toUpperCase() === b.dmsBookingNo!.toUpperCase()
    const vinMatch = Boolean(b.vin) && d.vins.includes(b.vin)
    const panMatch = Boolean(b.pan) && d.pans.includes(b.pan)
    const phoneMatch = Boolean(b.phone) && d.phones.includes(b.phone)
    const personName = d.customerName && !isInstitutionalName(d.customerName) ? d.customerName : d.registrationName
    const nameMatch = namesAgree(b.customerName, personName) || namesAgree(b.customerName, d.registrationName)
    const modelAgrees = modelsAgree(b.model, d.model)
    const state = dmsState(d)
    const gapDays = d.bookingDate ? daysBetween(b.bookingDate, d.bookingDate) : null

    let tier: number
    if (noMatch && (phoneMatch || nameMatch || panMatch)) tier = 1
    else if (vinMatch && (phoneMatch || panMatch)) tier = 2
    else if (panMatch) tier = 3
    else if (phoneMatch && nameMatch) tier = modelAgrees ? 4 : 5
    else if (phoneMatch) tier = 5
    else if (vinMatch) tier = 6
    else if (noMatch) tier = 7
    else continue

    /*
     * A car this customer took delivery of BEFORE this booking existed is a previous purchase, not
     * this one — the repeat buyer whose 2025 Seltos would otherwise read as "already delivered".
     * Tiers 1–2 are exempt: a booking number or the booking's own chassis names the DMS row outright.
     */
    if (tier >= 3) {
      const deliveredOn = d.deliveryDate ?? d.firstRetailSeen
      if (state.delivered && deliveredOn && daysBetween(deliveredOn, b.bookingDate) > 10) continue
      if (gapDays !== null && gapDays > 180) continue
    }
    out.push({
      key: d.key, bookingNo: d.bookingNo, status: d.status, tier, gapDays, modelAgrees, d,
      cancelled: state.cancelled, stageRank: state.rank, absGap: gapDays === null ? 9999 : Math.abs(gapDays),
    })
  }
  /*
   * Same tier: a live booking beats a cancelled one, the right model beats the wrong one, and the
   * FURTHEST-progressed wins — a customer re-booked in DMS (B…339 still "Booking", B…941 "Retail"
   * 27 days later) bought through the second one. Nearest date breaks what is left.
   */
  return out.sort((a, b2) =>
    a.tier - b2.tier
    || Number(a.cancelled) - Number(b2.cancelled)
    || Number(b2.modelAgrees) - Number(a.modelAgrees)
    || b2.stageRank - a.stageRank
    || a.absGap - b2.absGap)
}

export type DmsIndex = {
  byNo: Map<string, DmsBookingInput[]>
  byVin: Map<string, DmsBookingInput[]>
  byPan: Map<string, DmsBookingInput[]>
  byPhone: Map<string, DmsBookingInput[]>
}

export function indexDms(dms: DmsBookingInput[]): DmsIndex {
  const index: DmsIndex = { byNo: new Map(), byVin: new Map(), byPan: new Map(), byPhone: new Map() }
  const put = (map: Map<string, DmsBookingInput[]>, key: string, d: DmsBookingInput) => {
    if (!key) return
    const list = map.get(key)
    if (list) { if (!list.includes(d)) list.push(d) } else map.set(key, [d])
  }
  for (const d of dms) {
    put(index.byNo, d.bookingNo.toUpperCase(), d)
    d.vins.forEach((v) => put(index.byVin, v, d))
    d.pans.forEach((p) => put(index.byPan, p, d))
    d.phones.forEach((p) => put(index.byPhone, p, d))
  }
  return index
}

/** Two sold cars at the same best tier cannot both be this booking — that one goes to a human. */
function isAmbiguous(top: Scored[]): boolean {
  if (top.length < 2) return false
  const [a, b] = top
  if (a.tier !== b.tier) return false
  if (a.cancelled !== b.cancelled) return false
  if (a.stageRank >= 3 && b.stageRank >= 3) return true
  return a.modelAgrees === b.modelAgrees && a.stageRank === b.stageRank && a.absGap === b.absGap
}

export function reconcile(ours: OurBookingInput[], dms: DmsBookingInput[]): { items: ReconItem[]; stats: ReconStats } {
  const index = indexDms(dms)
  const scored = new Map<string, Scored[]>()
  for (const b of ours) scored.set(b.id, scoreCandidates(b, index))

  // 1. First choice per booking.
  type Choice = { b: OurBookingInput; best: Scored | null; ambiguous: boolean; all: Scored[] }
  const choices = new Map<string, Choice>()
  for (const b of ours) {
    const all = scored.get(b.id) ?? []
    const bestTier = all[0]?.tier
    const top = all.filter((c) => c.tier === bestTier)
    choices.set(b.id, { b, best: all[0] ?? null, ambiguous: isAmbiguous(top), all })
  }

  /*
   * 2. One DMS booking, one booking here. Measured: 8 DMS bookings were the first choice of TWO of
   * our bookings (double entry). The stronger tie keeps it; a closed booking gives way silently; two
   * live bookings tied at the same tier both go to review instead of either silently winning.
   */
  const claims = new Map<string, Choice[]>()
  for (const c of choices.values()) {
    if (c.best && c.best.tier <= CONFIDENT_MATCH_MAX_TIER) {
      const list = claims.get(c.best.key)
      if (list) list.push(c); else claims.set(c.best.key, [c])
    }
  }
  const conflictNote = new Map<string, string>()
  for (const list of claims.values()) {
    if (list.length < 2) continue
    list.sort((x, y) => x.best!.tier - y.best!.tier
      || Number(ourStage(x.b.status) === 'closed') - Number(ourStage(y.b.status) === 'closed')
      || x.best!.absGap - y.best!.absGap)
    const [winner, ...rest] = list
    for (const loser of rest) {
      const tied = loser.best!.tier === winner.best!.tier && ourStage(loser.b.status) !== 'closed' && ourStage(winner.b.status) !== 'closed'
      if (tied) {
        winner.ambiguous = true
        loser.ambiguous = true
        conflictNote.set(winner.b.id, `Booking ${loser.b.bookingNumber} here points to the same DMS booking.`)
        conflictNote.set(loser.b.id, `Booking ${winner.b.bookingNumber} here points to the same DMS booking.`)
      } else {
        loser.best = null
        loser.all = loser.all.filter((c) => c.key !== winner.best!.key)
      }
    }
  }

  const items: ReconItem[] = []
  const claimed = new Set<string>()
  const stats: ReconStats = { ourBookings: ours.length, matched: 0, review: 0, unmatchedOurs: 0, dmsBookings: dms.length, unmatchedDms: 0, byTier: {} }

  for (const c of choices.values()) {
    const { b, best } = c
    const confident = Boolean(best) && best!.tier <= CONFIDENT_MATCH_MAX_TIER && !c.ambiguous
    if (best) {
      stats.byTier[String(best.tier)] = (stats.byTier[String(best.tier)] ?? 0) + 1
      // Anything we might be — confident or not — is not "unmatched" on the DMS side.
      c.all.filter((x) => x.tier === best.tier).forEach((x) => claimed.add(x.key))
    }
    if (confident) stats.matched++
    else if (best) stats.review++
    else stats.unmatchedOurs++

    const others = c.all.filter((x) => x.key !== best?.key).slice(0, 4)
    const note = [
      conflictNote.get(b.id),
      c.ambiguous && !conflictNote.get(b.id) ? `${c.all.filter((x) => x.tier === best?.tier).length} DMS bookings match equally well.` : null,
      best && !best.modelAgrees ? `Model differs: ${b.model || '—'} here, ${best.d.model || '—'} in DMS.` : null,
      others.length ? `Also in DMS: ${others.map((x) => `${x.bookingNo} (${x.status || '—'})`).join(', ')}.` : null,
    ].filter(Boolean).join(' ') || null

    const verdict = classify(b, confident ? best!.d : null)
    if (confident) {
      if (verdict) items.push(toItem(b, 'exception', verdict, best!, note, c.all))
      continue
    }
    if (best) {
      // A possible or ambiguous match: surface it only if it would matter, and never as a link. If
      // the possible DMS booking agrees with us, there is nothing to review.
      const probe = classify(b, best.d)
      if (probe) items.push(toItem(b, 'review', probe, best, note, c.all))
      continue
    }
    if (verdict) items.push(toItem(b, 'exception', verdict, null, null, []))
  }

  for (const d of dms) {
    if (claimed.has(d.key)) continue
    const s = dmsState(d)
    if (s.cancelled) continue
    stats.unmatchedDms++
    const on = d.latestActivity ?? d.bookingDate
    if (!on) continue
    const label = dmsStageLabel(d)
    items.push({
      itemKey: `D:${d.key}:unmatched_dms`,
      kind: 'unmatched_dms',
      type: 'unmatched_dms',
      severity: RECON_TYPE_META.unmatched_dms.severity,
      bookingId: null,
      bookingNumber: null,
      ourStatus: null,
      ourStage: null,
      dms: d,
      matchTier: null,
      matchLabel: null,
      matchNote: null,
      eventDate: on,
      bookingDate: d.bookingDate ?? on,
      headline: `${label} in DMS (${d.bookingNo}); no booking here with this mobile, PAN or chassis.`,
      customerName: d.customerName,
      dealerCode: d.outletDealer,
      model: d.model,
      variant: d.variant,
      candidates: [],
    })
  }
  return { items, stats }
}

function toItem(
  b: OurBookingInput,
  kind: ReconKind,
  verdict: NonNullable<ReturnType<typeof classify>>,
  best: Scored | null,
  note: string | null,
  all: Scored[],
): ReconItem {
  return {
    itemKey: `B:${b.id}:${verdict.type}`,
    kind,
    type: verdict.type,
    severity: verdict.severity,
    bookingId: b.id,
    bookingNumber: b.bookingNumber,
    ourStatus: b.status,
    ourStage: ourStage(b.status, b.heldFromStatus),
    dms: best?.d ?? null,
    matchTier: best?.tier ?? null,
    matchLabel: best ? MATCH_TIER_LABEL[best.tier] ?? null : null,
    matchNote: note,
    eventDate: verdict.eventDate,
    bookingDate: b.bookingDate === '1970-01-01' ? null : b.bookingDate,
    headline: verdict.headline,
    customerName: b.customerName,
    dealerCode: b.dealerCode,
    model: b.model,
    variant: b.variant,
    candidates: all.slice(0, 5).map(({ key, bookingNo, status, tier, gapDays, modelAgrees }) => ({ key, bookingNo, status, tier, gapDays, modelAgrees })),
  }
}
