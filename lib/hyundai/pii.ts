// Client-safe helpers for Hyundai customer PII visibility.
//
// Mirrors lib/kia/pii.ts deliberately: the same people are trusted with a customer's contact details
// whichever brand's report they open, and a second, divergent policy is how one brand quietly ends up
// looser than the other. Like the KIA rule, this redacts CONTACT details (phone, address) and keeps
// the customer NAME — without a name the report rows cannot be told apart and the page stops being
// usable, and the name alone is what every consultant already works from.
//
// ⚠️ Applied SERVER-SIDE, before serialisation. The Hyundai sales report previously selected `*` from
// tables carrying contact_num1/2/3, contact_number and address and shipped every column to anyone
// holding hyundai.sales_report.view — the `canViewPii` option existed on the query function, was
// never read, and was never passed by the route. Hiding a value in the UI is not access control.

export function canViewHyundaiCustomerPii(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase()
  return r === 'md' || r === 'developer' || r === 'finance_head' || r === 'ea' || r === 'eba' || r === 'ed' || r === 'ceo' || r === 'vp'
}

const REDACTED = '••••••'

/** Column names across the Hyundai sales/booking/enquiry/purchase feeds that carry contact details. */
export const HYUNDAI_PII_COLUMNS = [
  'contact_num1', 'contact_num2', 'contact_num3',
  'contact_number', 'contact_no', 'mobile', 'mobile_no', 'phone', 'phone_number',
  'email', 'email_id',
  'address',
] as const

export function maskHyundaiPii(value: unknown, allowed: boolean): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  return allowed ? v : REDACTED
}

/**
 * Redacts one report row in place of a copy. Matching is case-insensitive on the column NAME, so a
 * feed that renames `contact_num1` to `Contact_Num1` is still covered, and a column that does not
 * exist on this particular table is simply absent rather than an error.
 */
export function redactHyundaiReportRow<T extends Record<string, unknown>>(row: T, allowed: boolean): T {
  if (allowed) return row
  const out: Record<string, unknown> = { ...row }
  for (const key of Object.keys(out)) {
    if (HYUNDAI_PII_COLUMNS.includes(key.trim().toLowerCase() as typeof HYUNDAI_PII_COLUMNS[number])) {
      if (out[key] !== null && out[key] !== undefined && String(out[key]).trim() !== '') out[key] = REDACTED
    }
  }
  return out as T
}

export function redactHyundaiReportRows<T extends Record<string, unknown>>(rows: T[], allowed: boolean): T[] {
  return allowed ? rows : rows.map((r) => redactHyundaiReportRow(r, allowed))
}
