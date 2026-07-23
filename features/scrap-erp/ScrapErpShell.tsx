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
  const canAccessDistribution = roleLower === 'md' || roleLower === 'developer'

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

  // Transactions State
  const [transactions, setTransactions] = useState<ScrapTransaction[]>(INITIAL_SCRAP_TRANSACTIONS)
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

  const handleToggleDistribution = (id: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, isDistributed: nextStatus, distributedAt: nextStatus ? new Date().toISOString() : undefined }
          : t
      )
    )
    fetch('/api/scrap-erp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        isDistributed: nextStatus,
        distributedAt: nextStatus ? new Date().toISOString() : null,
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
            { key: 'masters', label: 'Master Data', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon
            const isActive = activeModule === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveModule(tab.key as any)}
                style={isActive ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)', borderColor: 'var(--dashboard-action-bg)' } : undefined}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all shadow-xs cursor-pointer',
                  isActive
                    ? 'shadow-md font-black'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-black',
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Active Module View */}
      {activeModule === 'dashboard' && (
        <ScrapExecutiveDashboardView
          transactions={filteredTransactions}
          onDrilldown={handleOpenDrilldown}
        />
      )}

      {activeModule === 'distribution' && canAccessDistribution && (
        <ScrapDistributionView
          transactions={filteredTransactions}
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
