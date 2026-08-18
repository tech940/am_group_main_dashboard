'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  CalendarClock,
  ClipboardList,
  Clock,
  FileText,
  ImageOff,
  Loader2,
  MapPin,
  Receipt,
  User2,
  Wallet,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusPill, formatCurrency, formatDateTime } from './pc-shared'
import type { PettyCashCategory } from './types'

export type DetailTarget =
  | { type: 'request' | 'expense'; id: string; row?: Record<string, unknown> }
  | null

// Right-side drawer, mirroring the KIA Bookings detail panel — slides in from the
// right instead of a centered modal.
const DRAWER_CLASS =
  'fixed inset-y-0 !left-0 sm:!left-auto !right-0 !top-0 z-50 !flex min-w-0 h-dvh max-h-dvh w-full max-w-full sm:max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l border-slate-200 bg-white p-0 shadow-[0_30px_110px_rgba(15,23,42,0.32)] duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:!w-[min(600px,calc(100vw-1rem))] sm:rounded-l-[2rem]'

type HistoryItem = {
  id: string
  action: string
  stage: string | null
  remarks: string | null
  performedByName: string
  createdAt: string | null
}

type ExpenseDetail = {
  expense: Record<string, unknown>
  attachments: Array<{ id: string; fileName?: string | null; fileUrl?: string | null; mimeType?: string | null }>
  history: HistoryItem[]
}

type RequestDetail = {
  request: Record<string, unknown>
  allocation: Record<string, unknown> | null
  history: HistoryItem[]
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|heic|heif)(\?|#|$)/i

function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Read a field allowing either camelCase or snake_case, preferring the fetched
 * detail object and falling back to the clicked list row. */
function field(primary: Record<string, unknown> | undefined, fallback: Record<string, unknown> | undefined, ...keys: string[]): string {
  for (const source of [primary, fallback]) {
    if (!source) continue
    for (const key of keys) {
      const value = source[key]
      if (value !== null && value !== undefined && value !== '') return String(value)
    }
  }
  return ''
}

function collectBills(detail: ExpenseDetail | null): Array<{ url: string; name?: string }> {
  if (!detail) return []
  const seen = new Set<string>()
  const bills: Array<{ url: string; name?: string }> = []
  const raw = detail.expense.billFiles
  for (const file of Array.isArray(raw) ? raw : []) {
    const url = str(file).trim()
    if (url && !seen.has(url)) { seen.add(url); bills.push({ url }) }
  }
  for (const attachment of detail.attachments || []) {
    const url = str(attachment.fileUrl).trim()
    if (url && !seen.has(url)) { seen.add(url); bills.push({ url, name: attachment.fileName || undefined }) }
  }
  return bills
}

export function PettyCashDetailDialog({
  target,
  onClose,
  categories = [],
}: {
  target: DetailTarget
  onClose: () => void
  categories?: PettyCashCategory[]
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expenseDetail, setExpenseDetail] = useState<ExpenseDetail | null>(null)
  const [requestDetail, setRequestDetail] = useState<RequestDetail | null>(null)

  const load = useCallback(async (t: NonNullable<DetailTarget>) => {
    setLoading(true)
    setError(null)
    setExpenseDetail(null)
    setRequestDetail(null)
    try {
      const endpoint = t.type === 'expense' ? 'expenses' : 'requests'
      const res = await fetch(`/api/petty-cash/${endpoint}?id=${encodeURIComponent(t.id)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to load details')
      if (t.type === 'expense') setExpenseDetail(data as ExpenseDetail)
      else setRequestDetail(data as RequestDetail)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load details')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!target) return
    const timer = setTimeout(() => { void load(target) }, 0)
    return () => clearTimeout(timer)
  }, [target, load])

  const isExpense = target?.type === 'expense'
  // Prefer the fetched detail; fall back to the clicked list row so the drawer
  // paints instantly instead of showing a skeleton.
  const fetched = (isExpense ? expenseDetail?.expense : requestDetail?.request) as Record<string, unknown> | undefined
  const row = target?.row
  const history = (isExpense ? expenseDetail?.history : requestDetail?.history) || []
  const allocation = requestDetail?.allocation
  const bills = collectBills(expenseDetail)

  const headerNumber = isExpense
    ? field(fetched, row, 'expenseNumber', 'expense_number') || 'Expense'
    : field(fetched, row, 'requestNumber', 'request_number') || 'Request'
  const headerStatus = field(fetched, row, 'status')
  const headerAmount = isExpense
    ? field(fetched, row, 'amount')
    : field(fetched, row, 'requestedAmount', 'requested_amount')
  const categoryName = categories.find((category) => category.id === field(fetched, row, 'categoryId', 'category_id'))?.name || null

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={DRAWER_CLASS}>
        <DialogHeader className="space-y-3 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white p-6 text-left">
          <div className="flex items-center justify-between gap-3 pr-8">
            <span className="font-mono text-xs font-bold text-slate-500">{headerNumber}</span>
            {headerStatus ? <StatusPill status={headerStatus} /> : null}
          </div>
          <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">
            {formatCurrency(headerAmount)}
          </DialogTitle>
          <DialogDescription className="text-sm font-semibold text-slate-500">
            {isExpense ? 'Expense details' : 'Petty cash request details'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
          ) : isExpense ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <DetailField icon={CalendarClock} label="Date" value={formatDateTime(field(fetched, row, 'expenseDate', 'expense_date', 'createdAt', 'created_at')) || '—'} />
                <DetailField icon={Receipt} label="Vendor" value={field(fetched, row, 'vendorName', 'vendor_name') || '—'} />
                <DetailField icon={User2} label="Received By" value={field(fetched, row, 'receivedBy', 'received_by') || '—'} />
                <DetailField icon={ClipboardList} label="Category" value={categoryName || '—'} />
                <DetailField icon={Building2} label="Department" value={field(fetched, row, 'department') || '—'} />
                <DetailField icon={Building2} label="Location" value={field(fetched, row, 'location') || '—'} />
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">Particulars</p>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">{field(fetched, row, 'particulars', 'purpose') || '—'}</p>
              </div>
              <BillGallery bills={bills} loading={loading} />
              <Timeline history={history} loading={loading} />
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <DetailField icon={User2} label="Requested By" value={field(fetched, row, 'requestedByName', 'requested_by_name') || '—'} />
                <DetailField icon={Building2} label="Department" value={field(fetched, row, 'department') || '—'} />
                <DetailField icon={MapPin} label="Location" value={field(fetched, row, 'location') || '—'} />
                <DetailField icon={CalendarClock} label="Submitted" value={formatDateTime(field(fetched, row, 'submittedAt', 'submitted_at', 'createdAt', 'created_at')) || '—'} />
                <DetailField icon={Wallet} label="Allocated" value={allocation ? formatCurrency(str(allocation.allocatedAmount)) : '—'} />
                <DetailField icon={Wallet} label="Payment Type" value={field(fetched, row, 'typeOfPayment') || '—'} />
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-600">Purpose</p>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">{field(fetched, row, 'purpose') || '—'}</p>
              </div>
              <Timeline history={history} loading={loading} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BillGallery({ bills, loading }: { bills: Array<{ url: string; name?: string }>; loading: boolean }) {
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
        <Receipt className="h-4 w-4 text-slate-500" /> Bill / Invoice{loading ? '' : ` (${bills.length})`}
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
      </p>
      {loading && bills.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <div key={`bill-skeleton-${index}`} className="aspect-[4/3] animate-pulse motion-reduce:animate-none rounded-2xl bg-slate-100" />)}
        </div>
      ) : bills.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-sm font-semibold text-slate-500">
          <ImageOff className="h-4 w-4" /> No bill uploaded for this expense.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {bills.map((bill, index) => {
            const isImage = IMAGE_RE.test(bill.url)
            return (
              <a
                key={`${bill.url}-${index}`}
                href={bill.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition-colors hover:border-slate-300"
                title={bill.name || `Bill ${index + 1}`}
              >
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external Supabase public URL; next/image not configured for this remote host.
                  <img src={bill.url} alt={bill.name || `Bill ${index + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                ) : (
                  <span className="flex flex-col items-center gap-1.5 text-slate-500">
                    <FileText className="h-7 w-7" />
                    <span className="px-2 text-center text-[11px] font-bold">{bill.name || 'View PDF'}</span>
                  </span>
                )}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Timeline({ history, loading }: { history: HistoryItem[]; loading: boolean }) {
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
        <Clock className="h-4 w-4 text-slate-500" /> Timeline
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
      </p>
      {history.length > 0 ? (
        <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
          {history.map((item) => (
            <li key={item.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[var(--dashboard-action-bg)] ring-2 ring-white" />
              <p className="text-sm font-bold capitalize text-slate-800">{item.action.replace(/_/g, ' ')}</p>
              <p className="text-xs font-semibold text-slate-500">{item.performedByName} · {formatDateTime(item.createdAt)}</p>
              {item.remarks && <p className="mt-0.5 text-xs font-medium italic text-slate-500">“{item.remarks}”</p>}
            </li>
          ))}
        </ol>
      ) : loading ? (
        <p className="text-sm font-medium text-slate-500">Loading history…</p>
      ) : (
        <p className="text-sm font-medium text-slate-500">No history yet.</p>
      )}
    </div>
  )
}

function DetailField({ icon: Icon, label, value }: { icon: typeof User2; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-600">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold text-slate-800">{value}</p>
    </div>
  )
}
