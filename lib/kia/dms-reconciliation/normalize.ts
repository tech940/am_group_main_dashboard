/**
 * Identifier normalisation for DMS ↔ booking matching. Pure — no database.
 *
 * Measured on the live feeds (2026-09-18) before any of this was written:
 *   - phones: 10 bare digits on every DMS row and on 229 of 233 bookings (4 empty). Some carry a +91 /
 *     0 prefix in other feeds, so everything is reduced to the LAST 10 digits.
 *   - PAN: valid on all 949 DMS sales rows (CSD sales carry the BUYER's PAN, not the canteen's —
 *     170 PANs over 172 CSD cars) and on 199 bookings (metadata.panNumber). Never persisted.
 *   - names: free text on both sides; CSD registrations read "THE AREA MANAGER CANTEEN STORES
 *     DEPARTMENT" and can never match a person.
 *   - models: our 'NEW SELTOS PETROL' / 'CLAVIS' vs DMS 'NEW SELTOS' / 'CARENS CLAVIS EV' — compared
 *     by model FAMILY, never by string.
 */

export function phone10(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
export function panKey(value: unknown): string {
  const pan = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return PAN_RE.test(pan) ? pan : ''
}

export function vinKey(value: unknown): string {
  const vin = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return vin.length >= 11 ? vin : ''
}

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'SRI', 'CAPT', 'COL', 'MAJ', 'LT', 'SGT', 'HAV', 'SUB', 'NK', 'SEP', 'THE'])
/** Surname-like tokens shared by thousands of unrelated customers here — never enough on their own. */
const COMMON_TOKENS = new Set([
  'SINGH', 'KUMAR', 'KUMARI', 'DEVI', 'KAUR', 'SHARMA', 'GUPTA', 'KHAN', 'BHAT', 'MOHD', 'MOHAMMAD', 'MOHAMMED',
  'MUHAMMAD', 'AHMED', 'AHMAD', 'RAM', 'LAL', 'CHAND', 'DUTTA', 'RAINA', 'VERMA', 'JAMWAL', 'MANHAS', 'SLATHIA',
  'CHOUDHARY', 'CHAUDHARY', 'BHAGAT', 'DOGRA', 'KOUR', 'MIR', 'SHAH', 'WANI', 'DAR', 'LONE', 'SHEIKH',
])
const INSTITUTIONAL = /CANTEEN|STORES DEPARTMENT|AREA MANAGER|PVT|LTD|LIMITED|ENTERPRISES|TRADERS|COMPANY/

export function nameTokens(value: unknown): string[] {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !TITLES.has(t))
}

export function isInstitutionalName(value: unknown): boolean {
  return INSTITUTIONAL.test(String(value ?? '').toUpperCase())
}

/**
 * Do two free-text names plausibly belong to the same person? Deliberately strict: the first name
 * must agree, or the whole name, or a distinctive (non-common) token of 4+ letters. "SINGH" alone
 * never makes two people the same.
 */
export function namesAgree(a: unknown, b: unknown): boolean {
  const x = nameTokens(a)
  const y = nameTokens(b)
  if (!x.length || !y.length) return false
  if (x.join('') === y.join('')) return true
  if (x[0].length >= 3 && x[0] === y[0]) return true
  const ys = new Set(y)
  return x.some((t) => t.length >= 4 && !COMMON_TOKENS.has(t) && ys.has(t))
}

const FAMILIES: Array<[RegExp, string]> = [
  [/CLAVIS|CARENS/, 'CARENS'],
  [/SELTOS/, 'SELTOS'],
  [/SONET/, 'SONET'],
  [/SYROS/, 'SYROS'],
  [/CARNIVAL/, 'CARNIVAL'],
  [/SORENTO/, 'SORENTO'],
  [/EV\s*6/, 'EV6'],
  [/EV\s*9/, 'EV9'],
]
export function modelFamily(value: unknown): string {
  const model = String(value ?? '').toUpperCase()
  for (const [re, family] of FAMILIES) if (re.test(model)) return family
  return model.replace(/[^A-Z0-9]/g, '')
}

export function modelsAgree(a: unknown, b: unknown): boolean {
  const x = modelFamily(a)
  const y = modelFamily(b)
  return Boolean(x) && Boolean(y) && x === y
}

/** 'dd/mm/yyyy' (the DMS text dates) or 'yyyy-mm-dd' → 'yyyy-mm-dd', else null. */
export function isoDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const text = String(value ?? '').trim()
  let m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(text)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/.exec(text)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}
