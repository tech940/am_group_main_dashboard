/**
 * Registration numbers and phone numbers for H Promise. Client-safe and pure.
 */

/**
 * The comparison key for a registration number: letters and digits only, upper case.
 *
 * ⚠️ MUST stay identical to the generated column in migration 0072:
 *     upper(regexp_replace(reg_no, '[^A-Za-z0-9]', '', 'g'))
 * scripts/verify-h-promise.ts checks the two agree. If they ever differ, the duplicate check the app runs
 * and the unique index the database enforces disagree about which cars are "the same".
 */
export function normalizeRegNo(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/** How a registration number is stored and shown: trimmed, upper case, single spaces. */
export function displayRegNo(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** The database refuses keys shorter than this (CHECK in 0072). */
export const MIN_REG_KEY_LENGTH = 4

/**
 * A soft check only — shown as a warning, never a refusal. Real registrations include BH-series plates
 * (22BH1234AB), temporary numbers and old formats, and the desk must still be able to record them.
 */
export function looksLikeIndianReg(value: unknown): boolean {
  const key = normalizeRegNo(value)
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(key) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(key)
}

/** Digits only, with a leading +91 / 91 / 0 trunk prefix removed when it makes the number too long. */
export function normalizePhone(value: unknown): string {
  let digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

/** New entries need exactly ten digits, as the sheet required. */
export function isValidPhone(value: unknown): boolean {
  return /^\d{10}$/.test(normalizePhone(value))
}

/** `••••••1234`. What view-only users see. */
export function maskPhone(value: unknown): string | null {
  const digits = normalizePhone(value)
  if (!digits) return null
  if (digits.length <= 4) return '•'.repeat(digits.length)
  return `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}
