'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  CreditCard,
  Plus,
  RefreshCw,
  AlertTriangle,
  FileText,
  History as HistoryIcon,
  Trash2,
  Save,
  X,
  Building2,
  Calendar,
  TrendingUp,
  Percent,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Search,
  ExternalLink,
  AlertCircle,
  FileCheck,
  Wallet,
  Eye,
  Pencil,
  Landmark,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { INDIA_TIME_ZONE } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { BANK_SANCTION_BRANDS } from '@/lib/auth/bank-sanctions-access'
import { getBranchLabel } from '@/lib/branches'

type ExpiryStatus = 'old_expired' | 'current_month' | null

type SanctionRecord = {
  id: string
  loanType: string
  location: string
  creditLimit: number | null
  instalment: number | null
  roiPct: number | null
  interestAmount: number | null
  outstandingAmount: number | null
  dateOfSanction: string | null
  installmentDueOn: string | null
  installmentPaidOn: string | null
  expiryDate: string | null
  guarantor: string | null
  collateral: string | null
  primarySecurity: string | null
  corporateGuarantee: string | null
  documentUrl1: string | null
  documentUrl2: string | null
  alertEmail: string | null
  /** Owning brand; '' = group-level (MD & Developer only). */
  branchCode: string | null
  expiryStatus: ExpiryStatus
  updatedAt: string | null
}

type HistoryEntry = {
  id: string
  action: string
  loanType: string
  location: string
  snapshot: Record<string, unknown>
  changedByEmail: string | null
  createdAt: string
}

const KNOWN_LOCATIONS = [
  'Jammu Auto Mart',
  'SMAM AUTO',
  'AM Hyundai',
  'Platinum Auto',
  'AM Hyundai Auto Square Gangyal',
  'AM Tata',
  'AM MG',
]

const EMPTY_DRAFT = {
  loanType: '',
  location: '',
  creditLimit: '',
  instalment: '',
  roiPct: '',
  interestAmount: '',
  outstandingAmount: '',
  dateOfSanction: '',
  installmentDueOn: '',
  installmentPaidOn: '',
  expiryDate: '',
  guarantor: '',
  collateral: '',
  primarySecurity: '',
  corporateGuarantee: '',
  documentUrl1: '',
  documentUrl2: '',
  alertEmail: '',
  branchCode: '',
}
type Draft = typeof EMPTY_DRAFT

function draftFrom(record: SanctionRecord): Draft {
  return {
    loanType: record.loanType,
    location: record.location,
    creditLimit: record.creditLimit === null ? '' : String(record.creditLimit),
    instalment: record.instalment === null ? '' : String(record.instalment),
    roiPct: record.roiPct === null ? '' : String(record.roiPct),
    interestAmount: record.interestAmount === null ? '' : String(record.interestAmount),
    outstandingAmount: record.outstandingAmount === null ? '' : String(record.outstandingAmount),
    dateOfSanction: record.dateOfSanction || '',
    installmentDueOn: record.installmentDueOn || '',
    installmentPaidOn: record.installmentPaidOn || '',
    expiryDate: record.expiryDate || '',
    guarantor: record.guarantor || '',
    collateral: record.collateral || '',
    primarySecurity: record.primarySecurity || '',
    corporateGuarantee: record.corporateGuarantee || '',
    documentUrl1: record.documentUrl1 || '',
    documentUrl2: record.documentUrl2 || '',
    alertEmail: record.alertEmail || '',
    branchCode: record.branchCode || '',
  }
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

function formatCurrencyINR(val: number | null): string {
  if (val === null || val === undefined) return '—'
  return inr.format(val)
}

function formatCompactINR(val: number | null): string {
  if (val === null || val === undefined) return '—'
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)} L`
  return inr.format(val)
}

const istStamp = (value: string) =>
  `${new Date(value).toLocaleDateString('en-IN', { timeZone: INDIA_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' })}, ${new Date(value).toLocaleTimeString('en-IN', { timeZone: INDIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: true })} IST`

function getBankBadge(name: string): { label: string; bg: string; text: string; border: string } {
  const upper = (name || '').toUpperCase()
  if (upper.includes('SBI') || upper.includes('STATE BANK')) {
    return { label: 'SBI', bg: 'bg-sky-50 dark:bg-sky-950/60', text: 'text-sky-700 dark:text-sky-300', border: 'border-sky-200 dark:border-sky-800' }
  }
  if (upper.includes('HDFC')) {
    return { label: 'HDFC', bg: 'bg-indigo-50 dark:bg-indigo-950/60', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-800' }
  }
  if (upper.includes('AXIS')) {
    return { label: 'AXIS', bg: 'bg-rose-50 dark:bg-rose-950/60', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-800' }
  }
  if (upper.includes('INDIAN BANK')) {
    return { label: 'INDIAN BANK', bg: 'bg-blue-50 dark:bg-blue-950/60', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' }
  }
  if (upper.includes('ICICI')) {
    return { label: 'ICICI', bg: 'bg-amber-50 dark:bg-amber-950/60', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' }
  }
  if (upper.includes('J&K') || upper.includes('JKB')) {
    return { label: 'J&K BANK', bg: 'bg-emerald-50 dark:bg-emerald-950/60', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' }
  }
  if (upper.includes('PNB') || upper.includes('PUNJAB')) {
    return { label: 'PNB', bg: 'bg-purple-50 dark:bg-purple-950/60', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800' }
  }
  return { label: 'BANK', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700' }
}

function getFacilityTypeBadge(name: string): { label: string; bg: string; text: string; border: string } {
  const upper = (name || '').toUpperCase()
  if (upper.includes('TERM LOAN') || upper.includes('TL') || upper.includes('REHAB-TERM')) {
    return { label: 'Term Loan', bg: 'bg-amber-50 dark:bg-amber-950/60', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-800' }
  }
  if (upper.includes('DROP LINE') || upper.includes('DROP-LINE') || upper.includes('DL')) {
    return { label: 'Drop Line', bg: 'bg-teal-50 dark:bg-teal-950/60', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-300 dark:border-teal-800' }
  }
  if (upper.includes('OVER DRAFT') || upper.includes('OVER-DRAFT') || upper.includes('OVERDRAFT') || upper.includes('OD')) {
    return { label: 'Overdraft', bg: 'bg-purple-50 dark:bg-purple-950/60', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-300 dark:border-purple-800' }
  }
  if (upper.includes('CASH CREDIT') || upper.includes('CC')) {
    return { label: 'Cash Credit', bg: 'bg-blue-50 dark:bg-blue-950/60', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-800' }
  }
  if (upper.includes('GUARANTEE') || upper.includes('BG') || upper.includes('INF')) {
    return { label: 'Non-Funded / BG', bg: 'bg-cyan-50 dark:bg-cyan-950/60', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-300 dark:border-cyan-800' }
  }
  return { label: 'Credit Line', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700' }
}

function getLocationBadge(location: string): { bg: string; text: string; border: string } {
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
  return { bg: 'bg-blue-50 dark:bg-blue-950/60', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' }
}

export function BankSanctionsWorkspace() {
  const [records, setRecords] = useState<SanctionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [locationFilter, setLocationFilter] = useState('all')
  const [loanTypeFilter, setLoanTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'current_month' | 'old_expired'>('all')
  const [search, setSearch] = useState('')

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(20)
  /*
   * Which location groups are open. Everything starts CLOSED — the point of the grouping is that
   * the register opens as ~13 location rows you can scan, and you drill into one.
   */
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
  const toggleLocation = useCallback((key: string) => {
    setExpandedLocations((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const [currentPage, setCurrentPage] = useState<number>(1)

  // Modal States
  const [viewingRecord, setViewingRecord] = useState<SanctionRecord | null>(null)
  const [editingRecord, setEditingRecord] = useState<SanctionRecord | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [uploadingSlot, setUploadingSlot] = useState<1 | 2 | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/bank-sanctions', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load bank sanctions')
      const data = await res.json()
      setRecords(data.records || [])
    } catch (error) {
      setRecords([])
      setLoadError(error instanceof Error ? error.message : 'Failed to load bank sanctions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  useEffect(() => {
    setCurrentPage(1)
  }, [locationFilter, loanTypeFilter, statusFilter, search, pageSize])

  const locations = useMemo(
    () => Array.from(new Set(records.map((r) => r.location).filter(Boolean))).sort(),
    [records],
  )

  const availableFormLocations = useMemo(() => {
    const set = new Set([...KNOWN_LOCATIONS, ...records.map((r) => r.location).filter(Boolean)])
    return Array.from(set).sort()
  }, [records])

  const loanTypes = useMemo(
    () => Array.from(new Set(
      records
        .filter((r) => locationFilter === 'all' || r.location === locationFilter)
        .map((r) => r.loanType),
    )).sort(),
    [records, locationFilter],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter((r) =>
      (locationFilter === 'all' || r.location === locationFilter) &&
      (loanTypeFilter === 'all' || r.loanType === loanTypeFilter) &&
      (statusFilter === 'all' || r.expiryStatus === statusFilter) &&
      (!q ||
        r.loanType.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q) ||
        (r.guarantor || '').toLowerCase().includes(q) ||
        (r.primarySecurity || '').toLowerCase().includes(q))
    )
  }, [records, locationFilter, loanTypeFilter, statusFilter, search])

  /*
   * ── Location grouping ──────────────────────────────────────────────────────────────────────
   * The register is read location-first ("what does KIA owe?"), not as one 73-row list, so rows
   * are collapsed under their location and the table opens one location at a time.
   *
   * ⚠️ Grouped on a NORMALISED key (lower-cased, non-alphanumerics stripped), not the raw string.
   * Live data holds "Jammu Auto Mart" (11 facilities) AND "Jammuautomart" (2) — the same company
   * typed two ways. Grouping raw would split one location into two headers whose totals each look
   * complete and neither is. 14 distinct strings collapse to 13 real locations.
   * The DISPLAY label is the spelling used by the most facilities, so the header shows the
   * house style rather than whichever row happened to sort first.
   */
  const groupedByLocation = useMemo(() => {
    const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    const groups = new Map<string, { key: string; label: string; rows: SanctionRecord[]; spellings: Map<string, number> }>()

    for (const row of visible) {
      const key = normalise(row.location) || '__unspecified__'
      let group = groups.get(key)
      if (!group) {
        group = { key, label: row.location, rows: [], spellings: new Map() }
        groups.set(key, group)
      }
      group.rows.push(row)
      group.spellings.set(row.location, (group.spellings.get(row.location) || 0) + 1)
    }

    return Array.from(groups.values()).map((group) => {
      const label = Array.from(group.spellings.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || group.label
      const totals = group.rows.reduce(
        (acc, r) => ({
          creditLimit: acc.creditLimit + (r.creditLimit ?? 0),
          outstandingAmount: acc.outstandingAmount + (r.outstandingAmount ?? 0),
          instalment: acc.instalment + (r.instalment ?? 0),
          interestAmount: acc.interestAmount + (r.interestAmount ?? 0),
        }),
        { creditLimit: 0, outstandingAmount: 0, instalment: 0, interestAmount: 0 },
      )
      const validRoiRows = group.rows.filter((r) => r.roiPct !== null && r.creditLimit)
      const totalWeightedRoi = validRoiRows.reduce((acc, r) => acc + (r.roiPct! * (r.creditLimit || 0)), 0)
      const totalWeight = validRoiRows.reduce((acc, r) => acc + (r.creditLimit || 0), 0)
      const weightedRoi = totalWeight > 0 ? Number((totalWeightedRoi / totalWeight).toFixed(2)) : null
      const availableHeadroom = Math.max(0, totals.creditLimit - totals.outstandingAmount)

      return {
        key: group.key,
        label,
        rows: group.rows,
        totals,
        drawnPct: totals.creditLimit > 0 ? Math.round((totals.outstandingAmount / totals.creditLimit) * 100) : 0,
        weightedRoi,
        availableHeadroom,
        expiredCount: group.rows.filter((r) => r.expiryStatus === 'old_expired').length,
        expiringCount: group.rows.filter((r) => r.expiryStatus === 'current_month').length,
        // More than one spelling in the source data — surfaced on the header so it gets cleaned up
        // rather than silently merged forever.
        spellingVariants: group.spellings.size > 1 ? Array.from(group.spellings.keys()) : null,
      }
    }).sort((a, b) => b.totals.creditLimit - a.totals.creditLimit)
  }, [visible])

  const hasNarrowingFilter =
    search.trim() !== '' || locationFilter !== 'all' || loanTypeFilter !== 'all' || statusFilter !== 'all'

  /*
   * A search or filter must not leave the user staring at closed headers — typing a bank name
   * would otherwise appear to return nothing. While anything narrows the list every surviving
   * group renders open; with no filter, the user's own toggles apply.
   *
   * DERIVED, not synced through an effect: writing this into state from a useEffect trips
   * react-hooks/set-state-in-effect and adds a render just to catch up with something already
   * knowable. Clearing the filters restores whatever the user had manually opened.
   */
  const isGroupOpen = useCallback(
    (key: string) => hasNarrowingFilter || expandedLocations.has(key),
    [hasNarrowingFilter, expandedLocations],
  )

  /*
   * Pagination now walks LOCATIONS, not rows: paging a grouped table by row would cut a location's
   * facilities across two pages and make its header totals disagree with what is under it.
   * With 13 locations and a default page size of 20 the control simply resolves to one page.
   */
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(groupedByLocation.length / pageSize)),
    [groupedByLocation.length, pageSize],
  )
  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return groupedByLocation.slice(start, start + pageSize)
  }, [groupedByLocation, currentPage, pageSize])

  const totals = useMemo(() => visible.reduce(
    (acc, r) => ({
      creditLimit: acc.creditLimit + (r.creditLimit ?? 0),
      instalment: acc.instalment + (r.instalment ?? 0),
      interestAmount: acc.interestAmount + (r.interestAmount ?? 0),
      outstandingAmount: acc.outstandingAmount + (r.outstandingAmount ?? 0),
    }),
    { creditLimit: 0, instalment: 0, interestAmount: 0, outstandingAmount: 0 },
  ), [visible])

  const portfolioUtilization = useMemo(() => {
    if (!totals.creditLimit || totals.creditLimit === 0) return 0
    return Math.round((totals.outstandingAmount / totals.creditLimit) * 100)
  }, [totals])

  const availableHeadroom = useMemo(() => {
    return Math.max(0, totals.creditLimit - totals.outstandingAmount)
  }, [totals])

  const averageRoi = useMemo(() => {
    const valid = visible.filter((r) => r.roiPct !== null && r.creditLimit)
    if (!valid.length) return null
    const totalWeighted = valid.reduce((acc, r) => acc + (r.roiPct! * (r.creditLimit || 0)), 0)
    const totalWeight = valid.reduce((acc, r) => acc + (r.creditLimit || 0), 0)
    return totalWeight > 0 ? (totalWeighted / totalWeight).toFixed(2) : null
  }, [visible])

  const expiredCount = useMemo(() => records.filter((r) => r.expiryStatus === 'old_expired').length, [records])
  const currentMonthExpiringCount = useMemo(() => records.filter((r) => r.expiryStatus === 'current_month').length, [records])
  const totalAlertsCount = expiredCount + currentMonthExpiringCount

  const handleOpenView = (record: SanctionRecord) => {
    setViewingRecord(record)
    setShowHistory(false)
    setHistory(null)
  }

  const handleOpenEdit = (record: SanctionRecord | 'new') => {
    setEditingRecord(record)
    setDraft(record === 'new' ? EMPTY_DRAFT : draftFrom(record))
    setShowHistory(false)
    setHistory(null)
  }

  const setField = (key: keyof Draft, value: string) => setDraft((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    if (!editingRecord) return
    setSaving(true)
    try {
      const isNew = editingRecord === 'new'
      const res = await fetch(isNew ? '/api/bank-sanctions' : `/api/bank-sanctions/${editingRecord.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to save record')
      toast({
        title: isNew ? 'Record created' : 'Record saved',
        description: `${draft.loanType} — audit snapshot recorded.`,
        variant: 'success',
      })
      setEditingRecord(null)
      await load()
    } catch (error) {
      toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (record: SanctionRecord) => {
    if (!window.confirm(`Delete "${record.loanType}"?\n\nA final snapshot will remain in history.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/bank-sanctions/${record.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to delete record')
      toast({ title: 'Record deleted', description: `${record.loanType} removed.`, variant: 'success' })
      setViewingRecord(null)
      setEditingRecord(null)
      await load()
    } catch (error) {
      toast({ title: 'Delete failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const loadHistoryForRecord = async (recordId: string) => {
    setShowHistory(true)
    if (history) return
    try {
      const res = await fetch(`/api/bank-sanctions/${recordId}/history`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to load history')
      setHistory(data.history || [])
    } catch (error) {
      toast({ title: 'History failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'error' })
      setHistory([])
    }
  }

  const uploadPdf = async (slot: 1 | 2, file: File | null) => {
    if (!file) return
    setUploadingSlot(slot)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/bank-sanctions/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed')
      setField(slot === 1 ? 'documentUrl1' : 'documentUrl2', data.url)
      toast({ title: 'PDF uploaded', description: file.name, variant: 'success' })
    } catch (error) {
      toast({ title: 'Upload failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'error' })
    } finally {
      setUploadingSlot(null)
    }
  }

  return (
    <div className="space-y-6 pb-24 font-sans tracking-normal">
      {/* ── Top Executive KPI Overview Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Total Sanctioned Limit */}
        <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Sanctioned Limits
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[var(--dashboard-primary)] dark:text-slate-200">
              <Landmark className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4 pt-0">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
              {formatCompactINR(totals.creditLimit)}
            </div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 mt-1">
              <span>{visible.length} Active {visible.length === 1 ? 'Facility' : 'Facilities'}</span>
              <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-300">{formatCurrencyINR(totals.creditLimit)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Total Outstanding & Utilization */}
        <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Total Outstanding
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4 pt-0 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-bold tabular-nums tracking-tight text-rose-600 dark:text-rose-400">
                {formatCompactINR(totals.outstandingAmount)}
              </div>
              <span className={cn(
                'px-2 py-0.5 rounded-lg text-xs font-semibold tabular-nums border',
                portfolioUtilization > 90
                  ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200'
                  : portfolioUtilization > 75
                  ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200'
              )}>
                {portfolioUtilization}% Drawn
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  portfolioUtilization > 90 ? 'bg-rose-500' : portfolioUtilization > 75 ? 'bg-amber-500' : 'bg-emerald-500'
                )}
                style={{ width: `${Math.min(100, portfolioUtilization)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Headroom / Available Limit */}
        <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Available Headroom
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
              <Wallet className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4 pt-0">
            <div className="text-2xl font-bold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
              {formatCompactINR(availableHeadroom)}
            </div>
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 mt-1">
              <span>Unutilized Capacity</span>
              <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-300">{100 - portfolioUtilization}% Available</span>
            </div>
          </CardContent>
        </Card>

        {/* Weighted ROI & Alerts */}
        <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Weighted Avg ROI
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300">
              <Percent className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4 pt-0 flex items-baseline justify-between">
            <div>
              <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                {averageRoi ? `${averageRoi}%` : '—'}
              </div>
              <p className="text-xs font-medium text-slate-500 mt-1">
                Annual Interest Rate
              </p>
            </div>
            {totalAlertsCount > 0 ? (
              <button
                type="button"
                onClick={() => setStatusFilter(currentMonthExpiringCount > 0 ? 'current_month' : 'old_expired')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-200 hover:bg-amber-100 cursor-pointer transition-colors shadow-2xs"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                {totalAlertsCount} Due
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" /> Healthy
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Active Expiry Notification Banner ── */}
      {totalAlertsCount > 0 && statusFilter === 'all' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-950 dark:text-amber-200">
                Facility Renewal Attention Needed
              </p>
              <p className="text-xs font-medium text-amber-900 dark:text-amber-300">
                {currentMonthExpiringCount} facility(ies) expiring this calendar month and {expiredCount} already past renewal date.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatusFilter('current_month')}
              className="h-8 rounded-xl text-xs font-semibold cursor-pointer"
            >
              View Expiring This Month
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatusFilter('old_expired')}
              className="h-8 rounded-xl text-xs font-semibold cursor-pointer"
            >
              View Expired
            </Button>
          </div>
        </div>
      )}

      {/* ── Control & Multi-Filter Bar ── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Location Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1">
            <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <Select
              value={locationFilter}
              onValueChange={(value) => {
                setLocationFilter(value)
                setLoanTypeFilter('all')
              }}
            >
              <SelectTrigger className="h-7 border-0 bg-transparent text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-none focus:ring-0 w-[140px] p-0">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs font-semibold">All Locations</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc} value={loc} className="text-xs font-medium">{loc}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loan Type Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1">
            <CreditCard className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <Select
              value={loanTypeFilter}
              onValueChange={(value) => setLoanTypeFilter(value)}
            >
              <SelectTrigger className="h-7 border-0 bg-transparent text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-none focus:ring-0 w-[150px] p-0">
                <SelectValue placeholder="All Loan Types" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs font-semibold">All Loan Types</SelectItem>
                {loanTypes.map((lt) => (
                  <SelectItem key={lt} value={lt} className="text-xs font-medium">{lt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Expiry Status Segmented Filter */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            {[
              { key: 'all', label: 'All Status' },
              { key: 'current_month', label: 'Expiring Soon' },
              { key: 'old_expired', label: 'Expired' },
            ].map((st) => (
              <button
                key={st.key}
                type="button"
                onClick={() => setStatusFilter(st.key as typeof statusFilter)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                  statusFilter === st.key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-2xs border border-slate-200/90 dark:border-slate-700 font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                )}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search facility, bank, guarantor…"
              className="h-9 w-60 rounded-xl pl-8 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="h-9 rounded-xl text-xs font-semibold gap-1.5 cursor-pointer"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => handleOpenEdit('new')}
            className="h-9 px-3.5 rounded-xl font-bold text-xs gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Facility</span>
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-900">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void load()} className="ml-auto h-7 text-xs">
            Retry
          </Button>
        </div>
      )}

      {/* ── Main High-Precision Financial Register Table ── */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={`sk-${i}`} className="h-12 animate-pulse rounded-xl bg-slate-50 dark:bg-slate-800/40" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 dark:bg-slate-800 text-slate-400">
                <CreditCard className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">No Facilities Match</p>
                <p className="text-xs font-medium text-slate-400 mt-0.5">
                  {records.length === 0 ? 'Click "Add Facility" to create the first sanction record.' : 'Try adjusting the location or search filters.'}
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs font-sans">
              <thead>
                <tr className="bg-slate-950 text-white border-b border-slate-800">
                  <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-300 sticky left-0 z-10 bg-slate-950 min-w-[280px]">
                    Facility & Bank
                  </th>
                  <th className="py-3 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                    Location
                  </th>
                  <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 min-w-[140px]">
                    Credit Limit
                  </th>
                  <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 min-w-[170px]">
                    Outstanding & Drawn %
                  </th>
                  <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                    Instalment
                  </th>
                  <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                    ROI %
                  </th>
                  <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                    Interest
                  </th>
                  <th className="py-3 px-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                    Expiry Date
                  </th>
                  <th className="py-3 px-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                    Docs
                  </th>
                  <th className="py-3 px-4 text-center text-[11px] font-bold uppercase tracking-wider text-slate-300 min-w-[160px]">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-normal">
                {paginatedGroups.map((group) => {
                  const isOpen = isGroupOpen(group.key)
                  return (
                  <Fragment key={group.key}>
                    {/* ── Location header: the rich executive summary of one location/group position ── */}
                    <tr
                      className={cn(
                        'group/parent border-y transition-all duration-150 cursor-pointer select-none',
                        isOpen
                          ? 'bg-slate-100/90 dark:bg-slate-800/90 border-slate-300 dark:border-slate-600 shadow-2xs'
                          : 'bg-slate-50/75 dark:bg-slate-900/60 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 border-slate-200/90 dark:border-slate-800',
                      )}
                      onClick={() => toggleLocation(group.key)}
                    >
                      {/* Facility & Bank column -> Entity Name, Icon, Facility Pill, Expiry Alerts */}
                      <td className={cn(
                        'py-3.5 px-4 sticky left-0 z-10 transition-colors',
                        isOpen
                          ? 'bg-slate-100 dark:bg-slate-800 border-l-4 border-l-[var(--dashboard-primary)]'
                          : 'bg-slate-50/95 dark:bg-slate-900/95 group-hover/parent:bg-slate-100/80 dark:group-hover/parent:bg-slate-800/80 border-l-4 border-l-transparent',
                      )}>
                        <div className="flex items-center gap-3">
                          {/* Expand / Collapse Icon Pill */}
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={(event) => { event.stopPropagation(); toggleLocation(group.key) }}
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-lg border transition-all shadow-2xs flex-none cursor-pointer',
                              isOpen
                                ? 'bg-[var(--dashboard-primary)] text-white border-[var(--dashboard-primary)] shadow-sm'
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 group-hover/parent:border-slate-400',
                            )}
                          >
                            <ChevronRight
                              className={cn('h-4 w-4 transition-transform duration-200 motion-reduce:transition-none', isOpen && 'rotate-90 text-white')}
                              aria-hidden="true"
                            />
                          </button>

                          {/* Entity Avatar / Monogram */}
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-black text-xs shadow-2xs flex-none">
                            {group.label.slice(0, 2).toUpperCase()}
                          </div>

                          {/* Entity Title & Badges */}
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-black tracking-tight text-slate-950 dark:text-white truncate">
                                {group.label}
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-200/80 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 border border-slate-300/60 dark:border-slate-600 tabular-nums shadow-2xs">
                                <Layers className="h-3 w-3 text-slate-500" />
                                {group.rows.length} {group.rows.length === 1 ? 'Facility' : 'Facilities'}
                              </span>
                              {group.expiredCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100/90 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 tabular-nums shadow-2xs">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  {group.expiredCount} expired
                                </span>
                              )}
                              {group.expiringCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100/90 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 tabular-nums shadow-2xs">
                                  <Clock className="h-2.5 w-2.5" />
                                  {group.expiringCount} expiring
                                </span>
                              )}
                            </div>
                            {group.spellingVariants && (
                              <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 truncate">
                                Merged spellings: {group.spellingVariants.join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Location Column */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                          Group
                        </span>
                      </td>

                      {/* Credit Limit & Headroom */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-black tabular-nums text-slate-950 dark:text-white tracking-tight">
                            {formatCurrencyINR(group.totals.creditLimit)}
                          </span>
                          {group.availableHeadroom > 0 && (
                            <span className="text-[10px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                              Avail: {formatCompactINR(group.availableHeadroom)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Outstanding & Drawn % with styled progress bar */}
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-sm font-black tabular-nums text-rose-600 dark:text-rose-400 tracking-tight">
                              {formatCurrencyINR(group.totals.outstandingAmount)}
                            </span>
                            <span className={cn(
                              'text-[10px] font-extrabold tabular-nums px-1.5 py-0.5 rounded-md border shadow-2xs',
                              group.drawnPct > 90
                                ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200'
                                : group.drawnPct > 75
                                ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200',
                            )}>
                              {group.drawnPct}%
                            </span>
                          </div>
                          {group.totals.creditLimit > 0 && (
                            <div className="h-1.5 w-24 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all duration-300',
                                  group.drawnPct > 90 ? 'bg-rose-500' : group.drawnPct > 75 ? 'bg-amber-500' : 'bg-emerald-500',
                                )}
                                style={{ width: `${Math.min(100, group.drawnPct)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Instalment (Monthly Principal) */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end">
                          <span className="text-xs font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {formatCurrencyINR(group.totals.instalment)}
                          </span>
                          <span className="text-[9px] font-medium text-slate-400 uppercase tracking-tight">Principal</span>
                        </div>
                      </td>

                      {/* Weighted Average ROI % */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        {group.weightedRoi !== null ? (
                          <span className="inline-block px-2 py-0.5 rounded-md font-bold text-xs tabular-nums bg-purple-100/70 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-2xs">
                            {group.weightedRoi}% <span className="text-[9px] font-normal text-purple-600 dark:text-purple-400">avg</span>
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>

                      {/* Interest */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end">
                          <span className="text-xs font-bold tabular-nums text-slate-800 dark:text-slate-200">
                            {formatCurrencyINR(group.totals.interestAmount)}
                          </span>
                          <span className="text-[9px] font-medium text-slate-400 uppercase tracking-tight">Est. Interest</span>
                        </div>
                      </td>

                      {/* Expiry Date / Status Summary across facilities */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center">
                          {group.expiredCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                              <AlertTriangle className="h-3 w-3" /> Action Needed
                            </span>
                          ) : group.expiringCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                              <Clock className="h-3 w-3" /> Review Expiring
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> All Active
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Docs Count / Status */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                          {group.rows.filter(r => r.documentUrl1 || r.documentUrl2).length}/{group.rows.length} Docs
                        </span>
                      </td>

                      {/* Actions: Clean Expand / Collapse Action Button */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleLocation(group.key) }}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs border',
                            isOpen
                              ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-600 hover:bg-slate-300'
                              : 'bg-white dark:bg-slate-800 text-[var(--dashboard-primary)] dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/80 hover:border-slate-300',
                          )}
                        >
                          <span>{isOpen ? 'Collapse' : `View ${group.rows.length} ${group.rows.length === 1 ? 'Facility' : 'Facilities'}`}</span>
                          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-200', isOpen && 'rotate-90')} />
                        </button>
                      </td>
                    </tr>

                    {isOpen && group.rows.map((row) => {
                  const bank = getBankBadge(row.loanType)
                  const facilityType = getFacilityTypeBadge(row.loanType)
                  const locBadge = getLocationBadge(row.location)
                  const utilPct = row.creditLimit && row.outstandingAmount
                    ? Math.round((row.outstandingAmount / row.creditLimit) * 100)
                    : 0
                  const isExpired = row.expiryStatus === 'old_expired'
                  const isExpiringSoon = row.expiryStatus === 'current_month'

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'transition-colors group hover:bg-slate-50/80 dark:hover:bg-slate-800/40',
                        isExpired
                          ? 'bg-rose-50/40 dark:bg-rose-950/20'
                          : isExpiringSoon
                          ? 'bg-amber-50/40 dark:bg-amber-950/20'
                          : ''
                      )}
                    >
                      {/* Facility & Bank Tags */}
                      <td className="py-3 px-4 sticky left-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800 transition-colors pl-12 border-l-4 border-l-slate-200 dark:border-l-slate-700">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider shrink-0 shadow-2xs', bank.bg, bank.text, bank.border)}>
                              {bank.label}
                            </span>
                            <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-semibold border uppercase tracking-wider shrink-0 shadow-2xs', facilityType.bg, facilityType.text, facilityType.border)}>
                              {facilityType.label}
                            </span>
                          </div>
                          <span
                            onClick={() => handleOpenView(row)}
                            className="font-semibold text-[13px] text-slate-900 dark:text-slate-100 truncate max-w-[260px] cursor-pointer hover:underline"
                            title={row.loanType}
                          >
                            {row.loanType}
                          </span>
                        </div>
                      </td>

                      {/* Location Badge */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={cn('inline-block px-2.5 py-1 rounded-lg text-xs font-semibold border shadow-2xs', locBadge.bg, locBadge.text, locBadge.border)}>
                          {row.location}
                        </span>
                      </td>

                      {/* Credit Limit */}
                      <td className="py-3 px-3 text-right font-semibold text-sm tabular-nums tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap">
                        {formatCurrencyINR(row.creditLimit)}
                      </td>

                      {/* Outstanding & Inline Progress Bar */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm tabular-nums tracking-tight text-rose-600 dark:text-rose-400">
                              {formatCurrencyINR(row.outstandingAmount)}
                            </span>
                            {row.creditLimit && row.outstandingAmount !== null && (
                              <span className={cn(
                                'text-[10px] font-bold tabular-nums px-1.5 py-0.2 rounded border shadow-2xs',
                                utilPct > 90
                                  ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200'
                                  : utilPct > 75
                                  ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200'
                              )}>
                                {utilPct}%
                              </span>
                            )}
                          </div>
                          {row.creditLimit && (
                            <div className="h-1.5 w-24 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  utilPct > 90 ? 'bg-rose-500' : utilPct > 75 ? 'bg-amber-500' : 'bg-emerald-500'
                                )}
                                style={{ width: `${Math.min(100, utilPct)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Instalment */}
                      <td className="py-3 px-3 text-right font-medium text-xs tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatCurrencyINR(row.instalment)}
                      </td>

                      {/* ROI % */}
                      <td className="py-3 px-3 text-right">
                        {row.roiPct !== null ? (
                          <span className="inline-block px-2 py-0.5 rounded-md font-semibold text-xs tabular-nums bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            {row.roiPct}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Interest */}
                      <td className="py-3 px-3 text-right font-medium text-xs tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatCurrencyINR(row.interestAmount)}
                      </td>

                      {/* Expiry Date */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center gap-1">
                          <span className="font-medium text-xs tabular-nums text-slate-700 dark:text-slate-300">
                            {row.expiryDate || '—'}
                          </span>
                          {isExpired && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200">
                              <AlertTriangle className="h-2.5 w-2.5" /> Expired
                            </span>
                          )}
                          {isExpiringSoon && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200">
                              <Clock className="h-2.5 w-2.5" /> Due Soon
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Documents */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {row.documentUrl1 && (
                            <a
                              href={row.documentUrl1}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors shadow-2xs"
                              title="Sanction Letter 1"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {row.documentUrl2 && (
                            <a
                              href={row.documentUrl2}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors shadow-2xs"
                              title="Sanction Letter 2"
                            >
                              <FileCheck className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {!row.documentUrl1 && !row.documentUrl2 && (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </div>
                      </td>

                      {/* Action Buttons using Theme Outline */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* View Button */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenView(row)}
                            className="h-7 px-2.5 rounded-lg text-xs font-semibold cursor-pointer shadow-2xs"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View
                          </Button>

                          {/* Edit Button */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenEdit(row)}
                            className="h-7 px-2.5 rounded-lg text-xs font-semibold cursor-pointer shadow-2xs"
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                    })}
                  </Fragment>
                  )
                })}
              </tbody>

              {/* Total Summary Footer */}
              <tfoot>
                <tr className="bg-slate-100/90 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700 font-semibold">
                  <td className="py-3 px-4 text-[11px] uppercase tracking-wider text-slate-900 dark:text-slate-100 sticky left-0 z-10 bg-slate-100 dark:bg-slate-800 font-bold">
                    Portfolio Total · {visible.length} Facilities
                  </td>
                  <td />
                  <td className="py-3 px-3 text-right text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatCurrencyINR(totals.creditLimit)}
                  </td>
                  <td className="py-3 px-3 text-right text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                    {formatCurrencyINR(totals.outstandingAmount)}
                  </td>
                  <td className="py-3 px-3 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {formatCurrencyINR(totals.instalment)}
                  </td>
                  <td className="py-3 px-3 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {averageRoi ? `${averageRoi}%` : '—'}
                  </td>
                  <td className="py-3 px-3 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    {formatCurrencyINR(totals.interestAmount)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* ── Modern Pagination Control Bar ── */}
        {!loading && visible.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
            {/* Left: Items Count & Per Page Selector */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                {/* Counts LOCATIONS, because that is what the pages step through now — quoting a
                    facility range here would describe a page boundary the table no longer has. */}
                Showing{' '}
                <strong className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold">
                  {groupedByLocation.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                </strong>
                –
                <strong className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold">
                  {Math.min(currentPage * pageSize, groupedByLocation.length)}
                </strong>{' '}
                of <strong className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold">{groupedByLocation.length}</strong>
                {groupedByLocation.length === 1 ? ' location' : ' locations'}
                {' · '}
                <strong className="text-slate-900 dark:text-slate-100 tabular-nums font-semibold">{visible.length}</strong> facilities
              </span>

              {/* Rows Per Page Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-500">Per page:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(val) => setPageSize(Number(val))}
                >
                  <SelectTrigger className="h-7 w-[78px] rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="20" className="text-xs font-medium">20</SelectItem>
                    <SelectItem value="40" className="text-xs font-medium">40</SelectItem>
                    <SelectItem value="100" className="text-xs font-medium">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right: Page Navigation Controls */}
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
                              ? 'bg-[var(--dashboard-action-bg)] text-white shadow-2xs font-bold'
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
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          MODAL 1: EXECUTIVE FACILITY VIEW MODAL (READ-ONLY PRESENTATION)
          ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={viewingRecord !== null} onOpenChange={(open) => { if (!open) setViewingRecord(null) }}>
        <DialogContent hideCloseButton className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-3xl p-6 border-slate-200 dark:border-slate-800 shadow-2xl">
          {viewingRecord && (
            <div className="space-y-6 font-sans">
              {/* Executive Header Banner */}
              <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
                <DialogTitle asChild>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                    <div className="space-y-1 pr-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('px-2.5 py-0.5 rounded-lg text-xs font-bold border uppercase tracking-wider', getBankBadge(viewingRecord.loanType).bg, getBankBadge(viewingRecord.loanType).text, getBankBadge(viewingRecord.loanType).border)}>
                          {getBankBadge(viewingRecord.loanType).label}
                        </span>
                        <span className={cn('px-2.5 py-0.5 rounded-lg text-xs font-semibold border uppercase tracking-wider', getFacilityTypeBadge(viewingRecord.loanType).bg, getFacilityTypeBadge(viewingRecord.loanType).text, getFacilityTypeBadge(viewingRecord.loanType).border)}>
                          {getFacilityTypeBadge(viewingRecord.loanType).label}
                        </span>
                        <span className={cn('px-2.5 py-0.5 rounded-lg text-xs font-semibold border', getLocationBadge(viewingRecord.location).bg, getLocationBadge(viewingRecord.location).text, getLocationBadge(viewingRecord.location).border)}>
                          {viewingRecord.location}
                        </span>
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50 pt-1">
                        {viewingRecord.loanType}
                      </h3>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const rec = viewingRecord
                          setViewingRecord(null)
                          handleOpenEdit(rec)
                        }}
                        className="h-9 px-3 rounded-xl font-semibold text-xs gap-1.5 cursor-pointer shadow-2xs"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit Facility
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => (showHistory ? setShowHistory(false) : void loadHistoryForRecord(viewingRecord.id))}
                        className="h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 cursor-pointer shadow-2xs"
                      >
                        <HistoryIcon className="h-3.5 w-3.5" />
                        {showHistory ? 'View Facility' : 'Audit Trail'}
                      </Button>
                    </div>
                  </div>
                </DialogTitle>
              </DialogHeader>

              {showHistory ? (
                /* History View Inside View Modal */
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Immutable Audit Trail</h4>
                  {history === null ? (
                    <p className="text-xs font-medium text-slate-500 py-6 text-center">Loading audit history…</p>
                  ) : history.length === 0 ? (
                    <p className="text-xs font-medium text-slate-500 py-6 text-center">No history recorded for this facility yet.</p>
                  ) : (
                    history.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-[var(--dashboard-primary)]">
                            {entry.action}
                          </span>
                          <span className="text-xs tabular-nums text-slate-500">{istStamp(entry.createdAt)}</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Modified by: <strong className="text-slate-700 dark:text-slate-300">{entry.changedByEmail || 'System'}</strong>
                        </p>
                        <p className="text-xs tabular-nums text-slate-600 dark:text-slate-400 pt-1">
                          Limit: {String(entry.snapshot.creditLimit ?? '—')} · Outstanding: {String(entry.snapshot.outstandingAmount ?? '—')} · Expiry: {String(entry.snapshot.expiryDate ?? '—')}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                /* Structured Executive Overview */
                <div className="space-y-6">
                  {/* 4 Financial Highlights */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sanctioned Limit</span>
                      <p className="text-lg font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">{formatCurrencyINR(viewingRecord.creditLimit)}</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-rose-50/60 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Outstanding Balance</span>
                      <p className="text-lg font-bold tabular-nums tracking-tight text-rose-600 dark:text-rose-400">{formatCurrencyINR(viewingRecord.outstandingAmount)}</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Available Headroom</span>
                      <p className="text-lg font-bold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                        {formatCurrencyINR(Math.max(0, (viewingRecord.creditLimit || 0) - (viewingRecord.outstandingAmount || 0)))}
                      </p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">Rate of Interest</span>
                      <p className="text-lg font-bold tabular-nums tracking-tight text-purple-700 dark:text-purple-300">
                        {viewingRecord.roiPct !== null ? `${viewingRecord.roiPct}% p.a.` : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Financial & Repayment Breakdown */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <TrendingUp className="h-4 w-4 text-emerald-600" /> Repayment & Interest Terms
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-slate-400 block font-medium">Monthly Instalment</span>
                        <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-200">{formatCurrencyINR(viewingRecord.instalment)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Calculated Interest Amount</span>
                        <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-200">{formatCurrencyINR(viewingRecord.interestAmount)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Renewal Alert Recipient</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{viewingRecord.alertEmail || 'accounts@jammuautomart.com'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Timeline Milestones */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-purple-600" /> Key Milestone Dates
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-slate-400 block font-medium">Sanction Date</span>
                        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{viewingRecord.dateOfSanction || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Instalment Due On</span>
                        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{viewingRecord.installmentDueOn || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Instalment Paid On</span>
                        <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{viewingRecord.installmentPaidOn || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Facility Expiry Date</span>
                        <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">{viewingRecord.expiryDate || '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Security & Collateral Coverage */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-blue-600" /> Security & Legal Coverage
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-medium block">Guarantor</span>
                        <p className="font-medium text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{viewingRecord.guarantor || '—'}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-medium block">Collateral</span>
                        <p className="font-medium text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{viewingRecord.collateral || '—'}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-medium block">Primary Security</span>
                        <p className="font-medium text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{viewingRecord.primarySecurity || '—'}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                        <span className="text-slate-400 font-medium block">Corporate Guarantee</span>
                        <p className="font-medium text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{viewingRecord.corporateGuarantee || '—'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Attached Documents */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-slate-600" /> Attached Sanction Letters (PDF)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {viewingRecord.documentUrl1 ? (
                        <a
                          href={viewingRecord.documentUrl1}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-slate-400 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-slate-600" /> Sanction Letter #1
                          </span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-xs text-center font-medium">
                          No PDF #1 Attached
                        </div>
                      )}

                      {viewingRecord.documentUrl2 ? (
                        <a
                          href={viewingRecord.documentUrl2}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-slate-400 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <FileCheck className="h-4 w-4 text-slate-600" /> Sanction Letter #2
                          </span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 text-xs text-center font-medium">
                          No PDF #2 Attached
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Close Button */}
                  <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setViewingRecord(null)}
                      className="h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer"
                    >
                      Close Window
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════
          MODAL 2: FACILITY EDIT & CREATE MODAL (STRUCTURED FORM)
          ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={editingRecord !== null} onOpenChange={(open) => { if (!open) setEditingRecord(null) }}>
        <DialogContent hideCloseButton className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-3xl p-6 border-slate-200 dark:border-slate-800 shadow-2xl">
          <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <DialogTitle asChild>
              <div className="flex items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    <Pencil className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
                      {editingRecord === 'new' ? 'Add Credit Facility' : `Edit: ${draft.loanType || 'Facility'}`}
                    </h3>
                    <p className="text-xs font-medium text-slate-400">
                      {editingRecord === 'new' ? 'Create a new bank credit limit or term loan record' : 'Update financial limits, dates, and securities'}
                    </p>
                  </div>
                </div>

                {editingRecord !== 'new' && editingRecord !== null && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void remove(editingRecord)}
                    disabled={saving}
                    className="h-8 gap-1.5 rounded-xl border-rose-200 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer shadow-2xs"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete Facility
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-2 font-sans">
            {/* Section 1: Facility Scope */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> 1. Facility Scope & Naming
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Loan Type / Account Name *
                  </label>
                  <Input
                    value={draft.loanType}
                    onChange={(e) => setField('loanType', e.target.value)}
                    placeholder="e.g. SBI - Drop Line - 42266427607"
                    className="rounded-xl font-medium text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Location *
                  </label>
                  <Select
                    value={draft.location || ''}
                    onValueChange={(val) => setField('location', val)}
                  >
                    <SelectTrigger className="h-9 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                      <SelectValue placeholder="Select Dealership Location" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl max-h-60">
                      {availableFormLocations.map((loc) => (
                        <SelectItem key={loc} value={loc} className="text-xs font-medium">
                          {loc}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Section 2: Financial Terms */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> 2. Financial Terms & Exposure
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Credit Limit (₹)
                  </label>
                  <Input
                    type="number"
                    value={draft.creditLimit}
                    onChange={(e) => setField('creditLimit', e.target.value)}
                    placeholder="e.g. 10000000"
                    className="rounded-xl tabular-nums text-right font-medium text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Outstanding Amount (₹)
                  </label>
                  <Input
                    type="number"
                    value={draft.outstandingAmount}
                    onChange={(e) => setField('outstandingAmount', e.target.value)}
                    placeholder="e.g. 7500000"
                    className="rounded-xl tabular-nums text-right font-medium text-xs text-rose-600"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Monthly Instalment (₹)
                  </label>
                  <Input
                    type="number"
                    value={draft.instalment}
                    onChange={(e) => setField('instalment', e.target.value)}
                    placeholder="e.g. 250000"
                    className="rounded-xl tabular-nums text-right font-medium text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Rate of Interest (ROI %)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={draft.roiPct}
                    onChange={(e) => setField('roiPct', e.target.value)}
                    placeholder="e.g. 9.40"
                    className="rounded-xl tabular-nums text-right font-medium text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Interest Amount (₹)
                  </label>
                  <Input
                    type="number"
                    value={draft.interestAmount}
                    onChange={(e) => setField('interestAmount', e.target.value)}
                    placeholder="e.g. 45000"
                    className="rounded-xl tabular-nums text-right font-medium text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Alert Email
                  </label>
                  <Input
                    type="email"
                    value={draft.alertEmail}
                    onChange={(e) => setField('alertEmail', e.target.value)}
                    placeholder="accounts@jammuautomart.com"
                    className="rounded-xl font-medium text-xs"
                  />
                </div>
                {/*
                  * Branch decides WHO CAN SEE this facility, so it is a first-class field rather
                  * than something only a migration can set. Group-level keeps it to MD & Developer.
                  */}
                <div>
                  <label htmlFor="bs-branch" className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Branch <span className="font-normal text-slate-400">· controls who can see it</span>
                  </label>
                  <select
                    id="bs-branch"
                    value={draft.branchCode}
                    onChange={(e) => setField('branchCode', e.target.value)}
                    className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-action-bg)]"
                  >
                    <option value="">Group-level — MD &amp; Developer only</option>
                    {BANK_SANCTION_BRANDS.map((brand) => (
                      <option key={brand} value={brand}>{getBranchLabel(brand)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 3: Timeline Dates */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> 3. Timeline Milestones & Expiry
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Sanction Date
                  </label>
                  <Input
                    type="date"
                    value={draft.dateOfSanction}
                    onChange={(e) => setField('dateOfSanction', e.target.value)}
                    className="rounded-xl text-xs font-medium tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Instalment Due On
                  </label>
                  <Input
                    type="date"
                    value={draft.installmentDueOn}
                    onChange={(e) => setField('installmentDueOn', e.target.value)}
                    className="rounded-xl text-xs font-medium tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Instalment Paid On
                  </label>
                  <Input
                    type="date"
                    value={draft.installmentPaidOn}
                    onChange={(e) => setField('installmentPaidOn', e.target.value)}
                    className="rounded-xl text-xs font-medium tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Facility Expiry Date *
                  </label>
                  <Input
                    type="date"
                    value={draft.expiryDate}
                    onChange={(e) => setField('expiryDate', e.target.value)}
                    className="rounded-xl text-xs font-semibold tabular-nums border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/30"
                  />
                </div>
              </div>
            </div>

            {/* Section 4: Security & Collateral */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> 4. Security & Collateral Coverage
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Guarantor
                  </label>
                  <Textarea
                    rows={2}
                    value={draft.guarantor}
                    onChange={(e) => setField('guarantor', e.target.value)}
                    className="rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Collateral Details
                  </label>
                  <Textarea
                    rows={2}
                    value={draft.collateral}
                    onChange={(e) => setField('collateral', e.target.value)}
                    className="rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Primary Security
                  </label>
                  <Textarea
                    rows={2}
                    value={draft.primarySecurity}
                    onChange={(e) => setField('primarySecurity', e.target.value)}
                    className="rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1">
                    Corporate Guarantee
                  </label>
                  <Textarea
                    rows={2}
                    value={draft.corporateGuarantee}
                    onChange={(e) => setField('corporateGuarantee', e.target.value)}
                    className="rounded-xl text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Section 5: Documents */}
            <div className="space-y-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> 5. Sanction Letters & Documents (PDF)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([1, 2] as const).map((slot) => {
                  const key = slot === 1 ? 'documentUrl1' : 'documentUrl2'
                  const url = draft[key]
                  return (
                    <div key={slot} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-800/30">
                      <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block mb-1.5">
                        Sanction Letter PDF #{slot}
                      </label>
                      {url ? (
                        <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2 rounded-xl">
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--dashboard-primary)] hover:underline truncate"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">View Attached PDF {slot}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setField(key, '')}
                            className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-rose-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Input
                          type="file"
                          accept="application/pdf"
                          disabled={uploadingSlot !== null}
                          onChange={(e) => void uploadPdf(slot, e.target.files?.[0] || null)}
                          className="rounded-xl text-xs"
                        />
                      )}
                      {uploadingSlot === slot && <p className="text-[10px] font-semibold text-indigo-600 mt-1">Uploading PDF…</p>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingRecord(null)}
                disabled={saving}
                className="h-10 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={() => void save()}
                disabled={saving || uploadingSlot !== null}
                className="h-10 px-5 rounded-xl font-bold text-xs gap-1.5 shadow-md cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : editingRecord === 'new' ? 'Create Facility' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
