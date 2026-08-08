import 'server-only'
import { canViewKiaCustomerPii, maskKiaPii } from '@/lib/kia/pii'
import type { KiaCustomerProfile, KiaCustomerSummary } from './reader'

/**
 * PII redaction for the Customer Profile, applied at the SERIALISATION BOUNDARY.
 *
 * ⚠️ Masking must happen here, on the server, not in the client component.
 *
 * lib/kia/pii.ts:45-59 records what happened the last time this was done the other way round:
 * the KIA bookings endpoints shipped raw customerPhone, customerEmail, PAN, Aadhaar — and the
 * Storage URLs of the uploaded ID scans — and the client merely declined to paint them.
 * "Anyone could read the whole customer book out of the network tab or with one curl."
 *
 * This section concentrates more customer contact detail on one screen than anything else in
 * the dashboard, so the rule is absolute: whatever the profile does not display, it does not send.
 *
 * The client may still call maskKiaPii for presentation — that is a second layer, never the first.
 */

/** Replaces the value with the redaction glyph rather than omitting the key, so the UI shape is stable. */
function mask(value: string | null, allowed: boolean): string | null {
  if (value === null) return null
  return allowed ? value : maskKiaPii(value, false)
}

export function redactKiaCustomerSummary<T extends KiaCustomerSummary>(row: T, role?: string | null): T {
  const allowed = canViewKiaCustomerPii(role)
  if (allowed) return row
  return { ...row, phone: mask(row.phone, false), email: mask(row.email, false) }
}

export function redactKiaCustomerProfile(profile: KiaCustomerProfile, role?: string | null): KiaCustomerProfile {
  const allowed = canViewKiaCustomerPii(role)
  if (allowed) return profile
  return {
    ...profile,
    phone: mask(profile.phone, false),
    email: mask(profile.email, false),
  }
}

export { canViewKiaCustomerPii }
