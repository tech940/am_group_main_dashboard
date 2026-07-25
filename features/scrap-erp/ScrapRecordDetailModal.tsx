'use client'

import { ScrapTransaction } from '@/lib/scrap-erp/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Building2,
  DollarSign,
  UserCheck,
  CreditCard,
  User,
  Calendar,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  ArrowLeft,
  Coins,
} from 'lucide-react'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

export function ScrapRecordDetailModal({
  transaction,
  isOpen,
  onClose,
  onBack,
  onOpenGallery,
  onEditRecord,
}: {
  transaction: ScrapTransaction | null
  isOpen: boolean
  onClose: () => void
  onBack?: () => void
  onOpenGallery?: (txn: ScrapTransaction) => void
  onEditRecord?: (txn: ScrapTransaction) => void
}) {
  if (!transaction) return null

  const isDue = Math.round(Number(transaction.outstandingAmount || 0)) >= 1
  const handleBack = onBack || onClose

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[96vw] xl:max-w-6xl 2xl:max-w-7xl max-h-[92vh] overflow-hidden flex flex-col rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <DialogHeader className="shrink-0 border-b border-slate-100 dark:border-slate-800 pb-4 pr-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleBack}
                className="h-9 rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs font-black text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-700">
                    #{transaction.transactionNumber}
                  </Badge>
                  <Badge variant="secondary" className="text-xs font-extrabold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                    {transaction.groupName || 'JAM'}
                  </Badge>
                  
                  {/* Distributed Status Badge directly on popup */}
                  <Badge className="bg-emerald-600 dark:bg-emerald-600 text-white font-extrabold text-xs px-2.5 py-1 flex items-center gap-1.5 shadow-xs">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Distributed to Directors
                  </Badge>
                </div>
                <DialogTitle className="text-lg font-black text-slate-900 dark:text-slate-100 mt-1">
                  Scrap Disposal Full Transaction Record
                </DialogTitle>
                <p className="text-xs text-slate-500 font-medium">
                  Recorded on {transaction.soldDate || transaction.timestamp.slice(0, 10)}
                </p>
              </div>
            </div>

            {onEditRecord && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => {
                  onClose()
                  onEditRecord(transaction)
                }}
                style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
                className="rounded-xl text-xs font-black h-9 px-4 shadow-sm cursor-pointer border-0 shrink-0 flex items-center gap-1.5"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit Record
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 pt-2 pr-1 space-y-4">
          {/* Financial Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-2">
            <Card className="bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400">Total Valuation</span>
                <div className="text-xl font-black text-slate-900 dark:text-slate-100">
                  {formatINR(transaction.calculatedTotal)}
                </div>
                <p className="text-[10px] text-slate-500 font-semibold">
                  {transaction.weightQty} {transaction.unit} × ₹{transaction.ratePerUnit}/unit
                </p>
              </CardContent>
            </Card>

            <Card className="bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-extrabold uppercase text-slate-500 dark:text-slate-400">Amount Collected</span>
                <div className="text-xl font-black text-emerald-700 dark:text-emerald-400">
                  {formatINR(transaction.amountReceived)}
                </div>
                <p className="text-[10px] text-slate-500 font-semibold">
                  Payment Mode: {transaction.paymentModeName}
                </p>
              </CardContent>
            </Card>

            {/* Balance Outstanding Card with Direct Distributed Status */}
            <Card className="bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl">
              <CardContent className="p-4 space-y-1">
                <span className="text-[11px] font-extrabold uppercase text-emerald-800 dark:text-emerald-300">
                  Balance & Distribution Status
                </span>
                <div className="text-xl font-black text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                  <span>{formatINR(transaction.outstandingAmount || 0)}</span>
                  <Badge className="bg-emerald-600 text-white font-extrabold text-[10px] px-2 py-0.5 flex items-center gap-1 border-0">
                    <CheckCircle2 className="h-3 w-3" /> Distributed
                  </Badge>
                </div>
                <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-bold">
                  Payment collected and handed over for director distribution.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Sections Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Column 1: Classification & Material */}
            <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl">
              <CardContent className="p-4 space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Origin & Scrap Classification
                </h4>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Dealership Group:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{transaction.groupName || 'JAM'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Department:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{transaction.departmentName}</span>
                  </div>
                </div>

                <div className="text-xs">
                  <span className="text-slate-400 block text-[11px]">Dealership Location:</span>
                  <span className="font-extrabold text-slate-900 dark:text-slate-100">{transaction.locationName}</span>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Scrap Material Category:</span>
                    <span className="font-extrabold text-slate-900 dark:text-slate-100">{transaction.scrapTypeName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Unit of Measure:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{transaction.unit}</span>
                  </div>
                </div>

                <div className="text-xs">
                  <span className="text-slate-400 block text-[11px]">Item Description:</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{transaction.description || 'N/A'}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 dark:border-slate-800 pt-2">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Weight / Quantity:</span>
                    <span className="font-black text-slate-900 dark:text-slate-100">{transaction.weightQty.toLocaleString('en-IN')} {transaction.unit}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Rate per Unit:</span>
                    <span className="font-black text-slate-900 dark:text-slate-100">₹{transaction.ratePerUnit}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Column 2: Buyer & Payment Handover */}
            <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl">
              <CardContent className="p-4 space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-cyan-600 dark:text-cyan-400" /> Buyer & Payment Handover
                </h4>

                <div className="text-xs">
                  <span className="text-slate-400 block text-[11px]">Sold To (Buyer / Merchant):</span>
                  <span className="font-extrabold text-slate-900 dark:text-slate-100 text-sm">{transaction.soldTo || 'N/A'}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 dark:border-slate-800 pt-2">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Sold Date:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{transaction.soldDate || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Sold By Employee:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{transaction.soldByName || 'N/A'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Payment Mode:</span>
                    <Badge variant="outline" className="font-bold text-[10px] mt-0.5">
                      {transaction.paymentModeName}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Payment Handover To:</span>
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                      <UserCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> {transaction.paymentHandoverToName}
                    </span>
                  </div>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-2 text-xs">
                  <span className="text-slate-400 block text-[11px]">Remarks & Notes:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100 italic">{transaction.remarks || 'No remarks recorded.'}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Attachments Section */}
          <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <h4 className="text-xs font-black uppercase text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Eye className="h-4 w-4 text-slate-400" /> Attached Verification Documents
                </h4>
                {onOpenGallery && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenGallery(transaction)}
                    className="h-7 text-xs font-bold rounded-xl cursor-pointer"
                  >
                    View Gallery
                  </Button>
                )}
              </div>

              {transaction.attachments && transaction.attachments.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {transaction.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-2.5 flex items-center justify-between text-xs hover:border-emerald-500 transition-all"
                    >
                      <span className="font-bold text-slate-900 dark:text-slate-100 truncate max-w-[140px]">{att.fileName}</span>
                      <Badge variant="secondary" className="text-[9px]">
                        {att.type}
                      </Badge>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic py-2">
                  No document attachments uploaded for this transaction.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
