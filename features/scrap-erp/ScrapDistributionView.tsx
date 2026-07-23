'use client'

import { useMemo, useState } from 'react'
import { ScrapTransaction } from '@/lib/scrap-erp/types'
import {
  calculateScrapDistribution,
  SHAREHOLDERS,
  ShareholderKey,
  getCompanyShareConfig,
} from '@/lib/scrap-erp/distribution'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Coins,
  UserCheck,
  CheckCircle2,
  Clock,
  Search,
  Building2,
  PieChart as PieChartIcon,
  Sparkles,
  ArrowUpRight,
  Filter,
  Check,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

function formatPercent(val: number) {
  if (Math.abs(val - 33.333333333333336) < 0.1) return '33.33%'
  return `${Number(val.toFixed(1))}%`
}

export function ScrapDistributionView({
  transactions,
  onDrilldown,
  onToggleDistribution,
}: {
  transactions: ScrapTransaction[]
  onDrilldown: (title: string, filtered: ScrapTransaction[]) => void
  onToggleDistribution?: (transactionId: string, currentStatus: boolean) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'distributed'>('all')

  // Filter records for July 2026 onwards & new entries (soldDate >= 2026-07-01 or new)
  const julyAndNewTxns = useMemo(() => {
    return transactions.filter((t) => {
      const d = t.soldDate || t.timestamp || t.createdAt
      if (!d) return true
      const dateStr = d.slice(0, 10) // 'YYYY-MM-DD'
      return dateStr >= '2026-07-01' || t.id.startsWith('tx-')
    })
  }, [transactions])

  // Filtered by search query & distribution status tab
  const displayedTxns = useMemo(() => {
    return julyAndNewTxns.filter((t) => {
      if (statusFilter === 'pending' && Boolean(t.isDistributed)) return false
      if (statusFilter === 'distributed' && !Boolean(t.isDistributed)) return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchNum = t.transactionNumber.toLowerCase().includes(q)
        const matchGroup = (t.groupName || '').toLowerCase().includes(q)
        const matchDesc = t.description.toLowerCase().includes(q)
        const matchType = t.scrapTypeName.toLowerCase().includes(q)
        const matchSoldBy = t.soldByName.toLowerCase().includes(q)
        if (!matchNum && !matchGroup && !matchDesc && !matchType && !matchSoldBy) {
          return false
        }
      }
      return true
    })
  }, [julyAndNewTxns, searchQuery, statusFilter])

  // Calculate overall distribution metrics for July+ transactions
  const julyDistribution = useMemo(() => {
    return calculateScrapDistribution(julyAndNewTxns)
  }, [julyAndNewTxns])

  // Distributed vs Pending Totals
  const distributedStats = useMemo(() => {
    let distributedAmt = 0
    let pendingAmt = 0
    let distributedCount = 0
    let pendingCount = 0

    julyAndNewTxns.forEach((t) => {
      const amt = Number(t.amountReceived || 0)
      if (t.isDistributed) {
        distributedAmt += amt
        distributedCount++
      } else {
        pendingAmt += amt
        pendingCount++
      }
    })

    return {
      distributedAmt,
      pendingAmt,
      distributedCount,
      pendingCount,
      totalCount: julyAndNewTxns.length,
    }
  }, [julyAndNewTxns])

  return (
    <div className="space-y-6">
      {/* ── Header Banner ── */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-amber-100 dark:bg-amber-950/80 p-2 text-amber-700 dark:text-amber-300">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                July+ Scrap Distribution & Manual Payouts
                <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800 text-[10px] font-black">
                  July 2026 Onwards
                </Badge>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                Calculated share split per shareholder. EBA/Staff execute manual payout and mark records as distributed below.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2 rounded-xl border border-emerald-200/80 dark:border-emerald-800 text-right">
            <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block">Distributed</span>
            <span className="text-sm font-black text-emerald-700 dark:text-emerald-300">{formatINR(distributedStats.distributedAmt)}</span>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2 rounded-xl border border-amber-200/80 dark:border-amber-800 text-right">
            <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest block">Pending Distribution</span>
            <span className="text-sm font-black text-amber-700 dark:text-amber-300">{formatINR(distributedStats.pendingAmt)}</span>
          </div>
        </div>
      </div>

      {/* ── Individual Partner July+ Share Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {SHAREHOLDERS.map((s) => {
          const personData = julyDistribution.personTotals[s.key]
          const pctOfTotal = julyDistribution.totalRevenue > 0 ? (personData.amount / julyDistribution.totalRevenue) * 100 : 0

          return (
            <Card
              key={s.key}
              onClick={() => onDrilldown(`July+ Scrap Share: ${personData.name}`, personData.txns)}
              className="cursor-pointer transition-all hover:shadow-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl overflow-hidden group"
            >
              <div className="h-1.5 w-full" style={{ backgroundColor: s.color }} />
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <UserCheck className="h-4 w-4" style={{ color: s.color }} />
                    {personData.name}
                  </CardTitle>
                  <CardDescription className="text-[11px] font-bold text-slate-400 mt-0.5">
                    July Share: {formatPercent(pctOfTotal)} of total July pool
                  </CardDescription>
                </div>
                <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold text-[10px] group-hover:bg-amber-100 group-hover:text-amber-900 transition-colors">
                  View Records <ArrowUpRight className="h-3 w-3 ml-0.5" />
                </Badge>
              </CardHeader>

              <CardContent className="pt-2 space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-2xl font-black tracking-tight" style={{ color: s.color }}>
                    {formatINR(personData.amount)}
                  </div>
                  <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                    {personData.txns.length} July sales
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* ── July+ Transactions Manual Distribution Action Table ── */}
      <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Coins className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                July+ Manual Distribution Entries ({displayedTxns.length} records)
              </CardTitle>
              <CardDescription className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                Review shareholder split per transaction and click the action button to log manual distribution.
              </CardDescription>
            </div>

            {/* Controls: Search & Status Filter Tabs */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-48 sm:w-64">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search July entries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-8 text-xs font-bold bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer',
                    statusFilter === 'all'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400'
                  )}
                >
                  All ({julyAndNewTxns.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('pending')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer',
                    statusFilter === 'pending'
                      ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-xs border border-slate-200 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400'
                  )}
                >
                  Pending ({distributedStats.pendingCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('distributed')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer',
                    statusFilter === 'distributed'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs border border-slate-200 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400'
                  )}
                >
                  Distributed ({distributedStats.distributedCount})
                </button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-900 text-white dark:bg-slate-800 border-b border-slate-800 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider text-slate-100">
                    TXN / DATE
                  </th>
                  <th className="py-3 px-4 font-black uppercase text-[10px] tracking-wider text-slate-100">
                    COMPANY & DETAILS
                  </th>
                  <th className="py-3 px-3 text-right font-black uppercase text-[10px] tracking-wider text-amber-400">
                    COLLECTED (₹)
                  </th>
                  <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-sky-300 border-l border-slate-800 dark:border-slate-700">
                    SANJAY SHARE
                  </th>
                  <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-emerald-300 border-l border-slate-800 dark:border-slate-700">
                    ANKUR SHARE
                  </th>
                  <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-amber-300 border-l border-slate-800 dark:border-slate-700">
                    SANJEEV SHARE
                  </th>
                  <th className="py-3 px-4 text-center font-black uppercase text-[10px] tracking-wider text-slate-100 border-l border-slate-800 dark:border-slate-700">
                    DISTRIBUTION ACTION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 font-medium">
                {displayedTxns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 font-bold">
                      No July distribution records found matching criteria.
                    </td>
                  </tr>
                ) : (
                  displayedTxns.map((t) => {
                    const rawGroup = t.groupName || 'JAM'
                    const { displayName, shares } = getCompanyShareConfig(rawGroup)
                    const amt = Number(t.amountReceived || 0)

                    const sanjayShare = (amt * (shares.sanjay || 0)) / 100
                    const ankurShare = (amt * (shares.ankur || 0)) / 100
                    const sanjeevShare = (amt * (shares.sanjeev || 0)) / 100

                    const isDone = Boolean(t.isDistributed)

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-black text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          <div>#{t.transactionNumber}</div>
                          <div className="text-[10px] text-slate-400 font-semibold">{t.soldDate || t.timestamp?.slice(0, 10)}</div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-slate-400" />
                            {displayName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs font-semibold">
                            {t.scrapTypeName} · {t.description}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right font-black text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatINR(amt)}
                        </td>

                        {/* Share splits */}
                        <td className="py-3 px-3 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap font-bold text-sky-700 dark:text-sky-400">
                          {sanjayShare > 0 ? (
                            <div>
                              <div>{formatINR(sanjayShare)}</div>
                              <div className="text-[9px] text-sky-600/70 dark:text-sky-400/70 font-black">({formatPercent(shares.sanjay)})</div>
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">-</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400">
                          {ankurShare > 0 ? (
                            <div>
                              <div>{formatINR(ankurShare)}</div>
                              <div className="text-[9px] text-emerald-600/70 dark:text-emerald-400/70 font-black">({formatPercent(shares.ankur)})</div>
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">-</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap font-bold text-amber-700 dark:text-amber-400">
                          {sanjeevShare > 0 ? (
                            <div>
                              <div>{formatINR(sanjeevShare)}</div>
                              <div className="text-[9px] text-amber-600/70 dark:text-amber-400/70 font-black">({formatPercent(shares.sanjeev)})</div>
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">-</span>
                          )}
                        </td>

                        {/* Distribution Action Button */}
                        <td className="py-3 px-4 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap">
                          {isDone ? (
                            <div className="flex items-center justify-center gap-2">
                              <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 font-extrabold text-[10px] px-2.5 py-1 inline-flex items-center gap-1 border border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                Distributed
                              </Badge>
                              {onToggleDistribution && (
                                <button
                                  type="button"
                                  onClick={() => onToggleDistribution(t.id, true)}
                                  title="Undo distribution status"
                                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (onToggleDistribution) {
                                  onToggleDistribution(t.id, false)
                                }
                              }}
                              className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-3 py-1.5 rounded-xl transition-all shadow-2xs active:scale-95 cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Mark as Distributed
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
