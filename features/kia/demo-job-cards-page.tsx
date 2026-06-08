'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Car,
  Clock,
  Download,
  Edit3,
  History,
  MessageSquarePlus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { logApiTimings } from '@/lib/api/client-timing'
import { EXECUTIVE_TARGETS } from '@/lib/business-excellence/executive-targets'
import { DEFAULT_KIA_DEALER_CODE, KIA_BRANCH_DEALERS, normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

type DemoDueStatus = 'Scheduled' | 'Due Soon' | 'Overdue'

type DemoVehicleRow = {
  vehicleKey: string
  registrationNumber: string
  vin: string
  model: string
  mileage: number | string | null
  customerName: string
  lastRoNumber: string
  lastBillDate: string
  nextDemoDueDate: string
  daysRemaining: number
  dueStatus: DemoDueStatus
  serviceAdvisor: string
  status: string
  latestRemarkId: string | null
  latestRemark: string | null
  latestRemarkBy: string | null
  latestRemarkAt: string | null
  latestRemarkUpdatedAt: string | null
  remarkCount: number
}

type DemoRemark = {
  id: string
  vin: string
  remark: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

type DemoPayload = {
  meta: {
    workType: string
    source: string
    remarksSource: string
    vehicleUniqueness: string
    nextDemoDueRule: string
    alertRule: string
    remarksTableReady: boolean
    sourceUpdatedAt: string | null
    generatedAt: string
  }
  summary: {
    totalVehicles: number
    dueWithin5Days: number
    overdue: number
    vehiclesWithRemarks: number
  }
  alerts: DemoVehicleRow[]
  rows: DemoVehicleRow[]
  pagination: {
    page: number
    pageSize: number
    totalRows: number
    totalPages: number
  }
  options: {
    dueStatuses: DemoDueStatus[]
  }
}

const DASHBOARD_STALE_TIME_MS = 30 * 60 * 1000
const PAGE_SIZE = 25

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function numberFormat(value: unknown) {
  const parsed = Number(value || 0)
  return new Intl.NumberFormat('en-IN').format(Number.isFinite(parsed) ? parsed : 0)
}

function buildQueryString(params: Record<string, string | number>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== 'all') searchParams.set(key, String(value))
  })
  return searchParams.toString()
}

function getDueBadgeClass(status: DemoDueStatus) {
  if (status === 'Overdue') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'Due Soon') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function daysRemainingLabel(days: number) {
  if (days < 0) return `${Math.abs(days)} days overdue`
  if (days === 0) return 'Due today'
  return `${days} days left`
}

function exportRowsToCsv(rows: DemoVehicleRow[]) {
  const headers = [
    'Registration Number',
    'VIN',
    'Model',
    'Mileage',
    'Customer Name',
    'Last RO Date',
    'Next Demo Due Date',
    'Days Remaining',
    'Remarks',
    'Remark By',
    'Remark At',
  ]
  const csvRows = rows.map((row) => [
    row.registrationNumber,
    row.vin,
    row.model,
    row.mileage ?? '',
    row.customerName,
    row.lastBillDate,
    row.nextDemoDueDate,
    row.daysRemaining,
    row.latestRemark || '',
    row.latestRemarkBy || '',
    row.latestRemarkAt || '',
  ])
  const csv = [headers, ...csvRows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `demo-vehicle-tracker-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/76 px-4 py-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-950">{numberFormat(value)}</p>
    </div>
  )
}

function DemoVehicleHealth({ data }: { data: DemoPayload }) {
  const total = data.summary.totalVehicles || 0
  const dueSoon = data.summary.dueWithin5Days || 0
  const overdue = data.summary.overdue || 0
  const vehiclesWithRemarks = data.summary.vehiclesWithRemarks || 0
  const withoutRemarks = Math.max(total - vehiclesWithRemarks, 0)
  const complianceRate = total > 0 ? ((total - overdue) / total) * 100 : 100
  const remarkCoverage = total > 0 ? (vehiclesWithRemarks / total) * 100 : 100
  const score = Math.max(0, Math.min(100, Math.round(complianceRate * 0.55 + remarkCoverage * 0.25 + Math.max(0, 100 - dueSoon * 8) * 0.2)))
  const status = score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 60 ? 'WATCH' : 'CRITICAL'
  const nextAlert = [...data.alerts].sort((a, b) => a.daysRemaining - b.daysRemaining)[0]
  const targetPercent = complianceRate
  const targetStatus = targetPercent >= 90 ? 'EXCELLENT' : targetPercent >= 75 ? 'GOOD' : targetPercent >= 60 ? 'WATCH' : 'CRITICAL'
  const statusClass = (value: string) => value === 'EXCELLENT' || value === 'GOOD'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : value === 'WATCH'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-rose-200 bg-rose-50 text-rose-700'

  return (
    <section className="rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/88 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
      <div className="grid gap-3 xl:grid-cols-[260px_1fr]">
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--dashboard-action-bg)]">Demo Vehicle Health</p>
            <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest', statusClass(status))}>{status}</span>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <p className="text-5xl font-black tracking-tight text-slate-950">{score}</p>
            <p className="pb-1 text-sm font-black uppercase tracking-widest text-slate-400">/ 100</p>
          </div>
          <p className="mt-2 text-xs font-black text-slate-600">Previous: insufficient due-score history</p>
          <p className="mt-2 inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Medium Confidence</p>
        </div>

        <div className="grid gap-2 md:grid-cols-5">
          {[
            { label: 'Due Vehicles', value: numberFormat(dueSoon), helper: 'Within 5 days', tone: dueSoon > 0 ? 'border-amber-100 bg-amber-50/70 text-amber-800' : 'border-emerald-100 bg-emerald-50/70 text-emerald-800' },
            { label: 'Compliance Risk', value: numberFormat(overdue), helper: 'Overdue follow-ups', tone: overdue > 0 ? 'border-rose-100 bg-rose-50/70 text-rose-800' : 'border-emerald-100 bg-emerald-50/70 text-emerald-800' },
            { label: 'Top Driver', value: 'Remark Coverage', helper: `${remarkCoverage.toFixed(1)}%`, tone: 'border-slate-200 bg-slate-50/80 text-slate-800' },
            { label: 'Biggest Concern', value: overdue > 0 ? 'Overdue' : 'Missing Remarks', helper: overdue > 0 ? `${overdue} vehicles` : `${withoutRemarks} vehicles`, tone: overdue > 0 || withoutRemarks > 0 ? 'border-rose-100 bg-rose-50/70 text-rose-800' : 'border-emerald-100 bg-emerald-50/70 text-emerald-800' },
            { label: 'Target Achievement', value: `${targetPercent.toFixed(1)}%`, helper: targetStatus, tone: targetPercent < 75 ? 'border-rose-100 bg-rose-50/70 text-rose-800' : 'border-emerald-100 bg-emerald-50/70 text-emerald-800' },
          ].map((item) => (
            <div key={item.label} className={cn('rounded-2xl border p-3', item.tone)}>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{item.label}</p>
              <p className="mt-2 text-lg font-black tracking-tight">{item.value}</p>
              <p className="mt-1 text-[11px] font-bold opacity-75">{item.helper}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-4">
        {[
          {
            title: 'Due Drivers',
            items: [
              ['Follow-up Base', numberFormat(total), 'Total demo vehicles'],
              ['Closest Due', nextAlert?.registrationNumber || 'None', nextAlert ? daysRemainingLabel(nextAlert.daysRemaining) : 'No due pressure'],
            ],
          },
          {
            title: 'Compliance Risks',
            tone: 'risk',
            items: [
              ['Overdue Vehicles', numberFormat(overdue), 'Missed demo due date'],
              ['Missing Remarks', numberFormat(withoutRemarks), 'No accountability note'],
            ],
          },
          {
            title: 'Follow-up Opportunities',
            tone: 'good',
            items: [
              ['Clear Overdue', numberFormat(overdue), 'First priority queue'],
              ['Reach 100% Remarks', `${remarkCoverage.toFixed(1)}%`, `${EXECUTIVE_TARGETS.demoJobCards.remarkCoveragePct}% target`],
            ],
          },
          {
            title: 'Focus Areas',
            items: [
              ['Complete Overdue Follow-ups', numberFormat(overdue), 'Daily action list'],
              ['Reduce Missing Remarks', numberFormat(withoutRemarks), 'Improve ownership'],
            ],
          },
        ].map((card) => (
          <div key={card.title} className={cn('rounded-2xl border p-3', card.tone === 'risk' ? 'border-rose-100 bg-rose-50/70 text-rose-800' : card.tone === 'good' ? 'border-emerald-100 bg-emerald-50/70 text-emerald-800' : 'border-slate-200 bg-slate-50/80 text-slate-800')}>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{card.title}</p>
            <div className="mt-2 space-y-2">
              {card.items.map(([label, value, helper]) => (
                <div key={`${card.title}-${label}`} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wide">{label}</p>
                    <p className="text-[11px] font-bold opacity-75">{helper}</p>
                  </div>
                  <p className="text-xs font-black">{value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-emerald-900">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Positive Drivers</p>
          <p className="mt-1 text-xs font-black">Compliance {complianceRate.toFixed(1)}%</p>
          <p className="text-xs font-black">Remark coverage {remarkCoverage.toFixed(1)}%</p>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-rose-900">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Negative Drivers</p>
          <p className="mt-1 text-xs font-black">{overdue} overdue vehicles</p>
          <p className="text-xs font-black">{withoutRemarks} missing remarks</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-slate-800">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Demo Compliance Target</p>
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', statusClass(targetStatus))}>{targetStatus}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-black">
            <div><p className="text-[10px] uppercase tracking-widest text-slate-400">Target</p><p>{EXECUTIVE_TARGETS.demoJobCards.complianceRatePct}%</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-slate-400">Achieved</p><p>{complianceRate.toFixed(1)}%</p></div>
            <div><p className="text-[10px] uppercase tracking-widest text-slate-400">Ach %</p><p>{targetPercent.toFixed(1)}%</p></div>
          </div>
        </div>
      </div>
    </section>
  )
}

function RemarksModal({
  row,
  onClose,
  onSaved,
}: {
  row: DemoVehicleRow
  onClose: () => void
  onSaved: () => void
}) {
  const [remark, setRemark] = useState(row.latestRemark || '')
  const [editingRemarkId, setEditingRemarkId] = useState<string | null>(row.latestRemarkId)
  const queryClient = useQueryClient()

  const historyQuery = useQuery<{ remarks: DemoRemark[] }>({
    queryKey: ['demo-job-card-remarks', row.vehicleKey],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/demo-job-cards?remarksVin=${encodeURIComponent(row.vehicleKey)}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load remark history')
      return payload
    },
    staleTime: 30_000,
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const method = editingRemarkId ? 'PATCH' : 'POST'
      const response = await fetch('/api/brands/kia/demo-job-cards', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingRemarkId
          ? { id: editingRemarkId, remark }
          : { vin: row.vehicleKey, remark }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to save remark')
      return payload
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['demo-job-cards'] })
      await queryClient.invalidateQueries({ queryKey: ['demo-job-card-remarks', row.vehicleKey] })
      onSaved()
      onClose()
    },
  })

  const history = historyQuery.data?.remarks || []

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="demo-remarks-modal demo-remarks-surface isolate mx-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 text-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[var(--dashboard-action-bg)] px-5 py-4 text-white">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/70">Remarks Management</p>
            <h2 className="mt-1 text-2xl font-black">{row.registrationNumber}</h2>
            <p className="mt-1 text-xs font-bold text-white/70">{row.vin}</p>
          </div>
          <button type="button" onClick={onClose} className="demo-remarks-close rounded-xl bg-white p-2 text-slate-950 shadow-sm transition hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="demo-remarks-body min-h-0 flex-1 overflow-auto p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="demo-remarks-panel rounded-2xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Model</p>
              <p className="mt-1 truncate font-black text-slate-950" title={row.model}>{row.model}</p>
            </div>
            <div className="demo-remarks-panel rounded-2xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mileage</p>
              <p className="mt-1 font-black text-slate-950">{numberFormat(row.mileage)}</p>
            </div>
            <div className="demo-remarks-panel rounded-2xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Next Due</p>
              <p className="mt-1 font-black text-slate-950">{formatDate(row.nextDemoDueDate)}</p>
            </div>
            <div className="demo-remarks-panel rounded-2xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Days Remaining</p>
              <p className="mt-1 font-black text-slate-950">{daysRemainingLabel(row.daysRemaining)}</p>
            </div>
            <div className="demo-remarks-panel rounded-2xl border border-slate-200 p-3 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Last RO</p>
              <p className="mt-1 font-black text-slate-950">{formatDate(row.lastBillDate)}</p>
            </div>
          </div>

          <div className="demo-remarks-panel mt-5 rounded-3xl border border-slate-200 p-4 shadow-sm">
            <label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
              {editingRemarkId ? 'Edit latest remark' : 'Add remark'}
            </label>
            <textarea
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              rows={4}
              placeholder="Customer contacted, vehicle unavailable, demo postponed..."
              className="demo-remarks-input mt-3 w-full resize-none rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-900 shadow-inner outline-none transition placeholder:text-slate-500 focus:border-[var(--dashboard-primary-border)] focus:ring-4 focus:ring-[var(--dashboard-primary-soft)]"
            />
            {saveMutation.error && (
              <p className="mt-2 text-xs font-bold text-rose-600">{saveMutation.error.message}</p>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {editingRemarkId && (
                <Button type="button" className="app-outline-action rounded-2xl" onClick={() => {
                  setEditingRemarkId(null)
                  setRemark('')
                }}>
                  Add New Instead
                </Button>
              )}
              <Button
                type="button"
                className="app-primary-action rounded-2xl"
                disabled={saveMutation.isPending || remark.trim().length < 2}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquarePlus className="mr-2 h-4 w-4" />}
                Save Remark
              </Button>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--dashboard-action-bg)]" />
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Remark History</h3>
            </div>

            {historyQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : historyQuery.error ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                {historyQuery.error.message}
              </div>
            ) : history.length === 0 ? (
              <div className="demo-remarks-panel rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">
                No remarks added yet.
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <article key={item.id} className="demo-remarks-panel rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-950">{item.remark}</p>
                        <p className="mt-2 text-xs font-bold text-slate-500">
                          Added by {item.createdByName || 'Unknown'} on {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        className="app-outline-action h-9 rounded-xl px-3"
                        onClick={() => {
                          setEditingRemarkId(item.id)
                          setRemark(item.remark)
                        }}
                      >
                        <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RemarkViewModal({
  row,
  onClose,
}: {
  row: DemoVehicleRow
  onClose: () => void
}) {
  const historyQuery = useQuery<{ remarks: DemoRemark[] }>({
    queryKey: ['demo-job-card-remarks', row.vehicleKey],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/demo-job-cards?remarksVin=${encodeURIComponent(row.vehicleKey)}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load remark history')
      return payload
    },
    staleTime: 30_000,
  })
  const history = historyQuery.data?.remarks || []

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="demo-remarks-modal demo-remarks-surface isolate mx-auto flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 text-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[var(--dashboard-action-bg)] px-5 py-4 text-white">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/70">Remark Details</p>
            <h2 className="mt-1 text-2xl font-black">{row.registrationNumber}</h2>
            <p className="mt-1 text-xs font-bold text-white/70">{row.model} / {numberFormat(row.mileage)} km</p>
          </div>
          <button type="button" onClick={onClose} className="demo-remarks-close rounded-xl bg-white p-2 text-slate-950 shadow-sm transition hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="demo-remarks-body min-h-0 flex-1 overflow-auto p-5">
          <div className="demo-remarks-panel rounded-3xl border border-slate-200 p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Latest Remark</p>
            <p className="mt-3 text-sm font-black leading-6 text-slate-950">{row.latestRemark || 'No remark added yet.'}</p>
            {row.latestRemark && (
              <p className="mt-3 text-xs font-bold text-slate-500">
                {row.latestRemarkBy || 'Unknown'} / {formatDateTime(row.latestRemarkAt)}
              </p>
            )}
          </div>

          <div className="mt-5">
            <div className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-[var(--dashboard-action-bg)]" />
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">Remark History</h3>
            </div>
            {historyQuery.isLoading ? (
              <div className="demo-remarks-panel h-20 animate-pulse rounded-2xl" />
            ) : historyQuery.error ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                {historyQuery.error.message}
              </div>
            ) : history.length === 0 ? (
              <div className="demo-remarks-panel rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">
                No remark history available.
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <article key={item.id} className="demo-remarks-panel rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <p className="text-sm font-black text-slate-950">{item.remark}</p>
                    <p className="mt-2 text-xs font-bold text-slate-500">
                      Added by {item.createdByName || 'Unknown'} on {formatDateTime(item.createdAt)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DemoJobCardsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [dueStatus, setDueStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedDealerCode, setSelectedDealerCode] = useState(() => normalizeKiaDealerCode(searchParams.get('dealer_code')) || DEFAULT_KIA_DEALER_CODE)
  const [selectedVehicle, setSelectedVehicle] = useState<DemoVehicleRow | null>(null)
  const [viewingRemarkVehicle, setViewingRemarkVehicle] = useState<DemoVehicleRow | null>(null)
  const [healthVisible, setHealthVisible] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSelectedDealerCode(normalizeKiaDealerCode(searchParams.get('dealer_code')) || DEFAULT_KIA_DEALER_CODE)
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [searchParams])

  const queryString = useMemo(() => buildQueryString({
    search,
    dueStatus,
    page,
    pageSize: PAGE_SIZE,
    dealer_code: selectedDealerCode,
  }), [dueStatus, page, search, selectedDealerCode])

  const { data, error, isLoading, isFetching, refetch } = useQuery<DemoPayload>({
    queryKey: ['demo-job-cards', queryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/demo-job-cards?${queryString}`)
      logApiTimings(response, 'demo-job-cards')
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load Demo Job Cards')
      return payload
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  })

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const handleDueStatus = (value: string) => {
    setDueStatus(value)
    setPage(1)
  }

  const handleDealerChange = (dealerCode: string) => {
    const nextDealerCode = normalizeKiaDealerCode(dealerCode) || DEFAULT_KIA_DEALER_CODE
    setSelectedDealerCode(nextDealerCode)
    setPage(1)
    const params = new URLSearchParams(searchParams.toString())
    params.set('dealer_code', nextDealerCode)
    router.replace(`/brands/kia/demo-job-cards?${params.toString()}`, { scroll: false })
  }

  const rows = data?.rows || []
  const alerts = data?.alerts || []
  const pagination = data?.pagination

  return (
    <MainLayout title="Demo Job Cards" subtitle="AM Kia Demo Vehicle Follow-up Tracker">
      <div className="space-y-6">
        {selectedVehicle && (
          <RemarksModal
            row={selectedVehicle}
            onClose={() => setSelectedVehicle(null)}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['demo-job-cards'] })
            }}
          />
        )}
        {viewingRemarkVehicle && (
          <RemarkViewModal
            row={viewingRemarkVehicle}
            onClose={() => setViewingRemarkVehicle(null)}
          />
        )}

        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/80 p-6 shadow-2xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,var(--dashboard-primary-soft),transparent_58%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--dashboard-action-bg)]">
                <Car className="h-3.5 w-3.5" />
                Demo Vehicle Tracker
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">Demo Job Cards</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">
                One vehicle, one row. Uses Demo Job Cards records where work type is Test Drive/CC Maintenance and calculates next due date as latest RO date plus 15 days.
              </p>
              <p className="mt-2 text-xs font-black uppercase tracking-widest text-slate-500">
                Source last updated: {formatDateTime(data?.meta.sourceUpdatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Demo Job Cards branch filter">
                {KIA_BRANCH_DEALERS.map((branch) => {
                  const isActive = selectedDealerCode === branch.dealerCode
                  return (
                    <button
                      key={branch.dealerCode}
                      type="button"
                      onClick={() => handleDealerChange(branch.dealerCode)}
                      className={cn(
                        'rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition',
                        isActive ? 'bg-[var(--dashboard-action-bg)] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      )}
                    >
                      {branch.label}
                    </button>
                  )
                })}
              </div>
              <Button
                type="button"
                onClick={() => setHealthVisible((visible) => !visible)}
                className="app-outline-action rounded-2xl px-4 py-2"
              >
                <Activity className="mr-2 h-4 w-4" />
                {healthVisible ? 'Hide Health' : 'Show Health'}
              </Button>
              <Button type="button" onClick={() => void refetch()} className="app-outline-action rounded-2xl px-4 py-2" disabled={isFetching}>
                <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
                Refresh
              </Button>
              <Button type="button" onClick={() => exportRowsToCsv(rows)} className="app-primary-action rounded-2xl px-4 py-2">
                <Download className="mr-2 h-4 w-4" />
                Export Visible
              </Button>
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-44 animate-pulse rounded-[2rem] border border-white/60 bg-white/60" />
            <div className="h-96 animate-pulse rounded-[2rem] border border-white/60 bg-white/60" />
          </div>
        ) : error ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-950">
            <h2 className="text-xl font-black">Demo Job Cards unavailable</h2>
            <p className="mt-2 text-sm font-semibold">{error.message}</p>
          </section>
        ) : (
          <>
            {!data?.meta.remarksTableReady && (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                Remarks table is not ready yet. Run <span className="font-black">scripts/create-demo-vehicle-remarks.sql</span> to enable add/edit/history.
              </section>
            )}

            {data && healthVisible && <DemoVehicleHealth data={data} />}

            <section className="rounded-[2rem] border border-amber-200 bg-white/82 p-5 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-700">Upcoming Demo Due</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-950">Vehicles due within 5 days</h2>
                </div>
                <p className="text-xs font-bold text-slate-500">{data?.meta.alertRule}</p>
              </div>

              {alerts.length === 0 ? (
                <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50/80 p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                      <CalendarClock className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-emerald-950">No demo vehicles due in the next 5 days</h3>
                      <p className="mt-1 text-sm font-semibold text-emerald-800">The follow-up tracker is clear for now.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid gap-4 xl:grid-cols-3">
                  {alerts.map((item) => (
                    <article key={`alert-${item.vehicleKey}`} className={cn('rounded-3xl border p-5 shadow-sm', getDueBadgeClass(item.dueStatus))}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70">{item.dueStatus}</p>
                          <h3 className="mt-2 text-2xl font-black">{item.registrationNumber}</h3>
                          <p className="mt-1 text-xs font-bold opacity-70">{item.vin}</p>
                        </div>
                        <AlertTriangle className="h-6 w-6" />
                      </div>
                      <div className="mt-4 grid gap-2 text-sm font-bold">
                        <div className="flex justify-between gap-3">
                          <span className="opacity-60">Model</span>
                          <span className="text-right">{item.model}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="opacity-60">Mileage</span>
                          <span>{numberFormat(item.mileage)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="opacity-60">Next Demo Due</span>
                          <span>{formatDate(item.nextDemoDueDate)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="opacity-60">Remaining</span>
                          <span>{daysRemainingLabel(item.daysRemaining)}</span>
                        </div>
                        {item.latestRemark && (
                          <p className="mt-2 rounded-2xl bg-white/70 p-3 text-xs leading-5">{item.latestRemark}</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <SummaryPill label="Total Vehicles" value={data?.summary.totalVehicles || 0} />
              <SummaryPill label="Due Within 5 Days" value={data?.summary.dueWithin5Days || 0} />
              <SummaryPill label="Overdue" value={data?.summary.overdue || 0} />
              <SummaryPill label="With Remarks" value={data?.summary.vehiclesWithRemarks || 0} />
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white/76 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
              <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[1fr_220px]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => handleSearch(event.target.value)}
                    placeholder="Search registration, VIN, customer, model, remark..."
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white/80 pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-[var(--dashboard-primary-border)] focus:ring-4 focus:ring-[var(--dashboard-primary-soft)]"
                  />
                </label>
                <select
                  value={dueStatus}
                  onChange={(event) => handleDueStatus(event.target.value)}
                  className="h-12 rounded-2xl border border-slate-200 bg-white/80 px-4 text-sm font-bold outline-none focus:border-[var(--dashboard-primary-border)]"
                >
                  <option value="all">All due statuses</option>
                  {data?.options.dueStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>

              <div className="overflow-auto">
                <table className="min-w-[1040px] w-full border-collapse text-center">
                  <thead className="bg-slate-950 text-white">
                    <tr>
                      {[
                        'Registration Number',
                        'VIN',
                        'Model',
                        'Mileage',
                        'Last RO Date',
                        'Next Demo Due Date',
                        'Days Remaining',
                        'Action',
                      ].map((heading) => (
                        <th key={heading} className="border border-slate-700 px-4 py-4 text-center text-[10px] font-black uppercase tracking-[0.2em]">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-16 text-center text-sm font-black text-slate-500">
                          No demo vehicles match the current filters.
                        </td>
                      </tr>
                    ) : rows.map((row) => (
                      <tr key={row.vehicleKey} className="border-b border-slate-200/80 transition hover:bg-[var(--dashboard-primary-soft)]/60">
                        <td className="border border-slate-200 px-4 py-4 text-center text-[13px] font-black text-[var(--dashboard-action-bg)]">{row.registrationNumber}</td>
                        <td className="border border-slate-200 px-4 py-4 text-center text-[11px] font-bold text-slate-600">{row.vin}</td>
                        <td className="border border-slate-200 px-4 py-4 text-center text-[13px] font-bold text-slate-800">{row.model}</td>
                        <td className="border border-slate-200 px-4 py-4 text-center text-[13px] font-bold text-slate-700">{numberFormat(row.mileage)}</td>
                        <td className="border border-slate-200 px-4 py-4 text-center text-[13px] font-bold text-slate-700">{formatDate(row.lastBillDate)}</td>
                        <td className="border border-slate-200 px-4 py-4 text-center text-[13px] font-black text-slate-950">{formatDate(row.nextDemoDueDate)}</td>
                        <td className="border border-slate-200 px-4 py-4 text-center">
                          <span className={cn('inline-flex rounded-full border px-3 py-1 text-[11px] font-black', getDueBadgeClass(row.dueStatus))}>
                            {daysRemainingLabel(row.daysRemaining)}
                          </span>
                        </td>
                        <td className="border border-slate-200 px-4 py-4 text-center">
                          <div className="flex min-w-[210px] flex-nowrap items-center justify-center gap-2">
                            {row.latestRemark && (
                              <Button
                                type="button"
                                className="app-outline-action h-10 shrink-0 rounded-2xl px-4"
                                onClick={() => setViewingRemarkVehicle(row)}
                              >
                                View
                              </Button>
                            )}
                            <Button
                              type="button"
                              className="app-primary-action h-10 shrink-0 rounded-2xl px-4"
                              onClick={() => setSelectedVehicle(row)}
                            >
                              {row.latestRemark ? <Edit3 className="mr-2 h-4 w-4" /> : <MessageSquarePlus className="mr-2 h-4 w-4" />}
                              Remarks
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <Clock className="h-4 w-4" />
                  Page {pagination?.page || 1} of {pagination?.totalPages || 1} / {numberFormat(pagination?.totalRows || 0)} vehicles
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" className="app-outline-action rounded-2xl px-4" disabled={(pagination?.page || 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Prev
                  </Button>
                  <Button type="button" className="app-outline-action rounded-2xl px-4" disabled={(pagination?.page || 1) >= (pagination?.totalPages || 1)} onClick={() => setPage((current) => current + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </MainLayout>
  )
}
