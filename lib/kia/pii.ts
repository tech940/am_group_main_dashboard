// Client-safe helpers for KIA customer PII visibility.
// Customer phone numbers and email addresses are restricted to MD, Super Admin (developer) and the
// Finance Head everywhere in the KIA Proforma section (tables, drawers, stock, bookings CRM). The
// Finance Head needs full customer details — including Aadhaar/PAN — to complete finance approval.
// Imported by both client components and server code so the rule stays in one place.

export function canViewKiaCustomerPii(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase()
  return r === 'md' || r === 'developer' || r === 'finance_head'
}

const REDACTED = '••••••'

// Returns the real value when the viewer is allowed, a redaction glyph otherwise,
// and an em dash when there is nothing to show.
export function maskKiaPii(value: string | null | undefined, allowed: boolean): string {
  const v = String(value ?? '').trim()
  if (!v) return '—'
  return allowed ? v : REDACTED
}
