'use client'

import { useMemo } from 'react'
import { ScrapTransaction } from '@/lib/scrap-erp/types'
import {
  TrendingUp,
  DollarSign,
  Weight,
  Building,
  MapPin,
  Tag,
  ArrowUpRight,
  BarChart3,
  PieChart,
  CreditCard,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

export function ScrapExecutiveDashboardView({
  transactions,
  onDrilldown,
}: {
  transactions: ScrapTransaction[]
  onDrilldown: (title: string, filtered: ScrapTransaction[]) => void
}) {
  const metrics = useMemo(() => {
    const amountReceived = transactions.reduce((acc, t) => acc + Number(t.amountReceived || 0), 0)
    const totalRevenue = amountReceived
    const totalWeight = transactions.reduce((acc, t) => acc + Number(t.weightQty || 0), 0)
    const totalTxns = transactions.length
    const outstandingAmount = transactions.reduce((acc, t) => acc + Number(t.outstandingAmount || 0), 0)

    const avgSellingRate = totalWeight > 0 ? totalRevenue / totalWeight : 0
    const avgRevenuePerTxn = totalTxns > 0 ? totalRevenue / totalTxns : 0

    let cash = 0
    let online = 0
    let cheque = 0

    const locMap: Record<string, { amount: number; weight: number; count: number }> = {}
    const deptMap: Record<string, { amount: number; count: number }> = {}
    const typeMap: Record<string, { amount: number; weight: number; count: number }> = {}
    const groupMap: Record<string, { amount: number; count: number }> = {}

    transactions.forEach((t) => {
      const amt = Number(t.amountReceived || 0)
      const wt = Number(t.weightQty || 0)
      const pm = (t.paymentModeName || '').toLowerCase()
      if (pm.includes('cash')) cash += amt
      else if (pm.includes('cheque')) cheque += amt
      else online += amt

      const locName = t.locationName || 'Other Location'
      if (!locMap[locName]) locMap[locName] = { amount: 0, weight: 0, count: 0 }
      locMap[locName].amount += amt
      locMap[locName].weight += wt
      locMap[locName].count += 1

      const deptName = t.departmentName || 'SERVICE'
      if (!deptMap[deptName]) deptMap[deptName] = { amount: 0, count: 0 }
      deptMap[deptName].amount += amt
      deptMap[deptName].count += 1

      const typeName = t.scrapTypeName || 'Other'
      if (!typeMap[typeName]) typeMap[typeName] = { amount: 0, weight: 0, count: 0 }
      typeMap[typeName].amount += amt
      typeMap[typeName].weight += wt
      typeMap[typeName].count += 1

      const grpName = t.groupName || 'JAM'
      if (!groupMap[grpName]) groupMap[grpName] = { amount: 0, count: 0 }
      groupMap[grpName].amount += amt
      groupMap[grpName].count += 1
    })

    const topLocations = Object.entries(locMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)

    const topDepts = Object.entries(deptMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)

    const topTypes = Object.entries(typeMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)

    const topGroups = Object.entries(groupMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)

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
      topDepts,
      topTypes,
      topGroups,
    }
  }, [transactions])

  const maxLocAmount = metrics.topLocations[0]?.amount || 1
  const maxTypeAmount = metrics.topTypes[0]?.amount || 1

  return (
    <div className="space-y-6">
      {/* 3 Executive Rich KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Revenue */}
        <Card
          onClick={() => onDrilldown('Total Disposal Revenue', transactions)}
          className="cursor-pointer transition-all hover:shadow-lg border border-slate-200 dark:border-slate-800 border-t-4 border-t-emerald-500 bg-white dark:bg-slate-900 rounded-2xl p-1"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total Revenue
            </span>
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 p-2.5 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              {formatINR(metrics.totalRevenue)}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-medium border-t border-slate-100 dark:border-slate-800 pt-2">
              <span className="text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" /> {transactions.length} Sales Records
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Outstanding: <span className="font-extrabold text-rose-600">{formatINR(metrics.outstandingAmount)}</span>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Total Weight Disposed */}
        <Card
          onClick={() => onDrilldown('Total Weight Disposed', transactions)}
          className="cursor-pointer transition-all hover:shadow-lg border border-slate-200 dark:border-slate-800 border-t-4 border-t-teal-500 bg-white dark:bg-slate-900 rounded-2xl p-1"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Weight Disposed
            </span>
            <div className="rounded-xl bg-teal-50 dark:bg-teal-950/60 p-2.5 text-teal-600 dark:text-teal-400 border border-teal-200/60 dark:border-teal-800">
              <Weight className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              {metrics.totalWeight.toLocaleString('en-IN')}{' '}
              <span className="text-sm font-bold text-slate-500 dark:text-slate-400">Kg/Ltr</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-medium border-t border-slate-100 dark:border-slate-800 pt-2">
              <span className="font-extrabold text-teal-600 dark:text-teal-400">
                Avg Rate: ₹{metrics.avgSellingRate.toFixed(2)}/unit
              </span>
              <span className="text-slate-500 dark:text-slate-400">Avg/Txn: {formatINR(metrics.avgRevenuePerTxn)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Payment Breakdown */}
        <Card className="transition-all hover:shadow-lg border border-slate-200 dark:border-slate-800 border-t-4 border-t-cyan-500 bg-white dark:bg-slate-900 rounded-2xl p-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Payment Breakdown
            </span>
            <div className="rounded-xl bg-cyan-50 dark:bg-cyan-950/60 p-2.5 text-cyan-600 dark:text-cyan-400 border border-cyan-200/60 dark:border-cyan-800">
              <CreditCard className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xs font-black text-slate-900 dark:text-slate-100 space-y-2">
              <div
                onClick={() => onDrilldown('Cash Collections', transactions.filter((t) => (t.paymentModeName || '').toUpperCase() === 'CASH'))}
                className="flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 p-1 rounded-lg transition-colors"
                title="Click to view all Cash transactions"
              >
                <span className="text-slate-600 dark:text-slate-400 font-bold text-xs">Cash Collections:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-black">{formatINR(metrics.cash)}</span>
              </div>
              <div
                onClick={() => onDrilldown('Cheque Payments', transactions.filter((t) => (t.paymentModeName || '').toUpperCase() === 'CHEQUE'))}
                className="flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 p-1 rounded-lg transition-colors"
                title="Click to view all Cheque transactions"
              >
                <span className="text-slate-600 dark:text-slate-400 font-bold text-xs">Cheque Payments:</span>
                <span className="text-cyan-600 dark:text-cyan-400 font-black">{formatINR(metrics.cheque)}</span>
              </div>
              <div
                onClick={() => onDrilldown('Online / Bank Transfers', transactions.filter((t) => (t.paymentModeName || '').toUpperCase() === 'ONLINE'))}
                className="flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 p-1 rounded-lg transition-colors"
                title="Click to view all Online transactions"
              >
                <span className="text-slate-600 dark:text-slate-400 font-bold text-xs">Online / Bank:</span>
                <span className="text-teal-600 dark:text-teal-400 font-black">{formatINR(metrics.online)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analytics Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Locations Ranking */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100">
                Location Performance Ranking
              </CardTitle>
            </div>
            <Badge className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-extrabold text-[10px]">
              Top 8 Dealerships
            </Badge>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {metrics.topLocations.slice(0, 8).map((loc) => {
              const pct = (loc.amount / maxLocAmount) * 100
              const locTxns = transactions.filter((t) => t.locationName === loc.name)
              return (
                <div
                  key={loc.name}
                  onClick={() => onDrilldown(`Location: ${loc.name}`, locTxns)}
                  className="group cursor-pointer space-y-1.5 rounded-xl p-2.5 transition-all hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {loc.name}
                      <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600" />
                    </span>
                    <div className="text-right">
                      <span className="font-black text-slate-900 dark:text-slate-100">{formatINR(loc.amount)}</span>
                      <span className="ml-2 text-[10px] text-slate-500 font-medium">({loc.count} sales)</span>
                    </div>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-emerald-50 dark:bg-slate-800 border border-emerald-100 dark:border-slate-700">
                    <div
                      className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(8, Math.round((loc.amount / maxLocAmount) * 100)))}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Top Scrap Material Types */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100">
                Scrap Material Category Breakdown
              </CardTitle>
            </div>
            <Badge className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-extrabold text-[10px]">
              By Total Revenue
            </Badge>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {metrics.topTypes.map((st) => {
              const pct = (st.amount / maxTypeAmount) * 100
              const typeTxns = transactions.filter((t) => t.scrapTypeName === st.name)
              return (
                <div
                  key={st.name}
                  onClick={() => onDrilldown(`Material Type: ${st.name}`, typeTxns)}
                  className="group cursor-pointer space-y-1.5 rounded-xl p-2.5 transition-all hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {st.name}
                      <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-teal-600" />
                    </span>
                    <div className="text-right">
                      <span className="font-black text-slate-900 dark:text-slate-100">{formatINR(st.amount)}</span>
                      <span className="ml-2 text-[10px] text-slate-500 font-medium">
                        ({st.weight.toLocaleString('en-IN')} units)
                      </span>
                    </div>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-teal-50 dark:bg-slate-800 border border-teal-100 dark:border-slate-700">
                    <div
                      className="h-full bg-teal-600 dark:bg-teal-500 transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(8, Math.round((st.amount / maxTypeAmount) * 100)))}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* Department & Group Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Department Share */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100">
                Departmental Revenue Share
              </CardTitle>
            </div>
            <BarChart3 className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent className="pt-4 grid grid-cols-2 gap-3">
            {metrics.topDepts.map((d) => {
              const deptTxns = transactions.filter((t) => t.departmentName === d.name)
              return (
                <div
                  key={d.name}
                  onClick={() => onDrilldown(`Department: ${d.name}`, deptTxns)}
                  className="cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-3.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all space-y-1"
                >
                  <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 block">
                    {d.name}
                  </span>
                  <div className="text-base font-black text-slate-900 dark:text-slate-100">{formatINR(d.amount)}</div>
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{d.count} sales records</span>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Group Share */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <PieChart className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100">
                Group Valuation Share
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4 grid grid-cols-2 gap-3">
            {metrics.topGroups.map((g) => {
              const grpTxns = transactions.filter((t) => (t.groupName || 'JAM') === g.name)
              return (
                <div
                  key={g.name}
                  onClick={() => onDrilldown(`Group: ${g.name}`, grpTxns)}
                  className="cursor-pointer rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-3.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all space-y-1"
                >
                  <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 block">
                    {g.name} GROUP
                  </span>
                  <div className="text-base font-black text-slate-900 dark:text-slate-100">{formatINR(g.amount)}</div>
                  <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400">{g.count} transactions</span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
