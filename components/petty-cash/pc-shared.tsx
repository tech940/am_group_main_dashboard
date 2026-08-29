'use client'

import { getPettyCashStageInfo } from '@/lib/petty-cash/status-tracking'

import { motion } from 'motion/react'
import { useState, useMemo, useEffect, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Wallet,
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getPettyCashStatusLabel } from '@/lib/petty-cash/constants'
import type {
  PettyCashAllocation,
  PettyCashExpense,
  PettyCashLedgerEntry,
  PettyCashRequest,
} from './types'

/* ------------------------------------------------------------------ */
/* Formatting + normalize helpers                                      */
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

export function toTitleCase(value?: string | null): string {
  if (!value) return ''
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function requestedByName(request: PettyCashRequest) {
  const name = request.requestedByName || request.requested_by_name
  if (!name) return '—'
  return toTitleCase(name)
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
/* Status pill & Location badge helper                                 */
/* ------------------------------------------------------------------ */

export type Tone = 'emerald' | 'amber' | 'blue' | 'violet' | 'rose' | 'sky' | 'slate'

export const TONE_CLASS: Record<Tone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800/60',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800/60',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-800/60',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-800/60',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-800/60',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-800/60',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
}

export function getLocationBadge(location: string): { bg: string; text: string; border: string } {
  const upper = (location || '').toUpperCase()
  if (upper.includes('JAMMU AUTO MART') || upper.includes('JAM')) {
    return { bg: 'bg-purple-50 dark:bg-purple-950/60', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800' }
  }
  if (upper.includes('SMAM')) {
    return { bg: 'bg-cyan-50 dark:bg-cyan-950/60', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-200 dark:border-cyan-800' }
  }
  if (upper.includes('PLATINUM')) {
    return { bg: 'bg-amber-50 dark:bg-amber-950/60', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' }
  }
  if (upper.includes('HYUNDAI')) {
    return { bg: 'bg-blue-50 dark:bg-blue-950/60', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' }
  }
  if (upper.includes('TATA')) {
    return { bg: 'bg-indigo-50 dark:bg-indigo-950/60', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-800' }
  }
  if (upper.includes('MG')) {
    return { bg: 'bg-rose-50 dark:bg-rose-950/60', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-800' }
  }
  return { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700' }
}

export function statusTone(status: string): Tone {
  return getPettyCashStageInfo(status).tone
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ring-1 ring-inset shadow-2xs', TONE_CLASS[statusTone(status)])}>
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
    <section className={cn('overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs', className)}>
      <div className="flex flex-col gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset shadow-2xs', TONE_CLASS[iconTone])}>
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div>
            <h3 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-50">{title}</h3>
            {subtitle && <p className="text-xs font-medium text-slate-500">{subtitle}</p>}
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
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800 text-slate-400">
        <Icon className="h-6 w-6" />
      </div>
      <h4 className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-200">{title}</h4>
      <p className="mt-0.5 max-w-sm text-xs font-medium text-slate-400">{description}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Summary KPI card                                                    */
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
      whileHover={onClick ? { y: -2 } : undefined}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-white dark:bg-slate-900 p-5 text-left shadow-xs transition-all',
        active ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200 dark:border-slate-800',
        onClick && 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-700',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset shadow-2xs', TONE_CLASS[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-950 dark:text-slate-50">{value}</p>
        {meta && <p className="mt-0.5 text-xs font-medium text-slate-400">{meta}</p>}
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
  const isLow = remaining <= 1000

  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Remaining Balance
            </p>
            <p className="text-[11px] font-medium text-slate-400">
              Active Float in Hand
            </p>
          </div>
        </div>
        <span
          className={cn(
            'px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums border shadow-2xs',
            isLow
              ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
          )}
        >
          {percentage}% spent
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <p
            className={cn(
              'text-3xl font-bold tabular-nums tracking-tight',
              isLow ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
            )}
          >
            {formatCurrency(remaining)}
          </p>
          <span className="text-xs font-medium text-slate-400">
            {formatCurrency(allocation - spent)} available
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <motion.div
            className={cn(
              'h-full rounded-full transition-all',
              percentage > 90 ? 'bg-amber-500' : percentage > 75 ? 'bg-indigo-500' : 'bg-emerald-500'
            )}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, percentage)}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
        <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Allocated Float</p>
          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100 mt-0.5">
            {formatCurrency(allocation)}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Spent to Date</p>
          <p className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-0.5">
            {formatCurrency(spent)}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Generic Table with Built-in Pagination                              */
/* ------------------------------------------------------------------ */

export function RecordTable<T>({
  rows,
  columns,
  loading,
  empty,
  rowKey,
  onRowClick,
  pageSizeOptions = [20, 40, 100],
  defaultPageSize = 20,
}: {
  rows: T[]
  columns: Array<{ header: string; align?: 'left' | 'right'; cell: (row: T) => ReactNode; className?: string }>
  loading?: boolean
  empty: ReactNode
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  pageSizeOptions?: number[]
  defaultPageSize?: number
}) {
  const [pageSize, setPageSize] = useState<number>(defaultPageSize)
  const [currentPage, setCurrentPage] = useState<number>(1)

  useEffect(() => {
    setCurrentPage(1)
  }, [rows.length, pageSize])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rows.length / pageSize)), [rows.length, pageSize])
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, currentPage, pageSize])

  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={`row-skeleton-${index}`} className="h-12 animate-pulse motion-reduce:animate-none rounded-xl bg-slate-50 dark:bg-slate-800/40" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) return <>{empty}</>

  return (
    <div className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-xs font-sans">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-950 text-white">
              {columns.map((column) => (
                <th key={column.header} className={cn('px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-300', column.align === 'right' && 'text-right')}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-normal">
            {paginatedRows.map((row) => (
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
                  'transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40',
                  onRowClick && 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                )}
              >
                {columns.map((column) => (
                  <td key={column.header} className={cn('px-4 py-3 align-middle font-medium text-slate-700 dark:text-slate-300', column.align === 'right' && 'text-right', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Showing{' '}
            <strong className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold">
              {(currentPage - 1) * pageSize + 1}
            </strong>
            –
            <strong className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold">
              {Math.min(currentPage * pageSize, rows.length)}
            </strong>{' '}
            of <strong className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold">{rows.length}</strong> records
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => setPageSize(Number(val))}
            >
              <SelectTrigger className="h-7 w-[76px] rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {pageSizeOptions.map((opt) => (
                  <SelectItem key={opt} value={String(opt)} className="text-xs font-medium">
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
            title="First Page"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
            title="Previous Page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>

          <div className="flex items-center gap-1 px-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
              .map((p, idx, arr) => {
                const prev = arr[idx - 1]
                const showEllipsis = prev && p - prev > 1
                return (
                  <span key={p} className="flex items-center">
                    {showEllipsis && <span className="px-1 text-slate-400 text-xs">…</span>}
                    <button
                      type="button"
                      onClick={() => setCurrentPage(p)}
                      className={cn(
                        'h-7 min-w-[28px] px-2 rounded-lg text-xs font-semibold tabular-nums transition-colors cursor-pointer',
                        currentPage === p
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-2xs font-bold'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
                      )}
                    >
                      {p}
                    </button>
                  </span>
                )
              })}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
            title="Next Page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40"
            title="Last Page"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Deletion Rule Guard                                                */
/* ------------------------------------------------------------------ */

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
