'use client'

import { useState } from 'react'
import {
  Calendar,
  ChevronDown,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  X,
  Building2,
  Shield,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { BrandLogoLockup } from '@/components/brand-logo-lockup'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import { INSURANCE_BRANDS } from '@/lib/insurance/brands'

export type InsuranceFilterValues = {
  startDate: string
  endDate: string
  year: string
  dealerCode: string
  subUser: string
  insuranceCompany: string
  rmName: string
  policyType: string
  status64vb: string
  modelName: string
  fuelType: string
  paymentMode: string
}

type Props = {
  brand: InsuranceBrandId
  lockedBrand?: InsuranceBrandId
  dateRangeLabel: string
  defaultMonthRange: { start: string; end: string }
  appliedFilters: InsuranceFilterValues
  onApplyFilters: (filters: Partial<InsuranceFilterValues>) => void
  onResetFilters: () => void
  onRefresh: () => void
  isRefreshing: boolean
  filterOptions: {
    subUsers?: string[]
    insuranceCompanies?: string[]
    executives?: string[]
    models?: string[]
    policyTypes?: string[]
    fuelTypes?: string[]
    years?: string[]
  }
}

export function InsuranceHeader({
  brand,
  lockedBrand,
  dateRangeLabel,
  defaultMonthRange,
  appliedFilters,
  onApplyFilters,
  onResetFilters,
  onRefresh,
  isRefreshing,
  filterOptions,
}: Props) {
  const brandConfig = INSURANCE_BRANDS[brand]
  const capabilities = brandConfig.capabilities

  const [dateDropdownOpen, setDateDropdownOpen] = useState(false)
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false)

  // Draft date states
  const [draftStart, setDraftStart] = useState(appliedFilters.startDate)
  const [draftEnd, setDraftEnd] = useState(appliedFilters.endDate)

  // Draft filter states
  const [draftSubUser, setDraftSubUser] = useState(appliedFilters.subUser)
  const [draftInsurer, setDraftInsurer] = useState(appliedFilters.insuranceCompany)
  const [draftPolicyType, setDraftPolicyType] = useState(appliedFilters.policyType)
  const [draftStatus64vb, setDraftStatus64vb] = useState(appliedFilters.status64vb)
  const [draftModel, setDraftModel] = useState(appliedFilters.modelName)
  const [draftRm, setDraftRm] = useState(appliedFilters.rmName)

  // Active secondary filters count
  const activeSecondaryCount = [
    appliedFilters.subUser !== 'all',
    appliedFilters.insuranceCompany !== 'all',
    appliedFilters.policyType !== 'all',
    appliedFilters.status64vb !== 'all',
    appliedFilters.modelName !== 'all',
    appliedFilters.rmName !== 'all',
    appliedFilters.fuelType !== 'all',
  ].filter(Boolean).length

  const isAllHistory = !appliedFilters.startDate && !appliedFilters.endDate
  const isThisMonth =
    appliedFilters.startDate === defaultMonthRange.start &&
    appliedFilters.endDate === defaultMonthRange.end
  const isCustomDate = !isAllHistory && !isThisMonth

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md p-3.5 shadow-xs space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Brand Logo Lockup (Matching Approval Form Branding) */}
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <BrandLogoLockup
              brand={brand}
              variant="card"
              size="sm"
              className="bg-white dark:bg-slate-900 shadow-2xs border-slate-200/90 dark:border-slate-800"
            />
          </div>

          <div className="hidden sm:flex flex-col">
            <span className="text-xs font-black tracking-tight text-slate-900 dark:text-slate-100">
              {brandConfig.label}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
              Records from {brandConfig.historyStartLabel}
            </span>
          </div>
        </div>

        {/* Date Presets, Advanced Filters & Refresh Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Date Presets */}
          <div className="flex items-center bg-slate-100/90 dark:bg-slate-800/90 p-0.5 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-xs">
            <button
              type="button"
              onClick={() => {
                onApplyFilters({
                  startDate: defaultMonthRange.start,
                  endDate: defaultMonthRange.end,
                  year: 'all',
                })
              }}
              className={cn(
                'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                isThisMonth
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200',
              )}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => {
                onApplyFilters({
                  startDate: '',
                  endDate: '',
                  year: 'all',
                })
              }}
              className={cn(
                'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                isAllHistory
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200',
              )}
            >
              All History
            </button>
          </div>

          {/* Date Range Picker Dropdown */}
          <DropdownMenu open={dateDropdownOpen} onOpenChange={setDateDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-8 rounded-xl text-xs font-semibold gap-1.5 px-3 shadow-2xs cursor-pointer border-slate-200 dark:border-slate-700',
                  isCustomDate && 'border-teal-500 text-teal-700 dark:text-teal-300 font-bold',
                )}
              >
                <Calendar className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>{dateRangeLabel}</span>
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-80 p-4 rounded-2xl shadow-xl border-slate-200 dark:border-slate-800 space-y-3"
              align="end"
            >
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100">Custom Date Range</p>
                <p className="text-[11px] text-slate-500">Filter policies by issuance date</p>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">From Date</label>
                  <Input
                    type="date"
                    value={draftStart}
                    onChange={(e) => setDraftStart(e.target.value)}
                    className="h-8 text-xs rounded-xl mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">To Date</label>
                  <Input
                    type="date"
                    value={draftEnd}
                    onChange={(e) => setDraftEnd(e.target.value)}
                    className="h-8 text-xs rounded-xl mt-1"
                  />
                </div>
              </div>
              <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraftStart('')
                    setDraftEnd('')
                    onApplyFilters({ startDate: '', endDate: '' })
                    setDateDropdownOpen(false)
                  }}
                  className="h-7 text-xs font-medium"
                >
                  All History
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onApplyFilters({ startDate: draftStart, endDate: draftEnd })
                    setDateDropdownOpen(false)
                  }}
                  className="h-7 text-xs font-bold bg-[var(--dashboard-primary)] text-white"
                >
                  Apply
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Secondary Filters Dropdown */}
          <DropdownMenu open={filterDropdownOpen} onOpenChange={setFilterDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant={activeSecondaryCount > 0 ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-8 rounded-xl text-xs font-bold gap-1.5 px-3 shadow-2xs cursor-pointer',
                  activeSecondaryCount > 0
                    ? 'bg-[var(--dashboard-primary)] text-white hover:bg-[var(--dashboard-primary)]/90'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                <span>Filters</span>
                {activeSecondaryCount > 0 && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-white text-[9px] font-black">
                    {activeSecondaryCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-96 p-4 rounded-2xl shadow-xl border-slate-200 dark:border-slate-800 space-y-3.5"
              align="end"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Filter Scope</span>
                </div>
                {activeSecondaryCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftSubUser('all')
                      setDraftInsurer('all')
                      setDraftPolicyType('all')
                      setDraftStatus64vb('all')
                      setDraftModel('all')
                      setDraftRm('all')
                      onResetFilters()
                      setFilterDropdownOpen(false)
                    }}
                    className="text-[11px] font-bold text-rose-600 hover:text-rose-700 cursor-pointer"
                  >
                    Reset All
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Branch / Sub-User */}
                {capabilities.hasSubUser && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Branch</label>
                    <Select value={draftSubUser} onValueChange={setDraftSubUser}>
                      <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                        <SelectValue placeholder="All Branches" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Branches</SelectItem>
                        {(filterOptions.subUsers || []).map((sub) => (
                          <SelectItem key={sub} value={sub}>
                            {sub}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Insurer */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Insurance Partner</label>
                  <Select value={draftInsurer} onValueChange={setDraftInsurer}>
                    <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                      <SelectValue placeholder="All Insurers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Insurers</SelectItem>
                      {(filterOptions.insuranceCompanies || []).map((ic) => (
                        <SelectItem key={ic} value={ic}>
                          {ic}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Model */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Vehicle Model</label>
                  <Select value={draftModel} onValueChange={setDraftModel}>
                    <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                      <SelectValue placeholder="All Models" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Models</SelectItem>
                      {(filterOptions.models || []).map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Policy Type */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Policy Type</label>
                  <Select value={draftPolicyType} onValueChange={setDraftPolicyType}>
                    <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="NEW">New Vehicle</SelectItem>
                      <SelectItem value="RENEWAL">Renewal</SelectItem>
                      {capabilities.hasRollover && <SelectItem value="ROLLOVER">Rollover</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>

                {/* Executive / RM */}
                {capabilities.hasRmName && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Executive / RM</label>
                    <Select value={draftRm} onValueChange={setDraftRm}>
                      <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                        <SelectValue placeholder="All Executives" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Executives</SelectItem>
                        {(filterOptions.executives || []).map((rm) => (
                          <SelectItem key={rm} value={rm}>
                            {rm}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* 64VB Status */}
                {capabilities.has64vb && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">64VB Compliance</label>
                    <Select value={draftStatus64vb} onValueChange={setDraftStatus64vb}>
                      <SelectTrigger className="h-8 rounded-xl text-xs mt-1">
                        <SelectValue placeholder="All Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="VERIFIED">Verified</SelectItem>
                        <SelectItem value="NOT VERIFIED">Pending / Unverified</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilterDropdownOpen(false)}
                  className="h-8 text-xs font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onApplyFilters({
                      subUser: draftSubUser,
                      insuranceCompany: draftInsurer,
                      policyType: draftPolicyType,
                      status64vb: draftStatus64vb,
                      modelName: draftModel,
                      rmName: draftRm,
                    })
                    setFilterDropdownOpen(false)
                  }}
                  className="h-8 text-xs font-bold bg-[var(--dashboard-primary)] text-white"
                >
                  Apply Filters
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Quick Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-8 rounded-xl border-slate-200 dark:border-slate-700 text-xs font-bold gap-1.5 shadow-2xs cursor-pointer"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-slate-500', isRefreshing && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          {/* Reset Filters Pill */}
          {(activeSecondaryCount > 0 || isCustomDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              className="h-8 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 gap-1 px-2.5 rounded-xl cursor-pointer"
            >
              <X className="h-3 w-3" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {/* Active Filter Chips */}
      {activeSecondaryCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px]">
          <span className="font-bold text-slate-400 text-[10px] uppercase tracking-wider mr-1">Active:</span>
          {appliedFilters.subUser !== 'all' && (
            <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
              Branch: {appliedFilters.subUser}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => onApplyFilters({ subUser: 'all' })}
              />
            </Badge>
          )}
          {appliedFilters.insuranceCompany !== 'all' && (
            <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
              Insurer: {appliedFilters.insuranceCompany}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => onApplyFilters({ insuranceCompany: 'all' })}
              />
            </Badge>
          )}
          {appliedFilters.modelName !== 'all' && (
            <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
              Model: {appliedFilters.modelName}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => onApplyFilters({ modelName: 'all' })}
              />
            </Badge>
          )}
          {appliedFilters.policyType !== 'all' && (
            <Badge variant="secondary" className="gap-1 font-bold bg-slate-100 dark:bg-slate-800">
              Type: {appliedFilters.policyType}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => onApplyFilters({ policyType: 'all' })}
              />
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
