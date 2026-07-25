'use client'

import { useState, useMemo } from 'react'
import {
  ScrapTransaction,
  ScrapLocation,
  ScrapDepartment,
  ScrapType,
  ScrapDescription,
  ScrapEmployee,
  ScrapPaymentMode,
  ScrapHandoverUser,
  ScrapGroup,
  ScrapFilterState,
  ScrapAiInsight,
} from '@/lib/scrap-erp/types'
import {
  DEFAULT_SCRAP_GROUPS,
  DEFAULT_SCRAP_LOCATIONS,
  DEFAULT_SCRAP_DEPARTMENTS,
  DEFAULT_SCRAP_TYPES,
  DEFAULT_SCRAP_DESCRIPTIONS,
  DEFAULT_SCRAP_EMPLOYEES,
  DEFAULT_SCRAP_PAYMENT_MODES,
  DEFAULT_SCRAP_HANDOVER_USERS,
  INITIAL_SCRAP_TRANSACTIONS,
  DEFAULT_AI_INSIGHTS,
} from '@/lib/scrap-erp/mock-data'
import {
  LayoutDashboard,
  PlusCircle,
  Table as TableIcon,
  BarChart3,
  Settings,
  Coins,
} from 'lucide-react'
import { useUserRole } from '@/lib/hooks/use-user-role'
import { Badge } from '@/components/ui/badge'
import { ScrapExecutiveDashboardView } from './ScrapExecutiveDashboardView'
import { ScrapDistributionView } from './ScrapDistributionView'
import { ScrapEntryFormView } from './ScrapEntryFormView'
import { ScrapRecordGridView } from './ScrapRecordGridView'
import { ScrapMasterDataManager } from './ScrapMasterDataManager'
import { ScrapReportsHubView } from './ScrapReportsHubView'
import { ScrapRecordDetailModal } from './ScrapRecordDetailModal'
import { ScrapImageGalleryModal } from './ScrapImageGalleryModal'
import { ScrapDrilldownModal } from './ScrapDrilldownModal'
import { cn } from '@/lib/utils'

export function ScrapErpShell() {
  const { userRole } = useUserRole()
  const roleLower = String(userRole || '').trim().toLowerCase()
  const canAccessDistribution = ['eba', 'md', 'developer'].includes(roleLower)

  const [activeModule, setActiveModule] = useState<
    'dashboard' | 'distribution' | 'entry' | 'grid' | 'masters' | 'reports'
  >('dashboard')

  // Master Data State
  const [groups, setGroups] = useState<ScrapGroup[]>(DEFAULT_SCRAP_GROUPS)
  const [locations, setLocations] = useState<ScrapLocation[]>(DEFAULT_SCRAP_LOCATIONS)
  const [departments, setDepartments] = useState<ScrapDepartment[]>(DEFAULT_SCRAP_DEPARTMENTS)
  const [scrapTypes, setScrapTypes] = useState<ScrapType[]>(DEFAULT_SCRAP_TYPES)
  const [descriptions, setDescriptions] = useState<ScrapDescription[]>(DEFAULT_SCRAP_DESCRIPTIONS)
  const [employees, setEmployees] = useState<ScrapEmployee[]>(DEFAULT_SCRAP_EMPLOYEES)
  const [paymentModes, setPaymentModes] = useState<ScrapPaymentMode[]>(DEFAULT_SCRAP_PAYMENT_MODES)
  const [handoverUsers, setHandoverUsers] = useState<ScrapHandoverUser[]>(DEFAULT_SCRAP_HANDOVER_USERS)

  // Transactions State — strip any stale isDistributed from pre-July records (distribution starts 1 July 2026)
  const [transactions, setTransactions] = useState<ScrapTransaction[]>(() =>
    INITIAL_SCRAP_TRANSACTIONS.map((t) => {
      const dateStr = (t.soldDate || t.timestamp || t.createdAt || '').slice(0, 10)
      if (dateStr < '2026-07-01' && (t as unknown as { isDistributed?: boolean }).isDistributed) {
        const { isDistributed: _d, distributedAt: _da, distributedBy: _db, ...rest } = t as ScrapTransaction & { isDistributed?: boolean; distributedAt?: string; distributedBy?: string }
        return rest
      }
      return { ...t }
    })
  )
  const [insights] = useState<ScrapAiInsight[]>(DEFAULT_AI_INSIGHTS)

  // Global Filter State
  const [filters, setFilters] = useState<ScrapFilterState>({
    dateRange: 'all',
    groups: [],
    locations: [],
    departments: [],
    scrapTypes: [],
    soldBy: [],
    paymentModes: [],
    handoverUsers: [],
    searchQuery: '',
  })

  // Modal Gallery & Details State
  const [selectedGalleryTxn, setSelectedGalleryTxn] = useState<ScrapTransaction | null>(null)
  const [isGalleryOpen, setIsGalleryOpen] = useState(false)
  const [selectedDetailTxn, setSelectedDetailTxn] = useState<ScrapTransaction | null>(null)

  // Active Transaction for Editing (direct form edit mode)
  const [editingTxn, setEditingTxn] = useState<ScrapTransaction | null>(null)

  // Drilldown Modal State
  const [drilldownTitle, setDrilldownTitle] = useState('')
  const [drilldownRows, setDrilldownRows] = useState<ScrapTransaction[] | null>(null)

  // Filter logic
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Search
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase()
        const matchNum = t.transactionNumber.toLowerCase().includes(q)
        const matchLoc = t.locationName.toLowerCase().includes(q)
        const matchDept = t.departmentName.toLowerCase().includes(q)
        const matchType = t.scrapTypeName.toLowerCase().includes(q)
        const matchSoldTo = t.soldTo.toLowerCase().includes(q)
        const matchSoldBy = t.soldByName.toLowerCase().includes(q)
        if (!matchNum && !matchLoc && !matchDept && !matchType && !matchSoldTo && !matchSoldBy) {
          return false
        }
      }

      // Group Filter
      if (filters.groups.length > 0 && t.groupName) {
        if (!filters.groups.includes(t.groupName)) return false
      }

      // Location Filter
      if (filters.locations.length > 0) {
        if (!filters.locations.includes(t.locationId) && !filters.locations.includes(t.locationName)) return false
      }

      // Department Filter
      if (filters.departments.length > 0) {
        if (!filters.departments.includes(t.departmentId) && !filters.departments.includes(t.departmentName)) return false
      }

      // Scrap Type Filter
      if (filters.scrapTypes.length > 0) {
        if (!filters.scrapTypes.includes(t.scrapTypeId) && !filters.scrapTypes.includes(t.scrapTypeName)) return false
      }

      return true
    })
  }, [transactions, filters])

  // Save or Update transaction directly from Scrap Entry Form
  const handleSaveFormTransaction = async (formData: any) => {
    const isEditing = Boolean(formData.id)
    try {
      const res = await fetch('/api/scrap-erp', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await res.json()

      if (data.success && data.transaction) {
        if (isEditing) {
          setTransactions(
            transactions.map((t) => (t.id === formData.id || t.transactionNumber === formData.transactionNumber ? data.transaction : t))
          )
        } else {
          setTransactions([data.transaction, ...transactions])
        }
      } else if (isEditing) {
        setTransactions(transactions.map((t) => (t.id === formData.id ? { ...t, ...formData } : t)))
      }

      setEditingTxn(null)
      setActiveModule('grid')
    } catch (err) {
      console.error('Failed to save scrap transaction:', err)
    }
  }

  // Start editing a record: switches directly to Scrap Entry tab with populated fields!
  const handleStartEdit = (txn: ScrapTransaction) => {
    setEditingTxn(txn)
    setSelectedDetailTxn(null)
    setActiveModule('entry')
  }

  // Add master item
  const handleAddMasterItem = async (category: string, itemData: any) => {
    try {
      const res = await fetch('/api/scrap-erp/masters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, item: itemData }),
      })
      const data = await res.json()
      if (data.success && data.item) {
        if (category === 'group') setGroups([...groups, data.item])
        else if (category === 'location') setLocations([...locations, data.item])
        else if (category === 'department') setDepartments([...departments, data.item])
        else if (category === 'scrapType') setScrapTypes([...scrapTypes, data.item])
        else if (category === 'description') setDescriptions([...descriptions, data.item])
        else if (category === 'employee' || category === 'soldBy') setEmployees([...employees, data.item])
        else if (category === 'paymentMode') setPaymentModes([...paymentModes, data.item])
        else if (category === 'handoverUser' || category === 'paymentHandoverTo') setHandoverUsers([...handoverUsers, data.item])
      }
    } catch (err) {
      console.error('Failed to add master item:', err)
    }
  }

  const handleDeleteTransactions = (ids: string[]) => {
    setTransactions(transactions.filter((t) => !ids.includes(t.id)))
  }

  const handleOpenDrilldown = (title: string, filtered: ScrapTransaction[]) => {
    setDrilldownTitle(title)
    setDrilldownRows(filtered)
  }

  const handleToggleDistribution = (
    id: string,
    currentStatus: boolean,
    customPayload?: Partial<ScrapTransaction>
  ) => {
    const nextStatus = !currentStatus
    const defaultPayload = {
      isDistributed: nextStatus,
      distributedAt: nextStatus ? new Date().toISOString() : undefined,
    }
    const payload = customPayload || defaultPayload

    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...payload } : t))
    )
    fetch('/api/scrap-erp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        ...payload,
      }),
    }).catch((err) => {
      console.error('Failed to update distribution status:', err)
    })
  }

  return (
    <div className="space-y-6">
      {/* Top Module Tabs Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {[
            { key: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
            ...(canAccessDistribution ? [{ key: 'distribution', label: 'Distribution', icon: Coins }] : []),
            { key: 'entry', label: editingTxn ? `Editing #${editingTxn.transactionNumber}` : 'Scrap Entry', icon: PlusCircle },
            { key: 'grid', label: 'Record Grid', icon: TableIcon, count: filteredTransactions.length },
            { key: 'reports', label: 'Reports Hub', icon: BarChart3 },
            { key: 'masters', label: 'Master Settings', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon
            const isActive = activeModule === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveModule(tab.key as typeof activeModule)}
                className={cn(
                  'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer whitespace-nowrap',
                  isActive
                    ? 'shadow-xs border border-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
                style={
                  isActive
                    ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }
                    : {}
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <Badge variant="secondary" className="ml-1 text-[10px] font-black px-1.5 py-0.2">
                    {tab.count}
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

        {/* User Role Pill */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px] font-extrabold uppercase py-1 px-3 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
            Role: {roleLower}
          </Badge>
        </div>
      </div>

      {/* Module Content Views */}
      {activeModule === 'dashboard' && (
        <ScrapExecutiveDashboardView
          transactions={filteredTransactions}
          onDrilldown={handleOpenDrilldown}
        />
      )}

      {activeModule === 'distribution' && canAccessDistribution && (
        <ScrapDistributionView
          transactions={filteredTransactions}
          handoverUsers={handoverUsers}
          onDrilldown={handleOpenDrilldown}
          onToggleDistribution={handleToggleDistribution}
        />
      )}

      {activeModule === 'entry' && (
        <ScrapEntryFormView
          groups={groups}
          locations={locations}
          departments={departments}
          scrapTypes={scrapTypes}
          descriptions={descriptions}
          employees={employees}
          paymentModes={paymentModes}
          handoverUsers={handoverUsers}
          initialData={editingTxn}
          onCancelEdit={() => setEditingTxn(null)}
          onSubmit={handleSaveFormTransaction}
        />
      )}

      {activeModule === 'grid' && (
        <ScrapRecordGridView
          transactions={filteredTransactions}
          onOpenImageGallery={(txn) => {
            setSelectedGalleryTxn(txn)
            setIsGalleryOpen(true)
          }}
          onSelectTransaction={(txn) => setSelectedDetailTxn(txn)}
          onEditRecord={handleStartEdit}
          onDeleteSelected={handleDeleteTransactions}
        />
      )}

      {activeModule === 'reports' && (
        <ScrapReportsHubView transactions={filteredTransactions} />
      )}

      {activeModule === 'masters' && (
        <ScrapMasterDataManager
          groups={groups}
          locations={locations}
          departments={departments}
          scrapTypes={scrapTypes}
          descriptions={descriptions}
          employees={employees}
          paymentModes={paymentModes}
          handoverUsers={handoverUsers}
          onAddMasterItem={handleAddMasterItem}
        />
      )}

      {/* Gallery Modal */}
      {selectedGalleryTxn && (
        <ScrapImageGalleryModal
          isOpen={isGalleryOpen}
          onClose={() => {
            setIsGalleryOpen(false)
            setSelectedGalleryTxn(null)
          }}
          transaction={selectedGalleryTxn}
        />
      )}

      {/* Full Transaction Details Modal */}
      {selectedDetailTxn && (
        <ScrapRecordDetailModal
          isOpen={Boolean(selectedDetailTxn)}
          onClose={() => setSelectedDetailTxn(null)}
          onOpenGallery={(txn: ScrapTransaction) => {
            setSelectedGalleryTxn(txn)
            setIsGalleryOpen(true)
          }}
          onEditRecord={handleStartEdit}
          transaction={selectedDetailTxn}
        />
      )}

      {/* Drilldown List Modal */}
      {drilldownRows && (
        <ScrapDrilldownModal
          title={drilldownTitle}
          rows={drilldownRows}
          isOpen={Boolean(drilldownRows)}
          onClose={() => setDrilldownRows(null)}
          onOpenGallery={(txn: ScrapTransaction) => {
            setSelectedGalleryTxn(txn)
            setIsGalleryOpen(true)
          }}
          onSelectTransaction={(txn: ScrapTransaction) => setSelectedDetailTxn(txn)}
        />
      )}
    </div>
  )
}
