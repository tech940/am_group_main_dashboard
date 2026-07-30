'use client'

import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Loader2, Receipt, User2, Wallet } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusPill, formatCurrency, formatDateTime } from './pc-shared'

/**
 * "When did the money go out?" for one allocation — the spend, day by day.
 *
 * Buckets on `expense_date` (the date the spender says the cash left), NOT `created_at`. They
 * disagree on roughly 39% of live rows, by up to 9 days, so bucketing on the entry timestamp would
 * put spends on the wrong day. `recordedAt` is surfaced per line so a back-dated entry is visible
 * rather than hidden.
 */

const DRAWER_CLASS =
  'fixed inset-y-0 !left-0 sm:!left-auto !right-0 !top-0 z-50 !flex min-w-0 h-dvh max-h-dvh w-full max-w-full sm:max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l border-slate-200 bg-white p-0 shadow-[0_30px_110px_rgba(15,23,42,0.32)] duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:!w-[min(640px,calc(100vw-1rem))] sm:rounded-l-[2rem]'

type SpendItem = {
  expenseNumber: string
  expenseDate: string
  amount: string
  description: string
  vendorName: string
  spentByName: string | null
  recordedAt: string | null
}

type SpendDay = { date: string; total: string; items: SpendItem[] }

type SpendPayload = {
  allocation: Record<string, unknown> & { allocatedToName?: string | null; remainingAmount?: string }
  days: SpendDay[]
  totalSpent: string
  expenseCount: number
}

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(d)
}

/** True when the spend date precedes the day the row was keyed in. */
function isBackdated(item: SpendItem) {
  if (!item.recordedAt) return false
  const recordedDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(item.recordedAt))
  return item.expenseDate < recordedDay
}

export function AllocationSpendDialog({
  allocationId,
  onClose,
}: {
  allocationId: string | null
  onClose: () => void
}) {
  // React Query rather than useEffect+useState: the query key IS the allocation id, so switching
  // rows can never show the previous allocation's numbers, and there is no synchronous setState in
  // an effect (react-hooks/set-state-in-effect). `enabled` keeps it idle while the drawer is shut.
  const query = useQuery({
    queryKey: ['petty-cash-allocation-spend', allocationId],
    enabled: Boolean(allocationId),
    staleTime: 30_000,
    queryFn: async (): Promise<SpendPayload> => {
      const res = await fetch(`/api/petty-cash/allocations/${allocationId}/spend`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed to load spend history')
      return json
    },
  })

  const data = query.data ?? null
  const loading = query.isPending && Boolean(allocationId)
  const error = query.isError ? ((query.error as Error)?.message || 'Failed to load spend history') : ''
  const a = data?.allocation as Record<string, unknown> | undefined

  return (
    <Dialog open={Boolean(allocationId)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={DRAWER_CLASS}>
        <DialogHeader className="border-b border-slate-100 px-6 py-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-black text-slate-900">
            <Wallet className="h-4 w-4 text-blue-600" />
            {String(a?.allocationNumber ?? a?.allocation_number ?? 'Allocation')}
          </DialogTitle>
          <DialogDescription className="text-xs font-medium text-slate-500">
            Spend against this allocation, day by day. Dated on when the money went out, not when the entry was typed.
          </DialogDescription>
        </DialogHeader>

        <AllocationSpendBody data={data} loading={loading} error={error} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The drawer's contents. Separate from the shell above because Radix mounts DialogContent through a
 * portal, which server rendering skips entirely — keeping the body here makes it directly
 * renderable, and keeps the fetch/JSX split honest.
 */
export function AllocationSpendBody({
  data,
  loading,
  error,
}: {
  data: SpendPayload | null
  loading: boolean
  error: string
}) {
  const a = data?.allocation as Record<string, unknown> | undefined
  const allocated = (a?.allocatedAmount ?? a?.allocated_amount) as string | undefined
  const allocatedOn = (a?.allocatedAt ?? a?.allocated_at) as string | undefined

  return (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
          ) : error ? (
            <p className="py-16 text-center text-sm font-semibold text-rose-700">{error}</p>
          ) : !data ? null : (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    ['Allocated', formatCurrency(allocated)],
                    ['Spent', formatCurrency(data.totalSpent)],
                    ['Remaining', formatCurrency(data.allocation.remainingAmount)],
                    ['Entries', String(data.expenseCount)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p>
                      <p className="mt-0.5 text-sm font-black tabular-nums text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-slate-200 pt-3 text-[11px] font-semibold text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <User2 className="h-3 w-3" /> {String(data.allocation.allocatedToName || '—')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-3 w-3" /> Allocated {formatDateTime(allocatedOn)}
                  </span>
                  <StatusPill status={String(a?.status || '')} />
                </div>
              </div>

              {data.days.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center">
                  <Receipt className="mx-auto h-6 w-6 text-slate-300" />
                  <p className="mt-2 text-sm font-bold text-slate-500">Nothing spent yet</p>
                  <p className="text-xs text-slate-400">This allocation has no approved expenses against it.</p>
                </div>
              ) : (
                data.days.map((day) => (
                  <div key={day.date} className="overflow-hidden rounded-2xl border border-slate-200">
                    <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
                      <p className="text-xs font-black text-slate-700">{dayLabel(day.date)}</p>
                      <p className="text-xs font-black tabular-nums text-rose-600">{formatCurrency(day.total)}</p>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {day.items.map((item) => (
                        <div key={item.expenseNumber} className="flex items-start justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-800">{item.description || '—'}</p>
                            <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400">
                              <span className="font-mono">{item.expenseNumber}</span>
                              {item.vendorName ? ` · ${item.vendorName}` : ''}
                              {item.spentByName ? ` · by ${item.spentByName}` : ''}
                            </p>
                            {isBackdated(item) && (
                              <p className="mt-0.5 text-[10px] font-semibold text-amber-600">
                                back-dated · recorded {formatDateTime(item.recordedAt)}
                              </p>
                            )}
                          </div>
                          <p className="shrink-0 text-xs font-black tabular-nums text-slate-900">{formatCurrency(item.amount)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
  )
}
