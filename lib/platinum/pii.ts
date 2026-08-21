// Client-safe helpers for Platinum customer PII visibility.

export function canViewPlatinumCustomerPii(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase()
  return (
    r === 'md' ||
    r === 'developer' ||
    r === 'super_admin' ||
    r === 'admin' ||
    r === 'owner' ||
    r === 'finance_head' ||
    r === 'ea' ||
    r === 'eba' ||
    r === 'ed' ||
    r === 'ceo' ||
    r === 'vp'
  )
}

const REDACTED = '••••••'

export const PLATINUM_PII_COLUMNS = [
  'contact_num1', 'contact_num2', 'contact_num3',
  'contact_number', 'contact_no', 'mobile', 'mobile_no', 'phone', 'phone_number',
  'email', 'email_id',
  'address',
] as const

export function maskPlatinumPii(value: unknown, allowed: boolean): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  return allowed ? v : REDACTED
}

export function redactPlatinumReportRow<T extends Record<string, unknown>>(row: T, allowed: boolean): T {
  if (allowed) return row
  const out: Record<string, unknown> = { ...row }
  for (const key of Object.keys(out)) {
    if (PLATINUM_PII_COLUMNS.includes(key.trim().toLowerCase() as typeof PLATINUM_PII_COLUMNS[number])) {
      if (out[key] !== null && out[key] !== undefined && String(out[key]).trim() !== '') out[key] = REDACTED
    }
  }
  return out as T
}

export function redactPlatinumReportRows<T extends Record<string, unknown>>(rows: T[], allowed: boolean): T[] {
  return allowed ? rows : rows.map((r) => redactPlatinumReportRow(r, allowed))
}
