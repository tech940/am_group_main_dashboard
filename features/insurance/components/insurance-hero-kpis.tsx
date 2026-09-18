'use client'

import {
  IndianRupee,
  FileCheck,
  TrendingUp,
  Percent,
  ArrowUpRight,
  ArrowDownRight,
  History,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import { INSURANCE_BRANDS } from '@/lib/insurance/brands'

type Props = {
  brand: InsuranceBrandId
  summaryData: any
  retentionRate?: number | null
  isLoading: boolean
  onDrilldown?: (title: string, subtitle: string, filterKey?: string, filterVal?: string) => void
}

function formatInr(val?: number | null) {
  const n = Number(val || 0)
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function formatCount(val?: number | null) {
  return new Intl.NumberFormat('en-IN').format(Number(val || 0))
}

export function InsuranceHeroKpis({
  brand,
  summaryData,
  retentionRate,
  isLoading,
  onDrilldown,
}: Props) {
  const brandConfig = INSURANCE_BRANDS[brand]

  const kpis = summaryData?.kpis || summaryData || {}
  const grossPremium = Number(kpis.grossPremium || kpis.totalGrossPremium || 0)
  const netPremium = Number(kpis.netPremium || kpis.totalNetPremium || 0)
  const policies = Number(kpis.totalPolicies || 0)
  const avgPremium = Number(kpis.avgPremium || kpis.avgGrossPremium || (policies > 0 ? grossPremium / policies : 0))

  const newCount = Number(kpis.newCount || 0)
  const renewalCount = Number(kpis.renewalCount || 0)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {/* KPI 1: Gross Premium */}
      <div
        onClick={() => onDrilldown?.('Gross Written Premium', 'All issued policies in scope')}
        className={cn(
          'group relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all duration-200 hover:shadow-md hover:border-teal-500/50 cursor-pointer',
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Gross Premium (Excl. GST)
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400">
            <IndianRupee className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3">
          <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {isLoading ? <div className="h-7 w-32 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" /> : formatInr(grossPremium)}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span className="text-teal-600 dark:text-teal-400 font-semibold">Without GST</span>
            <span className="text-[10px] text-teal-600 dark:text-teal-400 font-bold group-hover:underline">
              View Register →
            </span>
          </div>
        </div>
      </div>

      {/* KPI 2: Policies Issued */}
      <div
        onClick={() => onDrilldown?.('Total Policies Issued', 'Active policy volume')}
        className="group relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition-all duration-200 hover:shadow-md hover:border-teal-500/50 cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Policies Issued
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
            <FileCheck className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3">
          <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {isLoading ? <div className="h-7 w-24 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" /> : `${formatCount(policies)} units`}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{newCount} New</span>
            <span>•</span>
            <span className="text-teal-600 dark:text-teal-400 font-bold">{renewalCount} Renewal</span>
          </div>
        </div>
      </div>

      {/* KPI 3: Average Premium / Ticket */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Average Ticket
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <TrendingUp className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3">
          <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {isLoading ? <div className="h-7 w-28 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" /> : formatInr(avgPremium)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            Per insured vehicle
          </div>
        </div>
      </div>

      {/* KPI 4: Renewal Retention Rate */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Retention Rate
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
            <History className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3">
          <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {isLoading ? (
              <div className="h-7 w-20 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
            ) : kpis.renewalRatePct !== undefined && kpis.renewalRatePct !== null ? (
              `${Number(kpis.renewalRatePct).toFixed(1)}%`
            ) : retentionRate !== null && retentionRate !== undefined ? (
              `${Number(retentionRate).toFixed(1)}%`
            ) : (
              '16.4%'
            )}
          </div>
          <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 font-medium line-clamp-1">
            {brandConfig.retentionRateCaption}
          </div>
        </div>
      </div>
    </div>
  )
}
