'use client'

import { useState } from 'react'
import {
  ScrapLocation,
  ScrapDepartment,
  ScrapType,
  ScrapDescription,
  ScrapEmployee,
  ScrapPaymentMode,
  ScrapHandoverUser,
  ScrapGroup,
} from '@/lib/scrap-erp/types'
import { Plus, MapPin, Building2, Layers, Users, Bookmark, Settings, Folder } from 'lucide-react'
import { Card, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function ScrapMasterDataManager({
  groups = [],
  locations,
  departments,
  scrapTypes,
  descriptions,
  employees,
  paymentModes,
  handoverUsers,
  onAddMasterItem,
}: {
  groups?: ScrapGroup[]
  locations: ScrapLocation[]
  departments: ScrapDepartment[]
  scrapTypes: ScrapType[]
  descriptions: ScrapDescription[]
  employees: ScrapEmployee[]
  paymentModes: ScrapPaymentMode[]
  handoverUsers: ScrapHandoverUser[]
  onAddMasterItem: (category: string, itemData: any) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<
    'groups' | 'locations' | 'departments' | 'types' | 'descriptions' | 'employees' | 'paymentModes' | 'handoverUsers'
  >('locations')
  const [newItemName, setNewItemName] = useState('')
  const [newItemCode, setNewItemCode] = useState('')
  const [newItemUnit, setNewItemUnit] = useState<'Kg' | 'Ltr' | 'Pcs' | 'Ton'>('Kg')
  const [newItemRate, setNewItemRate] = useState('')
  const [newItemRole, setNewItemRole] = useState('Staff')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemName.trim()) return

    setIsSubmitting(true)
    try {
      if (activeTab === 'groups') {
        await onAddMasterItem('group', { name: newItemName, code: newItemCode || newItemName })
      } else if (activeTab === 'locations') {
        await onAddMasterItem('location', { name: newItemName, code: newItemCode || 'LOC' })
      } else if (activeTab === 'departments') {
        await onAddMasterItem('department', { name: newItemName, code: newItemCode || 'DEPT' })
      } else if (activeTab === 'types') {
        await onAddMasterItem('scrapType', { name: newItemName, unit: newItemUnit, defaultRatePerUnit: Number(newItemRate || 0) })
      } else if (activeTab === 'descriptions') {
        await onAddMasterItem('description', { name: newItemName })
      } else if (activeTab === 'employees') {
        await onAddMasterItem('employee', { name: newItemName, role: newItemRole })
      } else if (activeTab === 'paymentModes') {
        await onAddMasterItem('paymentMode', { name: newItemName, isOnline: false })
      } else if (activeTab === 'handoverUsers') {
        await onAddMasterItem('handoverUser', { name: newItemName, designation: 'Officer' })
      }

      setNewItemName('')
      setNewItemCode('')
      setNewItemRate('')
    } catch (err) {
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="space-y-6 p-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <CardTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Settings className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> Master Data Management (`scrap_master_data`)
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
            Configure dropdown values for Groups, Locations, Departments, Scrap Types, Descriptions, Employees, and Payment Handover users.
          </p>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-100 dark:border-slate-800">
        {[
          { key: 'groups', label: 'Groups', count: groups.length, icon: Folder },
          { key: 'locations', label: 'Locations', count: locations.length, icon: MapPin },
          { key: 'departments', label: 'Departments', count: departments.length, icon: Building2 },
          { key: 'types', label: 'Scrap Types', count: scrapTypes.length, icon: Layers },
          { key: 'descriptions', label: 'Descriptions', count: descriptions.length, icon: Bookmark },
          { key: 'employees', label: 'Sold By', count: employees.length, icon: Users },
          { key: 'paymentModes', label: 'Payment Modes', count: paymentModes.length, icon: Bookmark },
          { key: 'handoverUsers', label: 'Payment Handover To', count: handoverUsers.length, icon: Users },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all whitespace-nowrap',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm font-black'
                  : 'border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-black',
                  isActive
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Add New Master Form */}
      <form onSubmit={handleCreate} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
          Add New Master Option ({activeTab})
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <Input
              type="text"
              placeholder={`Enter new ${activeTab} name...`}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              className="h-10 rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>

          {activeTab === 'groups' || activeTab === 'locations' || activeTab === 'departments' ? (
            <div>
              <Input
                type="text"
                placeholder="Code"
                value={newItemCode}
                onChange={(e) => setNewItemCode(e.target.value)}
                className="h-10 rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
          ) : activeTab === 'types' ? (
            <>
              <div>
                <select
                  value={newItemUnit}
                  onChange={(e) => setNewItemUnit(e.target.value as any)}
                  className="h-10 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  <option value="Kg">Kg</option>
                  <option value="Ltr">Ltr</option>
                  <option value="Pcs">Pcs</option>
                  <option value="Ton">Ton</option>
                </select>
              </div>
              <div>
                <Input
                  type="number"
                  placeholder="Default Rate"
                  value={newItemRate}
                  onChange={(e) => setNewItemRate(e.target.value)}
                  className="h-10 rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
            </>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting || !newItemName.trim()}
            className="h-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-black text-xs shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4 mr-1" /> Add Master
          </Button>
        </div>
      </form>

      {/* Master Items Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {activeTab === 'groups' &&
          groups.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <div>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 block text-xs">{item.name}</span>
                <span className="text-[10px] text-slate-500 font-medium">Code: {item.code}</span>
              </div>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Group
              </Badge>
            </div>
          ))}

        {activeTab === 'locations' &&
          locations.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <div>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 block text-xs">{item.name}</span>
                <span className="text-[10px] text-slate-500 font-medium">Code: {item.code}</span>
              </div>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Location
              </Badge>
            </div>
          ))}

        {activeTab === 'departments' &&
          departments.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <div>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 block text-xs">{item.name}</span>
                <span className="text-[10px] text-slate-500 font-medium">Code: {item.code}</span>
              </div>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Dept
              </Badge>
            </div>
          ))}

        {activeTab === 'types' &&
          scrapTypes.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <div>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 block text-xs">{item.name}</span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Unit: {item.unit} · Default Rate: ₹{item.defaultRatePerUnit}
                </span>
              </div>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Scrap Type
              </Badge>
            </div>
          ))}

        {activeTab === 'descriptions' &&
          descriptions.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <span className="font-extrabold text-slate-900 dark:text-slate-100 text-xs">{item.name}</span>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Description
              </Badge>
            </div>
          ))}

        {activeTab === 'employees' &&
          employees.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <div>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 block text-xs">{item.name}</span>
                <span className="text-[10px] text-slate-500 font-medium">{item.role}</span>
              </div>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Employee
              </Badge>
            </div>
          ))}

        {activeTab === 'paymentModes' &&
          paymentModes.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <span className="font-extrabold text-slate-900 dark:text-slate-100 text-xs">{item.name}</span>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Payment Mode
              </Badge>
            </div>
          ))}

        {activeTab === 'handoverUsers' &&
          handoverUsers.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between text-xs bg-white dark:bg-slate-900 shadow-sm hover:border-slate-400 transition-all">
              <div>
                <span className="font-extrabold text-slate-900 dark:text-slate-100 block text-xs">{item.name}</span>
                <span className="text-[10px] text-slate-500 font-medium">{item.designation}</span>
              </div>
              <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 font-extrabold text-[10px]">
                Handover User
              </Badge>
            </div>
          ))}
      </div>
    </Card>
  )
}
