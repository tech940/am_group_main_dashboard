/**
 * Reading a facility's revision trail: formatting one snapshot, and diffing two of them.
 *
 * ── Why there IS a trail to read ───────────────────────────────────────────────────────────────
 * The "Bank Sanction Limit System" Google Sheet this section replaced was APPEND-ONLY. Its form
 * wrote a WHOLE NEW response row on every save, so its 563 rows describe only 73 facilities. Those
 * extra rows are not duplicates to be cleaned up — each is that facility as it stood on that date,
 * and the sequence IS the history. All 563 live in bank_sanction_history at their ORIGINAL sheet
 * timestamps, alongside every create/update/delete the app has made since.
 *
 * ⚠️ No React, no server-only: this is pure data so the UI and scripts/verify-bank-sanction-history
 * can exercise the identical code against real rows. Do not import client components here.
 */

const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

/** Rupees as the register shows them: Cr / L above the thresholds, exact below. */
export function formatCompactINR(val: number | null): string {
  if (val === null || val === undefined) return '—'
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)} L`
  return inrCompact.format(val)
}

export type HistoryFieldKind = 'money' | 'percent' | 'date' | 'text'

/** The fields a revision is compared on, in the order they read on screen. */
export const HISTORY_FIELDS: ReadonlyArray<{ key: string; label: string; kind: HistoryFieldKind }> = [
  { key: 'creditLimit', label: 'Sanctioned Limit', kind: 'money' },
  { key: 'outstandingAmount', label: 'Outstanding', kind: 'money' },
  { key: 'instalment', label: 'Instalment', kind: 'money' },
  { key: 'interestAmount', label: 'Interest Amount', kind: 'money' },
  { key: 'roiPct', label: 'ROI', kind: 'percent' },
  { key: 'expiryDate', label: 'Expiry Date', kind: 'date' },
  { key: 'dateOfSanction', label: 'Date of Sanction', kind: 'date' },
  { key: 'installmentDueOn', label: 'Instalment Due On', kind: 'date' },
  { key: 'installmentPaidOn', label: 'Instalment Paid On', kind: 'date' },
  { key: 'location', label: 'Location', kind: 'text' },
  { key: 'loanType', label: 'Loan Type', kind: 'text' },
  { key: 'guarantor', label: 'Guarantor', kind: 'text' },
  { key: 'collateral', label: 'Collateral Security', kind: 'text' },
  { key: 'primarySecurity', label: 'Primary Security', kind: 'text' },
  { key: 'corporateGuarantee', label: 'Corporate Guarantee', kind: 'text' },
  { key: 'alertEmail', label: 'Alert Email', kind: 'text' },
]

/**
 * The comparable form of a snapshot value.
 *
 * ⚠️ Money and ROI are stored as Postgres decimal STRINGS ('17500000.00', '11.550'), and the
 * imported sheet rows carry them with different trailing zeros than the app writes. A raw string
 * compare therefore reports a change on almost every field of almost every entry — the trail would
 * claim the whole facility was rewritten 15 times. Numbers must compare as numbers.
 */
export function normalisedHistoryValue(kind: HistoryFieldKind, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return ''
  if (kind === 'money' || kind === 'percent') {
    const n = Number(raw)
    return Number.isFinite(n) ? String(n) : String(raw).trim()
  }
  if (kind === 'date') return String(raw).slice(0, 10)
  return String(raw).trim()
}

/**
 * A snapshot value as the reader should see it.
 *
 * ⚠️ Dates inside a snapshot are plain 'YYYY-MM-DD' — no time, no zone. Formatting them through IST
 * (as the entry TIMESTAMPS correctly are) shifts them across midnight and prints the wrong day, so
 * they are parsed and printed as UTC. A calendar date and an instant are different kinds of value.
 */
export function formatHistoryValue(kind: HistoryFieldKind, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—'
  if (kind === 'money') {
    const n = Number(raw)
    return Number.isFinite(n) ? formatCompactINR(n) : String(raw)
  }
  if (kind === 'percent') {
    const n = Number(raw)
    return Number.isFinite(n) ? `${Number(n.toFixed(3))}%` : String(raw)
  }
  if (kind === 'date') {
    const text = String(raw).slice(0, 10)
    const date = new Date(`${text}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return text
    return date.toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
  }
  return String(raw)
}

export type HistoryChange = { key: string; label: string; kind: HistoryFieldKind; from: unknown; to: unknown }

/**
 * What this revision changed relative to the one before it. Empty for the very first entry, and
 * empty for a re-submission that touched nothing (the sheet's form produced plenty of those).
 */
export function historyChanges(
  current: Record<string, unknown> | null | undefined,
  previous: Record<string, unknown> | null | undefined,
): HistoryChange[] {
  if (!previous) return []
  const changes: HistoryChange[] = []
  for (const field of HISTORY_FIELDS) {
    const to = current?.[field.key]
    const from = previous?.[field.key]
    if (normalisedHistoryValue(field.kind, to) === normalisedHistoryValue(field.kind, from)) continue
    changes.push({ key: field.key, label: field.label, kind: field.kind, from, to })
  }
  return changes
}

/** How an entry got there. 'imported' is a response row from the original Google Sheet form. */
export function historyActionLabel(action: string): { label: string; className: string } {
  switch (action) {
    case 'imported':
      return { label: 'Sheet entry', className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' }
    case 'created':
      return { label: 'Created', className: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800' }
    case 'updated':
      return { label: 'Updated', className: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800' }
    case 'deleted':
      return { label: 'Deleted', className: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800' }
    default:
      return { label: action, className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' }
  }
}
