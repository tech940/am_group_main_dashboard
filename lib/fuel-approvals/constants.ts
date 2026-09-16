import { FuelLocation, FuelRequiredFor, FuelType, FuelApprovalStatus } from './types'

export const FUEL_LOCATIONS: { value: FuelLocation; label: string }[] = [
  { value: 'KIA JAMMU', label: 'KIA JAMMU' },
  { value: 'KIA UDHAMPUR', label: 'KIA UDHAMPUR' },
  { value: 'KIA BANIHAL', label: 'KIA BANIHAL' },
]

export const FUEL_REQUIRED_FOR_OPTIONS: { value: FuelRequiredFor; label: string }[] = [
  { value: 'DEMO', label: 'DEMO' },
  { value: 'GENSET', label: 'GENSET' },
  { value: 'NEW DELIVERY', label: 'NEW DELIVERY' },
  { value: 'STOCK YARD', label: 'STOCK YARD' },
  { value: 'STOCK TRANSFER', label: 'STOCK TRANSFER' },
  { value: 'DISPLAY VEH', label: 'DISPLAY VEH' },
  { value: 'PAINT BOOTH -KIA -GANYAL', label: 'PAINT BOOTH -KIA -GANYAL' },
  { value: 'CPO', label: 'CPO' },
  { value: 'OTHER', label: 'OTHER' },
]

export const PRECONFIGURED_VEHICLES = [
  'Seltos GTX Plus DCT 1.5T Petrol-RED-PETROL-JK02DP0880',
  'Seltos HTX 1.5 Petrol-BLUE-PETROL-JK02CJ0880',
  'Seltos GTX Plus AT 1.5 Diesel-GREEN-DIESEL-JK02CD0880',
  'Sonet G1.2 5MT Gravity-WHITE-PETROL-JK02DN0880',
  'Sonet G1.2 5MT Gravity-GREEN-PETROL-JK02CP0880',
  'SONET G1.5 MT Gravity-WHITE-DIESEL-JK02CR0880',
  'Carens G1.5 6MT Gravity-WHITE-PETROL-JK02CL0880',
  'CARENS G1.5 DCT LUXARY PLUS 7-WHITE-PETROL-JK02DP1010',
  'Carens D1.5 6AT PRESTIGE Plus 7-BLACK-DIESEL-JK02CC0880',
  'Syros G1.0T 7DCT HTX Plus(O)-BLUE-PETROL-JK02DP0770',
  'Syros D1.5 6MT HTK(O)-WHITE-PETROL-JK02CH0880',
  'Syros G1.0T 6MT HTX-BLUE-DIESEL-JK02CN0880',
  'Kia Carnival D2.2 8AT Limousine Plus-BLACK-DIESEL-JK02DP0008',
  'Carens ClavisD1.5 6AT HTKPlus7-BLUE-DIESEL-JK02CQ6060',
  'Carens Clavis G1.5 6MT HTK7-WHITE-PETROL-JK02DQ0770',
  'Carens Clavis G1.5TDCTHTXPlus6-SILVER-PETROL-JK02DQ8080',
  'DISPLAY SYROS-GREEN-DIESEL-15135',
  'DISPLAY BLACK SONET -BLACK-PETROL-617474',
  'DISPLAY MORNING HAZE SELTOS-HAZE-PETROL-15610',
  'DISPLAY WHITE CARENS-WHITE-PETROL-306897',
  'DISPLAY SILVER CLAVIS-SILVER-PETROL-246446',
  'DISPLAY  GREY CLAVIS-GREY-DIESEL-251548',
  'DEMO IVORY SILVER SELTOS -DEMO IVORY-DIESEL-JK02DU0770',
  'DEMO MORNING HAZE SELTOS -MORNING HAZE-PETROL-JK02DU7070',
  'DEMO BLACK SELTOS GTX -BLACK-PETROL-JK02DU0880',
  'Genset',
  'Stockyard',
  'SYROS-021128',
  'SELTOS- 015610',
  'DISPLAY VEHICLE',
  'CPO',
  'JK14L0880 -Demo Seltos',
  'CARENS CLAVIS - JK14J0880',
  'DEMO TATA MOBILE  JK02DD -1208',
  'DEMO NEW SYROS SILVER - JK02C0059TC',
] as const

export const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'PETROL', label: 'PETROL' },
  { value: 'DIESEL', label: 'DIESEL' },
]

export function detectFuelType(vehicleText: string): FuelType | '' {
  if (!vehicleText) return ''
  const upper = vehicleText.toUpperCase()
  if (upper.includes('DIESEL')) return 'DIESEL'
  if (upper.includes('PETROL')) return 'PETROL'
  return ''
}

export const STATUS_LABELS: Record<FuelApprovalStatus, string> = {
  ceo_pending: 'Awaiting CEO Approval',
  ceo_on_hold: 'Held by CEO',
  accounts_pending: 'Awaiting Review',
  accounts_on_hold: 'On Hold',
  ea_pending: 'Awaiting EA Approval',
  ea_on_hold: 'Held by EA',
  md_pending: 'Awaiting MD Approval',
  md_on_hold: 'Held by MD',
  ed_pending: 'Awaiting ED Approval',
  ed_on_hold: 'Held by ED',
  hr_pending: 'Awaiting HR Approval',
  hr_on_hold: 'Held by HR',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent Back',
}

export const STAGE_STEPS = [
  { key: 'submission', label: 'Submission' },
  { key: 'ceo', label: 'CEO Approval' },
] as const

/**
 * Safely parses single URL, comma-separated URLs, or JSON array string of URLs
 * into a clean array of slip URLs.
 */
export function parseFuelSlipUrls(value: string | null | undefined): string[] {
  if (!value) return []
  const str = String(value).trim()
  if (!str) return []
  if (str.startsWith('[') && str.endsWith(']')) {
    try {
      const parsed = JSON.parse(str)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => (typeof item === 'string' ? item.trim() : typeof item?.url === 'string' ? item.url.trim() : '')).filter(Boolean)
      }
    } catch {
      // fallback
    }
  }
  if (str.includes(',')) {
    return str.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return [str]
}


/**
 * Has this fuel order actually been finalised, and by whom?
 *
 * ⚠️ NOT `record.totalCost != null` — which is what the two action buttons used to test, and it is
 * wrong in both directions:
 *
 *   · The cost is OPTIONAL on the finalise form. An order finalised with slips but no rupee figure
 *     (a pump bill still to come, a card statement to reconcile) kept reading "Finalise", so it
 *     looked untouched and somebody would finalise it a second time.
 *   · BOTH the create route and the resubmit route write `totalCost` straight from the request form.
 *     A submitter who typed the pump amount when raising the request made the row read "Finalised"
 *     before the CEO had even approved it.
 *
 * The act of finalising is recorded exactly once, as a FINALIZE entry in the history, written inside
 * the only route that can perform it. That entry is the fact; `totalCost` is merely a field that may
 * happen to be filled in. The LAST entry wins, because finalising again is how a correction is made
 * and the person who corrected it is the one to name.
 */
export type FuelFinalization = {
  finalized: boolean
  /** ISO timestamp of the most recent finalisation, or null. */
  at: string | null
  /** Who performed it. Never an email — this is rendered in a tooltip. */
  byName: string | null
}

export function getFuelFinalization(
  record: { history?: { action?: string; userName?: string; timestamp?: string }[] | null } | null | undefined,
): FuelFinalization {
  const history = Array.isArray(record?.history) ? record!.history! : []
  let last: { userName?: string; timestamp?: string } | null = null
  for (const entry of history) {
    if (entry?.action === 'FINALIZE') last = entry
  }
  if (!last) return { finalized: false, at: null, byName: null }
  return {
    finalized: true,
    at: last.timestamp || null,
    byName: last.userName || null,
  }
}

/**
 * Where a fuel order actually stands — the pipeline as staff describe it, not as `status` spells it.
 *
 * ⚠️ `status = 'approved'` IS NOT "done", and `current_stage = 'completed'` is worse: the action route
 * writes that stage the instant the CEO approves, so every approved order has claimed to be completed
 * since the day it was raised, while the bill and the pump slips were still outstanding. An order the
 * CEO has approved is OPEN work for whoever records the receipt — it belongs in its own queue with
 * the other things somebody still has to do, not in a green "Approved" bucket that reads as finished.
 *
 * So the pipeline has one more position than `status` has values, and it is derived rather than
 * stored — see getFuelFinalization for why the FINALIZE history entry is the only honest test, and
 * see the note in lib/db/schema.ts about `status` + `current_stage`: a third stored copy of the same
 * fact is the defect that made purchase orders unmaintainable.
 */
export type FuelLifecycleState =
  | 'in_review'    // somebody still has to approve it
  | 'on_hold'
  | 'sent_back'
  | 'rejected'
  | 'to_finalise'  // CEO approved; the bill and slips are NOT recorded yet. Open work.
  | 'completed'    // finalised — the money and the paperwork are in

export const FUEL_LIFECYCLE_LABELS: Record<FuelLifecycleState, string> = {
  in_review: 'In Review',
  on_hold: 'On Hold',
  sent_back: 'Sent Back',
  rejected: 'Rejected',
  to_finalise: 'To Finalise',
  completed: 'Completed',
}

export function getFuelLifecycleState(
  record: { status?: string | null; history?: any[] | null } | null | undefined,
): FuelLifecycleState {
  const status = String(record?.status ?? '')
  if (status === 'rejected') return 'rejected'
  if (status === 'sent_back') return 'sent_back'
  if (status.includes('on_hold')) return 'on_hold'
  if (status === 'approved') {
    return getFuelFinalization(record).finalized ? 'completed' : 'to_finalise'
  }
  return 'in_review'
}
