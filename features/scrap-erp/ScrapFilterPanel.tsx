'use client'

import { useState } from 'react'
import { ScrapFilterState, ScrapLocation, ScrapDepartment, ScrapType, ScrapPaymentMode, ScrapHandoverUser } from '@/lib/scrap-erp/types'
import { Filter, Calendar, Search, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function ScrapFilterPanel({
  filters,
  onChange,
  locations,
  departments,
  scrapTypes,
}: {
  filters: ScrapFilterState
  onChange: (updated: ScrapFilterState) => void
  locations: ScrapLocation[]
  departments: ScrapDepartment[]
  scrapTypes: ScrapType[]
  paymentModes?: ScrapPaymentMode[]
  handoverUsers?: ScrapHandoverUser[]
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  const resetFilters = () => {
    onChange({
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
  }

  const activeCount =
    (filters.dateRange !== 'all' ? 1 : 0) +
    filters.groups.length +
    filters.locations.length +
    filters.departments.length +
    filters.scrapTypes.length +
    (filters.searchQuery ? 1 : 0)

  return (
    <Card className="p-3 shadow-xs space-y-3">
      {/* Top Search & Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by Txn #, Location, Department, Material, Vendor, Handover..."
            value={filters.searchQuery}
            onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
            className="pl-9 text-xs rounded-xl h-9"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Quick Date Presets */}
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border">
            {[
              { key: 'all', label: 'All' },
              { key: 'today', label: 'Today' },
              { key: 'this_month', label: 'This Month' },
            ].map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => onChange({ ...filters, dateRange: preset.key as any })}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-extrabold transition-all',
                  filters.dateRange === preset.key
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn('rounded-xl text-xs font-bold h-9', isExpanded && 'border-indigo-500 bg-indigo-50/50')}
          >
            <Filter className="h-3.5 w-3.5 mr-1 text-indigo-500" /> Filters
            {activeCount > 0 && (
              <Badge variant="default" className="ml-1.5 px-1.5 py-0 text-[10px] font-black">
                {activeCount}
              </Badge>
            )}
          </Button>

          {activeCount > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters} className="rounded-xl text-xs h-9">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset
            </Button>
          )}
        </div>
      </div>

      {/* Expanded Multi-select Filter Drawer */}
      {isExpanded && (
        <div className="border-t border-border pt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Locations */}
          <div className="space-y-1.5">
            <span className="text-xs font-extrabold text-foreground block">Filter Location</span>
            <select
              value={filters.locations[0] || 'all'}
              onChange={(e) =>
                onChange({ ...filters, locations: e.target.value === 'all' ? [] : [e.target.value] })
              }
              className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs font-semibold text-foreground"
            >
              <option value="all">All Locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          {/* Departments */}
          <div className="space-y-1.5">
            <span className="text-xs font-extrabold text-foreground block">Filter Department</span>
            <select
              value={filters.departments[0] || 'all'}
              onChange={(e) =>
                onChange({ ...filters, departments: e.target.value === 'all' ? [] : [e.target.value] })
              }
              className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs font-semibold text-foreground"
            >
              <option value="all">All Departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.name}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>

          {/* Scrap Types */}
          <div className="space-y-1.5">
            <span className="text-xs font-extrabold text-foreground block">Filter Scrap Category</span>
            <select
              value={filters.scrapTypes[0] || 'all'}
              onChange={(e) =>
                onChange({ ...filters, scrapTypes: e.target.value === 'all' ? [] : [e.target.value] })
              }
              className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs font-semibold text-foreground"
            >
              <option value="all">All Scrap Categories</option>
              {scrapTypes.map((st) => (
                <option key={st.id} value={st.name}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </Card>
  )
}
