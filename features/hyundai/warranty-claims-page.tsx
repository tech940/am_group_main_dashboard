'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
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
  FileText,
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
import { HYUNDAI_WARRANTY_DEALER_GROUPS } from '@/lib/hyundai/warranty-dealers'
import { PLATINUM_WARRANTY_DEALER_GROUPS } from '@/lib/platinum/warranty-dealers'

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
  options: {
    dealers: string[]
    dealerOptions: Array<{ code: string; name: string; location?: string | null }>
    locationGroups?: Array<{ key: string; label: string; dealerCodes: string[] }>
    statuses: string[]
    claimTypes: string[]
  }
  charts: null | {
    status: Array<{ name: string; count: number; amount: number }>
    dealers: Array<{ code: string; name: string; amount: number }>
    claimTypes: Array<{ name: string; count: number }>
    aging: Array<{ name: string; count: number }>
    monthly: Array<{ month: string; monthNumber: number; count: number; amount: number }>
  }
  matrix: null | {
    statuses: string[]
    groups: Array<{
      key: string
      label: string
      dealerCodes: string[]
      amounts: Record<string, number>
      counts: Record<string, number>
      total: number
      countTotal: number
      dealers: Array<{
        dealerCode: string
        dealerName: string
        amounts: Record<string, number>
        counts: Record<string, number>
        total: number
        countTotal: number
        monthly: Array<{
          month: string
          monthNumber: number
          amounts: Record<string, number>
          counts: Record<string, number>
          total: number
          countTotal: number
        }>
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
  locations: string[]
  dealers: string[]
  statuses: string[]
  claimType: string
  sla: string
  startDate: string
  endDate: string
  sort: string
  statusBucket: string
}

const DEFAULT_FILTERS: Filters = {
  page: 1,
  search: '',
  locations: [],
  dealers: [],
  statuses: [],
  claimType: '',
  sla: '',
  startDate: '',
  endDate: '',
  sort: 'date_desc',
  statusBucket: '',
}

// Location filter options are resolved dynamically inside the component based on brand parameter.

const warrantyTableClass = 'min-w-full text-xs'
const warrantyThClass = 'px-3 py-2 text-center'
const warrantyTdClass = 'px-3 py-2 text-center'
const warrantyFooterClass = 'border-t-2 border-[var(--dashboard-primary-border)] bg-[var(--dashboard-action-bg)] px-3 py-2.5 text-center font-black text-[var(--dashboard-action-fg)]'
const warrantyNestedTableClass = 'min-w-full text-[10px]'
const warrantyNestedCellClass = 'px-2 py-1.5 text-center'
const warrantyRecordThClass = 'whitespace-nowrap px-3 py-2 text-center text-[10px] font-black uppercase tracking-wider'
const warrantyRecordTdClass = 'whitespace-nowrap px-3 py-2 text-center'

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

type MatrixViewMode = 'amount' | 'count'

function formatMatrixValue(
  mode: MatrixViewMode,
  amounts: Record<string, number>,
  counts: Record<string, number>,
  status: string,
) {
  return mode === 'amount' ? money(amounts[status]) : number(counts[status])
}

function formatMatrixTotal(mode: MatrixViewMode, total: number, countTotal: number) {
  return mode === 'amount' ? money(total) : number(countTotal)
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
  if (filters.search) params.set('search', filters.search)
  if (filters.locations.length) params.set('locations', filters.locations.join(','))
  if (filters.dealers.length) params.set('dealers', filters.dealers.join(','))
  if (filters.statuses.length) params.set('statuses', filters.statuses.join(','))
  if (filters.claimType) params.set('claimType', filters.claimType)
  if (filters.sla) params.set('sla', filters.sla)
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  if (filters.statusBucket) params.set('statusBucket', filters.statusBucket)
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

function FilterCheckboxList({ label, options, selected, onChange, emptyLabel = 'All' }: {
  label: string
  options: Array<{ value: string; label: string }>
  selected: string[]
  onChange: (value: string[]) => void
  emptyLabel?: string
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
        {selected.length > 0 && (
          <button type="button" className="text-[10px] font-bold text-slate-500 hover:text-slate-900" onClick={() => onChange([])}>
            Reset
          </button>
        )}
      </div>
      <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
        {options.length === 0 ? (
          <p className="px-2 py-2 text-xs font-semibold text-slate-400">No options</p>
        ) : (
          <div className="space-y-1">
            {options.map((item) => (
              <label
                key={item.value}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold transition',
                  selected.includes(item.value) ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/70',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(item.value)}
                  onChange={() => toggle(item.value)}
                  className="rounded border-slate-300 text-[var(--dashboard-action-bg)]"
                />
                <span className="truncate">{item.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] font-bold text-slate-400">
        {selected.length === 0 ? emptyLabel : `${selected.length} selected`}
      </p>
    </div>
  )
}

function MultiSelectFilter({ label, options, selected, onChange }: {
  label: string
  options: string[]
  selected: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <FilterCheckboxList
      label={label}
      options={options.map((item) => ({ value: item, label: item }))}
      selected={selected}
      onChange={onChange}
    />
  )
}

function WarrantyTableSkeleton({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <tr key={`skeleton-${index}`} className="border-b border-slate-100">
          {Array.from({ length: columns }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-3 py-3">
              <div className="mx-auto h-4 w-full max-w-[7rem] animate-pulse rounded bg-slate-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function WarrantyBlockSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  )
}

function humanizeFieldName(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatRowDetailValue(key: string, value: unknown) {
  if (value == null || value === '') return '-'
  if (typeof value === 'number') return number(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  if (key.toLowerCase().includes('date') || key === 'createdAt') return formatDate(value)
  if (key.toLowerCase().includes('amt') || key.toLowerCase().includes('amount') || key === 'labour' || key === 'part' || key === 'sublet') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return money(parsed)
  }
  return String(value)
}

const VIEW_ROW_SKIP_KEYS = new Set(['id', 'recordKey', 'row_hash', 'uploaded_at', 'requirement', 'latestRemark'])

function buildRowDetailEntries(row: WarrantyRow) {
  const entries: Array<{ label: string; value: string }> = [
    { label: 'Dealer Name', value: formatRowDetailValue('dealerName', row.dealerName) },
    { label: 'Dealer Code', value: formatRowDetailValue('dealerCode', row.dealerCode) },
    { label: 'Status', value: formatRowDetailValue('status', row.status) },
    { label: 'Business Date', value: formatRowDetailValue('businessDate', row.businessDate) },
    { label: 'Compliance', value: formatRowDetailValue('compliance', row.compliance) },
    { label: 'SLA Requirement', value: row.requirement?.label || '-' },
    { label: 'SLA Age (Days)', value: formatRowDetailValue('ageDays', row.requirement?.ageDays) },
    { label: 'Remark Count', value: formatRowDetailValue('remarkCount', row.remarkCount) },
  ]

  Object.entries(row).forEach(([key, value]) => {
    if (VIEW_ROW_SKIP_KEYS.has(key)) return
    if (['dealerName', 'dealerCode', 'status', 'businessDate', 'compliance', 'remarkCount'].includes(key)) return
    entries.push({
      label: humanizeFieldName(key),
      value: formatRowDetailValue(key, value),
    })
  })

  if (row.latestRemark) {
    entries.push(
      { label: 'Latest Remark', value: row.latestRemark.remark },
      { label: 'Latest Remark By', value: `${row.latestRemark.createdByName} · ${row.latestRemark.createdByRole}` },
      { label: 'Latest Remark At', value: formatDateTime(row.latestRemark.createdAt) },
    )
    if (row.latestRemark.docketNumber) {
      entries.push({ label: 'Docket Number', value: row.latestRemark.docketNumber })
    }
  }

  return entries
}

function SelectFilter({ value, onChange, children, label }: {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  label: string
}) {
  return (
    <label className="space-y-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:border-[var(--dashboard-primary-border)] focus:bg-white"
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
const tableActionButtonClass = cn(actionButtonClass, 'h-8 shrink-0 whitespace-nowrap px-2.5 text-[10px]')
const activeActionButtonClass = 'bg-[var(--dashboard-action-hover)]'

export function HyundaiWarrantyClaimsPage({ source, brand = 'hyundai' }: { source: Source; brand?: 'hyundai' | 'platinum' }) {
  const queryClient = useQueryClient()
  const isYtp = source === 'ytp'

  const dealerGroups = brand === 'platinum' ? PLATINUM_WARRANTY_DEALER_GROUPS : HYUNDAI_WARRANTY_DEALER_GROUPS
  const locationFilterOptions = useMemo(() => dealerGroups.map((group) => ({
    value: group.key,
    label: group.label,
  })), [dealerGroups])
  const [draftFilters, setDraftFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [showKpis, setShowKpis] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showYtpSummary, setShowYtpSummary] = useState(false)
  const [actionRow, setActionRow] = useState<WarrantyRow | null>(null)
  const [historyRow, setHistoryRow] = useState<WarrantyRow | null>(null)
  const [viewRow, setViewRow] = useState<WarrantyRow | null>(null)
  const [filterFetchPending, setFilterFetchPending] = useState(false)
  const [remark, setRemark] = useState('')
  const [docketNumber, setDocketNumber] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [expandedDealer, setExpandedDealer] = useState<string | null>(null)
  const [matrixViewMode, setMatrixViewMode] = useState<MatrixViewMode>('amount')
  const queryString = useMemo(() => buildQuery(source, appliedFilters), [appliedFilters, source])

  const { data, isPending, isFetching, error } = useQuery<Payload>({
    queryKey: [`${brand}-warranty-claims`, queryString],
    queryFn: () => fetch(`/api/brands/${brand}/warranty-claims?${queryString}`).then(readJson<Payload>),
    staleTime: 60_000,
  })

  const showContentLoading = isPending || (filterFetchPending && isFetching)
  const dealerOptions = data?.options.dealerOptions?.length
    ? data.options.dealerOptions
    : (data?.options.dealers || []).map((code) => ({ code, name: code }))
  const dealerCodeOptions = useMemo(
    () => [...new Set(dealerOptions.map((item) => item.code))].sort().map((code) => ({ value: code, label: code })),
    [dealerOptions],
  )

  useEffect(() => {
    if (!isFetching && !isPending) setFilterFetchPending(false)
  }, [isFetching, isPending])

  const historyQuery = useQuery<HistoryPayload>({
    queryKey: [`${brand}-warranty-history`, source, historyRow?.recordKey, historyRow?.id],
    queryFn: () => fetch(
      `/api/brands/${brand}/warranty-claims/actions?source=${source}&recordKey=${encodeURIComponent(historyRow!.recordKey)}&sourceRowId=${encodeURIComponent(String(historyRow!.id))}`,
    ).then(readJson<HistoryPayload>),
    enabled: Boolean(historyRow),
  })

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!actionRow) throw new Error('No record selected')
      const form = new FormData()
      form.set('source', source)
      form.set('recordKey', actionRow.recordKey)
      form.set('sourceRowId', String(actionRow.id))
      form.set('remark', remark)
      form.set('docketNumber', docketNumber)
      files.forEach((file) => form.append('files', file))
      return fetch(`/api/brands/${brand}/warranty-claims/actions`, { method: 'POST', body: form }).then(readJson<{
        id: string
        message: string
        sourceRowId?: string
        latestRemark?: WarrantyRow['latestRemark']
      }>)
    },
    onSuccess: async (response) => {
      const savedRow = actionRow
      const savedRowId = String(response.sourceRowId || savedRow?.id || '')
      const savedRemark = response.latestRemark

      setActionRow(null)
      setRemark('')
      setDocketNumber('')
      setFiles([])

      if (savedRowId && savedRemark) {
        queryClient.setQueryData<Payload>([`${brand}-warranty-claims`, queryString], (current) => {
          if (!current) return current
          return {
            ...current,
            rows: current.rows.map((row) => {
              if (String(row.id) !== savedRowId) return row
              const nextRemarkCount = row.remarkCount + 1
              const compliance = row.requirement.required ? 'complete' as const : row.compliance
              return {
                ...row,
                remarkCount: nextRemarkCount,
                latestRemark: savedRemark,
                compliance,
              }
            }),
            summary: {
              ...current.summary,
              overdueActions: savedRow?.compliance === 'action_required'
                ? Math.max(0, current.summary.overdueActions - 1)
                : current.summary.overdueActions,
            },
          }
        })
      }

      await queryClient.invalidateQueries({ queryKey: [`${brand}-warranty-claims`] })
      await queryClient.invalidateQueries({ queryKey: [`${brand}-warranty-history`] })
    },
  })

  const updateDraftFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }))
  }

  const applyFilters = () => {
    setShowFilters(false)
    setFilterFetchPending(true)
    setAppliedFilters({ ...draftFilters, page: 1 })
  }

  const clearFilters = () => {
    setShowFilters(false)
    setFilterFetchPending(true)
    setDraftFilters(DEFAULT_FILTERS)
    setAppliedFilters(DEFAULT_FILTERS)
  }

  const updateAppliedStatusBucket = (statusBucket: string) => {
    setFilterFetchPending(true)
    setAppliedFilters((current) => ({ ...current, statusBucket, page: 1 }))
  }

  const updateAppliedPage = (page: number) => {
    setAppliedFilters((current) => ({ ...current, page }))
  }
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

        {showKpis && (showContentLoading ? (
          <section className={cn('grid gap-3', isYtp ? 'md:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-6')}>
            {Array.from({ length: isYtp ? 3 : 6 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </section>
        ) : (
        <section className={cn('grid gap-3', isYtp ? 'md:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-6')}>
          <KpiCard label="Total Rows" value={number(data?.summary.total)} helper="Filtered records" icon={BarChart3} />
          {!isYtp && <KpiCard label="Claim Amount" value={money(data?.summary.totalClaimAmount)} helper="Sum of total_amt" icon={IndianRupee} />}
          {!isYtp && <KpiCard label="Approved Amount" value={money(data?.summary.approvedAmount)} helper="Approved by HMI" icon={CheckCircle2} />}
          <KpiCard label="Action Required" value={number(data?.summary.overdueActions)} helper="Missing current SLA response" icon={AlertTriangle} warning={Boolean(data?.summary.overdueActions)} />
          {!isYtp && <KpiCard label="Docket Proof" value={number(data?.summary.suspenseProofPending)} helper="Suspense evidence pending" icon={FileImage} warning={Boolean(data?.summary.suspenseProofPending)} />}
          {!isYtp && <KpiCard label="Unresolved" value={number(data?.summary.unresolved)} helper="Not accepted, denied or cancelled" icon={Clock3} />}
          {isYtp && <KpiCard label="Compliant" value={number((data?.summary.total || 0) - (data?.summary.overdueActions || 0))} helper="Within SLA or remarked" icon={CheckCircle2} />}
        </section>
        ))}

        {showFilters && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-3">
              <h2 className="text-sm font-black text-slate-900">Filters</h2>
              <p className="text-xs font-semibold text-slate-500">Location and dealer code are separate filters.</p>
            </div>
            <div className="space-y-4 p-5">
              <label className="block space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Search</span>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={draftFilters.search}
                    onChange={(event) => updateDraftFilter('search', event.target.value)}
                    placeholder="Claim, RO, VIN, dealer or part..."
                    className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 text-sm font-semibold focus:bg-white"
                  />
                </div>
              </label>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                <FilterCheckboxList
                  label="Location"
                  options={locationFilterOptions}
                  selected={draftFilters.locations}
                  onChange={(value) => updateDraftFilter('locations', value)}
                  emptyLabel="All locations"
                />
                <FilterCheckboxList
                  label="Dealer Code"
                  options={dealerCodeOptions}
                  selected={draftFilters.dealers}
                  onChange={(value) => updateDraftFilter('dealers', value)}
                  emptyLabel="All dealer codes"
                />
                <MultiSelectFilter
                  label="Status"
                  options={data?.options.statuses || []}
                  selected={draftFilters.statuses}
                  onChange={(value) => updateDraftFilter('statuses', value)}
                />
                <SelectFilter label="SLA" value={draftFilters.sla} onChange={(value) => updateDraftFilter('sla', value)}>
                  <option value="">All SLA states</option>
                  <option value="action_required">Action required</option>
                  <option value="complete">Remark completed</option>
                  <option value="within_sla">Within SLA</option>
                </SelectFilter>
                <SelectFilter label="Claim Type" value={draftFilters.claimType} onChange={(value) => updateDraftFilter('claimType', value)}>
                  <option value="">All claim types</option>
                  {(data?.options?.claimTypes ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                </SelectFilter>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">From</span>
                    <Input type="date" value={draftFilters.startDate} onChange={(event) => updateDraftFilter('startDate', event.target.value)} className="h-10 rounded-xl border-slate-200 bg-slate-50 text-xs font-bold focus:bg-white" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">To</span>
                    <Input type="date" value={draftFilters.endDate} onChange={(event) => updateDraftFilter('endDate', event.target.value)} className="h-10 rounded-xl border-slate-200 bg-slate-50 text-xs font-bold focus:bg-white" />
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                <Button className={actionButtonClass} onClick={clearFilters}>Clear</Button>
                <Button className={cn(actionButtonClass, activeActionButtonClass)} onClick={applyFilters}>Apply</Button>
              </div>
            </div>
          </section>
        )}

        {isYtp && showYtpSummary && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-black text-slate-950">Monthly Claim YTP Summary</h2>
              <p className="text-xs font-semibold text-slate-500">Monthly counts across all available years for the active filters.</p>
            </div>
            {showContentLoading ? (
              <WarrantyBlockSkeleton lines={6} />
            ) : error ? (
              <div className="p-10 text-center text-sm font-bold text-rose-600">Unable to load the monthly summary.</div>
            ) : !data?.ytpMonthlySummary ? (
              <div className="p-10 text-center text-sm font-bold text-amber-700">
                Summary data is unavailable. Refresh the page to load the latest warranty response.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className={warrantyTableClass}>
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className={warrantyThClass}>Month</th>
                    {data.ytpMonthlySummary.dealers.map((code) => <th key={code} className={warrantyThClass}>{code}</th>)}
                    <th className={warrantyThClass}>Grand Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ytpMonthlySummary.rows.map((row) => (
                    <tr key={row.monthNumber} className="border-b border-slate-100">
                      <td className={cn(warrantyTdClass, 'font-black text-slate-900')}>{row.month}</td>
                      {data.ytpMonthlySummary!.dealers.map((code) => <td key={code} className={cn(warrantyTdClass, 'font-mono')}>{number(row.counts[code])}</td>)}
                      <td className={cn(warrantyTdClass, 'font-mono font-black')}>{number(row.total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 text-slate-950">
                    <td className={cn(warrantyTdClass, 'font-black')}>Grand Total</td>
                    {data.ytpMonthlySummary.dealers.map((code) => <td key={code} className={cn(warrantyTdClass, 'font-mono font-black')}>{number(data.ytpMonthlySummary!.dealerTotals[code])}</td>)}
                    <td className={cn(warrantyTdClass, 'font-mono font-black')}>{number(data.ytpMonthlySummary.grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}
          </section>
        )}

        {!isYtp && showAnalytics && (showContentLoading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-72 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </section>
        ) : data?.charts && (
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
        ))}

        {!isYtp && (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">Total Claim Amount</h2>
                <p className="text-xs font-semibold text-slate-500">All years by default. Use the date filter to narrow the matrix. Expand a location for dealer codes, then expand a dealer for monthly breakdown.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className={cn(actionButtonClass, matrixViewMode === 'amount' && activeActionButtonClass)}
                  onClick={() => setMatrixViewMode('amount')}
                >
                  <IndianRupee className="mr-1 h-3.5 w-3.5 shrink-0" /> Amount
                </Button>
                <Button
                  size="sm"
                  className={cn(actionButtonClass, matrixViewMode === 'count' && activeActionButtonClass)}
                  onClick={() => setMatrixViewMode('count')}
                >
                  <BarChart3 className="mr-1 h-3.5 w-3.5 shrink-0" /> Count
                </Button>
                <CalendarDays className="h-5 w-5 text-blue-700" />
              </div>
            </div>
            {showContentLoading ? (
              <WarrantyBlockSkeleton lines={8} />
            ) : !data?.matrix ? (
              <div className="p-10 text-center text-sm font-bold text-slate-500">Matrix data is unavailable for the current filters.</div>
            ) : (
            <div className="overflow-x-auto">
              <table className={warrantyTableClass}>
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className={warrantyThClass}>Location</th>
                    {data.matrix.statuses.map((item) => (
                      <th key={item} className="px-2 py-1.5 text-center">
                        <Button
                          size="sm"
                          className={cn(actionButtonClass, 'w-full justify-center text-xs', appliedFilters.statusBucket === item && activeActionButtonClass)}
                          onClick={() => updateAppliedStatusBucket(appliedFilters.statusBucket === item ? '' : item)}
                        >
                          {item}
                        </Button>
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-center">
                      <Button size="sm" className={cn(actionButtonClass, 'w-full justify-center text-xs', !appliedFilters.statusBucket && activeActionButtonClass)} onClick={() => updateAppliedStatusBucket('')}>Grand Total</Button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.groups.map((group) => {
                    const groupExpanded = expandedGroup === group.key
                    return (
                      <Fragment key={group.key}>
                        <tr className="border-b border-slate-100 bg-slate-50/60">
                          <td className={warrantyTdClass}>
                            <Button
                              size="sm"
                              className={cn(actionButtonClass, 'mx-auto text-xs', groupExpanded && activeActionButtonClass)}
                              onClick={() => {
                                if (groupExpanded) {
                                  setExpandedGroup(null)
                                  setExpandedDealer(null)
                                } else {
                                  setExpandedGroup(group.key)
                                  setExpandedDealer(null)
                                }
                              }}
                            >
                              {groupExpanded ? <ChevronDown /> : <ChevronRight />}
                              {group.label}
                            </Button>
                          </td>
                          {data.matrix!.statuses.map((item, index) => (
                            <td key={item} className={cn(warrantyTdClass, 'font-mono font-black', index === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
                              {formatMatrixValue(matrixViewMode, group.amounts, group.counts, item)}
                            </td>
                          ))}
                          <td className={cn(warrantyTdClass, 'font-mono font-black text-slate-950')}>
                            {formatMatrixTotal(matrixViewMode, group.total, group.countTotal)}
                          </td>
                        </tr>
                        {groupExpanded && group.dealers.map((row) => {
                          const dealerExpanded = expandedDealer === row.dealerCode
                          return (
                            <Fragment key={row.dealerCode}>
                              <tr className="border-b border-slate-100">
                                <td className={cn(warrantyTdClass, 'pl-8')}>
                                  <Button
                                    size="sm"
                                    className={cn(actionButtonClass, 'mx-auto text-xs', dealerExpanded && activeActionButtonClass)}
                                    onClick={() => setExpandedDealer(dealerExpanded ? null : row.dealerCode)}
                                  >
                                    {dealerExpanded ? <ChevronDown /> : <ChevronRight />}
                                    {row.dealerName} ({row.dealerCode})
                                  </Button>
                                </td>
                                {data.matrix!.statuses.map((item, index) => (
                                  <td key={item} className={cn(warrantyTdClass, 'font-mono font-black', index === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
                                    {formatMatrixValue(matrixViewMode, row.amounts, row.counts, item)}
                                  </td>
                                ))}
                                <td className={cn(warrantyTdClass, 'font-mono font-black text-slate-950')}>
                                  {formatMatrixTotal(matrixViewMode, row.total, row.countTotal)}
                                </td>
                              </tr>
                              {dealerExpanded && (
                                <tr className="border-b border-slate-200 bg-slate-50">
                                  <td colSpan={data.matrix!.statuses.length + 2} className="p-3">
                                    <p className="mb-2 text-[10px] font-bold text-slate-500">Monthly breakdown (all years)</p>
                                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                      <table className={warrantyNestedTableClass}>
                                        <thead className="bg-slate-800 text-white">
                                          <tr>
                                            <th className={warrantyNestedCellClass}>Month</th>
                                            {data.matrix!.statuses.map((item) => <th key={item} className={warrantyNestedCellClass}>{item}</th>)}
                                            <th className={warrantyNestedCellClass}>Total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {row.monthly.map((month) => (
                                            <tr key={month.monthNumber} className="border-b border-slate-100">
                                              <td className={cn(warrantyNestedCellClass, 'font-black')}>{month.month}</td>
                                              {data.matrix!.statuses.map((item) => (
                                                <td key={item} className={cn(warrantyNestedCellClass, 'font-mono')}>
                                                  {formatMatrixValue(matrixViewMode, month.amounts, month.counts, item)}
                                                </td>
                                              ))}
                                              <td className={cn(warrantyNestedCellClass, 'font-mono font-black')}>
                                                {formatMatrixTotal(matrixViewMode, month.total, month.countTotal)}
                                              </td>
                                            </tr>
                                          ))}
                                          <tr className="bg-slate-100 font-black">
                                            <td className={warrantyNestedCellClass}>All Years Total</td>
                                            {data.matrix!.statuses.map((item) => (
                                              <td key={item} className={cn(warrantyNestedCellClass, 'font-mono')}>
                                                {formatMatrixValue(matrixViewMode, row.amounts, row.counts, item)}
                                              </td>
                                            ))}
                                            <td className={cn(warrantyNestedCellClass, 'font-mono')}>
                                              {formatMatrixTotal(matrixViewMode, row.total, row.countTotal)}
                                            </td>
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
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={warrantyFooterClass}>
                      Grand Total
                    </td>
                    {data.matrix.statuses.map((item) => (
                      <td
                        key={item}
                        className={cn(warrantyFooterClass, 'font-mono')}
                      >
                        {matrixViewMode === 'amount'
                          ? money(data.matrix!.groups.reduce((sum, group) => sum + Number(group.amounts[item] || 0), 0))
                          : number(data.matrix!.groups.reduce((sum, group) => sum + Number(group.counts[item] || 0), 0))}
                      </td>
                    ))}
                    <td className="border-t-2 border-[var(--dashboard-primary-border)] bg-[var(--dashboard-action-hover)] px-3 py-2.5 text-center font-mono font-black text-[var(--dashboard-action-fg)]">
                      {formatMatrixTotal(
                        matrixViewMode,
                        data.matrix.groups.reduce((sum, group) => sum + Number(group.total || 0), 0),
                        data.matrix.groups.reduce((sum, group) => sum + Number(group.countTotal || 0), 0),
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            )}
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className={warrantyTableClass}>
              <thead className="bg-slate-900 text-white">
                <tr>{columns.map((item) => <th key={item} className={warrantyRecordThClass}>{item}</th>)}</tr>
              </thead>
              <tbody>
                {showContentLoading ? (
                  <WarrantyTableSkeleton columns={columns.length} />
                ) : error ? (
                  <tr><td colSpan={columns.length} className="p-10 text-center text-xs font-bold text-rose-600">{error.message}</td></tr>
                ) : !data?.rows ? (
                  <tr><td colSpan={columns.length} className="p-10 text-center text-xs font-bold text-slate-500">Unable to load records.</td></tr>
                ) : data.rows.length === 0 ? (
                  <tr><td colSpan={columns.length} className="p-10 text-center text-xs font-bold text-slate-500">No records match these filters.</td></tr>
                ) : data.rows.map((row) => (
                  <tr key={row.id} className={cn('border-b border-slate-100 align-top', row.compliance === 'action_required' && 'bg-rose-50/70')}>
                    <td className={cn(warrantyRecordTdClass, 'font-black text-slate-900')}>{row.dealerName}<div className="text-[10px] text-slate-400">{row.dealerCode}</div></td>
                    {isYtp ? (
                      <>
                        <td className={cn(warrantyRecordTdClass, 'font-mono')}>{String(row.r_o_no || '-')}</td>
                        <td className={warrantyRecordTdClass}>{formatDate(row.r_o_date)}</td>
                        <td className={cn(warrantyRecordTdClass, 'font-mono text-[10px]')}>{String(row.vin || '-')}</td>
                        <td className={warrantyRecordTdClass}>{String(row.claim_type || '-')}</td>
                        <td className={warrantyRecordTdClass}>{row.status}</td>
                        <td className={warrantyRecordTdClass}>{String(row.campaign_no || '-')}</td>
                        <td className={warrantyRecordTdClass}>{String(row.category || '-')}</td>
                      </>
                    ) : (
                      <>
                        <td className={cn(warrantyRecordTdClass, 'font-mono')}>{String(row.claim_no || '-')}</td>
                        <td className={warrantyRecordTdClass}>{formatDate(row.claim_date)}</td>
                        <td className={cn(warrantyRecordTdClass, 'font-mono text-[10px]')}>{String(row.vin || '-')}</td>
                        <td className={cn(warrantyRecordTdClass, 'font-mono')}>{String(row.r_o_no || '-')}</td>
                        <td className={warrantyRecordTdClass}>{String(row.claim_type || '-')}</td>
                        <td className={cn(warrantyRecordTdClass, 'font-black')}>{row.status}</td>
                        <td className={cn(warrantyRecordTdClass, 'font-mono font-black')}>{money(row.total_amt)}</td>
                        <td className={cn(warrantyRecordTdClass, 'font-mono')}>{money(row.approve_amount_by_hmi)}</td>
                      </>
                    )}
                    <td className="min-w-48 px-3 py-2 text-center">
                      <span className={cn(
                        'inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide',
                        row.compliance === 'action_required' ? 'bg-rose-100 text-rose-700' : row.compliance === 'complete' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      )}>{row.compliance === 'action_required' ? 'Action required' : row.compliance === 'complete' ? 'Completed' : 'Within SLA'}</span>
                      <div className="mt-1 text-[10px] font-bold text-slate-600">{row.requirement.label} · {row.requirement.ageDays}D</div>
                    </td>
                    <td className="min-w-64 px-3 py-2 text-center">
                      {row.latestRemark ? (
                        <div>
                          <p className="line-clamp-3 text-xs font-semibold text-slate-800">{row.latestRemark.remark}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-500">
                            {row.latestRemark.createdByName} · {row.latestRemark.createdByRole} · {formatDateTime(row.latestRemark.createdAt)}
                          </p>
                        </div>
                      ) : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center">
                      <div className="inline-flex flex-nowrap items-center justify-center gap-1.5">
                        <Button size="sm" className={tableActionButtonClass} onClick={() => setViewRow(row)}>
                          <FileText className="mr-1 h-3.5 w-3.5 shrink-0" /> View
                        </Button>
                        {data?.permissions?.canEdit && (
                          <Button
                            size="sm"
                            className={tableActionButtonClass}
                            onClick={() => {
                              setRemark('')
                              setDocketNumber('')
                              setFiles([])
                              setActionRow(row)
                            }}
                          >
                            <MessageSquarePlus className="mr-1 h-3.5 w-3.5 shrink-0" /> Remark
                          </Button>
                        )}
                        <Button size="sm" className={tableActionButtonClass} onClick={() => setHistoryRow(row)}>
                          <Eye className="mr-1 h-3.5 w-3.5 shrink-0" /> History ({row.remarkCount})
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5">
            <p className="text-xs font-bold text-slate-500">Page {data?.pagination.page || 1} of {data?.pagination.totalPages || 1} · {number(data?.pagination.totalRows)} rows</p>
            <div className="flex gap-2">
              <Button className={actionButtonClass} size="sm" disabled={appliedFilters.page <= 1} onClick={() => updateAppliedPage(appliedFilters.page - 1)}>Previous</Button>
              <Button className={actionButtonClass} size="sm" disabled={appliedFilters.page >= (data?.pagination.totalPages || 1)} onClick={() => updateAppliedPage(appliedFilters.page + 1)}>Next</Button>
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

      <Dialog open={Boolean(viewRow)} onOpenChange={(open) => !open && setViewRow(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Record Details</DialogTitle></DialogHeader>
          {viewRow && (
            <div className="grid gap-3 sm:grid-cols-2">
              {buildRowDetailEntries(viewRow).map((entry) => (
                <div key={entry.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{entry.label}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-900">{entry.value}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </MainLayout>
  )
}
