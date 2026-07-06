'use client'

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
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(date)
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

export type Tone = 'emerald' | 'amber' | 'blue' | 'violet' | 'rose' | 'slate'

const TONE_CLASS: Record<Tone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function statusTone(status: string): Tone {
  const value = status.toLowerCase()
  if (value.includes('reject') || value.includes('cancel')) return 'rose'
  if (value.includes('approved') || value === 'active' || value === 'allocated') return 'emerald'
  if (value.includes('on_hold') || value.includes('hold')) return 'amber'
  if (value.includes('md_')) return 'blue'
  if (value.includes('accounts')) return 'violet'
  if (value.includes('ea_') || value.includes('pending') || value.includes('submitted')) return 'amber'
  return 'slate'
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
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
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
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</p>
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
}: {
  rows: T[]
  columns: Array<{ header: string; align?: 'left' | 'right'; cell: (row: T) => ReactNode; className?: string }>
  loading?: boolean
  empty: ReactNode
  rowKey: (row: T) => string
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`row-skeleton-${index}`} className="h-12 animate-pulse rounded-xl bg-slate-50" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) return <>{empty}</>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-black uppercase tracking-wider text-slate-500">
            {columns.map((column) => (
              <th key={column.header} className={cn('px-4 py-3 font-black', column.align === 'right' && 'text-right')}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-slate-50 transition-colors last:border-b-0 hover:bg-slate-50/60">
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
