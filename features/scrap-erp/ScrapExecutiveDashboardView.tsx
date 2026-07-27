'use client'

import { useMemo, useState } from 'react'
import { ScrapTransaction } from '@/lib/scrap-erp/types'
import {
  TrendingUp,
  DollarSign,
  Weight,
  CreditCard,
  Building,
  MapPin,
  Tag,
  ArrowUpRight,
  Calendar,
  Clock,
  Droplets,
  Container,
  Filter,
  RotateCcw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

function formatCompanyName(name: string) {
  const upper = String(name || '').toUpperCase().trim()
  if (upper === 'JAM' || upper === 'JAMMU AUTO MART' || upper === 'JAMMU AUTOMART') return 'JAMMU AUTOMART'
  return upper
}

// Scrap Type Aging Threshold Configuration
const SCRAP_AGING_CONFIG = [
  { key: 'USED OIL', label: 'USED OIL', threshold: 30, aliases: ['USED OIL', 'OIL'] },
  { key: 'CARDBOARD', label: 'CARDBOARD', threshold: 45, aliases: ['CARDBOARD', 'BOXES'] },
  { key: 'IRON', label: 'IRON', threshold: 60, aliases: ['IRON', 'STEEL', 'METAL'] },
  { key: 'WASTAGE PLASTIC', label: 'WASTAGE PLASTIC', threshold: 60, aliases: ['WASTAGE PLASTIC', 'PLASTIC', 'BUMPER'] },
  { key: 'OLD BATTERIES', label: 'OLD BATTERIES', threshold: 60, aliases: ['OLD BATTERIES', 'BATTERY', 'BATTERIES'] },
  { key: 'EMPTY BARREL', label: 'EMPTY BARREL', threshold: 90, aliases: ['EMPTY BARREL', 'BARREL', 'DRUM'] },
  { key: 'ALUMINIUM', label: 'ALUMINIUM', threshold: 90, aliases: ['ALUMINIUM', 'ALUMINUM'] },
  { key: 'BLACK PLASTIC', label: 'BLACK PLASTIC', threshold: 90, aliases: ['BLACK PLASTIC'] },
]

export function ScrapExecutiveDashboardView({
  transactions,
  onDrilldown,
}: {
  transactions: ScrapTransaction[]
  onDrilldown: (title: string, filtered: ScrapTransaction[]) => void
}) {
  const [agingFilter, setAgingFilter] = useState<'all' | 'on_schedule' | 'overdue' | 'investigate' | 'never'>('all')

  // Date Range Filter States
  const [startDateInput, setStartDateInput] = useState<string>('')
  const [endDateInput, setEndDateInput] = useState<string>('')
  const [appliedStartDate, setAppliedStartDate] = useState<string>('')
  const [appliedEndDate, setAppliedEndDate] = useState<string>('')
  const [activePreset, setActivePreset] = useState<string>('all')

  const handleApplyFilter = () => {
    setAppliedStartDate(startDateInput)
    setAppliedEndDate(endDateInput)
  }

  const handleResetFilter = () => {
    setStartDateInput('')
    setEndDateInput('')
    setAppliedStartDate('')
    setAppliedEndDate('')
    setActivePreset('all')
  }

  const handlePresetClick = (presetKey: string, start: string, end: string) => {
    setActivePreset(presetKey)
    setStartDateInput(start)
    setEndDateInput(end)
  }

  // Active Date-Filtered Transactions (Sorted Date High to Low -> Newest Sale First)
  const activeTxns = useMemo(() => {
    let list = transactions
    if (appliedStartDate || appliedEndDate) {
      list = transactions.filter((t) => {
        const d = t.soldDate || t.timestamp || t.createdAt
        if (!d) return false
        const dStr = d.slice(0, 10) // 'YYYY-MM-DD'

        if (appliedStartDate && dStr < appliedStartDate) return false
        if (appliedEndDate && dStr > appliedEndDate) return false
        return true
      })
    }
    return [...list].sort((a, b) => {
      const dA = new Date(a.soldDate || a.timestamp || a.createdAt || 0).getTime()
      const dB = new Date(b.soldDate || b.timestamp || b.createdAt || 0).getTime()
      return dB - dA
    })
  }, [transactions, appliedStartDate, appliedEndDate])

  // Top Metrics & Analytics Computation
  const metrics = useMemo(() => {
    const amountReceived = activeTxns.reduce((acc, t) => acc + Number(t.amountReceived || 0), 0)
    const totalRevenue = amountReceived
    const totalWeight = activeTxns.reduce((acc, t) => acc + Number(t.weightQty || 0), 0)
    const totalTxns = activeTxns.length
    const outstandingAmount = activeTxns.reduce((acc, t) => acc + Number(t.outstandingAmount || 0), 0)

    const avgSellingRate = totalWeight > 0 ? totalRevenue / totalWeight : 0
    const avgRevenuePerTxn = totalTxns > 0 ? totalRevenue / totalTxns : 0

    let cash = 0
    let online = 0
    let cheque = 0

    const locMap: Record<string, { amount: number; weight: number; count: number }> = {}
    const typeMap: Record<string, { amount: number; weight: number; count: number }> = {}
    const groupMap: Record<string, { amount: number; count: number }> = {}
    const monthMap: Record<string, { amount: number; weight: number; count: number; dateObj: Date }> = {}

    // Reference Date for relative calculations
    const now = new Date()

    activeTxns.forEach((t) => {
      const amt = Number(t.amountReceived || 0)
      const wt = Number(t.weightQty || 0)
      const pm = (t.paymentModeName || '').toLowerCase()
      
      // Payment Mode Breakdown calculations only start from July 2026
      const dateStr = (t.soldDate || t.timestamp || t.createdAt || '').slice(0, 10)
      if (dateStr >= '2026-07-01') {
        if (pm.includes('cash')) cash += amt
        else if (pm.includes('cheque')) cheque += amt
        else online += amt
      }

      // Location Breakdown
      const locName = t.locationName || 'Other Location'
      if (!locMap[locName]) locMap[locName] = { amount: 0, weight: 0, count: 0 }
      locMap[locName].amount += amt
      locMap[locName].weight += wt
      locMap[locName].count += 1

      // Scrap Type Breakdown
      const typeName = (t.scrapTypeName || 'OTHER').toUpperCase()
      if (!typeMap[typeName]) typeMap[typeName] = { amount: 0, weight: 0, count: 0 }
      typeMap[typeName].amount += amt
      typeMap[typeName].weight += wt
      typeMap[typeName].count += 1

      // Company / Group Breakdown
      const grpName = formatCompanyName(t.groupName || 'JAMMU AUTOMART')
      if (!groupMap[grpName]) groupMap[grpName] = { amount: 0, count: 0 }
      groupMap[grpName].amount += amt
      groupMap[grpName].count += 1

      // Monthly Trend Breakdown
      const d = t.soldDate || t.timestamp || t.createdAt
      if (d) {
        const dt = new Date(d)
        if (!isNaN(dt.getTime())) {
          const monthKey = dt.toLocaleString('en-IN', { month: 'short', year: '2-digit' })
          if (!monthMap[monthKey]) {
            monthMap[monthKey] = { amount: 0, weight: 0, count: 0, dateObj: dt }
          }
          monthMap[monthKey].amount += amt
          monthMap[monthKey].weight += wt
          monthMap[monthKey].count += 1
        }
      }
    })

    const topLocations = Object.entries(locMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)

    const topTypes = Object.entries(typeMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)

    const topGroups = Object.entries(groupMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)

    // Last 5 Months sorted chronologically
    const monthlyList = Object.entries(monthMap)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime())
      .slice(-5)

    return {
      totalRevenue,
      totalWeight,
      totalTransactions: totalTxns,
      amountReceived,
      outstandingAmount,
      avgSellingRate,
      avgRevenuePerTxn,
      cash,
      online,
      cheque,
      topLocations,
      topTypes,
      topGroups,
      monthlyList,
      now,
    }
  }, [activeTxns])

  // Highest values for bar scaling
  const maxMonthAmount = Math.max(...metrics.monthlyList.map((m) => m.amount), 1)
  const maxGroupAmount = Math.max(...metrics.topGroups.map((g) => g.amount), 1)
  const maxTypeAmount = Math.max(...metrics.topTypes.map((t) => t.amount), 1)

  // ── USED OIL BARREL SALES ANALYTICS COMPUTATION ──
  const oilAnalytics = useMemo(() => {
    const oilTxns = activeTxns.filter((t) => {
      const typeUpper = (t.scrapTypeName || '').toUpperCase()
      return typeUpper.includes('USED OIL') || typeUpper.includes('OIL')
    })

    const companyMonthMap: Record<
      string,
      Record<string, { barrels: number; revenue: number; txns: ScrapTransaction[] }>
    > = {}

    oilTxns.forEach((t) => {
      const company = formatCompanyName(t.groupName || 'JAMMU AUTOMART')
      const d = t.soldDate || t.timestamp || t.createdAt
      if (!d) return
      const dt = new Date(d)
      if (isNaN(dt.getTime())) return
      const monthLabel = dt.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
      const monthShort = dt.toLocaleString('en-IN', { month: 'short' })

      const unitUpper = (t.unit || '').toUpperCase()
      let barrelQty = Number(t.weightQty || 0)
      if (unitUpper === 'LTR' || unitUpper === 'LITER') {
        barrelQty = Math.max(1, Math.round(barrelQty / 200))
      }

      if (!companyMonthMap[company]) companyMonthMap[company] = {}
      if (!companyMonthMap[company][monthLabel]) {
        companyMonthMap[company][monthLabel] = { barrels: 0, revenue: 0, txns: [] }
      }
      if (!companyMonthMap[company]['ALL']) {
        companyMonthMap[company]['ALL'] = { barrels: 0, revenue: 0, txns: [] }
      }
      if (!companyMonthMap[company][monthShort]) {
        companyMonthMap[company][monthShort] = { barrels: 0, revenue: 0, txns: [] }
      }

      companyMonthMap[company][monthLabel].barrels += barrelQty
      companyMonthMap[company][monthLabel].revenue += Number(t.amountReceived || 0)
      companyMonthMap[company][monthLabel].txns.push(t)

      companyMonthMap[company]['ALL'].barrels += barrelQty
      companyMonthMap[company]['ALL'].revenue += Number(t.amountReceived || 0)
      companyMonthMap[company]['ALL'].txns.push(t)

      companyMonthMap[company][monthShort].barrels += barrelQty
      companyMonthMap[company][monthShort].revenue += Number(t.amountReceived || 0)
      companyMonthMap[company][monthShort].txns.push(t)
    })

    return {
      oilTxns,
      companyMonthMap,
    }
  }, [activeTxns])

  // Available Company List for Oil Barrels (from overview date-filtered activeTxns)
  const companyOilList = useMemo(() => {
    return Object.entries(oilAnalytics.companyMonthMap)
      .map(([company, monthData]) => {
        const allObj = monthData['ALL'] || { barrels: 0, revenue: 0, txns: [] }
        const aprilObj = monthData['April 2026'] || monthData['Apr'] || { barrels: 0, txns: [] }
        const mayObj = monthData['May 2026'] || monthData['May'] || { barrels: 0, txns: [] }
        const juneObj = monthData['June 2026'] || monthData['Jun'] || { barrels: 0, txns: [] }
        const julyObj = monthData['July 2026'] || monthData['Jul'] || { barrels: 0, txns: [] }

        const aprilBarrels = aprilObj.barrels
        const mayBarrels = mayObj.barrels
        const juneBarrels = juneObj.barrels
        const julyBarrels = julyObj.barrels

        const totalBarrels = allObj.barrels || (aprilBarrels + mayBarrels + juneBarrels + julyBarrels)

        return {
          company,
          selectedBarrels: allObj.barrels,
          revenue: allObj.revenue,
          txns: allObj.txns,
          aprilBarrels,
          mayBarrels,
          juneBarrels,
          julyBarrels,
          totalBarrels,
          aprilTxns: aprilObj.txns,
          mayTxns: mayObj.txns,
          juneTxns: juneObj.txns,
          julyTxns: julyObj.txns,
          allTxns: allObj.txns,
        }
      })
      .sort((a, b) => b.totalBarrels - a.totalBarrels)
  }, [oilAnalytics.companyMonthMap])

  const maxOilBarrels = Math.max(...companyOilList.map((c) => c.selectedBarrels), 1)

  const oilMatrixTotals = useMemo(() => {
    return companyOilList.reduce(
      (acc, row) => {
        acc.april += row.aprilBarrels
        acc.may += row.mayBarrels
        acc.june += row.juneBarrels
        acc.july += row.julyBarrels
        acc.total += row.totalBarrels
        acc.aprilTxns.push(...row.aprilTxns)
        acc.mayTxns.push(...row.mayTxns)
        acc.juneTxns.push(...row.juneTxns)
        acc.julyTxns.push(...row.julyTxns)
        acc.allTxns.push(...row.allTxns)
        return acc
      },
      {
        april: 0,
        may: 0,
        june: 0,
        july: 0,
        total: 0,
        aprilTxns: [] as ScrapTransaction[],
        mayTxns: [] as ScrapTransaction[],
        juneTxns: [] as ScrapTransaction[],
        julyTxns: [] as ScrapTransaction[],
        allTxns: [] as ScrapTransaction[],
      }
    )
  }, [companyOilList])

  const [agingCompanyFilter, setAgingCompanyFilter] = useState<string>('all')

  // Available Companies for Company-wise Aging Filter
  const availableCompanies = useMemo(() => {
    const set = new Set<string>()
    transactions.forEach((t) => {
      const c = formatCompanyName(t.groupName || 'JAMMU AUTOMART')
      if (c) set.add(c)
    })
    return Array.from(set).sort()
  }, [transactions])

  // Disposal Aging Heatmap Matrix Computation (ALL TIME, NEVER DATE FILTERED)
  const agingMatrix = useMemo(() => {
    let sourceTxns = transactions
    if (agingCompanyFilter !== 'all') {
      sourceTxns = transactions.filter(
        (t) => formatCompanyName(t.groupName || 'JAMMU AUTOMART') === agingCompanyFilter
      )
    }

    const locNames = Array.from(
      new Set(sourceTxns.map((t) => t.locationName).filter(Boolean))
    ).sort()

    const rows = locNames.map((locName) => {
      const locTxns = sourceTxns.filter((t) => t.locationName === locName)

      const cellData: Record<
        string,
        {
          days: number | null
          lastDateStr: string | null
          status: 'on_schedule' | 'overdue' | 'investigate' | 'never'
          txns: ScrapTransaction[]
        }
      > = {}

      SCRAP_AGING_CONFIG.forEach((cfg) => {
        const matchingTxns = locTxns.filter((t) => {
          const typeUpper = (t.scrapTypeName || '').toUpperCase()
          return cfg.aliases.some((alias) => typeUpper.includes(alias))
        })

        if (!matchingTxns.length) {
          cellData[cfg.key] = { days: null, lastDateStr: null, status: 'never', txns: [] }
          return
        }

        const sorted = [...matchingTxns].sort((a, b) => {
          const dA = new Date(a.soldDate || a.timestamp || a.createdAt).getTime()
          const dB = new Date(b.soldDate || b.timestamp || b.createdAt).getTime()
          return dB - dA
        })

        const latest = sorted[0]
        const latestDate = new Date(latest.soldDate || latest.timestamp || latest.createdAt)
        const diffMs = new Date().getTime() - latestDate.getTime()
        const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
        const lastDateStr = latestDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

        let status: 'on_schedule' | 'overdue' | 'investigate' | 'never' = 'on_schedule'
        if (days > cfg.threshold * 2) {
          status = 'investigate'
        } else if (days > cfg.threshold) {
          status = 'overdue'
        }

        cellData[cfg.key] = { days, lastDateStr, status, txns: matchingTxns }
      })

      return { locationName: locName, cellData }
    })

    return rows
  }, [transactions, agingCompanyFilter])

  return (
    <div className="space-y-6">
      {/* ── EXECUTIVE DATE RANGE FILTER BAR ── */}
      <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <CardContent className="p-4">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            {/* Title & Active Filter Info */}
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100">
                    Overview Date Range Filter
                  </h3>
                  {(appliedStartDate || appliedEndDate) && (
                    <Badge variant="outline" className="bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700 text-[10px] font-black">
                      Active: {activeTxns.length} of {transactions.length} Sales
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                  {appliedStartDate || appliedEndDate ? (
                    <span>Showing overview data from <strong className="text-slate-700 dark:text-slate-200">{appliedStartDate || 'Start'}</strong> to <strong className="text-slate-700 dark:text-slate-200">{appliedEndDate || 'Present'}</strong></span>
                  ) : (
                    <span>Showing all historical records ({transactions.length} total sales)</span>
                  )}
                </p>
              </div>
            </div>

            {/* Controls: Presets, Date Inputs & Apply Button */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Preset: All Time */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() => handlePresetClick('all', '', '')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer',
                    activePreset === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  )}
                >
                  All Time
                </button>
              </div>

              {/* Start & End Date Inputs */}
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/90 rounded-xl px-2.5 py-1 border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-extrabold uppercase text-slate-400">From:</span>
                  <input
                    type="date"
                    value={startDateInput}
                    onChange={(e) => {
                      setStartDateInput(e.target.value)
                      setActivePreset('custom')
                    }}
                    className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-hidden"
                  />
                </div>
                <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/90 rounded-xl px-2.5 py-1 border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] font-extrabold uppercase text-slate-400">To:</span>
                  <input
                    type="date"
                    value={endDateInput}
                    onChange={(e) => {
                      setEndDateInput(e.target.value)
                      setActivePreset('custom')
                    }}
                    className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Apply Button */}
              <button
                type="button"
                onClick={handleApplyFilter}
                className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-black px-4 py-2 rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer"
              >
                <Filter className="h-3.5 w-3.5" />
                Apply Filter
              </button>

              {/* Reset Button */}
              {(startDateInput || endDateInput || appliedStartDate || appliedEndDate) && (
                <button
                  type="button"
                  onClick={handleResetFilter}
                  title="Reset Date Filter"
                  className="inline-flex items-center gap-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold px-3 py-2 rounded-xl transition-all cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Top Executive KPI Summary Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Revenue */}
        <Card
          onClick={() => onDrilldown('Total Disposal Revenue', activeTxns)}
          className="cursor-pointer transition-all hover:shadow-md border border-slate-200 dark:border-slate-800 border-t-4 border-t-amber-600 bg-white dark:bg-slate-900 rounded-2xl p-1"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total Scrap Revenue
            </span>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/60 p-2.5 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              {formatINR(metrics.totalRevenue)}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-medium border-t border-slate-100 dark:border-slate-800 pt-2">
              <span className="text-amber-700 dark:text-amber-400 font-extrabold flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" /> {activeTxns.length} Total Sales
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Outstanding: <span className="font-extrabold text-rose-600">{formatINR(metrics.outstandingAmount)}</span>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Total Weight Disposed */}
        <Card
          onClick={() => onDrilldown('Total Weight Disposed', activeTxns)}
          className="cursor-pointer transition-all hover:shadow-md border border-slate-200 dark:border-slate-800 border-t-4 border-t-emerald-600 bg-white dark:bg-slate-900 rounded-2xl p-1"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Weight Disposed
            </span>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 p-2.5 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800">
              <Weight className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              {metrics.totalWeight.toLocaleString('en-IN')}{' '}
              <span className="text-sm font-bold text-slate-500 dark:text-slate-400">Kg/Ltr</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-medium border-t border-slate-100 dark:border-slate-800 pt-2">
              <span className="font-extrabold text-emerald-700 dark:text-emerald-400">
                Avg Rate: ₹{metrics.avgSellingRate.toFixed(2)}/unit
              </span>
              <span className="text-slate-500 dark:text-slate-400">Avg/Txn: {formatINR(metrics.avgRevenuePerTxn)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Payment Breakdown */}
        <Card className="transition-all hover:shadow-md border border-slate-200 dark:border-slate-800 border-t-4 border-t-slate-800 dark:border-t-slate-200 bg-white dark:bg-slate-900 rounded-2xl p-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Payment Method Breakdown
            </span>
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              <CreditCard className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xs font-black text-slate-900 dark:text-slate-100 space-y-1.5">
              <div
                onClick={() => onDrilldown('Cash Collections', activeTxns.filter((t) => (t.paymentModeName || '').toUpperCase().includes('CASH')))}
                className="flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 p-1.5 rounded-lg transition-colors"
              >
                <span className="text-slate-600 dark:text-slate-400 font-bold text-xs">Cash Collections:</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-black">{formatINR(metrics.cash)}</span>
              </div>
              <div
                onClick={() => onDrilldown('Cheque Payments', activeTxns.filter((t) => (t.paymentModeName || '').toUpperCase().includes('CHEQUE')))}
                className="flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 p-1.5 rounded-lg transition-colors"
              >
                <span className="text-slate-600 dark:text-slate-400 font-bold text-xs">Cheque Payments:</span>
                <span className="text-amber-700 dark:text-amber-400 font-black">{formatINR(metrics.cheque)}</span>
              </div>
              <div
                onClick={() => onDrilldown('Online / Bank Transfers', activeTxns.filter((t) => !(t.paymentModeName || '').toUpperCase().includes('CASH') && !(t.paymentModeName || '').toUpperCase().includes('CHEQUE')))}
                className="flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 p-1.5 rounded-lg transition-colors"
              >
                <span className="text-slate-600 dark:text-slate-400 font-bold text-xs">Online / Bank:</span>
                <span className="text-slate-900 dark:text-slate-100 font-black">{formatINR(metrics.online)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 2x2 EXECUTIVE ANALYTICS GRID (CLEAN THEME COLORS MATCHING ORIGINAL REFERENCE) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CARD 1: REVENUE BY MONTH */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden flex flex-col">
          <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Revenue by Month
              </CardTitle>
              <Calendar className="h-4 w-4 text-slate-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-4 pb-4 flex-1 flex flex-col min-h-0">
            {metrics.monthlyList.length > 0 ? (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Unified chart area — fills all available card height */}
                <div className="relative flex-1 min-h-0 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden px-4 pt-2 pb-0">
                  {/* Subtle horizontal gridlines */}
                  {[75, 50, 25].map((pct) => (
                    <div
                      key={pct}
                      className="absolute left-0 right-0 border-t border-slate-200/70 dark:border-slate-700/50"
                      style={{ bottom: `${pct}%` }}
                    />
                  ))}

                  {/* Bars row — all share the same chart floor */}
                  <div className="absolute inset-x-4 bottom-0 top-2 flex items-end justify-around gap-2">
                    {metrics.monthlyList.map((m, idx) => {
                      const isLatest = idx === metrics.monthlyList.length - 1
                      const heightPct = Math.max(8, Math.round((m.amount / maxMonthAmount) * 90))
                      const monthTxns = activeTxns.filter((t) => {
                        const d = t.soldDate || t.timestamp || t.createdAt
                        if (!d) return false
                        const dt = new Date(d)
                        return dt.toLocaleString('en-IN', { month: 'short', year: '2-digit' }) === m.month
                      })

                      return (
                        <div
                          key={m.month}
                          onClick={() => onDrilldown(`Month: ${m.month}`, monthTxns)}
                          style={{ height: `${heightPct}%` }}
                          className="group flex-1 flex flex-col items-center justify-start cursor-pointer"
                        >
                          {/* Value label sits at the very top of the bar */}
                          <span className="text-[10px] font-black text-slate-700 dark:text-slate-300 pt-1 tracking-tight group-hover:scale-105 transition-transform text-center leading-tight">
                            {(m.amount / 100000).toFixed(1)}L
                          </span>
                          {/* Bar fill — grows downward to take remaining height */}
                          <div
                            style={{ backgroundColor: isLatest ? '#b45309' : '#c67d0a' }}
                            className={cn(
                              'w-full flex-1 rounded-t-md transition-all duration-300 group-hover:brightness-110',
                              isLatest ? 'opacity-100' : 'opacity-85'
                            )}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Month labels below chart */}
                <div className="flex justify-around px-4 mt-2">
                  {metrics.monthlyList.map((m, idx) => {
                    const isLatest = idx === metrics.monthlyList.length - 1
                    return (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5">
                        <span className={cn('text-[11px] font-bold', isLatest ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400')}>
                          {m.month.split(' ')[0]}
                        </span>
                        {isLatest && (
                          <span className="text-[9px] font-black uppercase tracking-wide text-amber-600 dark:text-amber-500">
                            Current
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs font-medium text-slate-400">
                No monthly revenue records found.
              </div>
            )}
          </CardContent>
        </Card>

        {/* CARD 2: REVENUE BY COMPANY */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Revenue by Company
              </CardTitle>
              <Building className="h-4 w-4 text-slate-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-5 pb-4 space-y-3.5">
            {metrics.topGroups.slice(0, 7).map((grp) => {
              const companyName = formatCompanyName(grp.name)
              const grpTxns = activeTxns.filter((t) => formatCompanyName(t.groupName || '') === companyName)
              const pct = Math.max(10, Math.round((grp.amount / maxGroupAmount) * 100))

              return (
                <div
                  key={companyName}
                  onClick={() => onDrilldown(`Company: ${companyName}`, grpTxns)}
                  className="group cursor-pointer space-y-1 rounded-xl p-1.5 transition-all hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 tracking-wide flex items-center gap-1">
                      {companyName}
                      <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
                    </span>
                    <span className="font-black text-slate-900 dark:text-slate-100 tracking-tight">
                      {formatINR(grp.amount)}
                    </span>
                  </div>
                  {/* Progress Bar Container */}
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full bg-[#c67d0a] dark:bg-[#d98a0b] transition-all duration-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* CARD 3: REVENUE BY SCRAP TYPE */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Revenue by Scrap Type
              </CardTitle>
              <Tag className="h-4 w-4 text-slate-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-5 pb-4 space-y-3.5">
            {metrics.topTypes.slice(0, 7).map((st) => {
              const typeTxns = activeTxns.filter((t) => (t.scrapTypeName || 'OTHER').toUpperCase() === st.name)
              const pct = Math.max(10, Math.round((st.amount / maxTypeAmount) * 100))

              return (
                <div
                  key={st.name}
                  onClick={() => onDrilldown(`Scrap Type: ${st.name}`, typeTxns)}
                  className="group cursor-pointer space-y-1 rounded-xl p-1.5 transition-all hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 tracking-wide flex items-center gap-1">
                      {st.name}
                      <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600" />
                    </span>
                    <span className="font-black text-slate-900 dark:text-slate-100 tracking-tight">
                      {formatINR(st.amount)}
                    </span>
                  </div>
                  {/* Forest Green Progress Bar Fill */}
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full bg-[#2d7a58] dark:bg-[#34946b] transition-all duration-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* CARD 4: TOP LOCATIONS */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Top Locations
              </CardTitle>
              <MapPin className="h-4 w-4 text-slate-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-4 pb-4 divide-y divide-slate-100 dark:divide-slate-800">
            {metrics.topLocations.slice(0, 7).map((loc) => {
              const locTxns = activeTxns.filter((t) => t.locationName === loc.name)
              return (
                <div
                  key={loc.name}
                  onClick={() => onDrilldown(`Location: ${loc.name}`, locTxns)}
                  className="group cursor-pointer flex items-center justify-between py-2.5 px-1.5 transition-all hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                      {loc.name}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-xs text-slate-900 dark:text-slate-100">
                      {formatINR(loc.amount)}
                    </span>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* ── USED OIL BARREL SALES (COMPANY-WISE & MONTH-WISE) ── */}
      <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden border-l-4 border-l-amber-600">
        <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800 bg-amber-50/30 dark:bg-amber-950/20">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-100 dark:bg-amber-900/60 p-2.5 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                <Container className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  Used Oil Barrel Sales (Company & Month-Wise)
                </CardTitle>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                  Track oil barrel disposal quantities per company for the selected date range.
                </p>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5 pb-6 space-y-6">
          {/* Company Barrel Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {companyOilList.map((item) => (
              <div
                key={item.company}
                onClick={() => onDrilldown(`Used Oil Barrels: ${item.company}`, item.txns)}
                className="group cursor-pointer rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4 transition-all hover:shadow-md hover:border-amber-300 dark:hover:border-amber-700 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-slate-800 dark:text-slate-200 tracking-wide flex items-center gap-1">
                    {item.company}
                    <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-amber-600" />
                  </span>
                  <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 font-extrabold text-[10px]">
                    {appliedStartDate || appliedEndDate ? 'Filtered' : 'Total Barrels'}
                  </Badge>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-2xl font-black text-amber-700 dark:text-amber-400">
                      {item.selectedBarrels}{' '}
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {item.selectedBarrels === 1 ? 'Barrel' : 'Barrels'}
                      </span>
                    </div>
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                      Revenue: {formatINR(item.revenue)}
                    </div>
                  </div>
                  <Droplets className="h-5 w-5 text-amber-500 dark:text-amber-400 opacity-80" />
                </div>

                {/* Progress Bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full bg-amber-600 dark:bg-amber-500 transition-all duration-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(6, Math.round((item.selectedBarrels / maxOilBarrels) * 100)))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Used Oil Barrel Sales Matrix Table (Month-by-Month) */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
            <div className="bg-slate-900 text-white dark:bg-slate-800 px-4 py-3 border-b border-slate-800 dark:border-slate-700 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-100 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-amber-400" />
                Used Oil Barrel Sales Matrix (Month-by-Month)
              </span>
              <span className="text-[10px] font-bold text-slate-300">
                Quantity in Barrels
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-900 text-white dark:bg-slate-800 border-b border-slate-800 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider text-slate-100 border-r border-slate-800 dark:border-slate-700 bg-slate-900 dark:bg-slate-800">
                      COMPANY / GROUP
                    </th>
                    <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-slate-100">
                      APRIL
                    </th>
                    <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-slate-100">
                      MAY
                    </th>
                    <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-slate-100">
                      JUNE
                    </th>
                    <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-slate-100">
                      JULY
                    </th>
                    <th className="py-3 px-4 text-right font-black uppercase text-[10px] tracking-wider text-amber-400 bg-slate-800/80">
                      TOTAL BARRELS
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 font-medium">
                  {companyOilList.map((row) => (
                    <tr key={row.company} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-4 font-black text-slate-900 dark:text-slate-100 border-r border-slate-100 dark:border-slate-800">
                        {row.company}
                      </td>
                      <td
                        onClick={() => {
                          if (row.aprilBarrels > 0) {
                            onDrilldown(`Used Oil Barrels: ${row.company} · April 2026`, row.aprilTxns)
                          }
                        }}
                        className={cn('py-2.5 px-3 text-center font-extrabold', row.aprilBarrels > 0 ? 'cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/40' : '')}
                      >
                        {row.aprilBarrels > 0 ? (
                          <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 px-2.5 py-0.5 text-xs font-black shadow-2xs transition-transform hover:scale-105">
                            {row.aprilBarrels} Barrels
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td
                        onClick={() => {
                          if (row.mayBarrels > 0) {
                            onDrilldown(`Used Oil Barrels: ${row.company} · May 2026`, row.mayTxns)
                          }
                        }}
                        className={cn('py-2.5 px-3 text-center font-extrabold', row.mayBarrels > 0 ? 'cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/40' : '')}
                      >
                        {row.mayBarrels > 0 ? (
                          <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 px-2.5 py-0.5 text-xs font-black shadow-2xs transition-transform hover:scale-105">
                            {row.mayBarrels} Barrels
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td
                        onClick={() => {
                          if (row.juneBarrels > 0) {
                            onDrilldown(`Used Oil Barrels: ${row.company} · June 2026`, row.juneTxns)
                          }
                        }}
                        className={cn('py-2.5 px-3 text-center font-extrabold', row.juneBarrels > 0 ? 'cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/40' : '')}
                      >
                        {row.juneBarrels > 0 ? (
                          <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 px-2.5 py-0.5 text-xs font-black shadow-2xs transition-transform hover:scale-105">
                            {row.juneBarrels} Barrels
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td
                        onClick={() => {
                          if (row.julyBarrels > 0) {
                            onDrilldown(`Used Oil Barrels: ${row.company} · July 2026`, row.julyTxns)
                          }
                        }}
                        className={cn('py-2.5 px-3 text-center font-extrabold', row.julyBarrels > 0 ? 'cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/40' : '')}
                      >
                        {row.julyBarrels > 0 ? (
                          <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 px-2.5 py-0.5 text-xs font-black shadow-2xs transition-transform hover:scale-105">
                            {row.julyBarrels} Barrels
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                      <td
                        onClick={() => {
                          if (row.totalBarrels > 0) {
                            onDrilldown(`Used Oil Barrels: ${row.company} · All Months Total`, row.allTxns)
                          }
                        }}
                        className="py-2.5 px-4 text-right font-black text-amber-700 dark:text-amber-400 bg-amber-50/20 dark:bg-amber-950/20 cursor-pointer hover:bg-amber-100/40 dark:hover:bg-amber-900/40 transition-colors"
                      >
                        {row.totalBarrels} Barrels
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-900 text-white dark:bg-slate-800 border-t-2 border-slate-700 font-extrabold">
                  <tr>
                    <td className="py-3 px-4 font-black uppercase text-xs tracking-wider text-amber-400 border-r border-slate-800 dark:border-slate-700 bg-slate-900 dark:bg-slate-800">
                      GRAND TOTAL
                    </td>
                    <td
                      onClick={() => onDrilldown('Grand Total · Used Oil (April 2026)', oilMatrixTotals.aprilTxns)}
                      className="py-3 px-3 text-center text-xs font-black text-amber-300 cursor-pointer hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
                    >
                      {oilMatrixTotals.april} Barrels
                    </td>
                    <td
                      onClick={() => onDrilldown('Grand Total · Used Oil (May 2026)', oilMatrixTotals.mayTxns)}
                      className="py-3 px-3 text-center text-xs font-black text-amber-300 cursor-pointer hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
                    >
                      {oilMatrixTotals.may} Barrels
                    </td>
                    <td
                      onClick={() => onDrilldown('Grand Total · Used Oil (June 2026)', oilMatrixTotals.juneTxns)}
                      className="py-3 px-3 text-center text-xs font-black text-amber-300 cursor-pointer hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
                    >
                      {oilMatrixTotals.june} Barrels
                    </td>
                    <td
                      onClick={() => onDrilldown('Grand Total · Used Oil (July 2026)', oilMatrixTotals.julyTxns)}
                      className="py-3 px-3 text-center text-xs font-black text-amber-300 cursor-pointer hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
                    >
                      {oilMatrixTotals.july} Barrels
                    </td>
                    <td
                      onClick={() => onDrilldown('Grand Total · Used Oil (All Months Total)', oilMatrixTotals.allTxns)}
                      className="py-3 px-4 text-right text-xs font-black text-amber-400 bg-slate-800/90 dark:bg-slate-800 cursor-pointer hover:bg-amber-950/80 transition-colors"
                    >
                      {oilMatrixTotals.total} Barrels
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── DISPOSAL AGING HEATMAP MATRIX (MATCHING REFERENCE IMAGES 3 & 4) ── */}
      <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Clock className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
                Days since each scrap type was last sold, per location.
              </CardTitle>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                Click a cell for the last sale. Thresholds per type are set in Settings.
              </p>
            </div>

            {/* Controls: Company Filter Dropdown & Status Legend Pills */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Company Filter (No date filter applied) */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-700">
                <Building className="h-3.5 w-3.5 text-slate-500" />
                <select
                  value={agingCompanyFilter}
                  onChange={(e) => setAgingCompanyFilter(e.target.value)}
                  className="bg-transparent text-xs font-black text-slate-800 dark:text-slate-100 focus:outline-hidden cursor-pointer"
                >
                  <option value="all">All Companies</option>
                  {availableCompanies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Explicit 'All' Button to reset to all statuses */}
              <button
                type="button"
                onClick={() => setAgingFilter('all')}
                className={cn(
                  'rounded-full px-3.5 py-1 text-[11px] font-black transition-all border cursor-pointer flex items-center gap-1.5',
                  agingFilter === 'all'
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 shadow-xs'
                    : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-200'
                )}
              >
                <Filter className="h-3 w-3" />
                All
              </button>

              <button
                type="button"
                onClick={() => setAgingFilter(agingFilter === 'on_schedule' ? 'all' : 'on_schedule')}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-bold transition-all border cursor-pointer flex items-center gap-1.5',
                  agingFilter === 'on_schedule'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                )}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                On schedule
              </button>

              <button
                type="button"
                onClick={() => setAgingFilter(agingFilter === 'overdue' ? 'all' : 'overdue')}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-bold transition-all border cursor-pointer flex items-center gap-1.5',
                  agingFilter === 'overdue'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 hover:bg-amber-100'
                )}
              >
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Overdue
              </button>

              <button
                type="button"
                onClick={() => setAgingFilter(agingFilter === 'investigate' ? 'all' : 'investigate')}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-bold transition-all border cursor-pointer flex items-center gap-1.5',
                  agingFilter === 'investigate'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 hover:bg-rose-100'
                )}
              >
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                2× overdue – investigate
              </button>

              <button
                type="button"
                onClick={() => setAgingFilter(agingFilter === 'never' ? 'all' : 'never')}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-bold transition-all border cursor-pointer flex items-center gap-1.5',
                  agingFilter === 'never'
                    ? 'bg-slate-800 text-white border-slate-800 shadow-xs'
                    : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-200'
                )}
              >
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                Never sold
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto border-t border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-20 bg-slate-900 text-white dark:bg-slate-800 border-b border-slate-800 dark:border-slate-700">
                <tr>
                  <th className="py-3.5 px-4 font-black uppercase text-[10px] tracking-wider text-slate-100 min-w-[240px] sticky left-0 bg-slate-900 dark:bg-slate-800 z-30 border-r border-slate-800 dark:border-slate-700">
                    LOCATION
                  </th>
                  {SCRAP_AGING_CONFIG.map((cfg) => (
                    <th
                      key={cfg.key}
                      className="py-3.5 px-3 font-black text-center text-[10px] tracking-wider text-slate-100 whitespace-nowrap min-w-[120px]"
                    >
                      <div className="font-extrabold text-slate-100">{cfg.label}</div>
                      <div className="text-[9px] font-bold text-slate-300 opacity-80">≤{cfg.threshold}d</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 font-medium">
                {agingMatrix.map((row) => {
                  if (agingFilter !== 'all') {
                    const hasStatusMatch = SCRAP_AGING_CONFIG.some(
                      (cfg) => row.cellData[cfg.key]?.status === agingFilter
                    )
                    if (!hasStatusMatch) return null
                  }

                  return (
                    <tr
                      key={row.locationName}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Location Name Cell */}
                      <td className="py-2.5 px-4 font-black text-slate-900 dark:text-slate-100 sticky left-0 bg-white dark:bg-slate-900 z-10 border-r border-slate-200 dark:border-slate-800 text-[11px] whitespace-nowrap">
                        {row.locationName}
                      </td>

                      {/* Scrap Type Cells */}
                      {SCRAP_AGING_CONFIG.map((cfg) => {
                        const cell = row.cellData[cfg.key]
                        const isMatch = agingFilter === 'all' || cell?.status === agingFilter

                        if (!cell || cell.days === null) {
                          return (
                            <td key={cfg.key} className={cn('py-2.5 px-3 text-center transition-opacity', !isMatch && 'opacity-20')}>
                              {cell?.status === 'never' && agingFilter === 'never' ? (
                                <span className="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-extrabold bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900">
                                  Never
                                </span>
                              ) : (
                                <span className="text-slate-300 dark:text-slate-600 font-bold">-</span>
                              )}
                            </td>
                          )
                        }

                        let badgeStyle = ''
                        if (cell.status === 'on_schedule') {
                          badgeStyle = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        } else if (cell.status === 'overdue') {
                          badgeStyle = 'bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200 dark:border-amber-800 font-black scale-105 shadow-xs'
                        } else if (cell.status === 'investigate') {
                          badgeStyle = 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800 font-black scale-105 shadow-xs'
                        }

                        return (
                          <td key={cfg.key} className={cn('py-2.5 px-3 text-center transition-opacity', !isMatch && 'opacity-20')}>
                            <button
                              type="button"
                              onClick={() => onDrilldown(`${row.locationName} · ${cfg.label} (Last sold ${cell.lastDateStr})`, cell.txns)}
                              title={`Last sold: ${cell.lastDateStr || 'Unknown'} (${cell.days} days ago). Click to view details.`}
                              className={cn(
                                'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-[11px] font-bold border transition-all cursor-pointer hover:scale-105 shadow-2xs',
                                badgeStyle
                              )}
                            >
                              {cell.days}d
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
