// Client-safe access rules for the Finance Payouts ledger. Imported by BOTH the React client and
// the server so the UI and the API can never drift apart.

function norm(role?: string | null) {
  return String(role || '').trim().toLowerCase()
}

/**
 * Who may see a customer's MOBILE NUMBER in the payout ledger: **MD and Developer only**.
 *
 * This is deliberately STRICTER than canViewKiaCustomerPii (lib/kia/pii.ts), which also allows the
 * Finance Head. Requested explicitly: the payout ledger is a bulk table of every delivered customer,
 * so a single screen exposes far more numbers at once than a one-booking view does. The finance team
 * manages payouts with banks and dealers — that job needs the loan, the bank and the invoice, not the
 * customer's phone.
 *
 * Note the role that CAN edit every payout field (finance_head/finance_team, via finance.payouts)
 * still CANNOT see the number. Editing and PII are separate concerns here — that is the point.
 */
export function canViewFinancePayoutMobile(role?: string | null): boolean {
  const r = norm(role)
  return r === 'md' || r === 'developer'
}

/** Redaction glyph used across the KIA section — keep consistent with lib/kia/pii.ts. */
const REDACTED = '••••••'

/** Real value when allowed, the redaction glyph when not, an em dash when there is nothing to show. */
export function maskFinancePayoutMobile(value: string | null | undefined, allowed: boolean): string {
  const v = String(value ?? '').trim()
  if (!v) return '—'
  return allowed ? v : REDACTED
}
