'use client'

import { useMemo, useState } from 'react'
import { ScrapTransaction, ScrapHandoverUser } from '@/lib/scrap-erp/types'
import { DEFAULT_SCRAP_HANDOVER_USERS } from '@/lib/scrap-erp/mock-data'
import {
  calculateScrapDistribution,
  getCompanyShareConfig,
} from '@/lib/scrap-erp/distribution'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Coins,
  CheckCircle2,
  Search,
  Building2,
  Check,
  RotateCcw,
  Landmark,
  UserCheck,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

export function ScrapDistributionView({
  transactions,
  handoverUsers = [],
  onDrilldown,
  onToggleDistribution,
}: {
  transactions: ScrapTransaction[]
  handoverUsers?: ScrapHandoverUser[]
  onDrilldown: (title: string, filtered: ScrapTransaction[]) => void
  onToggleDistribution?: (
    transactionId: string,
    currentStatus: boolean,
    customPayload?: Partial<ScrapTransaction>
  ) => void
}) {
  console.log('ScrapDistributionView received transactions count:', transactions.length)
  console.log('ScrapDistributionView sentToAccounts count:', transactions.filter(t => (t as any).sentToAccounts).length)
  console.log('ScrapDistributionView sentToAccounts items:', transactions.filter(t => (t as any).sentToAccounts).map(t => ({ num: t.transactionNumber, date: t.soldDate, sent: (t as any).sentToAccounts })))

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'distributed' | 'accounts'>('all')

  // Modal State for "Mark as Distributed"
  const [selectedTxnForDist, setSelectedTxnForDist] = useState<ScrapTransaction | null>(null)
  const [distTarget, setDistTarget] = useState<'md' | 'accounts'>('md')
  const [selectedHandoverUserId, setSelectedHandoverUserId] = useState<string>('')
  const [handoverSearch, setHandoverSearch] = useState<string>('')
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false)

  // Eligible handover users: exact same list from Scrap Entry Form, with "CASH HANDOVER TO MD" REMOVED
  const eligibleAccountsHandoverUsers = useMemo(() => {
    const list = handoverUsers.length > 0 ? handoverUsers : DEFAULT_SCRAP_HANDOVER_USERS
    return list.filter((u) => {
      const nameUpper = (u.name || '').toUpperCase()
      return !nameUpper.includes('CASH HANDOVER TO MD') && !nameUpper.includes('HANDOVER TO MD')
    })
  }, [handoverUsers])

  // Filtered dropdown items based on search input
  const filteredHandoverUsers = useMemo(() => {
    if (!handoverSearch.trim()) return eligibleAccountsHandoverUsers
    const q = handoverSearch.toLowerCase()
    return eligibleAccountsHandoverUsers.filter((u) => u.name.toLowerCase().includes(q))
  }, [eligibleAccountsHandoverUsers, handoverSearch])

  // ── Distribution Start Date ── Only records from 1 July 2026 onwards
  const DISTRIBUTION_START_DATE = '2026-07-01'

  const julyAndNewTxns = useMemo(() => {
    const list = transactions.filter((t) => {
      const isSentToAccounts = Boolean((t as ScrapTransaction & { sentToAccounts?: boolean }).sentToAccounts)
      const isDistributed = Boolean(t.isDistributed)
      
      const dateStr = (t.soldDate || t.timestamp || t.createdAt || '').slice(0, 10)
      return dateStr >= DISTRIBUTION_START_DATE || isSentToAccounts || isDistributed
    })

    return [...list].sort((a, b) => {
      const dA = new Date(a.soldDate || a.timestamp || a.createdAt || 0).getTime()
      const dB = new Date(b.soldDate || b.timestamp || b.createdAt || 0).getTime()
      return dB - dA
    })
  }, [transactions])

  // Filtered by search query & distribution status tab
  const displayedTxns = useMemo(() => {
    return julyAndNewTxns.filter((t) => {
      const isSentToAccounts = Boolean((t as ScrapTransaction & { sentToAccounts?: boolean }).sentToAccounts)

      if (statusFilter === 'accounts') return isSentToAccounts
      if (isSentToAccounts) return false // hide accounts-routed records from all other tabs

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

  // Distributed vs Pending vs Accounts Totals
  const distributedStats = useMemo(() => {
    let distributedAmt = 0
    let pendingAmt = 0
    let distributedCount = 0
    let pendingCount = 0
    let accountsAmt = 0
    let accountsCount = 0

    julyAndNewTxns.forEach((t) => {
      const amt = Number(t.amountReceived || 0)
      const isSentToAccounts = Boolean((t as ScrapTransaction & { sentToAccounts?: boolean }).sentToAccounts)
      if (isSentToAccounts) {
        accountsAmt += amt
        accountsCount++
      } else if (t.isDistributed) {
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
      accountsAmt,
      accountsCount,
      totalCount: julyAndNewTxns.length,
    }
  }, [julyAndNewTxns])

  const handleOpenDistributionModal = (txn: ScrapTransaction) => {
    setSelectedTxnForDist(txn)
    setDistTarget('md')
    setHandoverSearch('')
    setSelectedHandoverUserId(eligibleAccountsHandoverUsers[0]?.id || '')
    setIsDropdownOpen(false)
  }

  const handleConfirmDistributionModal = () => {
    if (!selectedTxnForDist || !onToggleDistribution) return

    if (distTarget === 'md') {
      // Option 1: Handover to MD -> Mark as distributed directly
      onToggleDistribution(selectedTxnForDist.id, false, {
        isDistributed: true,
        sentToAccounts: false,
        distributedAt: new Date().toISOString(),
      })
    } else {
      // Option 2: Accounts department -> Route directly to Accounts under selected handover user
      const selectedUserObj = eligibleAccountsHandoverUsers.find((u) => u.id === selectedHandoverUserId) || eligibleAccountsHandoverUsers[0]
      const handoverName = selectedUserObj ? selectedUserObj.name : (handoverSearch.trim() || 'Accounts Department')
      const handoverId = selectedUserObj ? selectedUserObj.id : 'ho-accounts'

      onToggleDistribution(selectedTxnForDist.id, false, {
        isDistributed: false,
        sentToAccounts: true,
        accountsReceivedAt: new Date().toISOString(),
        paymentHandoverToId: handoverId,
        paymentHandoverToName: handoverName,
        accountsNote: `Received directly in accounts via ${handoverName}`,
      })
    }

    setSelectedTxnForDist(null)
  }

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
          <div className="bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2 rounded-xl border border-amber-200/80 dark:border-amber-800 text-right">
            <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest block flex items-center justify-end gap-1">
              Pending ({distributedStats.pendingCount})
            </span>
            <span className="text-sm font-black text-amber-700 dark:text-amber-300">{formatINR(distributedStats.pendingAmt)}</span>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2 rounded-xl border border-emerald-200/80 dark:border-emerald-800 text-right">
            <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block flex items-center justify-end gap-1">
              Distributed ({distributedStats.distributedCount})
            </span>
            <span className="text-sm font-black text-emerald-700 dark:text-emerald-300">{formatINR(distributedStats.distributedAmt)}</span>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/40 px-3.5 py-2 rounded-xl border border-blue-200/80 dark:border-blue-800 text-right">
            <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest block flex items-center justify-end gap-1">
              <Landmark className="h-3 w-3 inline" /> Direct Accounts ({distributedStats.accountsCount})
            </span>
            <span className="text-sm font-black text-blue-700 dark:text-blue-300">{formatINR(distributedStats.accountsAmt)}</span>
          </div>
        </div>
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
                  All ({distributedStats.pendingCount + distributedStats.distributedCount})
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
                <button
                  type="button"
                  onClick={() => setStatusFilter('accounts')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1',
                    statusFilter === 'accounts'
                      ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs border border-slate-200 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400'
                  )}
                >
                  <Landmark className="h-3 w-3" />
                  Accounts ({distributedStats.accountsCount})
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
                    SANJAY SIR
                  </th>
                  <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-emerald-300 border-l border-slate-800 dark:border-slate-700">
                    ANKUR SIR
                  </th>
                  <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-amber-300 border-l border-slate-800 dark:border-slate-700">
                    SANJEEV SIR
                  </th>
                  <th className="py-3 px-3 text-center font-black uppercase text-[10px] tracking-wider text-violet-300 border-l border-slate-800 dark:border-slate-700">
                    TARUN SIR
                  </th>
                  <th className="py-3 px-4 text-center font-black uppercase text-[10px] tracking-wider text-slate-100 border-l border-slate-800 dark:border-slate-700">
                    DISTRIBUTION ACTION
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 font-medium">
                {displayedTxns.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-bold">
                      No July distribution records found matching criteria.
                    </td>
                  </tr>
                ) : (
                  displayedTxns.map((t) => {
                    const rawGroup = t.groupName || 'JAM'
                    const { displayName, shares } = getCompanyShareConfig(rawGroup)
                    const amt = Number(t.amountReceived || 0)
                    const isSentToAccounts = Boolean((t as ScrapTransaction & { sentToAccounts?: boolean }).sentToAccounts)

                    const sanjayShare = (amt * (shares.sanjay || 0)) / 100
                    const ankurShare = (amt * (shares.ankur || 0)) / 100
                    const sanjeevShare = (amt * (shares.sanjeev || 0)) / 100
                    const tarunShare = (amt * (shares.tarun || 0)) / 100

                    const isDone = Boolean(t.isDistributed)

                    return (
                      <tr key={t.id} className={cn(
                        'hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors',
                        isSentToAccounts && 'bg-blue-50/50 dark:bg-blue-950/20'
                      )}>
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

                        {/* Share splits — hidden for accounts-routed records */}
                        {isSentToAccounts ? (
                          <td colSpan={4} className="py-3 px-4 text-center border-l border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-center gap-1.5">
                              <Landmark className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                              <span className="text-xs font-black text-blue-700 dark:text-blue-400 italic">
                                Revenue routed to accounts
                              </span>
                            </div>
                          </td>
                        ) : (
                          <>
                            <td className="py-3 px-3 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap font-extrabold text-sky-700 dark:text-sky-400">
                              {sanjayShare > 0 ? formatINR(sanjayShare) : <span className="text-slate-300 dark:text-slate-600">-</span>}
                            </td>

                            <td className="py-3 px-3 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap font-extrabold text-emerald-700 dark:text-emerald-400">
                              {ankurShare > 0 ? formatINR(ankurShare) : <span className="text-slate-300 dark:text-slate-600">-</span>}
                            </td>

                            <td className="py-3 px-3 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap font-bold text-amber-700 dark:text-amber-400">
                              {sanjeevShare > 0 ? formatINR(sanjeevShare) : <span className="text-slate-300 dark:text-slate-600">-</span>}
                            </td>

                            <td className="py-3 px-3 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap font-bold text-violet-700 dark:text-violet-400">
                              {tarunShare > 0 ? formatINR(tarunShare) : <span className="text-slate-300 dark:text-slate-600">-</span>}
                            </td>
                          </>
                        )}

                        {/* Distribution Action Button */}
                        <td className="py-3 px-4 text-center border-l border-slate-100 dark:border-slate-800 whitespace-nowrap">
                          {isSentToAccounts ? (
                             <div className="flex items-center justify-center gap-1.5">
                              <Badge className="bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300 font-extrabold text-[10px] px-2.5 py-1 inline-flex items-center gap-1 border border-blue-300 dark:border-blue-800">
                                <Landmark className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                                Received in Accounts
                              </Badge>
                              {onToggleDistribution && (
                                <button
                                  type="button"
                                  onClick={() => onToggleDistribution(t.id, false, { sentToAccounts: false, accountsReceivedAt: undefined })}
                                  title="Undo accounts status"
                                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ) : isDone ? (
                            <div className="flex items-center justify-center gap-2">
                              <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 font-extrabold text-[10px] px-2.5 py-1 inline-flex items-center gap-1 border border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                Distributed
                              </Badge>
                              {onToggleDistribution && (
                                <button
                                  type="button"
                                  onClick={() => onToggleDistribution(t.id, true, { isDistributed: false })}
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
                              onClick={() => handleOpenDistributionModal(t)}
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

      {/* ── Interactive Distribution Choice Modal ── */}
      <Dialog open={Boolean(selectedTxnForDist)} onOpenChange={(open) => !open && setSelectedTxnForDist(null)}>
        <DialogContent className="max-w-lg rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-600" />
              Distribution Target for #{selectedTxnForDist?.transactionNumber}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium mt-1">
              Select how the proceeds (₹{selectedTxnForDist?.amountReceived.toLocaleString('en-IN')}) for{' '}
              <strong>{selectedTxnForDist?.locationName}</strong> will be processed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-3">
            {/* Target Options Radio Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Option A: Handover to MD */}
              <div
                onClick={() => setDistTarget('md')}
                className={cn(
                  'p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2',
                  distTarget === 'md'
                    ? 'border-amber-600 bg-amber-50/50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center font-black">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  {distTarget === 'md' && <Check className="h-4 w-4 text-amber-600" />}
                </div>
                <div>
                  <div className="text-xs font-black">Handover to MD</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                    Distributed to Directors / Shareholders
                  </div>
                </div>
              </div>

              {/* Option B: Accounts Department */}
              <div
                onClick={() => setDistTarget('accounts')}
                className={cn(
                  'p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2',
                  distTarget === 'accounts'
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-black">
                    <Landmark className="h-4 w-4" />
                  </div>
                  {distTarget === 'accounts' && <Check className="h-4 w-4 text-blue-600" />}
                </div>
                <div>
                  <div className="text-xs font-black">Accounts Department</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                    Received directly into Branch Accounts
                  </div>
                </div>
              </div>
            </div>

            {/* Option Details & Inputs */}
            {distTarget === 'md' ? (
              <div className="p-3 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 rounded-xl text-xs text-amber-900 dark:text-amber-300 font-semibold">
                ✓ Record will be logged as <strong>Distributed</strong> under the standard shareholder split formula for{' '}
                {selectedTxnForDist?.groupName || 'this company'}.
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <label className="text-xs font-black text-slate-800 dark:text-slate-200 block">
                  Select Payment Handover Person / Account:
                </label>
                <div className="relative">
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="Type to filter or choose handover account..."
                      value={handoverSearch}
                      onChange={(e) => {
                        setHandoverSearch(e.target.value)
                        setIsDropdownOpen(true)
                      }}
                      onFocus={() => setIsDropdownOpen(true)}
                      className="pr-8 h-9 text-xs font-bold bg-white dark:bg-slate-900 rounded-xl border-slate-300 dark:border-slate-700"
                    />
                    <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>

                  {/* Filtered Dropdown Options List */}
                  {isDropdownOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-1 divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredHandoverUsers.length === 0 ? (
                        <div className="p-2 text-center text-xs text-slate-400 font-semibold italic">
                          No matching handover user found. Custom entry "{handoverSearch}" will be used.
                        </div>
                      ) : (
                        filteredHandoverUsers.map((ho) => {
                          const isSelected = selectedHandoverUserId === ho.id
                          return (
                            <div
                              key={ho.id}
                              onClick={() => {
                                setSelectedHandoverUserId(ho.id)
                                setHandoverSearch(ho.name)
                                setIsDropdownOpen(false)
                              }}
                              className={cn(
                                'px-3 py-2 text-xs font-extrabold cursor-pointer rounded-lg transition-colors flex items-center justify-between',
                                isSelected
                                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                              )}
                            >
                              <span>{ho.name}</span>
                              {isSelected && <Check className="h-3.5 w-3.5 text-blue-600" />}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 font-semibold italic">
                  Note: "CASH HANDOVER TO MD" is excluded from this Accounts dropdown.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedTxnForDist(null)}
              className="rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmDistributionModal}
              className={cn(
                'rounded-xl text-xs font-black px-4 shadow-sm border-0 cursor-pointer text-white',
                distTarget === 'md' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              {distTarget === 'md' ? 'Confirm MD Distribution' : 'Confirm Accounts Handover'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
