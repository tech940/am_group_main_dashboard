'use client'

import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Loader2, ShoppingCart, Banknote, Wallet, FileText, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BRANCH_OPTIONS, ALL_BRANCH_OPTION } from '@/lib/branches'
import { cn } from '@/lib/utils'
import { formatIndiaDate } from '@/lib/date-time'

type Metric = { approvedCount: number; approvedAmount: number }
type BranchRow = { branch: string; branchLabel: string; po: Metric; pettyCashFunding: Metric; pettyCashSpend: Metric }
type Summary = { branches: BranchRow[]; unassigned: BranchRow | null; totals: { po: Metric; pettyCashFunding: Metric; pettyCashSpend: Metric }; filters: { from: string | null; to: string | null } }
type Pagination = { page: number; pageSize: number; total: number; totalPages: number }
type PoRow = { id: string; orderNumber: string; branchLabel: string; vendorName: string | null; department: string | null; amount: number; status: string; approvedAt: string | null; approverName: string | null; documents: { invoices: string[]; quotations: string[]; bills: string[] } }
type FundingRow = { id: string; requestNumber: string; branchLabel: string; location: string | null; department: string | null; purpose: string; requestedAmount: number; approvedAt: string | null; approverName: string | null }
type ExpenseRow = { id: string; expenseNumber: string; branchLabel: string; location: string | null; vendorName: string | null; amount: number; particulars: string; expenseDate: string; approvedAt: string | null; approverName: string | null; billFiles: string[] }

const BRANCH_ITEMS = [ALL_BRANCH_OPTION, ...BRANCH_OPTIONS]

function formatCurrency(v: number) {
  const n = Number.isFinite(v) ? v : 0
  const r = Math.round(Math.abs(n))
  const sign = n < 0 ? '-' : ''
  if (r >= 10000000) return `${sign}₹${(r / 10000000).toFixed(2)}Cr`
  if (r >= 100000) return `${sign}₹${(r / 100000).toFixed(2)}L`
  return `${sign}₹${r.toLocaleString('en-IN')}`
}
function formatInt(v: number) { return Math.round(Number.isFinite(v) ? v : 0).toLocaleString('en-IN') }
// IST, explicitly. The CA view's approved-dates are what a chartered accountant reconciles against,
// so a date that silently shifts by timezone is the worst possible field to get wrong.
const formatDate = (iso: string | null) => formatIndiaDate(iso)

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
  return res.json()
}
function qs(params: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

export function CaDashboard() {
  const [branch, setBranch] = useState('all')
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')
  const [tab, setTab] = useState<'po' | 'petty'>('po')
  const [pcDataset, setPcDataset] = useState<'funding' | 'expenses'>('expenses')
  const [poPage, setPoPage] = useState(1)
  const [pcPage, setPcPage] = useState(1)

  const summaryQ = useQuery<Summary>({ queryKey: ['ca', 'summary', appliedFrom, appliedTo], queryFn: () => fetchJson(`/api/ca/summary?${qs({ from: appliedFrom, to: appliedTo })}`) })
  const poQ = useQuery<{ rows: PoRow[]; pagination: Pagination }>({
    queryKey: ['ca', 'po', branch, appliedFrom, appliedTo, poPage],
    queryFn: () => fetchJson(`/api/ca/purchase-orders?${qs({ branch, from: appliedFrom, to: appliedTo, page: poPage })}`),
    placeholderData: keepPreviousData, enabled: tab === 'po',
  })
  const pcQ = useQuery<{ rows: (FundingRow | ExpenseRow)[]; pagination: Pagination }>({
    queryKey: ['ca', 'petty', pcDataset, branch, appliedFrom, appliedTo, pcPage],
    queryFn: () => fetchJson(`/api/ca/petty-cash?${qs({ dataset: pcDataset, branch, from: appliedFrom, to: appliedTo, page: pcPage })}`),
    placeholderData: keepPreviousData, enabled: tab === 'petty',
  })

  const summary = summaryQ.data
  const ZERO_SCOPE = { po: { approvedCount: 0, approvedAmount: 0 }, pettyCashFunding: { approvedCount: 0, approvedAmount: 0 }, pettyCashSpend: { approvedCount: 0, approvedAmount: 0 } }
  const scope: { po: Metric; pettyCashFunding: Metric; pettyCashSpend: Metric } | null = !summary
    ? null
    : branch === 'all'
      ? summary.totals
      : summary.branches.find((b) => b.branch === branch) || ZERO_SCOPE

  function onBranch(v: string) { setBranch(v); setPoPage(1); setPcPage(1) }

  function handleApplyDates() {
    setAppliedFrom(fromInput)
    setAppliedTo(toInput)
    setPoPage(1)
    setPcPage(1)
  }

  function handleClearDates() {
    setFromInput('')
    setToInput('')
    setAppliedFrom('')
    setAppliedTo('')
    setPoPage(1)
    setPcPage(1)
  }

  const isDatesDirty = fromInput !== appliedFrom || toInput !== appliedTo

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Branch</label>
          <Select value={branch} onValueChange={onBranch}>
            <SelectTrigger className="h-9 w-52 rounded-xl text-xs font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>{BRANCH_ITEMS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Approved from</label>
          <input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-semibold outline-none focus:border-slate-400" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">to</label>
          <input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-semibold outline-none focus:border-slate-400" />
        </div>
        <Button onClick={handleApplyDates} disabled={!isDatesDirty} className="app-primary-action h-9 rounded-xl text-xs font-bold shadow-sm">Apply Filters</Button>
        {(appliedFrom || appliedTo || fromInput || toInput) && <Button variant="outline" className="h-9 rounded-xl text-xs font-bold" onClick={handleClearDates}>Clear dates</Button>}
      </div>

      {/* Headline KPI cards (selected scope) */}
      {summaryQ.isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : summaryQ.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(summaryQ.error as Error)?.message || 'Failed to load.'}</div>
      ) : scope ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <BigKpi icon={<ShoppingCart className="h-5 w-5" />} label="Approved Purchase Orders" value={formatCurrency(scope.po.approvedAmount)} sub={`${formatInt(scope.po.approvedCount)} approved`} tone="from-indigo-600 to-indigo-500" />
            <BigKpi icon={<Banknote className="h-5 w-5" />} label="Approved Petty-Cash Funding" value={formatCurrency(scope.pettyCashFunding.approvedAmount)} sub={`${formatInt(scope.pettyCashFunding.approvedCount)} approved requests`} tone="from-[#0B5D7A] to-[#0e7490]" />
            <BigKpi icon={<Wallet className="h-5 w-5" />} label="Approved Petty-Cash Spend" value={formatCurrency(scope.pettyCashSpend.approvedAmount)} sub={`${formatInt(scope.pettyCashSpend.approvedCount)} approved expenses`} tone="from-[#24766d] to-[#2f8f83]" />
          </div>
          {branch === 'all' && (summary!.branches.length > 0 || summary!.unassigned) && (
            <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3"><p className="text-[11px] font-black uppercase tracking-widest text-slate-500">By branch</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="px-5 py-2.5 text-left">Branch</th>
                      <th className="px-5 py-2.5 text-right">Approved POs</th>
                      <th className="px-5 py-2.5 text-right">PO value</th>
                      <th className="px-5 py-2.5 text-right">PC funding</th>
                      <th className="px-5 py-2.5 text-right">PC spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...summary!.branches, ...(summary!.unassigned ? [summary!.unassigned] : [])].map((b) => (
                      <tr key={b.branch} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-3 text-left font-black text-slate-800">{b.branchLabel}</td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatInt(b.po.approvedCount)}</td>
                        <td className="px-5 py-3 text-right font-black text-slate-900">{formatCurrency(b.po.approvedAmount)}</td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(b.pettyCashFunding.approvedAmount)}</td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(b.pettyCashSpend.approvedAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : null}

      {/* Tabs */}
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {([['po', 'Purchase Orders'], ['petty', 'Petty Cash']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors', tab === k ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900')}>{label}</button>
        ))}
      </div>

      {tab === 'po' ? (
        <TableCard
          loading={poQ.isLoading} error={poQ.error as Error | null}
          head={['Order #', 'Branch', 'Vendor', 'Dept', 'Amount', 'Approved', 'Approver', 'Documents']}
          empty="No approved purchase orders for this filter."
          rows={(poQ.data?.rows || []).map((r) => [
            <span key="on" className="font-bold text-slate-800">{r.orderNumber}</span>,
            r.branchLabel, r.vendorName || '—', r.department || '—',
            <span key="amt" className="font-black text-slate-900">{formatCurrency(r.amount)}</span>,
            formatDate(r.approvedAt), r.approverName || '—',
            <DocLinks key="doc" groups={[['Invoice', r.documents.invoices], ['Quote', r.documents.quotations], ['Bill', r.documents.bills]]} />,
          ])}
          align={['left', 'left', 'left', 'left', 'right', 'left', 'left', 'left']}
          pagination={poQ.data?.pagination} onPage={setPoPage}
          footnote="Approved value uses the PO amount once GRN is done, else the estimate. Shifts as POs progress."
        />
      ) : (
        <div className="space-y-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {([['expenses', 'Expenses (spend)'], ['funding', 'Funding (allocations)']] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setPcDataset(k); setPcPage(1) }} className={cn('rounded-md px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors', pcDataset === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}>{label}</button>
            ))}
          </div>
          {pcDataset === 'funding' ? (
            <TableCard
              loading={pcQ.isLoading} error={pcQ.error as Error | null}
              head={['Request #', 'Branch', 'Location', 'Dept', 'Purpose', 'Approved amount', 'Approved', 'Approver']}
              empty="No approved petty-cash funding for this filter."
              rows={(pcQ.data?.rows as FundingRow[] | undefined || []).map((r) => [
                <span key="rn" className="font-bold text-slate-800">{r.requestNumber}</span>,
                r.branchLabel, r.location || '—', r.department || '—', r.purpose,
                <span key="amt" className="font-black text-slate-900">{formatCurrency(r.requestedAmount)}</span>,
                formatDate(r.approvedAt), r.approverName || '—',
              ])}
              align={['left', 'left', 'left', 'left', 'left', 'right', 'left', 'left']}
              pagination={pcQ.data?.pagination} onPage={setPcPage}
              footnote="Approved funding = fresh approved request amounts; excludes balances carried forward into the next allocation."
            />
          ) : (
            <TableCard
              loading={pcQ.isLoading} error={pcQ.error as Error | null}
              head={['Expense #', 'Branch', 'Location', 'Vendor', 'Particulars', 'Amount', 'Date', 'Bills']}
              empty="No approved expenses for this filter."
              rows={(pcQ.data?.rows as ExpenseRow[] | undefined || []).map((r) => [
                <span key="en" className="font-bold text-slate-800">{r.expenseNumber}</span>,
                r.branchLabel, r.location || '—', r.vendorName || '—', r.particulars,
                <span key="amt" className="font-black text-slate-900">{formatCurrency(r.amount)}</span>,
                formatDate(r.expenseDate),
                <DocLinks key="bills" groups={[['Bill', r.billFiles]]} />,
              ])}
              align={['left', 'left', 'left', 'left', 'left', 'right', 'left', 'left']}
              pagination={pcQ.data?.pagination} onPage={setPcPage}
            />
          )}
        </div>
      )}
    </div>
  )
}

function BigKpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={cn('rounded-2xl bg-gradient-to-br p-5 text-white shadow-md', tone)}>
      <div className="flex items-center gap-1.5 opacity-90">{icon}<span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
      <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] font-semibold opacity-80">{sub}</p>
    </div>
  )
}

function DocLinks({ groups }: { groups: [string, string[]][] }) {
  const items = groups.flatMap(([label, urls]) => urls.map((url, i) => ({ label: `${label} ${i + 1}`, url })))
  if (items.length === 0) return <span className="text-slate-300">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <a key={it.url} href={it.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100">
          <FileText className="h-3 w-3" />{it.label}<ExternalLink className="h-2.5 w-2.5 opacity-60" />
        </a>
      ))}
    </div>
  )
}

function TableCard({ loading, error, head, rows, align, empty, pagination, onPage, footnote }: {
  loading: boolean; error: Error | null; head: string[]; rows: React.ReactNode[][]; align: ('left' | 'right')[]; empty: string
  pagination?: Pagination; onPage: (p: number) => void; footnote?: string
}) {
  return (
    <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : error ? (
        <div className="p-6 text-sm font-bold text-rose-700">{error.message || 'Failed to load.'}</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-sm font-semibold text-slate-400">{empty}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {head.map((h, i) => <th key={h} className={cn('px-4 py-2.5', align[i] === 'right' ? 'text-right' : 'text-left')}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-slate-50 last:border-0 align-top">
                    {r.map((c, ci) => <td key={ci} className={cn('px-4 py-3 font-semibold text-slate-600', align[ci] === 'right' ? 'text-right' : 'text-left')}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
              <span className="text-[11px] font-semibold text-slate-400">{formatInt(pagination.total)} records · page {pagination.page} / {pagination.totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" className="h-7 w-7 rounded-lg p-0" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" className="h-7 w-7 rounded-lg p-0" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}
      {footnote && rows.length > 0 && <p className="border-t border-slate-100 px-4 py-2 text-[10px] font-semibold italic text-slate-400">{footnote}</p>}
    </Card>
  )
}
