'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, Download, Columns3, RotateCcw, ChevronLeft, ChevronRight, X,
  Wallet, Clock, CheckCircle2, Landmark, BadgeIndianRupee, Ban, TrendingUp,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Chip, KpiRow, TableSkeleton, PremiumEmptyState, type KpiDatum,
} from '@/components/kia/premium'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { FinancePayoutDetail } from './finance-payout-detail'
import {
  dealerLabel, formatCompactMoney, formatDate, formatMoney, payoutStatusMeta, receiptStatusMeta,
  PAYOUT_STATUS_OPTIONS, RECEIPT_STATUS_OPTIONS,
  type PayoutListResponse, type PayoutRow,
} from './payouts-shared'

const ALL = 'all'
const PAGE_SIZE = 25

/**
 * Every column the ledger can show. `always` columns can't be hidden — without customer + delivery
 * date a row isn't identifiable, so hiding them would only ever be a mistake.
 */
type Column = { key: string; label: string; always?: boolean; hiddenByDefault?: boolean; numeric?: boolean }
const COLUMNS: Column[] = [
  { key: 'deliveryDate', label: 'Delivery', always: true },
  { key: 'customerName', label: 'Customer', always: true },
  { key: 'customerPhone', label: 'Mobile' },
  { key: 'model', label: 'Model' },
  { key: 'dealerCode', label: 'Dealer' },
  { key: 'salesExecutive', label: 'Sales Executive' },
  { key: 'hyp', label: 'Hypothecation' },
  { key: 'loanAmount', label: 'Loan', numeric: true },
  { key: 'payoutStatus', label: 'Payout' },
  { key: 'dealerPayoutPercent', label: 'Payout %', numeric: true },
  { key: 'dealerPayoutAmount', label: 'Payout Amt', numeric: true },
  { key: 'payoutReceiptStatus', label: 'Receipt' },
  { key: 'amountReceived', label: 'Received', numeric: true },
  { key: 'vehicleRegistrationNo', label: 'Reg. No', hiddenByDefault: true },
  { key: 'invoiceNumber', label: 'Invoice', hiddenByDefault: true },
  { key: 'bankBranch', label: 'Bank Branch', hiddenByDefault: true },
  { key: 'bankInterestRate', label: 'Int. Rate', hiddenByDefault: true, numeric: true },
  { key: 'tlName', label: 'TL', hiddenByDefault: true },
  { key: 'panNumber', label: 'PAN', hiddenByDefault: true },
]

async function fetchPayouts(qs: string): Promise<PayoutListResponse> {
  const res = await fetch(`/api/finance/payouts?${qs}`, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load the payout ledger')
  return data
}

export function FinancePayoutsDashboard() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [payoutStatus, setPayoutStatus] = useState(ALL)
  const [receiptStatus, setReceiptStatus] = useState(ALL)
  const [dealer, setDealer] = useState(ALL)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [showColumns, setShowColumns] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(COLUMNS.filter((c) => c.hiddenByDefault).map((c) => c.key)),
  )

  // Debounce the search so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  /**
   * Every filter goes through here so the page always resets with it — page 7 of the old result set
   * is meaningless against the new one. Done in the handler rather than an effect watching the
   * filters: setState inside an effect triggers a second render pass (and eslint's
   * react-hooks/set-state-in-effect rightly rejects it).
   */
  const applyFilter = useCallback((setter: (v: string) => void) => (value: string) => {
    setter(value)
    setPage(1)
  }, [])

  const clearFilters = useCallback(() => {
    setSearch(''); setPayoutStatus(ALL); setReceiptStatus(ALL); setDealer(ALL); setPage(1)
  }, [])

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (debouncedSearch) p.set('search', debouncedSearch)
    if (payoutStatus !== ALL) p.set('payoutStatus', payoutStatus)
    if (receiptStatus !== ALL) p.set('receiptStatus', receiptStatus)
    if (dealer !== ALL) p.set('dealer', dealer)
    p.set('page', String(page))
    p.set('pageSize', String(PAGE_SIZE))
    return p.toString()
  }, [debouncedSearch, payoutStatus, receiptStatus, dealer, page])

  const query = useQuery<PayoutListResponse>({
    queryKey: ['finance-payouts', qs],
    queryFn: () => fetchPayouts(qs),
    staleTime: 30_000,
    placeholderData: (prev) => prev, // keep the table on screen while paging — no flash to skeleton
  })

  const data = query.data
  const visible = useMemo(() => COLUMNS.filter((c) => !hidden.has(c.key)), [hidden])

  const toggleColumn = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const kpis: KpiDatum[] = useMemo(() => {
    const k = data?.kpis
    return [
      { key: 'total', label: 'Records', value: k?.total ?? 0, icon: Wallet, tone: 'indigo', hint: 'Delivered vehicles' },
      { key: 'pending', label: 'Pending', value: k?.pending ?? 0, icon: Clock, tone: 'amber', hint: 'Payout awaited' },
      { key: 'received', label: 'Received', value: k?.received ?? 0, icon: CheckCircle2, tone: 'emerald', hint: 'Payout in' },
      { key: 'noPayout', label: 'No Payout', value: k?.noPayout ?? 0, icon: Ban, tone: 'neutral', hint: 'Cash / not applicable' },
      { key: 'bankVisitDue', label: 'Bank Visit Due', value: k?.bankVisitDue ?? 0, icon: Landmark, tone: 'rose', hint: 'Scheduled, not done' },
      // Money KPIs get a compact format (₹12.6L) — seven digits of raw counter is unreadable at a glance.
      { key: 'payoutTotal', label: 'Payout Value', value: k?.payoutTotal ?? 0, icon: BadgeIndianRupee, tone: 'violet', hint: 'Dealer payout total', format: formatCompactMoney },
      { key: 'receivedTotal', label: 'Received Value', value: k?.receivedTotal ?? 0, icon: TrendingUp, tone: 'teal', hint: 'Amount received', format: formatCompactMoney },
    ]
  }, [data])

  // Clicking a KPI filters the table to it — the numbers become navigation, not decoration.
  const onKpi = useCallback((key: string) => {
    if (key === 'pending' || key === 'received' || key === 'noPayout') {
      const target = key === 'noPayout' ? 'no_payout' : key
      setReceiptStatus((prev) => (prev === target ? ALL : target))
      setPage(1)
    }
    if (key === 'total') clearFilters()
  }, [clearFilters])

  const activeKpi = receiptStatus === 'pending' ? 'pending'
    : receiptStatus === 'received' ? 'received'
      : receiptStatus === 'no_payout' ? 'noPayout' : undefined

  async function exportXlsx() {
    setExporting(true)
    try {
      // Export follows the CURRENT filter — the button sits with the filters, so that's what it means.
      const res = await fetch(`/api/finance/payouts/export?${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `finance-payouts-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      toast({ title: 'Could not export', description: e instanceof Error ? e.message : 'Try again', variant: 'error' })
    } finally { setExporting(false) }
  }

  const filtersActive = Boolean(debouncedSearch) || payoutStatus !== ALL || receiptStatus !== ALL || dealer !== ALL

  function cell(row: PayoutRow, key: string) {
    switch (key) {
      case 'deliveryDate': return <span className="kia-tnum font-semibold">{formatDate(row.deliveryDate)}</span>
      case 'customerName': return <span className="font-bold text-[var(--kia-text)]">{row.customerName || '—'}</span>
      case 'customerPhone': return <span className="kia-tnum">{row.customerPhone}</span>
      case 'dealerCode': return dealerLabel(row.dealerCode)
      case 'loanAmount': return <span className="kia-tnum">{formatMoney(row.loanAmount)}</span>
      case 'dealerPayoutAmount': return <span className="kia-tnum font-bold">{formatMoney(row.dealerPayoutAmount)}</span>
      case 'amountReceived': return <span className="kia-tnum">{formatMoney(row.amountReceived)}</span>
      case 'dealerPayoutPercent': return <span className="kia-tnum">{row.dealerPayoutPercent ? `${Number(row.dealerPayoutPercent)}%` : '—'}</span>
      case 'bankInterestRate': return <span className="kia-tnum">{row.bankInterestRate ? `${Number(row.bankInterestRate)}%` : '—'}</span>
      case 'payoutStatus': {
        const m = payoutStatusMeta(row.payoutStatus)
        return row.payoutStatus ? <Chip tone={m.tone} dot>{m.label}</Chip> : <span className="text-[var(--kia-text-faint)]">—</span>
      }
      case 'payoutReceiptStatus': {
        const m = receiptStatusMeta(row.payoutReceiptStatus)
        return row.payoutReceiptStatus ? <Chip tone={m.tone} dot>{m.label}</Chip> : <span className="text-[var(--kia-text-faint)]">—</span>
      }
      default: {
        const v = (row as unknown as Record<string, unknown>)[key]
        return <span className="truncate">{v ? String(v) : '—'}</span>
      }
    }
  }

  return (
    // kia-premium is REQUIRED — every --kia-* token below is scoped to it and resolves to nothing
    // outside. See app/globals.css.
    <div className="kia-premium space-y-4">
      <KpiRow items={kpis} activeKey={activeKpi} onSelect={onKpi} />

      {/* Toolbar */}
      <div className="kia-surface flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kia-text-faint)]" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search customer, model, invoice, registration, bank…"
            className="h-10 rounded-xl pl-9"
          />
        </div>

        <FilterSelect value={payoutStatus} onChange={applyFilter(setPayoutStatus)} placeholder="Payout" options={PAYOUT_STATUS_OPTIONS} />
        <FilterSelect value={receiptStatus} onChange={applyFilter(setReceiptStatus)} placeholder="Receipt" options={RECEIPT_STATUS_OPTIONS} />
        <FilterSelect
          value={dealer}
          onChange={applyFilter(setDealer)}
          placeholder="Dealer"
          options={(data?.options.dealers || []).map((d) => ({ value: d, label: dealerLabel(d) }))}
        />

        {filtersActive && (
          <Button
            variant="outline"
            className="h-10 gap-1.5 rounded-xl text-xs font-bold"
            onClick={clearFilters}
          >
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}

        <div className="relative">
          <Button variant="outline" className="h-10 gap-1.5 rounded-xl text-xs font-bold" onClick={() => setShowColumns((v) => !v)}>
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </Button>
          {showColumns && (
            <>
              {/* Click-away catcher */}
              <div className="fixed inset-0 z-40" onClick={() => setShowColumns(false)} />
              <div className="kia-float absolute right-0 top-12 z-50 w-64 rounded-2xl p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="kia-kicker">Visible columns</p>
                  <button
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--kia-accent)]"
                    onClick={() => setHidden(new Set(COLUMNS.filter((c) => c.hiddenByDefault).map((c) => c.key)))}
                  >
                    <RotateCcw className="h-3 w-3" /> Reset
                  </button>
                </div>
                <div className="kia-scroll max-h-64 space-y-1 overflow-auto">
                  {COLUMNS.map((c) => (
                    <label
                      key={c.key}
                      className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-semibold',
                        c.always ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--kia-surface-sunken)]')}
                    >
                      <Checkbox
                        checked={!hidden.has(c.key)}
                        disabled={c.always}
                        onCheckedChange={() => !c.always && toggleColumn(c.key)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <Button
          variant="outline"
          className="h-10 gap-1.5 rounded-xl text-xs font-bold"
          onClick={() => void exportXlsx()}
          disabled={exporting || !data?.total}
        >
          <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export'}
        </Button>
      </div>

      {/* Table */}
      {query.isLoading ? (
        <div className="kia-surface p-4"><TableSkeleton rows={8} columns={8} /></div>
      ) : query.isError ? (
        <PremiumEmptyState
          illustration="error"
          title="Could not load the payout ledger"
          description={query.error instanceof Error ? query.error.message : 'Try again.'}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
        />
      ) : !data?.rows.length ? (
        <PremiumEmptyState
          illustration={filtersActive ? 'search' : 'garage'}
          title={filtersActive ? 'No records match these filters' : 'No delivered vehicles yet'}
          description={filtersActive
            ? 'Try widening the search or clearing the filters.'
            : 'Records appear here automatically when a vehicle is marked delivered.'}
          action={filtersActive
            ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
            : undefined}
        />
      ) : (
        <div className="kia-surface overflow-hidden p-0">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-[13px] font-bold text-[var(--kia-text-soft)]">
              <span className="kia-tnum text-[var(--kia-text)]">{data.total}</span> record{data.total === 1 ? '' : 's'}
              {filtersActive && <span className="ml-1 text-[var(--kia-text-faint)]">· filtered</span>}
              {/*
                * A date range filters on DELIVERY date, and a payout whose financing completed before
                * the car went out has none — so it drops out of the range entirely. Saying so is the
                * whole point: the alternative is a ledger that quietly gets shorter and money that
                * stops being chased because nobody knew it was missing.
                */}
              {(data.undatedExcluded ?? 0) > 0 && (
                <span className="ml-2 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                  {data.undatedExcluded} completed payout{data.undatedExcluded === 1 ? '' : 's'} not yet delivered — hidden by this date range
                </span>
              )}
            </p>
            <p className="text-[11px] font-bold text-[var(--kia-text-faint)]">
              Page {data.page} of {data.totalPages}
            </p>
          </div>

          {/* Sticky header: the ledger is wide + long, so the header must survive the scroll. */}
          <div className="kia-scroll max-h-[620px] overflow-auto">
            <Table className="kia-table">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  {visible.map((c) => (
                    <TableHead key={c.key} className={cn('whitespace-nowrap', c.numeric && 'text-right')}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(row.id)}
                  >
                    {visible.map((c) => (
                      <TableCell key={c.key} className={cn('whitespace-nowrap text-[13px]', c.numeric && 'text-right')}>
                        {cell(row, c.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--kia-hairline)] px-4 py-3">
            <p className="text-[11px] font-semibold text-[var(--kia-text-faint)]">
              Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" className="h-8 gap-1 rounded-lg px-3 text-xs font-bold"
                disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </Button>
              <Button
                variant="outline" className="h-8 gap-1 rounded-lg px-3 text-xs font-bold"
                disabled={data.page >= data.totalPages} onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <FinancePayoutDetail
          id={selected}
          onClose={() => setSelected(null)}
          onSaved={() => void query.refetch()}
        />
      )}
    </div>
  )
}

/** Filter dropdown with a built-in "All" option — mirrors the bookings convention. */
function FilterSelect({ value, onChange, placeholder, options }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-10 w-[140px] rounded-xl text-xs font-bold', value !== ALL && 'border-[var(--kia-accent)]')}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
