'use client'

import * as React from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CarFront,
  ClipboardCheck,
  Download,
  FileWarning,
  Hourglass,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatStockNo } from '@/lib/h-promise/constants'
import { isSaleRecorded } from '@/lib/h-promise/insights-core'
import { normalizeRegNo } from '@/lib/h-promise/registration'
import { APPROVAL_QUEUE_LABELS, type ApprovalQueue } from '@/lib/h-promise/status'
import type { HpVehicleRow } from '@/lib/h-promise/types'
import { downloadHpExport, useVehicles } from './hp-data'
import { useHpSection, useLabel } from './hp-context'
import { day, inr, inrShort, MONTH_NAMES } from './hp-format'
import {
  AgingBar,
  Band,
  BandCell,
  DocDots,
  EmptyState,
  ErrorState,
  FilterSelect,
  HpButton,
  LoadingBlock,
  Money,
  MonthCalendarFilter,
  PlateSearch,
  RegPlate,
  Segmented,
  StageChip,
  ToneChip,
  type Tone,
} from './hp-ui'
import { toast } from '@/hooks/use-toast'

type StageFilter = 'all' | 'in_stock' | 'booked' | 'sold'
type AttentionKey =
  | 'overdue_sale' | 'purchase_pending' | 'sale_pending' | 'rejected' | 'ledger' | 'broker_rc' | 'docs'
  | 'paperwork' | 'insurance_expired' | 'insurance_due' | 'aging'

type AttentionDef = { key: AttentionKey; label: string; tone: Tone; icon: LucideIcon; test: (row: HpVehicleRow) => boolean; show: boolean }

type SortKey = 'stock' | 'age' | 'price' | 'bought' | 'profit'

/** The register: summary band, what needs attention, and the searchable vehicle table. */
export function VehiclesTab() {
  const { caps, openVehicle, meta } = useHpSection()
  const label = useLabel()
  const query = useVehicles('live')
  const rows = React.useMemo(() => query.data?.rows ?? [], [query.data])
  const today = query.data?.today ?? meta?.today ?? ''
  const monthNow = today.slice(0, 7)

  const [search, setSearch] = React.useState('')
  const [stage, setStage] = React.useState<StageFilter>('all')
  const [location, setLocation] = React.useState('')
  const [month, setMonth] = React.useState('')
  const [attention, setAttention] = React.useState<AttentionKey | null>(null)
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'stock', dir: 'desc' })
  const [page, setPage] = React.useState<{ key: string; limit: number }>({ key: '', limit: 100 })

  const attentionDefs: AttentionDef[] = React.useMemo(() => [
    { key: 'overdue_sale', label: '🚨 Overdue Target Sale', tone: 'rejected', icon: AlertTriangle, test: (r) => r.flags.saleOverdue, show: true },
    { key: 'purchase_pending', label: 'Purchases to approve', tone: 'pending', icon: ClipboardCheck, test: (r) => r.flags.purchasePending, show: caps.approvals.view || caps.register.view },
    { key: 'sale_pending', label: 'Sales to approve', tone: 'pending', icon: ClipboardCheck, test: (r) => r.flags.salePending, show: caps.approvals.view || caps.register.view },
    { key: 'rejected', label: 'Rejected — to fix', tone: 'rejected', icon: Undo2, test: (r) => r.flags.purchaseRejected || r.flags.saleRejected, show: caps.register.create || caps.register.edit || caps.approvals.view },
    { key: 'ledger', label: 'Ledgers to upload', tone: 'pending', icon: Wallet, test: (r) => r.flags.ledgerPending, show: true },
    { key: 'docs', label: 'Sold, documents missing', tone: 'rejected', icon: FileWarning, test: (r) => r.flags.docsMissing, show: true },
    { key: 'broker_rc', label: 'Broker RC pending', tone: 'pending', icon: FileWarning, test: (r) => r.flags.brokerRcPending, show: true },
    { key: 'paperwork', label: 'Hypothecation / RTO in progress', tone: 'booked', icon: Hourglass, test: (r) => r.flags.paperworkPending, show: true },
    { key: 'insurance_expired', label: 'Insurance expired', tone: 'rejected', icon: ShieldAlert, test: (r) => r.flags.insurance === 'expired', show: true },
    { key: 'insurance_due', label: 'Insurance due in 30 days', tone: 'pending', icon: ShieldAlert, test: (r) => r.flags.insurance === 'due7' || r.flags.insurance === 'due15' || r.flags.insurance === 'due30', show: true },
    { key: 'aging', label: 'Over 60 days in stock', tone: 'rejected', icon: Hourglass, test: (r) => r.flags.longAging, show: true },
  ], [caps])

  const counts = React.useMemo(() => {
    const map = new Map<AttentionKey, number>()
    for (const def of attentionDefs) map.set(def.key, rows.filter(def.test).length)
    return map
  }, [attentionDefs, rows])

  const overdueVehicles = React.useMemo(
    () => rows.filter((r) => r.flags.saleOverdue).sort((a, b) => (b.flags.daysOverdue ?? 0) - (a.flags.daysOverdue ?? 0)),
    [rows]
  )

  const stock = rows.filter((r) => (r.stage === 'in_stock' || r.stage === 'booked') && r.purchaseStatus !== 'rejected')
  const soldThisMonth = rows.filter((r) => isSaleRecorded(r) && r.saleDate?.startsWith(monthNow))
  const kpi = {
    inStock: stock.filter((r) => r.stage === 'in_stock').length,
    booked: stock.filter((r) => r.stage === 'booked').length,
    soldMonth: soldThisMonth.length,
    soldMonthNp: soldThisMonth.reduce((sum, r) => sum + (r.economics.netProfit ?? 0), 0),
    awaiting: rows.filter((r) => r.flags.purchasePending).length + rows.filter((r) => r.flags.salePending).length,
    value: stock.reduce((sum, r) => sum + r.purchasePrice, 0),
    valueGst: stock.reduce((sum, r) => sum + (r.economics.priceWithGst ?? 0), 0),
    over60: stock.filter((r) => r.flags.longAging).length,
  }

  const locationOptions = (meta?.options.location ?? []).map((o) => ({ value: o.value, label: o.label }))
  const monthCounts = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      const key = r.purchaseDate.slice(0, 7)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [rows])

  const stageCounts = {
    all: rows.length,
    in_stock: rows.filter((r) => r.stage === 'in_stock').length,
    booked: rows.filter((r) => r.stage === 'booked').length,
    sold: rows.filter((r) => r.stage === 'sold').length,
  }

  const filtered = React.useMemo(() => {
    const needle = search.trim().toUpperCase()
    const needleKey = normalizeRegNo(needle)
    const def = attention ? attentionDefs.find((d) => d.key === attention) : null
    const list = rows.filter((r) => {
      if (stage !== 'all' && r.stage !== stage) return false
      if (location && r.location !== location) return false
      if (month && !r.purchaseDate.startsWith(month)) return false
      if (def && !def.test(r)) return false
      if (needle) {
        const hay = `${r.model} ${r.colour ?? ''} ${r.buyerName ?? ''} ${r.soldBy ?? ''} ${r.purchasedBy} ${formatStockNo(r.stockNo)}`.toUpperCase()
        if (!(needleKey.length >= 2 && r.regNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase().includes(needleKey)) && !hay.includes(needle)) return false
      }
      return true
    })
    const value = (r: HpVehicleRow): number => {
      switch (sort.key) {
        case 'age': return r.flags.daysInStock ?? -1
        case 'price': return r.purchasePrice
        case 'bought': return Date.parse(r.purchaseDate)
        case 'profit': return r.economics.netProfit ?? Number.NEGATIVE_INFINITY
        default: return r.stockNo
      }
    }
    return list.sort((a, b) => (sort.dir === 'asc' ? value(a) - value(b) : value(b) - value(a)))
  }, [rows, search, stage, location, month, attention, attentionDefs, sort])

  // A new filter starts again from the first 100 rows.
  const filterKey = JSON.stringify([search, stage, location, month, attention])
  const limit = page.key === filterKey ? page.limit : 100
  const showMore = () => setPage({ key: filterKey, limit: limit + 200 })

  const filtersOn = Boolean(search || stage !== 'all' || location || month || attention)
  const clear = () => {
    setSearch('')
    setStage('all')
    setLocation('')
    setMonth('')
    setAttention(null)
  }

  const exportRegister = () => {
    toast({ title: 'Preparing the register…' })
    downloadHpExport('/api/h-promise/export?kind=register').catch((error) =>
      toast({ title: 'The register could not be downloaded', description: error instanceof Error ? error.message : undefined, variant: 'error' }))
  }

  if (query.isLoading) return <LoadingBlock label="Loading the register" rows={8} />
  if (query.isError && !query.data) return <ErrorState message={query.error instanceof Error ? query.error.message : 'The register could not be loaded.'} onRetry={() => query.refetch()} />

  const shownAttention = attentionDefs.filter((d) => d.show && (counts.get(d.key) ?? 0) > 0)

  return (
    <div className="space-y-4">
      <Band label="Register at a glance">
        <BandCell label="In stock" tone="stock" value={kpi.inStock} sub="Available to sell" onClick={() => setStage(stage === 'in_stock' ? 'all' : 'in_stock')} pressed={stage === 'in_stock'} />
        <BandCell label="Booked" tone="booked" value={kpi.booked} sub="Waiting for sale" onClick={() => setStage(stage === 'booked' ? 'all' : 'booked')} pressed={stage === 'booked'} />
        <BandCell label="Sold this month" tone="sold" value={kpi.soldMonth} sub={kpi.soldMonth ? `Net ${inrShort(kpi.soldMonthNp)}` : day(today, true).replace(/^\d+\s/, '')} />
        <BandCell label="Awaiting approval" tone="pending" value={kpi.awaiting} sub="Purchases and sales" />
        <BandCell label="Stock value" tone="accent" value={inrShort(kpi.value)} sub={`With GST ${inrShort(kpi.valueGst)}`} hint="Purchase price of every car in stock or booked, without GST." />
        <BandCell label="Over 60 days" tone="rejected" value={kpi.over60} sub="Oldest stock" onClick={() => setAttention(attention === 'aging' ? null : 'aging')} pressed={attention === 'aging'} />
      </Band>

      {shownAttention.length > 0 && (
        <section aria-labelledby="hp-attention" className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-2xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span id="hp-attention" className="mr-1 text-xs font-semibold text-slate-500">
              Needs attention:
            </span>
            {shownAttention.map((def) => {
              const on = attention === def.key
              return (
                <button
                  key={def.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAttention(on ? null : def.key)}
                  data-tone={def.tone}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors',
                    on ? 'hp-tone-fill border-transparent text-white shadow-2xs' : 'hp-tone hover:opacity-90',
                  )}
                >
                  <span>{def.label.replace(/^🚨\s*/, '')}</span>
                  <span className={cn('hp-num rounded-full px-1.5 text-[10.5px]', on ? 'bg-white/25' : 'hp-count')}>{counts.get(def.key)}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
          <PlateSearch value={search} onChange={setSearch} />
          <Segmented
            label="Stage"
            value={stage}
            onChange={setStage}
            options={[
              { value: 'all', label: 'All', count: stageCounts.all },
              { value: 'in_stock', label: 'In stock', count: stageCounts.in_stock, tone: 'stock' },
              { value: 'booked', label: 'Booked', count: stageCounts.booked, tone: 'booked' },
              { value: 'sold', label: 'Sold', count: stageCounts.sold, tone: 'sold' },
            ]}
          />
          <FilterSelect label="Location" value={location} onChange={setLocation} options={locationOptions} allLabel="All locations" />
          <MonthCalendarFilter label="Bought in" value={month} onChange={setMonth} monthCounts={monthCounts} today={today} />
          {filtersOn && (
            <HpButton size="sm" variant="ghost" onClick={clear}><X /> Clear</HpButton>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hp-num text-xs text-slate-500 tabular-nums" aria-live="polite">{filtered.length} of {rows.length}</span>
            <HpButton size="sm" variant="outline" onClick={exportRegister}><Download /> Excel</HpButton>
          </div>
        </div>
        {attention && (
          <div className="hp-accent-soft flex items-center gap-2 px-4 py-2 text-xs text-slate-700 border-b border-slate-100">
            Showing: <strong>{attentionDefs.find((d) => d.key === attention)?.label}</strong>
            <button type="button" onClick={() => setAttention(null)} className="hp-accent-text ml-1 font-semibold underline-offset-2 hover:underline">Show all</button>
          </div>
        )}
        {query.data?.truncated && (
          <p className="px-4 py-2 text-xs text-slate-500">Only the first 5,000 vehicles are shown.</p>
        )}
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={rows.length === 0 ? 'No vehicles on the register yet' : 'No vehicle matches these filters'}
              icon={<CarFront className="h-5 w-5" />}
              action={filtersOn ? <HpButton variant="outline" size="sm" onClick={clear}><RotateCcw /> Clear filters</HpButton> : undefined}
            >
              {rows.length === 0 ? (caps.register.create ? 'Record the first purchase with “New purchase”.' : 'Purchases appear here once the desk records them.') : 'Try another plate, stage or month.'}
            </EmptyState>
          </div>
        ) : (
          <div className="hp-scroll max-h-[70vh]">
            <table className="hp-table hp-table-dense min-w-[1040px]">
              <thead>
                <tr>
                  <SortHeader label="Stock" k="stock" sort={sort} onSort={setSort} />
                  <th scope="col">Vehicle</th>
                  <th scope="col">Location</th>
                  <SortHeader label="Bought" k="bought" sort={sort} onSort={setSort} />
                  <SortHeader label="Age" k="age" sort={sort} onSort={setSort} />
                  <SortHeader label="Price" k="price" sort={sort} onSort={setSort} numeric />
                  <th scope="col">Status</th>
                  <th scope="col">Sale / booking</th>
                  <SortHeader label="Net profit" k="profit" sort={sort} onSort={setSort} numeric />
                  <th scope="col">Paperwork</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((row) => (
                  <tr key={row.id} data-clickable="true" onClick={() => openVehicle(row.id)}>
                    <td>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); openVehicle(row.id) }}
                        className="whitespace-nowrap text-xs font-semibold text-slate-600 underline-offset-2 hover:underline tabular-nums"
                        aria-label={`Open ${formatStockNo(row.stockNo)}, ${row.regNo}`}
                      >
                        {formatStockNo(row.stockNo)}
                      </button>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <RegPlate regNo={row.regNo} size="sm" />
                        <div className="min-w-0">
                          <p className="max-w-[14rem] truncate font-semibold text-slate-900">{row.model}</p>
                          <p className="max-w-[14rem] truncate text-xs text-slate-500">{[row.colour, row.manufacturingYear].filter(Boolean).join(' · ') || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-slate-700">{label(row.location)}</td>
                    <td className="whitespace-nowrap">
                      <p className="hp-num text-slate-800">{day(row.purchaseDate)}</p>
                      {row.expectedSaleDate && (
                        <p className={cn("text-[11.5px]", row.flags.saleOverdue ? "font-semibold text-rose-600" : "text-slate-500")} title="Target Expected Sale Date">
                          Exp: {day(row.expectedSaleDate, false)}
                        </p>
                      )}
                      <p className="text-xs text-slate-500">{label(row.purchasedBy)}</p>
                    </td>
                    <td><AgingBar days={row.flags.daysInStock} bucket={row.flags.agingBucket} /></td>
                    <td className="hp-num whitespace-nowrap">
                      <p className="font-semibold text-slate-900">{inr(row.purchasePrice)}</p>
                      <p className="text-xs text-slate-500">GST {row.purchaseGstPct} %</p>
                    </td>
                    <td>
                      <div className="flex max-w-[12.5rem] flex-wrap items-center gap-1">
                        <StageChip stage={row.stage} />
                        {row.flags.saleOverdue && (
                          <span
                            title={`Expected sale date was ${day(row.expectedSaleDate ?? '')}`}
                            className="inline-flex items-center gap-0.5 rounded bg-rose-600 px-1.5 py-0.5 text-[10.5px] font-semibold text-white shadow-2xs animate-pulse"
                          >
                            🚨 {row.flags.daysOverdue}d overdue
                          </span>
                        )}
                        <MiniStatus label="Buy" queue={row.flags.purchaseQueue} edited={row.purchaseEditedAfterApproval} />
                        {row.saleStatus && <MiniStatus label="Sale" queue={row.flags.saleQueue} edited={row.saleEditedAfterApproval} />}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {isSaleRecorded(row) ? (
                        <>
                          <p className="hp-num font-semibold text-slate-900">{inr(row.sellingPrice)}</p>
                          <p className="text-xs text-slate-500">{day(row.saleDate)} · {row.soldTo ? row.soldTo.charAt(0) + row.soldTo.slice(1).toLowerCase() : ''}</p>
                        </>
                      ) : row.booking ? (
                        <>
                          <p className="hp-num font-semibold text-slate-900">{inr(row.booking.amount)}</p>
                          <p className="text-xs text-slate-500">Booked {day(row.booking.bookingDate, false)}</p>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="hp-num whitespace-nowrap text-right">
                      {row.economics.netProfit !== null ? <Money value={row.economics.netProfit} signed className="font-semibold" /> : (
                        <span className="text-xs text-slate-500" title="Interest on the purchase price since it was bought">{inr(row.economics.interest)} interest</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <DocDots present={row.presentFiles} sold={isSaleRecorded(row)} />
                        {row.flags.insurance && row.flags.insurance !== 'ok' && row.flags.insurance !== 'unknown' && (
                          <ToneChip tone={row.flags.insurance === 'expired' ? 'rejected' : 'pending'} className="text-[10.5px]">
                            {row.flags.insurance === 'expired' ? 'Insurance expired' : 'Insurance due'}
                          </ToneChip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div className="flex justify-center border-t border-slate-100 p-3">
                <HpButton variant="outline" size="sm" onClick={showMore}>Show {Math.min(200, filtered.length - limit)} more</HpButton>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Where the purchase or sale stands in the two-stage approval: waiting on the GSM / SM, on the MD, or decided. */
function MiniStatus({ label, queue, edited }: { label: string; queue: ApprovalQueue | null; edited: boolean }) {
  const tone: Tone = queue === 'approved' ? 'approved' : queue === 'rejected' ? 'rejected' : 'pending'
  const word = queue === 'approved' ? 'Approved' : queue === 'rejected' ? 'Rejected' : queue === 'md' ? 'Waiting · MD' : 'Waiting · GSM/SM'
  const title = [queue ? APPROVAL_QUEUE_LABELS[queue] : null, edited ? 'Edited after approval' : null].filter(Boolean).join(' · ')
  return (
    <ToneChip tone={tone} className="text-[10.5px]" title={title || undefined}>
      {label} · {word}{edited ? ' ✎' : ''}
    </ToneChip>
  )
}

function SortHeader({ label, k, sort, onSort, numeric }: { label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (s: { key: SortKey; dir: 'asc' | 'desc' }) => void; numeric?: boolean }) {
  const active = sort.key === k
  const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={numeric ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort({ key: k, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={cn('inline-flex items-center gap-1 uppercase', active ? 'text-slate-900' : 'hover:text-slate-700')}
      >
        {label}
        {active && <Icon className="h-3 w-3" aria-hidden="true" />}
      </button>
    </th>
  )
}

export function DeletedTab() {
  const { openVehicle } = useHpSection()
  const label = useLabel()
  const query = useVehicles('deleted')
  if (query.isLoading) return <LoadingBlock label="Loading deleted vehicles" rows={4} />
  if (query.isError) return <ErrorState message={query.error instanceof Error ? query.error.message : 'Could not load deleted vehicles.'} onRetry={() => query.refetch()} />
  const rows = query.data?.rows ?? []
  if (rows.length === 0) return <EmptyState title="Nothing has been deleted" icon={<Trash2 className="h-5 w-5" />}>Deleted vehicles appear here and can be restored.</EmptyState>
  return (
    <div className="hp-scroll overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="hp-table min-w-[760px]">
        <thead>
          <tr>
            <th scope="col">Stock</th>
            <th scope="col">Vehicle</th>
            <th scope="col">Location</th>
            <th scope="col">Deleted</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-clickable="true" onClick={() => openVehicle(row.id)}>
              <td className="hp-mono text-[12px] font-semibold text-slate-600">{formatStockNo(row.stockNo)}</td>
              <td>
                <div className="flex items-center gap-3">
                  <RegPlate regNo={row.regNo} size="sm" />
                  <span className="font-semibold text-slate-900">{row.model}</span>
                </div>
              </td>
              <td>{label(row.location)}</td>
              <td className="whitespace-nowrap text-slate-700">{row.deletedAt ? day(row.deletedAt.slice(0, 10)) : '—'} · {row.deletedByName ?? '—'}</td>
              <td className="max-w-[24rem] text-slate-600">{row.deleteReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
