'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Crown,
  Loader2,
  Sparkles,
  User,
} from 'lucide-react'
import { formatCurrency, normalizeRequestNumber, requestedAmount, requestedByName } from './pc-shared'
import type { PettyCashRequest } from './types'
import { getBranchLabel } from '@/lib/branches'
import { cn } from '@/lib/utils'

interface MdApprovalAmountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: PettyCashRequest | null
  loading?: boolean
  onConfirm: (data: { remarks: string; approvedAmount: number }) => void | Promise<void>
}

export function MdApprovalAmountDialog({
  open,
  onOpenChange,
  request,
  loading = false,
  onConfirm,
}: MdApprovalAmountDialogProps) {
  const reqAmount = useMemo(() => {
    if (!request) return 0
    return Number(requestedAmount(request)) || 0
  }, [request])

  const initialAmount = useMemo(() => {
    if (!request) return ''
    const existingAllocated = Number(request.allocatedAmount || request.allocated_amount || 0)
    return String(existingAllocated > 0 ? existingAllocated : reqAmount)
  }, [request, reqAmount])

  const [amountStr, setAmountStr] = useState(initialAmount)
  const [remarks, setRemarks] = useState('')

  useEffect(() => {
    if (open) {
      setAmountStr(initialAmount)
      setRemarks('')
    }
  }, [open, initialAmount])

  if (!request) return null

  const parsedAmount = Number(amountStr)
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  const isReduced = isValidAmount && parsedAmount < reqAmount
  const isIncreased = isValidAmount && parsedAmount > reqAmount
  const isExact = isValidAmount && parsedAmount === reqAmount
  const difference = Math.abs(reqAmount - parsedAmount)

  const handlePreset = (fraction: number) => {
    const calculated = Math.round(reqAmount * fraction)
    setAmountStr(String(calculated))
  }

  const handleConfirm = async () => {
    if (!isValidAmount) return
    await onConfirm({
      remarks: remarks.trim(),
      approvedAmount: parsedAmount,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0 text-slate-900 dark:text-slate-50 shadow-2xl sm:max-w-[560px]">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-b border-slate-100 dark:border-slate-800 px-6 py-5">
          <DialogHeader className="space-y-1.5 text-left">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
                <Crown className="h-3 w-3 text-amber-600 dark:text-amber-400" /> MD Final Authorization
              </span>
              <span className="font-mono text-xs font-bold text-slate-500">
                {normalizeRequestNumber(request)}
              </span>
            </div>
            <DialogTitle className="text-xl font-black tracking-tight text-slate-950 dark:text-white">
              Approve Petty Cash Float
            </DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Review request details and adjust the sanctioned amount before forwarding to Accounts.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Content Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Context Snippet Card */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold text-[11px]">
                  <User className="h-3.5 w-3.5" />
                </div>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {requestedByName(request)}
                </span>
                {request.department && (
                  <span className="text-[11px] font-semibold text-slate-500">
                    · {request.department}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <Building2 className="h-3.5 w-3.5" />
                <span>{getBranchLabel(request.branchId || '')}</span>
                {request.location && <span>({request.location})</span>}
              </div>
            </div>

            {request.purpose && (
              <div className="border-t border-slate-200/60 dark:border-slate-700/60 pt-2">
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300 line-clamp-2 italic">
                  “{request.purpose}”
                </p>
              </div>
            )}
          </div>

          {/* Amount Adjustment Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="md-approved-amount" className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Approved Amount (Sent to Accounts) <span className="text-red-500">*</span>
              </Label>
              <span className="text-xs font-medium text-slate-500">
                Requested: <strong className="tabular-nums font-bold text-slate-700 dark:text-slate-200">{formatCurrency(reqAmount)}</strong>
              </span>
            </div>

            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-base font-bold text-slate-400">
                ₹
              </div>
              <Input
                id="md-approved-amount"
                type="number"
                min={1}
                step="1"
                placeholder="Enter approved amount"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                disabled={loading}
                className="h-12 pl-8 pr-4 text-lg font-black tabular-nums border-2 rounded-2xl border-slate-200 dark:border-slate-700 focus:border-amber-500 dark:focus:border-amber-500 bg-white dark:bg-slate-900"
              />
            </div>

            {/* Quick Percentage Presets */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 mr-1">Quick Adjust:</span>
              <button
                type="button"
                onClick={() => handlePreset(1)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer',
                  isExact
                    ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                )}
              >
                100% (Full {formatCurrency(reqAmount)})
              </button>
              <button
                type="button"
                onClick={() => handlePreset(0.75)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
              >
                75% ({formatCurrency(Math.round(reqAmount * 0.75))})
              </button>
              <button
                type="button"
                onClick={() => handlePreset(0.5)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
              >
                50% ({formatCurrency(Math.round(reqAmount * 0.5))})
              </button>
              <button
                type="button"
                onClick={() => handlePreset(0.25)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
              >
                25% ({formatCurrency(Math.round(reqAmount * 0.25))})
              </button>
            </div>

            {/* Dynamic Comparison Banner */}
            {isValidAmount && (
              <div className={cn(
                'rounded-xl p-3 border text-xs font-semibold flex items-center gap-2.5 transition-all',
                isReduced
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                  : isIncreased
                  ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              )}>
                {isReduced ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-none" />
                    <span>
                      Reduced by <strong>{formatCurrency(difference)}</strong>. Accounts will be authorized to disburse <strong>{formatCurrency(parsedAmount)}</strong> only.
                    </span>
                  </>
                ) : isIncreased ? (
                  <>
                    <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-none" />
                    <span>
                      Increased by <strong>{formatCurrency(difference)}</strong>. Accounts will disburse <strong>{formatCurrency(parsedAmount)}</strong>.
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-none" />
                    <span>
                      Full requested amount (<strong>{formatCurrency(parsedAmount)}</strong>) authorized for Accounts disbursement.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Remarks Section */}
          <div className="space-y-1.5">
            <Label htmlFor="md-remarks" className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Instructions for Accounts / Remarks <span className="text-slate-400 font-normal">(Optional)</span>
            </Label>
            <Textarea
              id="md-remarks"
              placeholder={isReduced ? 'e.g. Sanctioned ₹5,000 for this cycle; balance to be reviewed next month.' : 'Add any special instructions or note (optional)...'}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              disabled={loading}
              className="resize-none rounded-2xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-xs focus:border-amber-500"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 px-6 py-4 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="rounded-xl border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !isValidAmount}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition-all cursor-pointer gap-1.5"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Approving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Approve {isValidAmount ? formatCurrency(parsedAmount) : ''} & Forward to Accounts</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
