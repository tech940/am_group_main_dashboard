// Client-safe helpers for KIA customer PII visibility.
// Customer phone numbers and email addresses are restricted to MD, Super Admin (developer) and the
// Finance Head everywhere in the KIA Proforma section (tables, drawers, stock, bookings CRM). The
// Finance Head needs full customer details — including Aadhaar/PAN — to complete finance approval.
// Imported by both client components and server code so the rule stays in one place.

export function canViewKiaCustomerPii(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase()
  return r === 'md' || r === 'developer' || r === 'finance_head'
}

/**
 * Who may REVEAL a customer's mobile number from Booking Follow-ups — the PII roles above, plus the
 * CRE, who actually makes the calls.
 *
 * This is a DELIBERATE, NARROW widening of the rule above, and it is worth knowing why. The Call
 * Center was built so telecallers never see a number: they click, and the telephony provider bridges
 * the call. But no provider is configured — every call ever logged is `provider=simulation` — so
 * that button dials nobody and a CRE cannot do their job without the number.
 *
 * The number is therefore NOT in the follow-up list payload. It is fetched only when someone clicks
 * Call, and every reveal is written to the booking's activity trail. The protection became auditing
 * rather than blocking. If real telephony is ever wired up, revert to masked dialling and delete this.
 */
export function canRevealKiaFollowupPhone(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase()
  return canViewKiaCustomerPii(r) || r === 'cre'
}

const REDACTED = '••••••'

// Returns the real value when the viewer is allowed, a redaction glyph otherwise,
// and an em dash when there is nothing to show.
export function maskKiaPii(value: string | null | undefined, allowed: boolean): string {
  const v = String(value ?? '').trim()
  if (!v) return '—'
  return allowed ? v : REDACTED
}

/** Booking metadata keys holding PII. Text fields are redacted; the URLs are dropped entirely. */
const PII_META_TEXT = ['panNumber', 'pan', 'aadhaarNumber', 'customerEmailId'] as const
const PII_META_URLS = ['panCardUrl', 'aadhaarCardUrl', 'employeeIdUrl'] as const

/**
 * Redacts a KIA booking row SERVER-SIDE, before it is serialised into an API response.
 *
 * This exists because maskKiaPii above was only ever applied in the browser: the list and detail
 * endpoints shipped raw customerPhone / customerEmail / PAN / Aadhaar — and the Supabase Storage URLs
 * of the uploaded PAN and Aadhaar scans — to every role holding `kia.bookings.view`, and the client
 * merely declined to paint them. Anyone could read the whole customer book out of the network tab or
 * with one curl. Hiding a value in the UI is not access control; the value must not leave the server.
 *
 * The doc URLs are DELETED rather than redacted: a redaction glyph in a href would render a broken
 * link, and the UI already hides the whole Customer Documents block from these viewers anyway.
 *
 * NOTE: only apply this to read paths that feed DISPLAY. The edit form is seeded from the booking
 * detail, so redacting a field that is later posted back would write "••••••" over the real value —
 * updateKiaBooking therefore refuses PII writes from viewers who cannot see PII, and the two guards
 * are meant to be kept in step.
 */
/**
 * Drops the PII keys from an INCOMING booking-metadata patch, so a shallow merge over the stored
 * metadata leaves the existing PAN / Aadhaar / document URLs untouched. The mirror of
 * redactKiaBookingPii: whatever that redacts on the way out, this refuses on the way back in.
 */
export function stripKiaBookingPiiKeys(meta: Record<string, unknown>): Record<string, unknown> {
  const out = { ...meta }
  for (const k of [...PII_META_TEXT, ...PII_META_URLS]) delete out[k]
  return out
}

export function redactKiaBookingPii<T extends Record<string, unknown>>(row: T, allowed: boolean): T {
  if (allowed) return row

  const out: Record<string, unknown> = { ...row }
  if (out.customerPhone) out.customerPhone = REDACTED
  if (out.customerEmail) out.customerEmail = REDACTED

  const meta = out.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const nextMeta: Record<string, unknown> = { ...(meta as Record<string, unknown>) }
    for (const k of PII_META_TEXT) if (nextMeta[k]) nextMeta[k] = REDACTED
    for (const k of PII_META_URLS) if (nextMeta[k]) nextMeta[k] = null
    out.metadata = nextMeta
  }
  return out as T
}
