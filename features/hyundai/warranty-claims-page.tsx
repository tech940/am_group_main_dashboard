'use client'

import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  FileImage,
  Filter,
  IndianRupee,
  LayoutDashboard,
  MessageSquarePlus,
  Search,
  TableProperties,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Source = 'ytp' | 'claim_list'
type WarrantyRow = Record<string, unknown> & {
  id: string
  recordKey: string
  dealerCode: string
  dealerName: string
  status: string
  businessDate: string | null
  requirement: {
    code: string | null
    label: string
    required: boolean
    requiresDocket: boolean
    ageDays: number
  }
  compliance: 'complete' | 'action_required' | 'not_required'
  remarkCount: number
  latestRemark: null | {
    remark: string
    docketNumber: string | null
    createdByName: string
    createdByRole: string
    createdAt: string
  }
  statusBucket: string
}

type Payload = {
  source: Source
  generatedAt: string
  permissions: { canEdit: boolean; canAudit: boolean }
  summary: {
    total: number
    totalClaimAmount: number
    approvedAmount: number
    overdueActions: number
    suspenseProofPending: number
    unresolved: number
  }
  options: { dealers: string[]; statuses: string[]; claimTypes: string[] }
  charts: null | {
    status: Array<{ name: string; count: number; amount: number }>
    dealers: Array<{ code: string; name: string; amount: number }>
    claimTypes: Array<{ name: string; count: number }>
    aging: Array<{ name: string; count: number }>
    monthly: Array<{ month: string; monthNumber: number; count: number; amount: number }>
  }
  matrix: null | {
    statuses: string[]
    rows: Array<{
      dealerCode: string
      dealerName: string
      amounts: Record<string, number>
      total: number
      currentYearAmounts: Record<string, number>
      currentYearTotal: number
      monthly: Array<{
        month: string
        monthNumber: number
        amounts: Record<string, number>
        total: number
      }>
    }>
  }
  ytpMonthlySummary: null | {
    dealers: string[]
    rows: Array<{ month: string; monthNumber: number; counts: Record<string, number>; total: number }>
    dealerTotals: Record<string, number>
    grandTotal: number
  }
  rows: WarrantyRow[]
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number }
}

type Filters = {
  page: number
  search: string
  dealer: string
  status: string
  claimType: string
  sla: string
  startDate: string
  endDate: string
  sort: string
  statusBucket: string
}

type HistoryPayload = {
  actions: Array<{
    id: string
    requirement_code: string
    status_snapshot: string | null
    business_date_snapshot: string | null
    remark: string
    docket_number: string | null
    created_by_name: string
    created_by_email: string
    created_by_role: string
    created_at: string
    evidence: Array<{ id: string; original_name: string; previewUrl: string }>
  }>
}

const COLORS = ['#0f3d75', '#2563eb', '#7c3aed', '#d97706', '#dc2626', '#059669', '#db2777']

function ResponsiveContainer(props: React.ComponentProps<typeof RechartsResponsiveContainer>) {
  return <RechartsResponsiveContainer minWidth={0} minHeight={0} debounce={50} {...props} />
}

function money(value: unknown) {
  return `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value || 0))}`
}

function number(value: unknown) {
  return new Intl.NumberFormat('en-IN').format(Number(value || 0))
}

function formatDate(value: unknown) {
  const text = String(value || '').slice(0, 10)
  if (!text) return '-'
  return new Date(`${text}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(value: unknown) {
  if (!value) return '-'
  return new Date(String(value)).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function buildQuery(source: Source, filters: Filters) {
  const params = new URLSearchParams({
    source,
    page: String(filters.page),
    pageSize: '25',
    sort: filters.sort,
    contract: 'warranty-ui-v2',
  })
  Object.entries(filters).forEach(([key, value]) => {
    if (key !== 'page' && key !== 'sort' && value) params.set(key, String(value))
  })
  return params.toString()
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

function KpiCard({ label, value, helper, icon: Icon, warning = false }: {
  label: string
  value: string
  helper: string
  icon: React.ComponentType<{ className?: string }>
  warning?: boolean
}) {
  return (
    <div className={cn('rounded-2xl border bg-white p-4 shadow-sm', warning ? 'border-rose-200' : 'border-slate-200')}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className={cn('mt-2 text-2xl font-black', warning ? 'text-rose-700' : 'text-slate-950')}>{value}</p>
        </div>
        <div className={cn('rounded-xl p-3', warning ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-700')}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-2 text-xs font-semibold text-slate-500">{helper}</p>
    </div>
  )
}

function SelectFilter({ value, onChange, children, label }: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  label: string
}) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
      >
        {children}
      </select>
    </label>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-black text-slate-900">{title}</p>
      <div className="h-64 min-w-0">{children}</div>
    </div>
  )
}

const actionButtonClass = 'rounded-xl border-[var(--dashboard-primary-border)] bg-[var(--dashboard-action-bg)] font-black text-[var(--dashboard-action-fg)] shadow-sm hover:bg-[var(--dashboard-action-hover)] hover:text-[var(--dashboard-action-fg)] focus-visible:ring-[var(--dashboard-primary)] disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500'
const activeActionButtonClass = 'bg-[var(--dashboard-action-hover)]'

export function HyundaiWarrantyClaimsPage({ source }: { source: Source }) {
  const queryClient = useQueryClient()
  const isYtp = source === 'ytp'
  const [filters, setFilters] = useState<Filters>({
    page: 1, search: '', dealer: '', status: '', claimType: '', sla: '', startDate: '', endDate: '', sort: 'date_desc', statusBucket: '',
  })
  const [showFilters, setShowFilters] = useState(false)
  const [showKpis, setShowKpis] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showYtpSummary, setShowYtpSummary] = useState(false)
  const [actionRow, setActionRow] = useState<WarrantyRow | null>(null)
  const [historyRow, setHistoryRow] = useState<WarrantyRow | null>(null)
  const [remark, setRemark] = useState('')
  const [docketNumber, setDocketNumber] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [expandedDealer, setExpandedDealer] = useState<string | null>(null)
  const queryString = useMemo(() => buildQuery(source, filters), [filters, source])

  const { data, isLoading, error } = useQuery<Payload>({
    queryKey: ['hyundai-warranty-claims', queryString],
    queryFn: () => fetch(`/api/brands/hyundai/warranty-claims?${queryString}`).then(readJson<Payload>),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  })

  const historyQuery = useQuery<HistoryPayload>({
    queryKey: ['hyundai-warranty-history', source, historyRow?.recordKey],
    queryFn: () => fetch(`/api/brands/hyundai/warranty-claims/actions?source=${source}&recordKey=${encodeURIComponent(historyRow!.recordKey)}`).then(readJson<HistoryPayload>),
    enabled: Boolean(historyRow),
  })

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!actionRow) throw new Error('No record selected')
      const form = new FormData()
      form.set('source', source)
      form.set('recordKey', actionRow.recordKey)
      form.set('remark', remark)
      form.set('docketNumber', docketNumber)
      files.forEach((file) => form.append('files', file))
      return fetch('/api/brands/hyundai/warranty-claims/actions', { method: 'POST', body: form }).then(readJson)
    },
    onSuccess: async () => {
      setActionRow(null)
      setRemark('')
      setDocketNumber('')
      setFiles([])
      await queryClient.invalidateQueries({ queryKey: ['hyundai-warranty-claims'] })
      await queryClient.invalidateQueries({ queryKey: ['hyundai-warranty-history'] })
    },
  })

  const updateFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value, page: 1 }))
  const columns = isYtp
    ? ['Dealer', 'RO No', 'RO Date', 'VIN', 'Claim Type', 'RO Status', 'Campaign', 'Category', 'SLA', 'Latest Remark', 'Actions']
    : ['Dealer', 'Claim No', 'Claim Date', 'VIN', 'RO No', 'Claim Type', 'Status', 'Total Amount', 'Approved', 'SLA', 'Latest Remark', 'Actions']

  return (
    <MainLayout title={isYtp ? 'Claim YTP' : 'Warranty Claim List'} subtitle="">
      <div className="space-y-4">
        <section className="rounded-[1.75rem] border border-white/70 bg-white/90 p-5 shadow-xl shadow-slate-900/5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-slate-950">{isYtp ? 'Claim YTP' : 'Warranty Claim List'}</h1>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">
                Updated {formatDateTime(data?.generatedAt)}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button className={cn(actionButtonClass, showFilters && activeActionButtonClass)} onClick={() => setShowFilters((value) => !value)}>
                  <Filter /> {showFilters ? 'Hide Filters' : 'Show Filters'}
                </Button>
                <Button className={cn(actionButtonClass, showKpis && activeActionButtonClass)} onClick={() => setShowKpis((value) => !value)}>
                  <LayoutDashboard /> {showKpis ? 'Hide KPIs' : 'Show KPIs'}
                </Button>
                {isYtp ? (
                  <Button className={cn(actionButtonClass, showYtpSummary && activeActionButtonClass)} onClick={() => setShowYtpSummary((value) => !value)}>
                    <TableProperties /> {showYtpSummary ? 'Hide Summary' : 'Show Summary'}
                  </Button>
                ) : (
                  <Button className={cn(actionButtonClass, showAnalytics && activeActionButtonClass)} onClick={() => setShowAnalytics((value) => !value)}>
                    <BarChart3 /> {showAnalytics ? 'Hide Analytics' : 'Show Analytics'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        {showKpis && <section className={cn('grid gap-3', isYtp ? 'md:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-6')}>
          <KpiCard label="Total Rows" value={number(data?.summary.total)} helper="Filtered records" icon={BarChart3} />
          {!isYtp && <KpiCard label="Claim Amount" value={money(data?.summary.totalClaimAmount)} helper="Sum of total_amt" icon={IndianRupee} />}
          {!isYtp && <KpiCard label="Approved Amount" value={money(data?.summary.approvedAmount)} helper="Approved by HMI" icon={CheckCircle2} />}
          <KpiCard label="Action Required" value={number(data?.summary.overdueActions)} helper="Missing current SLA response" icon={AlertTriangle} warning={Boolean(data?.summary.overdueActions)} />
          {!isYtp && <KpiCard label="Docket Proof" value={number(data?.summary.suspenseProofPending)} helper="Suspense evidence pending" icon={FileImage} warning={Boolean(data?.summary.suspenseProofPending)} />}
          {!isYtp && <KpiCard label="Unresolved" value={number(data?.summary.unresolved)} helper="Not accepted, denied or cancelled" icon={Clock3} />}
          {isYtp && <KpiCard label="Compliant" value={number((data?.summary.total || 0) - (data?.summary.overdueActions || 0))} helper="Within SLA or remarked" icon={CheckCircle2} />}
        </section>}

        {showFilters && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 xl:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Search</span>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Claim, RO, VIN, dealer or part..." className="pl-9" />
              </div>
            </label>
            <SelectFilter label="Dealer" value={filters.dealer} onChange={(value) => updateFilter('dealer', value)}>
              <option value="">All dealers</option>
              {data?.options.dealers.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectFilter>
            <SelectFilter label="SLA" value={filters.sla} onChange={(value) => updateFilter('sla', value)}>
              <option value="">All SLA states</option>
              <option value="action_required">Action required</option>
              <option value="complete">Remark completed</option>
              <option value="within_sla">Within SLA</option>
            </SelectFilter>
            <SelectFilter label="Status" value={filters.status} onChange={(value) => updateFilter('status', value)}>
              <option value="">All statuses</option>
              {data?.options.statuses.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectFilter>
            <SelectFilter label="Claim Type" value={filters.claimType} onChange={(value) => updateFilter('claimType', value)}>
              <option value="">All claim types</option>
              {data?.options.claimTypes.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectFilter>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">From</span>
              <Input type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">To</span>
              <Input type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
            </label>
          </div>
        </section>}

        {isYtp && showYtpSummary && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-black text-slate-950">Monthly Claim YTP Summary</h2>
              <p className="text-xs font-semibold text-slate-500">Monthly counts across all available years for the active filters.</p>
            </div>
            {isLoading ? (
              <div className="p-10 text-center text-sm font-bold text-slate-500">Loading monthly summary...</div>
            ) : error ? (
              <div className="p-10 text-center text-sm font-bold text-rose-600">Unable to load the monthly summary.</div>
            ) : !data?.ytpMonthlySummary ? (
              <div className="p-10 text-center text-sm font-bold text-amber-700">
                Summary data is unavailable. Refresh the page to load the latest warranty response.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-4 py-3 text-center">Month</th>
                    {data.ytpMonthlySummary.dealers.map((code) => <th key={code} className="px-4 py-3 text-center">{code}</th>)}
                    <th className="px-4 py-3 text-center">Grand Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ytpMonthlySummary.rows.map((row) => (
                    <tr key={row.monthNumber} className="border-b border-slate-100">
                      <td className="px-4 py-3 text-center font-black text-slate-900">{row.month}</td>
                      {data.ytpMonthlySummary!.dealers.map((code) => <td key={code} className="px-4 py-3 text-center font-mono">{number(row.counts[code])}</td>)}
                      <td className="px-4 py-3 text-center font-mono font-black">{number(row.total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 text-slate-950">
                    <td className="px-4 py-3 text-center font-black">Grand Total</td>
                    {data.ytpMonthlySummary.dealers.map((code) => <td key={code} className="px-4 py-3 text-center font-mono font-black">{number(data.ytpMonthlySummary!.dealerTotals[code])}</td>)}
                    <td className="px-4 py-3 text-center font-mono font-black">{number(data.ytpMonthlySummary.grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}
          </section>
        )}

        {!isYtp && showAnalytics && data?.charts && (
          <section className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Status Distribution">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.status}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Dealer-wise Claim Amount">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.dealers}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="code" /><YAxis /><Tooltip formatter={(value) => money(value)} /><Bar dataKey="amount" fill="#059669" radius={[6, 6, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Monthly Claim Trend">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.charts.monthly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={(value) => money(value)} /><Line type="monotone" dataKey="amount" stroke="#7c3aed" strokeWidth={3} /></LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Claim Type Mix">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={data.charts.claimTypes} dataKey="count" nameKey="name" innerRadius={45} outerRadius={85}>{data.charts.claimTypes.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <div className="xl:col-span-2">
              <ChartCard title="SLA Aging">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.aging}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="count" fill="#d97706" radius={[6, 6, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </section>
        )}

        {!isYtp && data?.matrix && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">Total Claim Amount</h2>
                <p className="text-xs font-semibold text-slate-500">Select a status to filter records, or expand a dealer for the current-year monthly breakdown.</p>
              </div>
              <CalendarDays className="h-5 w-5 text-blue-700" />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-4 py-3 text-center">Dealer</th>
                    {data.matrix.statuses.map((item) => (
                      <th key={item} className="px-2 py-2 text-center">
                        <Button
                          size="sm"
                          className={cn(actionButtonClass, 'w-full justify-center', filters.statusBucket === item && activeActionButtonClass)}
                          onClick={() => updateFilter('statusBucket', filters.statusBucket === item ? '' : item)}
                        >
                          {item}
                        </Button>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">
                      <Button size="sm" className={cn(actionButtonClass, 'w-full justify-center', !filters.statusBucket && activeActionButtonClass)} onClick={() => updateFilter('statusBucket', '')}>Grand Total</Button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.rows.map((row) => {
                    const expanded = expandedDealer === row.dealerCode
                    return (
                      <Fragment key={row.dealerCode}>
                        <tr className="border-b border-slate-100">
                          <td className="px-4 py-3 text-center">
                            <Button
                              size="sm"
                              className={cn(actionButtonClass, 'mx-auto', expanded && activeActionButtonClass)}
                              onClick={() => setExpandedDealer(expanded ? null : row.dealerCode)}
                            >
                              {expanded ? <ChevronDown /> : <ChevronRight />}
                              {row.dealerName} ({row.dealerCode})
                            </Button>
                          </td>
                          {data.matrix!.statuses.map((item, index) => (
                            <td key={item} className={cn('px-4 py-3 text-center font-mono font-black', index === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
                              {money(row.amounts[item])}
                            </td>
                          ))}
                          <td className="px-4 py-3 text-center font-mono font-black text-slate-950">{money(row.total)}</td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td colSpan={data.matrix!.statuses.length + 2} className="p-4">
                              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                <table className="min-w-full text-xs">
                                  <thead className="bg-slate-800 text-white">
                                    <tr>
                                      <th className="px-3 py-2 text-center">Month</th>
                                      {data.matrix!.statuses.map((item) => <th key={item} className="px-3 py-2 text-center">{item}</th>)}
                                      <th className="px-3 py-2 text-center">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.monthly.map((month) => (
                                      <tr key={month.monthNumber} className="border-b border-slate-100">
                                        <td className="px-3 py-2 text-center font-black">{month.month}</td>
                                        {data.matrix!.statuses.map((item) => <td key={item} className="px-3 py-2 text-center font-mono">{money(month.amounts[item])}</td>)}
                                        <td className="px-3 py-2 text-center font-mono font-black">{money(month.total)}</td>
                                      </tr>
                                    ))}
                                    <tr className="bg-slate-100 font-black">
                                      <td className="px-3 py-2 text-center">Year Total</td>
                                      {data.matrix!.statuses.map((item) => <td key={item} className="px-3 py-2 text-center font-mono">{money(row.currentYearAmounts[item])}</td>)}
                                      <td className="px-3 py-2 text-center font-mono">{money(row.currentYearTotal)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="border-t-2 border-[var(--dashboard-primary-border)] bg-[var(--dashboard-action-bg)] px-4 py-4 text-center font-black text-[var(--dashboard-action-fg)]">
                      Grand Total
                    </td>
                    {data.matrix.statuses.map((item) => (
                      <td
                        key={item}
                        className="border-t-2 border-[var(--dashboard-primary-border)] bg-[var(--dashboard-action-bg)] px-4 py-4 text-center font-mono font-black text-[var(--dashboard-action-fg)]"
                      >
                        {money(data.matrix!.rows.reduce((sum, row) => sum + Number(row.amounts[item] || 0), 0))}
                      </td>
                    ))}
                    <td className="border-t-2 border-[var(--dashboard-primary-border)] bg-[var(--dashboard-action-hover)] px-4 py-4 text-center font-mono font-black text-[var(--dashboard-action-fg)]">
                      {money(data.matrix.rows.reduce((sum, row) => sum + Number(row.total || 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900 text-white">
                <tr>{columns.map((item) => <th key={item} className="whitespace-nowrap px-4 py-3 text-center text-[11px] font-black uppercase tracking-wider">{item}</th>)}</tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={columns.length} className="p-12 text-center font-bold text-slate-500">Loading warranty records...</td></tr>
                ) : error ? (
                  <tr><td colSpan={columns.length} className="p-12 text-center font-bold text-rose-600">{error.message}</td></tr>
                ) : data?.rows.length === 0 ? (
                  <tr><td colSpan={columns.length} className="p-12 text-center font-bold text-slate-500">No records match these filters.</td></tr>
                ) : data?.rows.map((row) => (
                  <tr key={row.recordKey} className={cn('border-b border-slate-100 align-top', row.compliance === 'action_required' && 'bg-rose-50/70')}>
                    <td className="whitespace-nowrap px-4 py-3 text-center font-black text-slate-900">{row.dealerName}<div className="text-[10px] text-slate-400">{row.dealerCode}</div></td>
                    {isYtp ? (
                      <>
                        <td className="whitespace-nowrap px-4 py-3 text-center font-mono">{String(row.r_o_no || '-')}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-center">{formatDate(row.r_o_date)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-center font-mono text-xs">{String(row.vin || '-')}</td>
                        <td className="px-4 py-3 text-center">{String(row.claim_type || '-')}</td>
                        <td className="px-4 py-3 text-center">{row.status}</td>
                        <td className="px-4 py-3 text-center">{String(row.campaign_no || '-')}</td>
                        <td className="px-4 py-3 text-center">{String(row.category || '-')}</td>
                      </>
                    ) : (
                      <>
                        <td className="whitespace-nowrap px-4 py-3 text-center font-mono">{String(row.claim_no || '-')}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-center">{formatDate(row.claim_date)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-center font-mono text-xs">{String(row.vin || '-')}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-center font-mono">{String(row.r_o_no || '-')}</td>
                        <td className="px-4 py-3 text-center">{String(row.claim_type || '-')}</td>
                        <td className="px-4 py-3 text-center font-black">{row.status}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-center font-mono font-black">{money(row.total_amt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-center font-mono">{money(row.approve_amount_by_hmi)}</td>
                      </>
                    )}
                    <td className="min-w-48 px-4 py-3 text-center">
                      <span className={cn(
                        'inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide',
                        row.compliance === 'action_required' ? 'bg-rose-100 text-rose-700' : row.compliance === 'complete' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      )}>{row.compliance === 'action_required' ? 'Action required' : row.compliance === 'complete' ? 'Completed' : 'Within SLA'}</span>
                      <div className="mt-1 text-xs font-bold text-slate-600">{row.requirement.label} · {row.requirement.ageDays}D</div>
                    </td>
                    <td className="min-w-64 px-4 py-3 text-center">
                      {row.latestRemark ? (
                        <div>
                          <p className="line-clamp-3 text-sm font-semibold text-slate-800">{row.latestRemark.remark}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-500">
                            {row.latestRemark.createdByName} · {row.latestRemark.createdByRole} · {formatDateTime(row.latestRemark.createdAt)}
                          </p>
                        </div>
                      ) : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        {data.permissions.canEdit && (
                          <Button
                            size="sm"
                            className={actionButtonClass}
                            onClick={() => {
                              setRemark('')
                              setDocketNumber('')
                              setFiles([])
                              setActionRow(row)
                            }}
                          >
                            <MessageSquarePlus className="mr-1 h-4 w-4" /> Remark
                          </Button>
                        )}
                        <Button size="sm" className={actionButtonClass} onClick={() => setHistoryRow(row)}>
                          <Eye className="mr-1 h-4 w-4" /> History ({row.remarkCount})
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-xs font-bold text-slate-500">Page {data?.pagination.page || 1} of {data?.pagination.totalPages || 1} · {number(data?.pagination.totalRows)} rows</p>
            <div className="flex gap-2">
              <Button className={actionButtonClass} size="sm" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</Button>
              <Button className={actionButtonClass} size="sm" disabled={filters.page >= (data?.pagination.totalPages || 1)} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={Boolean(actionRow)} onOpenChange={(open) => !open && setActionRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add Warranty Remarks</DialogTitle></DialogHeader>
          {actionRow && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                {actionRow.requirement.label} ({actionRow.requirement.ageDays} days)
              </div>
              {actionRow.requirement.requiresDocket && (
                <>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-black text-rose-800">
                    Manual docket number not allowed. Enter the official docket number shown in uploaded proof.
                  </div>
                  <Input value={docketNumber} onChange={(event) => setDocketNumber(event.target.value)} placeholder="Official docket number" />
                  <label className="block rounded-xl border-2 border-dashed border-slate-300 p-5 text-center">
                    <FileImage className="mx-auto h-7 w-7 text-slate-500" />
                    <span className="mt-2 block text-sm font-black">Upload docket proof images</span>
                    <span className="block text-xs text-slate-500">JPEG, PNG or WebP · up to 10 images · 10MB each</span>
                    <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="mt-3 text-xs" onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 10))} />
                  </label>
                  {files.length > 0 && <p className="text-xs font-bold text-slate-600">{files.length} image(s) selected</p>}
                </>
              )}
              <Textarea value={remark} onChange={(event) => setRemark(event.target.value)} rows={5} placeholder="Enter detailed remarks / justification..." />
              {actionMutation.error && <p className="text-sm font-bold text-rose-600">{actionMutation.error.message}</p>}
              <div className="flex justify-end gap-2">
                <Button className={actionButtonClass} onClick={() => setActionRow(null)}>Cancel</Button>
                <Button
                  className={actionButtonClass}
                  disabled={!remark.trim() || actionMutation.isPending || (actionRow.requirement.requiresDocket && (!docketNumber.trim() || files.length === 0))}
                  onClick={() => actionMutation.mutate()}
                >
                  {actionMutation.isPending ? 'Saving...' : 'Save Remarks'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyRow)} onOpenChange={(open) => !open && setHistoryRow(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Remarks History</DialogTitle></DialogHeader>
          {historyQuery.isLoading ? <p className="p-6 text-center font-bold text-slate-500">Loading history...</p> : (
            <div className="space-y-3">
              {historyQuery.data?.actions.length === 0 && <p className="p-6 text-center font-bold text-slate-500">No remarks added yet.</p>}
              {historyQuery.data?.actions.map((action) => (
                <div key={action.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase text-blue-800">{action.requirement_code.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-bold text-slate-500">{formatDateTime(action.created_at)}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm font-semibold text-slate-800">{action.remark}</p>
                  {action.docket_number && <p className="mt-2 text-sm font-black text-slate-900">Docket: {action.docket_number}</p>}
                  <p className="mt-3 text-xs font-bold text-slate-500">{action.created_by_name} · {action.created_by_role} · {action.created_by_email}</p>
                  {action.evidence.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {action.evidence.map((file) => (
                        <a key={file.id} href={file.previewUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-action-bg)] px-3 py-2 text-xs font-black text-[var(--dashboard-action-fg)] hover:bg-[var(--dashboard-action-hover)]">
                          <FileImage className="mr-1 inline h-4 w-4" /> {file.original_name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </MainLayout>
  )
}
