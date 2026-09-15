'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One pager for every insurance table.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The queue tables rendered every row they were given. On the live Hyundai book that is 646 rows in
 * Upcoming Expiries alone, and 19,338 already-expired policies behind Lost Customers — a table you
 * scroll for a minute to reach the end of, and that makes the browser lay out thousands of rows it
 * will never show anyone.
 *
 * ⚠️ The page size is SHARED across the tables and the page number is NOT. Someone who picks 500
 * means "show me more everywhere"; someone on page 7 of the call queue does not mean page 7 of the
 * register. Keeping the two apart is what stops a tab change landing on an empty page.
 */

/** The owner's three options, in order. Anything else would be a fourth thing to explain. */
export const INSURANCE_PAGE_SIZES = [50, 100, 500] as const
export type InsurancePageSize = (typeof INSURANCE_PAGE_SIZES)[number]
export const DEFAULT_INSURANCE_PAGE_SIZE: InsurancePageSize = 50

export function isInsurancePageSize(value: unknown): value is InsurancePageSize {
  return (INSURANCE_PAGE_SIZES as readonly number[]).includes(Number(value))
}

/** The rows for one page, plus the page actually shown — clamped, so a stale page cannot blank the table. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): { rows: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  /*
   * ⚠️ Clamped rather than trusted. Narrowing a filter while on page 9 leaves `page` past the end,
   * and slicing there returns [] — a table that reads as "no results" when the rows are simply on
   * page 1. Clamping shows the last page instead, which is what the viewer meant.
   */
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return { rows: rows.slice(start, start + pageSize), page: safePage, totalPages }
}

export function TablePager({
  page,
  totalPages,
  totalRows,
  pageSize,
  onPageChange,
  onPageSizeChange,
  noun = 'rows',
  className,
}: {
  page: number
  totalPages: number
  totalRows: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: InsurancePageSize) => void
  /** What is being counted, so the sentence reads as English: "of 646 policies". */
  noun?: string
  className?: string
}) {
  const first = totalRows === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, totalRows)

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800',
        className,
      )}
    >
      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {totalRows === 0 ? (
          `No ${noun}`
        ) : (
          <>
            Showing <span className="tabular-nums text-slate-800 dark:text-slate-200">{first.toLocaleString('en-IN')}</span>
            {'–'}
            <span className="tabular-nums text-slate-800 dark:text-slate-200">{last.toLocaleString('en-IN')}</span>
            {' of '}
            <span className="tabular-nums text-slate-800 dark:text-slate-200">{totalRows.toLocaleString('en-IN')}</span>
            {` ${noun}`}
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          Per page
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as InsurancePageSize)}
            className="h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {INSURANCE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[5.5rem] text-center text-[11px] font-bold tabular-nums text-slate-600 dark:text-slate-300">
            Page {page.toLocaleString('en-IN')} of {totalPages.toLocaleString('en-IN')}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
