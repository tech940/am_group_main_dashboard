/**
 * Pure helpers for SUGGESTING which demo car a LocoNav tracker is fitted to. No 'server-only', no database.
 *
 * ── Why suggestions exist at all ────────────────────────────────────────────────────────────────
 * The only automatic link is LocoNav `chassisNumber` === our VIN (lib/loconav/sync.ts). On the live account
 * (2026-09-11) that field holds a PLATE or free text for 17 of 18 vehicles — `JK02DQ0770`, `SYROS UDHAMPUR` —
 * so the automatic rule linked one car. The labels still carry evidence: `CARENSJK02CQ6060` names both a plate
 * and a model. A human confirms each link on the Trackers screen; these helpers only point at the likely car.
 *
 * ⚠️ NOTHING IN THIS FILE MAY BE USED TO WRITE A LINK. A plate is not an identity: `JK02C0059TC` is a trade
 * plate on five demo cars, and plates are recycled when a demo car is sold. A suggestion is a prompt to look.
 */

export const KIA_MODEL_WORDS = ['CARENS', 'CLAVIS', 'SELTOS', 'SONET', 'SYROS', 'CARNIVAL', 'EV6', 'EV9'] as const
export type KiaModelWord = (typeof KIA_MODEL_WORDS)[number]

/** Upper-case letters and digits only — `jk 02 dq-0770` and `JK02DQ0770` are the same plate. */
export function normalisePlate(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * An Indian registration inside a normalised label: state (2 letters), RTO (2 digits), series (1-3 letters),
 * number (4 digits), and the `TC` suffix of a trade certificate. A 17-character VIN does not match it.
 */
const PLATE_TOKEN_SOURCE = '[A-Z]{2}\\d{2}[A-Z]{1,3}\\d{4}(?:TC)?'

/** Every plate found in any of the labels. `CARENSJK02CQ6060` → {JK02CQ6060}; `SYROS UDHAMPUR` → {}. */
export function extractPlateTokens(...labels: unknown[]): Set<string> {
  const out = new Set<string>()
  for (const label of labels) {
    for (const m of normalisePlate(label).matchAll(new RegExp(PLATE_TOKEN_SOURCE, 'g'))) out.add(m[0])
  }
  return out
}

/**
 * The first KIA model word in the labels, looked for only OUTSIDE any plate — otherwise a plate in an `EV`
 * series (`JK02EV6123`) would read as an EV6.
 */
export function modelWordIn(...labels: unknown[]): KiaModelWord | null {
  for (const label of labels) {
    const text = normalisePlate(label).replace(new RegExp(PLATE_TOKEN_SOURCE, 'g'), '|')
    const hit = KIA_MODEL_WORDS.find((word) => text.includes(word))
    if (hit) return hit
  }
  return null
}

export type SuggestTracker = {
  providerVehicleUuid: string
  /** LocoNav's number, displayNumber and chassisNumber, as returned. */
  labels: readonly unknown[]
}

export type SuggestDemoCar = {
  vin: string
  registrationNumber: string | null
  /** Free text from the demo feed, e.g. "SONET" or "CARENS CLAVIS". */
  model: string | null
}

export type TrackerSuggestion = {
  providerVehicleUuid: string
  vin: string
  reason: 'plate_and_model' | 'plate_only'
}

const vinKey = (vin: unknown) => String(vin ?? '').trim().toUpperCase()

/**
 * At most ONE suggested demo car per unlinked tracker, keyed by provider vehicle uuid.
 *
 * A tracker gets a suggestion only when ALL of these hold:
 *  - its labels contain a plate that belongs to exactly one demo car, and no other tracker's labels carry it;
 *  - ⚠️ none of its labels carries a plate SHARED by several demo cars — a label naming a trade plate is
 *    ambiguous by construction, however specific the rest of it looks;
 *  - that car is not already linked, and the tracker is not already linked;
 *  - if the label names a model, the car's model text contains that same word (no model word → 'plate_only');
 *  - no other tracker is suggested for the same car — a car claimed twice is suggested to neither.
 */
export function suggestTrackerLinks(input: {
  trackers: readonly SuggestTracker[]
  demoCars: readonly SuggestDemoCar[]
  linkedVins: ReadonlySet<string>
  linkedTrackerUuids: ReadonlySet<string>
}): Map<string, TrackerSuggestion> {
  const carsByPlate = new Map<string, SuggestDemoCar[]>()
  for (const car of input.demoCars) {
    const plate = normalisePlate(car.registrationNumber)
    if (!plate) continue
    carsByPlate.set(plate, [...(carsByPlate.get(plate) ?? []), car])
  }

  const tokensByTracker = new Map<string, Set<string>>()
  const trackersPerToken = new Map<string, number>()
  for (const t of input.trackers) {
    const tokens = extractPlateTokens(...t.labels)
    tokensByTracker.set(t.providerVehicleUuid, tokens)
    for (const token of tokens) trackersPerToken.set(token, (trackersPerToken.get(token) ?? 0) + 1)
  }

  const linkedVins = new Set([...input.linkedVins].map(vinKey))
  const pending: TrackerSuggestion[] = []

  for (const t of input.trackers) {
    if (input.linkedTrackerUuids.has(t.providerVehicleUuid)) continue
    const tokens = [...(tokensByTracker.get(t.providerVehicleUuid) ?? [])]
    if (tokens.some((token) => (carsByPlate.get(token)?.length ?? 0) > 1)) continue

    const candidates = new Map<string, SuggestDemoCar>()
    for (const token of tokens) {
      const cars = carsByPlate.get(token) ?? []
      if (cars.length === 1 && trackersPerToken.get(token) === 1) candidates.set(vinKey(cars[0].vin), cars[0])
    }
    if (candidates.size !== 1) continue

    const [vin, car] = [...candidates][0]
    if (linkedVins.has(vin)) continue

    const word = modelWordIn(...t.labels)
    if (word && !normalisePlate(car.model).includes(word)) continue
    pending.push({ providerVehicleUuid: t.providerVehicleUuid, vin, reason: word ? 'plate_and_model' : 'plate_only' })
  }

  const claims = new Map<string, number>()
  for (const s of pending) claims.set(s.vin, (claims.get(s.vin) ?? 0) + 1)
  const out = new Map<string, TrackerSuggestion>()
  for (const s of pending) if (claims.get(s.vin) === 1) out.set(s.providerVehicleUuid, s)
  return out
}
