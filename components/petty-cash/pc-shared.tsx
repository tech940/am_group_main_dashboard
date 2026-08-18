'use client'

import { getPettyCashStageInfo } from '@/lib/petty-cash/status-tracking'

import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { getPettyCashStatusLabel } from '@/lib/petty-cash/constants'
import type {
  PettyCashAllocation,
  PettyCashExpense,
  PettyCashLedgerEntry,
  PettyCashRequest,
} from './types'

/* ------------------------------------------------------------------ */
/* Formatting + normalize helpers (ported verbatim from the old page)  */
/* ------------------------------------------------------------------ */

export function formatCurrency(value: number | string | null | undefined) {
  const amount = Number(value)
  const safe = Number.isFinite(amount) ? amount : 0
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(safe)
}

export function formatDateTime(value?: string | null) {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(date)} IST`
}

export function normalizeRequestNumber(request: PettyCashRequest) {
  return request.requestNumber || request.request_number || 'PCR'
}

export function normalizeExpenseNumber(expense: PettyCashExpense) {
  return expense.expenseNumber || expense.expense_number || 'PCE'
}

export function normalizeBranchId(row: { branchId?: string; branch_id?: string }) {
  return row.branchId || row.branch_id || ''
}

export function normalizeAllocatedAmount(allocation: PettyCashAllocation | null | undefined) {
  return allocation?.allocatedAmount || allocation?.allocated_amount || '0'
}

export function normalizeSpentAmount(allocation: PettyCashAllocation | null | undefined) {
  return allocation?.spentAmount || allocation?.spent_amount || '0'
}

export function ledgerEntryType(entry: PettyCashLedgerEntry) {
  return entry.entryType || entry.entry_type || ''
}

export function ledgerBalanceAfter(entry: PettyCashLedgerEntry) {
  return entry.balanceAfter || entry.balance_after || '0'
}

export function requestedByName(request: PettyCashRequest) {
  return request.requestedByName || request.requested_by_name || '—'
}

export function requestedAmount(request: PettyCashRequest) {
  return request.requestedAmount || request.requested_amount || '0'
}

export function expenseDate(expense: PettyCashExpense) {
  return expense.expenseDate || expense.expense_date || null
}

export function expenseVendor(expense: PettyCashExpense) {
  return expense.vendorName || expense.vendor_name || '—'
}

/* ------------------------------------------------------------------ */
/* Status pill                                                         */
/* ------------------------------------------------------------------ */

export type Tone = 'emerald' | 'amber' | 'blue' | 'violet' | 'rose' | 'sky' | 'slate'

/*
 * Status tones — the approval state of money, so both themes have to be legible.
 *
 * These carried no dark treatment and were unreadable at 1.28–1.62:1 in dark mode. The cause is not
 * a missing `dark:` here but the app-wide rescue in globals.css (`.dark .glass-dashboard-content
 * [class*="text-…-700"]`), which forces the TEXT light with !important while leaving a tinted
 * background — bg-*-50 is not on its background list — so it produced light-on-light.
 *
 * Two consequences worth knowing before editing:
 *   1. A `dark:text-*` here CANNOT win against that !important. For emerald/amber/blue the fix is to
 *      darken the BACKGROUND so the already-forced-light text lands correctly (6.55–7.69:1).
 *   2. rose and violet need the opposite treatment. `text-rose-700` is rescued to
 *      var(--dashboard-risk-text), which resolves to pure #ff0000 and tops out at 4.43:1 on any
 *      tint — unreachable. Naming the shade rose-900 steps outside the rescue's match list so we own
 *      both modes again (8.71:1 light / 9.24:1 dark). violet was never rescued at all.
 */
export const TONE_CLASS: Record<Tone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/70 dark:ring-emerald-700/50',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/70 dark:ring-amber-700/50',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/70 dark:ring-blue-700/50',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-700/50',
  rose: 'bg-rose-50 text-rose-900 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-800/50',
  // sky is not in the rescue's match list either, so — like violet — we own both modes outright.
  sky: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-700/50',
  // bg-slate-100 IS on the rescue's background list, so this tone already flips correctly.
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
}

/**
 * Tone comes from STAGE_INFO, not from substring matching.
 *
 * The old body tested `value.includes('approved')` BEFORE any stage check, so `ed_approved` and
 * `ea_approved` — both `state: 'pending'` — rendered emerald. On a queue, green means done, so the
 * rows still owing an approval were exactly the ones a reviewer's eye skipped.
 */
export function statusTone(status: string): Tone {
  return getPettyCashStageInfo(status).tone
}


export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset', TONE_CLASS[statusTone(status)])}>
      {getPettyCashStatusLabel(status)}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

export function SectionCard({
  title,
  subtitle,
  icon: Icon,
  iconTone = 'slate',
  toolbar,
  children,
  className,
}: {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ className?: string }>
  iconTone?: Tone
  toolbar?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-2xl ring-1 ring-inset', TONE_CLASS[iconTone])}>
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div>
            <h3 className="text-base font-black tracking-tight text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs font-semibold text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {toolbar}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ icon: Icon, title, description }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon className="h-7 w-7" />
      </div>
      <h4 className="mt-4 text-base font-black text-slate-900">{title}</h4>
      <p className="mt-1 max-w-sm text-sm font-medium text-slate-500">{description}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Summary KPI card (animated counter)                                 */
/* ------------------------------------------------------------------ */

export function SummaryCard({
  label,
  value,
  meta,
  icon: Icon,
  tone = 'slate',
  onClick,
  active,
}: {
  label: string
  value: string
  meta?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: Tone
  onClick?: () => void
  active?: boolean
}) {
  const Wrapper = onClick ? motion.button : motion.div
  return (
    <Wrapper
      layout
      whileHover={onClick ? { y: -3 } : undefined}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-3 rounded-3xl border bg-white p-5 text-left shadow-sm transition-colors',
        active ? 'border-[var(--dashboard-action-bg)] ring-2 ring-[var(--dashboard-action-bg)]/15' : 'border-slate-200',
        onClick && 'cursor-pointer hover:border-slate-300',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ring-inset', TONE_CLASS[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div>
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">{label}</p>
        <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</p>
        {meta && <p className="mt-0.5 text-xs font-semibold text-slate-500">{meta}</p>}
      </div>
    </Wrapper>
  )
}

/* ------------------------------------------------------------------ */
/* Remaining-balance meter                                             */
/* ------------------------------------------------------------------ */

export function BalanceMeter({
  allocation,
  spent,
  remaining,
  percentage,
}: {
  allocation: number
  spent: number
  remaining: number
  percentage: number
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-[var(--dashboard-action-bg)] to-[var(--dashboard-action-hover)] p-6 text-white shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-black uppercase tracking-wider text-white/70">Remaining Balance</p>
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-black">{percentage}% used</span>
      </div>
      <p className="mt-2 text-4xl font-black tracking-tight">{formatCurrency(remaining)}</p>
      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/20">
        <motion.div
          className="h-full rounded-full bg-white"
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, percentage)}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/60">Allocated</p>
          <p className="font-black">{formatCurrency(allocation)}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/60">Spent</p>
          <p className="font-black">{formatCurrency(spent)}</p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Generic premium table                                               */
/* ------------------------------------------------------------------ */

export function RecordTable<T>({
  rows,
  columns,
  loading,
  empty,
  rowKey,
  onRowClick,
}: {
  rows: T[]
  columns: Array<{ header: string; align?: 'left' | 'right'; cell: (row: T) => ReactNode; className?: string }>
  loading?: boolean
  empty: ReactNode
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`row-skeleton-${index}`} className="h-12 animate-pulse motion-reduce:animate-none rounded-xl bg-slate-50" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) return <>{empty}</>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-black uppercase tracking-wider text-slate-600">
            {columns.map((column) => (
              <th key={column.header} className={cn('px-4 py-3 font-black', column.align === 'right' && 'text-right')}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            /*
             * Row click opens the detail dialog, and it used to be the ONLY way in — a bare
             * onClick on a <tr> with no tabIndex and no key handler, so keyboard and screen-reader
             * users could not open a single record.
             *
             * tabIndex + Enter/Space rather than role="button": that role would replace the row
             * semantics a table user navigates by, trading one barrier for another.
             */
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onRowClick(row)
                }
              } : undefined}
              className={cn(
                'border-b border-slate-50 transition-colors last:border-b-0 hover:bg-slate-50/60',
                onRowClick && 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--dashboard-action-bg)]',
              )}
            >
              {columns.map((column) => (
                <td key={column.header} className={cn('px-4 py-3 align-middle font-semibold text-slate-700', column.align === 'right' && 'text-right', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Mirror of deletePettyCashRequest's two rules (lib/petty-cash/server.ts): pending only, and
 * submitter only (developer / super_admin excepted).
 *
 * Lives here because the workspace and the status board render the SAME record and disagreed about
 * it — the board guarded the button correctly, the workspace rendered it on every row for every
 * role, so a reviewer saw a red Delete on 30 requests and every one returned "Only the user who
 * submitted this request can delete it." One function, both call sites.
 */
export function canDeletePettyCashRequestOnClient(
  request: Record<string, unknown> & { status?: string | null },
  currentUser: { id?: string | null; role?: string | null; email?: string | null; fullName?: string | null } | null | undefined,
  submitterName?: string | null,
): boolean {
  if (!currentUser) return false
  const status = String(request?.status || '')
  const DELETABLE = ['draft', 'ed_pending', 'ea_pending', 'md_pending', 'accounts_pending']
  if (!DELETABLE.includes(status)) return false

  const role = String(currentUser.role || '').trim().toLowerCase()
  if (role === 'developer' || role === 'super_admin') return true

  const createdBy = (request.createdBy ?? request.created_by) as string | undefined
  if (currentUser.id && createdBy && currentUser.id === createdBy) return true

  const reqEmail = String(request.requestedByEmail ?? request.requested_by_email ?? '').toLowerCase()
  if (currentUser.email && reqEmail && currentUser.email.toLowerCase() === reqEmail) return true

  const reqName = String(submitterName ?? request.requestedByName ?? request.requested_by_name ?? '').toLowerCase()
  if (currentUser.fullName && reqName && currentUser.fullName.toLowerCase() === reqName) return true

  return false
}
