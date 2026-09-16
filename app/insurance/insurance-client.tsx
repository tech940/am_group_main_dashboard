'use client'

import { useState, useDeferredValue, useMemo, useEffect, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  PhoneCall,
  History,
  FileText,
  Clock,
  UserX,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import { INSURANCE_BRANDS } from '@/lib/insurance/brands'
import type { CrmDisposition } from '@/lib/insurance/crm'
import type { RenewalDue, RenewalPipeline } from '@/lib/insurance/renewals'
import {
  DEFAULT_INSURANCE_PAGE_SIZE,
  type InsurancePageSize,
} from '@/features/insurance/table-pager'

// Sub-components
import { InsuranceHeader, type InsuranceFilterValues } from '@/features/insurance/components/insurance-header'
import { InsuranceHeroKpis } from '@/features/insurance/components/insurance-hero-kpis'
import { PolicyInspectorSheet } from '@/features/insurance/components/policy-inspector-sheet'
import { CrmDispositionModal } from '@/features/insurance/components/crm-disposition-modal'

// Workspaces
import { OverviewWorkspace } from '@/features/insurance/workspaces/overview-workspace'
import { RenewalsCrmWorkspace } from '@/features/insurance/workspaces/renewals-crm-workspace'
import { CohortsWorkspace } from '@/features/insurance/workspaces/cohorts-workspace'
import { RegisterWorkspace } from '@/features/insurance/workspaces/register-workspace'

type SearchParamsInput = Record<string, string | string[] | undefined>

type WorkspaceTab = 'overview' | 'renewals' | 'cohorts' | 'register'

const WORKSPACE_TABS: { id: WorkspaceTab; label: string; icon: any; badge?: string }[] = [
  { id: 'overview', label: 'Executive Overview', icon: BarChart3 },
  { id: 'renewals', label: 'Renewals & CRM Calling', icon: PhoneCall, badge: 'Live Desk' },
  { id: 'cohorts', label: 'Retention & Cohorts', icon: History },
  { id: 'register', label: 'Policy Register', icon: FileText },
]

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return typeof value === 'string' && WORKSPACE_TABS.some((t) => t.id === value)
}

function currentMonthRangeIst(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

export function InsuranceClient({
  initialSearchParams,
  lockedBrand,
  canEdit = false,
  currentUserName = '',
}: {
  initialSearchParams: SearchParamsInput
  lockedBrand?: InsuranceBrandId
  canEdit?: boolean
  currentUserName?: string
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const insuranceBrand: InsuranceBrandId = useMemo(() => {
    if (lockedBrand) return lockedBrand
    const raw = Array.isArray(initialSearchParams.type) ? initialSearchParams.type[0] : initialSearchParams.type
    return raw === 'platinum' || raw === 'kia' ? raw : 'hyundai'
  }, [lockedBrand, initialSearchParams.type])

  // Active Workspace Tab (URL synced)
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceTab>(() => {
    const raw = Array.isArray(initialSearchParams.tab) ? initialSearchParams.tab[0] : initialSearchParams.tab
    return isWorkspaceTab(raw) ? raw : 'overview'
  })

  useEffect(() => {
    const fromUrl = searchParams.get('tab')
    const next: WorkspaceTab = isWorkspaceTab(fromUrl) ? fromUrl : 'overview'
    setActiveWorkspace((cur) => (cur === next ? cur : next))
  }, [searchParams])

  const handleSelectWorkspace = useCallback(
    (tab: WorkspaceTab) => {
      setActiveWorkspace(tab)
      const p = new URLSearchParams(searchParams.toString())
      p.set('tab', tab)
      router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // Date Range Defaults (Mounts with Current Month by default)
  const defaultMonthRange = useMemo(() => currentMonthRangeIst(), [])

  // Filter States: mount with current month range by default
  const [filters, setFilters] = useState<InsuranceFilterValues>(() => {
    const start = (Array.isArray(initialSearchParams.startDate) ? initialSearchParams.startDate[0] : initialSearchParams.startDate) ?? defaultMonthRange.start
    const end = (Array.isArray(initialSearchParams.endDate) ? initialSearchParams.endDate[0] : initialSearchParams.endDate) ?? defaultMonthRange.end
    const year = (Array.isArray(initialSearchParams.year) ? initialSearchParams.year[0] : initialSearchParams.year) || 'all'

    return {
      startDate: start,
      endDate: end,
      year,
      dealerCode: 'all',
      subUser: 'all',
      insuranceCompany: 'all',
      rmName: 'all',
      policyType: 'all',
      status64vb: 'all',
      modelName: 'all',
      fuelType: 'all',
      paymentMode: 'all',
    }
  })

  const handleApplyFilters = useCallback((partial: Partial<InsuranceFilterValues>) => {
    setFilters((prev) => ({ ...prev, ...partial }))
    setTablePage(1)
  }, [])

  const handleResetFilters = useCallback(() => {
    const cur = currentMonthRangeIst()
    setFilters({
      startDate: cur.start,
      endDate: cur.end,
      year: 'all',
      dealerCode: 'all',
      subUser: 'all',
      insuranceCompany: 'all',
      rmName: 'all',
      policyType: 'all',
      status64vb: 'all',
      modelName: 'all',
      fuelType: 'all',
      paymentMode: 'all',
    })
    setTablePage(1)
  }, [])

  const dateRangeLabel = useMemo(() => {
    if (filters.startDate && filters.endDate) {
      return `${formatDate(filters.startDate)} – ${formatDate(filters.endDate)}`
    }
    if (filters.year !== 'all') return `Year ${filters.year}`
    return 'All History'
  }, [filters.startDate, filters.endDate, filters.year])

  // Register Table State
  const [tableSearch, setTableSearch] = useState('')
  const [tablePage, setTablePage] = useState(1)
  const [pageSize, setPageSize] = useState<InsurancePageSize>(DEFAULT_INSURANCE_PAGE_SIZE)
  const [tableSort, setTableSort] = useState('policy_issue_date')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')
  const deferredSearch = useDeferredValue(tableSearch)

  // Policy Inspector Sheet State
  const [selectedPolicyRecord, setSelectedPolicyRecord] = useState<any | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  // CRM Calling Modal State
  const [selectedCrmLead, setSelectedCrmLead] = useState<RenewalDue | null>(null)
  const [crmModalOpen, setCrmModalOpen] = useState(false)

  const handleInspectPolicy = useCallback((policy: any) => {
    setSelectedPolicyRecord(policy)
    setInspectorOpen(true)
  }, [])

  const handleOpenCrm = useCallback((lead: RenewalDue) => {
    setSelectedCrmLead(lead)
    setCrmModalOpen(true)
  }, [])

  // 1. Fetch Dropdown Filter Options (Cached for 10 mins)
  const filtersQuery = useQuery({
    queryKey: ['insurance-filters', insuranceBrand],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/filters?type=${insuranceBrand}`)
      if (!res.ok) throw new Error('Failed to fetch filters')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })

  // 2. Summary Query for Executive Overview & Hero KPIs
  const summaryQueryParams = useMemo(() => {
    const p = new URLSearchParams({ type: insuranceBrand })
    if (filters.year !== 'all') p.set('year', filters.year)
    if (filters.startDate) p.set('startDate', filters.startDate)
    if (filters.endDate) p.set('endDate', filters.endDate)
    if (filters.dealerCode !== 'all') p.set('dealerCode', filters.dealerCode)
    if (filters.subUser !== 'all') p.set('subUser', filters.subUser)
    if (filters.insuranceCompany !== 'all') p.set('insuranceCompany', filters.insuranceCompany)
    if (filters.rmName !== 'all') p.set('rmName', filters.rmName)
    if (filters.policyType !== 'all') p.set('policyType', filters.policyType)
    if (filters.status64vb !== 'all') p.set('status64vb', filters.status64vb)
    if (filters.modelName !== 'all') p.set('modelName', filters.modelName)
    if (filters.fuelType !== 'all') p.set('fuelType', filters.fuelType)
    if (filters.paymentMode !== 'all') p.set('paymentMode', filters.paymentMode)
    return p.toString()
  }, [insuranceBrand, filters])

  const summaryQuery = useQuery({
    queryKey: ['insurance-summary', summaryQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/summary?${summaryQueryParams}`)
      if (!res.ok) throw new Error('Failed to fetch summary analytics')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  // 3. LAZY-LOADED: Renewal Calling Pipeline Query (enabled only when in 'renewals' tab)
  const renewalsPipelineQuery = useQuery<RenewalPipeline>({
    queryKey: ['insurance-pipeline', insuranceBrand],
    queryFn: async () => {
      const res = await fetch(
        `/api/insurance/renewals?brands=${insuranceBrand}&lookaheadDays=90&lapsedDays=180`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error('Failed to fetch renewal pipeline')
      return res.json()
    },
    enabled: activeWorkspace === 'renewals',
    staleTime: 2 * 60 * 1000,
  })

  // 4. LAZY-LOADED: Cohorts Analytics Query (enabled only when in 'cohorts' tab)
  const cohortsQuery = useQuery({
    queryKey: ['insurance-cohorts', insuranceBrand],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/renewal-analytics?brand=${insuranceBrand}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Failed to fetch cohort analytics')
      return res.json()
    },
    enabled: activeWorkspace === 'cohorts',
    staleTime: 5 * 60 * 1000,
  })

  // 5. LAZY-LOADED: Master Policy Register Query (enabled only when in 'register' tab)
  const policiesQueryParams = useMemo(() => {
    const p = new URLSearchParams({
      type: insuranceBrand,
      page: String(tablePage),
      pageSize: String(pageSize),
      sort: tableSort,
      direction: tableSortDir,
    })
    if (deferredSearch) p.set('search', deferredSearch)
    if (filters.year !== 'all') p.set('year', filters.year)
    if (filters.startDate) p.set('startDate', filters.startDate)
    if (filters.endDate) p.set('endDate', filters.endDate)
    if (filters.dealerCode !== 'all') p.set('dealerCode', filters.dealerCode)
    if (filters.subUser !== 'all') p.set('subUser', filters.subUser)
    if (filters.insuranceCompany !== 'all') p.set('insuranceCompany', filters.insuranceCompany)
    if (filters.rmName !== 'all') p.set('rmName', filters.rmName)
    if (filters.policyType !== 'all') p.set('policyType', filters.policyType)
    if (filters.status64vb !== 'all') p.set('status64vb', filters.status64vb)
    if (filters.modelName !== 'all') p.set('modelName', filters.modelName)
    if (filters.fuelType !== 'all') p.set('fuelType', filters.fuelType)
    if (filters.paymentMode !== 'all') p.set('paymentMode', filters.paymentMode)
    return p.toString()
  }, [insuranceBrand, tablePage, pageSize, tableSort, tableSortDir, deferredSearch, filters])

  const policiesQuery = useQuery({
    queryKey: ['insurance-policies', policiesQueryParams],
    queryFn: async () => {
      const res = await fetch(`/api/insurance/policies?${policiesQueryParams}`)
      if (!res.ok) throw new Error('Failed to fetch policies register')
      return res.json()
    },
    enabled: activeWorkspace === 'register',
    staleTime: 2 * 60 * 1000,
  })

  // CRM Mutation
  const saveCrmMutation = useMutation({
    mutationFn: async (payload: {
      chassisNo: string
      policyNo?: string | null
      customerName?: string | null
      phone?: string | null
      disposition: CrmDisposition
      lossReason?: string | null
      remarks?: string | null
      followUpDate?: string | null
    }) => {
      const res = await fetch('/api/insurance/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, brand: insuranceBrand }),
      })
      if (!res.ok) throw new Error('Failed to save CRM record')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-pipeline'] })
      setCrmModalOpen(false)
      setSelectedCrmLead(null)
    },
  })

  // Export CSV Handler
  const [isExporting, setIsExporting] = useState(false)
  const handleExportCsv = async () => {
    setIsExporting(true)
    try {
      const p = new URLSearchParams({
        type: insuranceBrand,
        page: '1',
        pageSize: '1000',
        sort: tableSort,
        direction: tableSortDir,
      })
      if (deferredSearch) p.set('search', deferredSearch)
      if (filters.startDate) p.set('startDate', filters.startDate)
      if (filters.endDate) p.set('endDate', filters.endDate)

      const res = await fetch(`/api/insurance/policies?${p.toString()}`)
      if (!res.ok) throw new Error('Export failed')
      const json = await res.json()
      const rows = json.policies || json.rows || []

      const headers = ['Customer Name', 'Policy No', 'Model', 'Chassis No', 'Insurer', 'Policy Type', 'Gross Premium', 'Issue Date', 'Expiry Date']
      const csvLines = [headers.join(',')]
      rows.forEach((r: any) => {
        csvLines.push(
          [
            `"${(r.customerName || r.customer_name || '').replace(/"/g, '""')}"`,
            `"${(r.policyNo || r.policy_no || '').replace(/"/g, '""')}"`,
            `"${(r.modelName || r.model_name || '').replace(/"/g, '""')}"`,
            `"${(r.chassisNo || r.chassis_no || '').replace(/"/g, '""')}"`,
            `"${(r.insuranceCompany || r.insurance_company || '').replace(/"/g, '""')}"`,
            `"${(r.policyType || r.policy_type || '').replace(/"/g, '""')}"`,
            r.grossPremium || r.gross_premium || 0,
            r.policyIssueDate || r.policy_issue_date || '',
            r.odExpiryDate || r.od_expiry_date || '',
          ].join(','),
        )
      })

      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${insuranceBrand}_insurance_register_${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
    } catch (err) {
      console.error(err)
    } finally {
      setIsExporting(false)
    }
  }

  const summaryData = summaryQuery.data?.summary || {}
  const filterOptions = filtersQuery.data || {}

  return (
    <MainLayout
      title={`${INSURANCE_BRANDS[insuranceBrand].label}`}
      subtitle="Executive Retention Analytics, Renewal Triage & Calling Command Desk"
    >
      <div className="space-y-4 pb-16">
        {/* ── 1. HEADER CONTROLS ── */}
        <InsuranceHeader
          brand={insuranceBrand}
          lockedBrand={lockedBrand}
          dateRangeLabel={dateRangeLabel}
          defaultMonthRange={defaultMonthRange}
          appliedFilters={filters}
          onApplyFilters={handleApplyFilters}
          onResetFilters={handleResetFilters}
          onRefresh={() => {
            summaryQuery.refetch()
            if (activeWorkspace === 'renewals') renewalsPipelineQuery.refetch()
            if (activeWorkspace === 'cohorts') cohortsQuery.refetch()
            if (activeWorkspace === 'register') policiesQuery.refetch()
          }}
          isRefreshing={
            summaryQuery.isFetching ||
            renewalsPipelineQuery.isFetching ||
            cohortsQuery.isFetching ||
            policiesQuery.isFetching
          }
          filterOptions={filterOptions}
        />

        {/* ── 2. HERO EXECUTIVE KPIS ── */}
        <InsuranceHeroKpis
          brand={insuranceBrand}
          summaryData={summaryData}
          retentionRate={summaryData?.kpis?.renewalRatePct}
          isLoading={summaryQuery.isLoading}
          onDrilldown={() => handleSelectWorkspace('register')}
        />

        {/* ── 3. WORKSPACE TAB STRIP ── */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 overflow-x-auto shadow-2xs">
          {WORKSPACE_TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeWorkspace === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectWorkspace(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100',
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400')} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={cn(
                      'text-[10px] font-black px-1.5 py-0.2 rounded-md',
                      isActive
                        ? 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
                    )}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── 4. WORKSPACE PANELS ── */}
        {activeWorkspace === 'overview' && (
          <OverviewWorkspace
            brand={insuranceBrand}
            summaryData={summaryData}
            isLoading={summaryQuery.isLoading}
            onDrilldown={() => handleSelectWorkspace('register')}
          />
        )}

        {activeWorkspace === 'renewals' && (
          <RenewalsCrmWorkspace
            brand={insuranceBrand}
            pipelineData={renewalsPipelineQuery.data}
            isLoading={renewalsPipelineQuery.isLoading}
            canEdit={canEdit}
            onOpenCrm={handleOpenCrm}
            onInspectPolicy={handleInspectPolicy}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        )}

        {activeWorkspace === 'cohorts' && (
          <CohortsWorkspace
            brand={insuranceBrand}
            analyticsData={cohortsQuery.data}
            isLoading={cohortsQuery.isLoading}
          />
        )}

        {activeWorkspace === 'register' && (
          <RegisterWorkspace
            brand={insuranceBrand}
            policiesData={policiesQuery.data || {}}
            isLoading={policiesQuery.isLoading}
            searchQuery={tableSearch}
            onSearchChange={setTableSearch}
            page={tablePage}
            onPageChange={setTablePage}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            sort={tableSort}
            sortDir={tableSortDir}
            onSortChange={(col) => {
              if (tableSort === col) {
                setTableSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
              } else {
                setTableSort(col)
                setTableSortDir('desc')
              }
            }}
            onInspectPolicy={handleInspectPolicy}
            onExportCsv={handleExportCsv}
            isExporting={isExporting}
          />
        )}

        {/* ── 5. MODALS & INSPECTORS ── */}
        <PolicyInspectorSheet
          brand={insuranceBrand}
          policy={selectedPolicyRecord}
          open={inspectorOpen}
          onOpenChange={setInspectorOpen}
        />

        <CrmDispositionModal
          lead={selectedCrmLead}
          open={crmModalOpen}
          onOpenChange={setCrmModalOpen}
          onSave={(data) => saveCrmMutation.mutate(data)}
          isSaving={saveCrmMutation.isPending}
        />
      </div>
    </MainLayout>
  )
}
