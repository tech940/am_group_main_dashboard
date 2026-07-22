'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  ScrapTransaction,
  ScrapFilterState,
  ScrapLocation,
  ScrapDepartment,
  ScrapType,
  ScrapDescription,
  ScrapEmployee,
  ScrapPaymentMode,
  ScrapHandoverUser,
  ScrapAiInsight,
  ScrapGroup,
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

import { ScrapExecutiveDashboardView } from './ScrapExecutiveDashboardView'
import { ScrapEntryFormView } from './ScrapEntryFormView'
import { ScrapRecordGridView } from './ScrapRecordGridView'
import { ScrapMasterDataManager } from './ScrapMasterDataManager'
import { ScrapReportsHubView } from './ScrapReportsHubView'
import { ScrapFilterPanel } from './ScrapFilterPanel'
import { ScrapAiInsightsBanner } from './ScrapAiInsightsBanner'
import { ScrapImageGalleryModal } from './ScrapImageGalleryModal'
import { ScrapRecordDetailModal } from './ScrapRecordDetailModal'

import {
  LayoutDashboard,
  PlusCircle,
  Table,
  Settings,
  FileSpreadsheet,
  Recycle,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function ScrapErpShell() {
  const [activeModule, setActiveModule] = useState<
    'dashboard' | 'entry' | 'grid' | 'masters' | 'reports'
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

  // Drilldown Modal State
  const [drilldownTitle, setDrilldownTitle] = useState('')
  const [drilldownRows, setDrilldownRows] = useState<ScrapTransaction[] | null>(null)

  // Filtered Transactions Calculation
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Global Search
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase()
        const matches =
          t.transactionNumber.toLowerCase().includes(q) ||
          t.locationName.toLowerCase().includes(q) ||
          t.departmentName.toLowerCase().includes(q) ||
          t.scrapTypeName.toLowerCase().includes(q) ||
          t.soldTo.toLowerCase().includes(q) ||
          t.soldByName.toLowerCase().includes(q) ||
          t.paymentHandoverToName.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
        if (!matches) return false
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

  // Add new transaction
  const handleCreateTransaction = async (formData: any) => {
    try {
      const res = await fetch('/api/scrap-erp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await res.json()

      if (data.success && data.transaction) {
        setTransactions([data.transaction, ...transactions])
        setActiveModule('grid')
      }
    } catch (err) {
      console.error('Failed to save scrap transaction:', err)
    }
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

  return (
    <div className="space-y-6">
      {/* Top Module Tabs Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
            { key: 'entry', label: 'Scrap Entry', icon: PlusCircle },
            { key: 'grid', label: 'Record Grid', icon: Table, count: filteredTransactions.length },
            { key: 'reports', label: 'Reports Hub', icon: FileSpreadsheet },
            { key: 'masters', label: 'Master Data', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon
            const isActive = activeModule === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveModule(tab.key as any)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm font-black'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.count !== undefined && (
                  <span className="rounded-full bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-black text-slate-700 dark:text-slate-300">
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
          onSubmit={handleCreateTransaction}
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
          transaction={selectedDetailTxn}
          onOpenGallery={(txn) => {
            setSelectedGalleryTxn(txn)
            setIsGalleryOpen(true)
          }}
        />
      )}

      {/* Drilldown Modal (Fixed close button, scrolling inner body) */}
      <Dialog open={Boolean(drilldownRows)} onOpenChange={() => setDrilldownRows(null)}>
        <DialogContent className="max-w-[95vw] lg:max-w-6xl xl:max-w-7xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl p-6">
          <DialogHeader className="shrink-0 pb-2 pr-8">
            <DialogTitle className="text-base font-extrabold text-foreground">
              {drilldownTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 pt-2">
            <ScrapRecordGridView
              transactions={drilldownRows || []}
              onOpenImageGallery={(txn) => {
                setSelectedGalleryTxn(txn)
                setIsGalleryOpen(true)
              }}
              onSelectTransaction={(txn) => setSelectedDetailTxn(txn)}
              onDeleteSelected={() => {}}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
