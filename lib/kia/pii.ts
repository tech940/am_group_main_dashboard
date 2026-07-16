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
