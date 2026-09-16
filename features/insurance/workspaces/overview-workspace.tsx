'use client'

import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import {
  Building2,
  Car,
  TrendingUp,
  ShieldCheck,
  Layers,
  Fuel,
  CreditCard,
  UserCheck,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import { INSURANCE_BRANDS } from '@/lib/insurance/brands'

type Props = {
  brand: InsuranceBrandId
  summaryData: any
  isLoading: boolean
  onDrilldown?: (title: string, subtitle: string, filterKey?: string, filterVal?: string) => void
}

function formatInr(val?: number | null) {
  const n = Number(val || 0)
  if (!Number.isFinite(n) || n === 0) return '₹0'
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

const BRAND_PALETTES = ['#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4']

export function OverviewWorkspace({ brand, summaryData, isLoading, onDrilldown }: Props) {
  const brandConfig = INSURANCE_BRANDS[brand]

  // Monthly Trajectory Data (prefer full 12-24 month trajectory if single month filter is applied)
  const monthlyData = useMemo(() => {
    const traj = summaryData?.monthlyTrajectory || []
    const trend = summaryData?.monthlyTrend || []
    const raw = traj.length > 1 ? traj : trend.length > 0 ? trend : traj
    return raw.map((item: any) => ({
      month: item.monthLabel || item.monthKey || item.month || 'Month',
      premium: Number(item.grossPremium || item.gross_premium || 0),
      count: Number(item.policies || item.count || 0),
      newCount: Number(item.newCount || item.new_count || 0),
      renewalCount: Number(item.renewalCount || item.renewal_count || 0),
    }))
  }, [summaryData?.monthlyTrend, summaryData?.monthlyTrajectory])

  // Insurer Share Data (companyBreakdown)
  const insurerData = useMemo(() => {
    const raw = summaryData?.companyBreakdown || summaryData?.topInsurers || []
    const total = raw.reduce((sum: number, r: any) => sum + Number(r.grossPremium || r.premium || r.gross_premium || 0), 0)
    return raw.slice(0, 8).map((item: any, i: number) => {
      const prem = Number(item.grossPremium || item.premium || item.gross_premium || 0)
      return {
        name: item.company || item.name || 'Other Insurer',
        count: Number(item.policies || item.count || 0),
        premium: prem,
        share: item.sharePct !== undefined ? Number(item.sharePct) : total > 0 ? (prem / total) * 100 : 0,
        color: BRAND_PALETTES[i % BRAND_PALETTES.length],
      }
    })
  }, [summaryData?.companyBreakdown, summaryData?.topInsurers])

  // Model Breakdown Data (models / modelBreakdown)
  const modelData = useMemo(() => {
    const raw = summaryData?.models || summaryData?.modelBreakdown || summaryData?.topModels || []
    return raw.slice(0, 8).map((item: any) => ({
      name: item.model || item.name || 'Model',
      count: Number(item.count || item.policies || 0),
      premium: Number(item.grossPremium || item.premium || item.gross_premium || 0),
      sharePct: Number(item.sharePct || 0),
    }))
  }, [summaryData?.models, summaryData?.modelBreakdown, summaryData?.topModels])

  // Policy Type Breakdown Data (policyTypes / policyTypeDeep)
  const typeData = useMemo(() => {
    const raw = summaryData?.policyTypes || summaryData?.policyTypeBreakdown || summaryData?.policyTypeDeep || []
    return raw.map((item: any) => ({
      type: item.type || 'Standard',
      count: Number(item.count || item.totalCount || item.policies || 0),
      premium: Number(item.grossPremium || item.premium || 0),
      sharePct: Number(item.sharePct || item.premiumSharePct || 0),
    }))
  }, [summaryData?.policyTypes, summaryData?.policyTypeBreakdown, summaryData?.policyTypeDeep])

  // Fuel Types
  const fuelData = useMemo(() => {
    const raw = summaryData?.fuelTypes || []
    return raw.map((item: any) => ({
      fuel: item.fuel || 'Unknown',
      count: Number(item.count || 0),
      premium: Number(item.grossPremium || 0),
      sharePct: Number(item.sharePct || 0),
    }))
  }, [summaryData?.fuelTypes])

  // Top Executives
  const executiveData = useMemo(() => {
    const raw = summaryData?.executives || []
    return raw.slice(0, 6).map((item: any) => ({
      name: item.executive || 'Unassigned',
      policies: Number(item.policies || 0),
      premium: Number(item.grossPremium || 0),
      renewals: Number(item.renewals || 0),
      renewalPct: Number(item.renewalPct || 0),
    }))
  }, [summaryData?.executives])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-pulse">
        <div className="h-80 rounded-2xl bg-slate-100 dark:bg-slate-800" />
        <div className="h-80 rounded-2xl bg-slate-100 dark:bg-slate-800" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Row 1: Monthly Issuance Trajectory & Policy Type Breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly Issuance Trend Chart (2 Cols) */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Monthly Premium Trajectory & Historical Run-rate
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-medium">Gross Premium & Volume</span>
          </div>

          <div className="h-64 w-full">
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="premGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(0)}L` : String(v))}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload
                      return (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 p-2.5 shadow-lg text-xs backdrop-blur-xs">
                          <p className="font-bold text-slate-900 dark:text-slate-100">{label}</p>
                          <p className="text-teal-600 dark:text-teal-400 font-bold mt-1">
                            Gross: {formatInr(p.premium)}
                          </p>
                          <p className="text-slate-500 font-medium">{p.count} Policies Issued</p>
                          {p.renewalCount > 0 && (
                            <p className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px]">
                              {p.renewalCount} Renewals
                            </p>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="premium"
                    stroke="#0d9488"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#premGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                No monthly trajectory records available
              </div>
            )}
          </div>
        </div>

        {/* Policy Type Breakdown (1 Col) */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Policy Types
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-bold uppercase">Classification</span>
          </div>

          <div className="space-y-2.5 pt-1">
            {typeData.length > 0 ? (
              typeData.map((t: { type: string; count: number; premium: number; sharePct?: number }, idx: number) => (
                <div
                  key={t.type || idx}
                  onClick={() => onDrilldown?.(`${t.type} Policies`, 'Filtered by policy type', 'policyType', t.type)}
                  className="group cursor-pointer rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 p-3 transition-all hover:border-teal-500/50 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-teal-600">
                      {t.type}
                    </span>
                    <Badge variant="secondary" className="text-[10px] font-bold">
                      {formatCount(t.count)}
                      {t.sharePct ? ` (${t.sharePct.toFixed(0)}%)` : ''}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Gross: {formatInr(t.premium)}</span>
                    <span className="text-[10px] text-teal-600 font-semibold group-hover:underline">
                      Inspect →
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">No policy type data available</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2: Top Insurer Partners & Vehicle Models ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Insurer Partners Share */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                <Building2 className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Insurance Partner Share
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-bold uppercase">Volume & GWP</span>
          </div>

          <div className="space-y-3 pt-1">
            {insurerData.length > 0 ? (
              insurerData.map((ins: { name: string; count: number; premium: number; share: number; color: string }) => (
                <div key={ins.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]" title={ins.name}>
                      {ins.name}
                    </span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-500">{ins.count} units</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">{formatInr(ins.premium)}</span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-teal-600 dark:bg-teal-500 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(2, ins.share))}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">No insurer breakdown available</div>
            )}
          </div>
        </div>

        {/* Model-wise Breakdown */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                <Car className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Vehicle Model Distribution
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-bold uppercase">By Unit Volume</span>
          </div>

          <div className="space-y-2 pt-1 max-h-[340px] overflow-y-auto pr-1">
            {modelData.length > 0 ? (
              modelData.map((m: { name: string; count: number; premium: number }) => (
                <div
                  key={m.name}
                  onClick={() => onDrilldown?.(`${m.name} Policies`, 'Filtered by model', 'modelName', m.name)}
                  className="group cursor-pointer flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 transition-all hover:border-teal-500/50 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold">
                      {m.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-teal-600 block">
                        {m.name}
                      </span>
                      <span className="text-[10px] text-slate-400">Gross: {formatInr(m.premium)}</span>
                    </div>
                  </div>
                  <Badge variant="secondary" className="font-mono text-xs font-bold">
                    {formatCount(m.count)} units
                  </Badge>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">No model breakdown available</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 3: Fuel Type Mix & RM / Executive Leaderboard ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Fuel Types */}
        {fuelData.length > 0 && (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
                  <Fuel className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Fuel Type Distribution
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase">Volume Share</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              {fuelData.map((f: any) => (
                <div key={f.fuel} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{f.fuel}</span>
                    <Badge variant="outline" className="text-[10px] font-bold">
                      {f.sharePct ? `${f.sharePct.toFixed(0)}%` : `${formatCount(f.count)} units`}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-teal-600 dark:text-teal-400 font-semibold mt-1 block">
                    {formatInr(f.premium)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Executive / RM Leaderboard */}
        {executiveData.length > 0 && (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400">
                  <UserCheck className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Top Executive Performance
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase">RM Volume</span>
            </div>

            <div className="space-y-2 pt-1 max-h-56 overflow-y-auto pr-1">
              {executiveData.map((ex: any) => (
                <div key={ex.name} className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate max-w-[180px]">{ex.name}</span>
                    <span className="text-[10px] text-slate-400">{formatInr(ex.premium)} gross</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-slate-900 dark:text-slate-100 block">{formatCount(ex.policies)} policies</span>
                    {ex.renewals > 0 && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">{ex.renewals} renewals</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

