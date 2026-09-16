'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Car,
  Shield,
  FileText,
  Calendar,
  IndianRupee,
  Building2,
  User,
  CheckCircle2,
  AlertCircle,
  Copy,
  Phone,
  Clock,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InsuranceBrandId } from '@/lib/insurance/brands'
import { INSURANCE_BRANDS } from '@/lib/insurance/brands'

type Props = {
  brand: InsuranceBrandId
  policy: any | null
  open: boolean
  onOpenChange: (open: boolean) => void
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

function formatDate(val?: string | null) {
  if (!val) return '—'
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function PolicyInspectorSheet({ brand, policy: initialPolicy, open, onOpenChange }: Props) {
  const [fullPolicy, setFullPolicy] = useState<any | null>(initialPolicy)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)

  const brandConfig = INSURANCE_BRANDS[brand]
  const cap = brandConfig.capabilities

  useEffect(() => {
    if (!initialPolicy || !open) {
      setFullPolicy(initialPolicy)
      return
    }

    setFullPolicy(initialPolicy)
    const chassis = initialPolicy.chassisNo || initialPolicy.chassis_no || initialPolicy.vinno

    if (chassis) {
      setIsLoadingDetails(true)
      fetch(`/api/insurance/policies?type=${brand}&search=${encodeURIComponent(chassis)}&pageSize=1`)
        .then((res) => res.json())
        .then((data) => {
          const list = data.policies || data.rows || []
          if (list.length > 0) {
            setFullPolicy((prev: any) => ({ ...prev, ...list[0] }))
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingDetails(false))
    }
  }, [initialPolicy, brand, open])

  if (!fullPolicy) return null

  const p = fullPolicy
  const customerName = p.customerName || p.customer_name || 'Customer'
  const policyNo = p.policyNo || p.policy_no || p.policyno || '—'
  const proposalNo = p.proposalNo || p.proposal_no || '—'
  const chassisNo = p.chassisNo || p.chassis_no || p.vinno || '—'
  const engineNo = p.engineNo || p.engine_no || p.engineno || '—'
  const vehRegistNo = p.vehRegistNo || p.veh_regist_no || p.registrationNo || '—'
  const modelName = p.modelName || p.model_name || p.model || 'Vehicle'
  const variantName = p.variantName || p.variant_name || p.variant || ''
  const fuelType = p.fuelType || p.fuel_type || p.fueltype || '—'
  const mfgYear = p.policyMfgYear || p.mfgYear || p.mfg_year || '—'
  const insurer = p.insuranceCompany || p.insurance_company || p.insurancecompany || '—'
  const policyType = p.policyType || p.policy_type || p.policytype || 'Standard'

  const issueDate = p.policyIssueDate || p.policy_issue_date || p.create_date
  const startDate = p.policyStartDate || p.policy_start_date || p.policy_effective_date
  const expiryDate = p.odExpiryDate || p.od_expiry_date || p.policy_expiry_date || p.expiryDate

  const grossPremium = Number(p.grossPremium || p.gross_premium || p.grosspremium || p.lastPremium || 0)
  const netPremium = Number(p.netPremium || p.net_premium || p.netpremium || 0)
  const netOdPremium = Number(p.netOdPremiumA || p.net_od_premium_a || p.netodpremiuma || 0)
  const tpLiability = Number(p.thirdPartyLiability || p.third_party_liability || 0)
  const addOnPremium = Number(p.addOnPremium || p.add_on_premium || 0)
  const totalIdv = Number(p.totalIdv || p.total_idv || p.totalidv || 0)
  const ncb = p.currentNcb || p.current_ncb_percentage || '0%'

  const dealerCode = p.dealerCode || p.dealer_code || p.dealercode || '—'
  const subUser = p.subUser || p.sub_user || '—'
  const rmName = p.rmName || p.rm_name || '—'
  const status64vb = p.column64vbStatus || p.column_64vb_status

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-6">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider bg-slate-50 dark:bg-slate-800">
                  {policyType}
                </Badge>
                {status64vb && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] font-bold',
                      status64vb === 'VERIFIED'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
                    )}
                  >
                    64VB {status64vb}
                  </Badge>
                )}
                {isLoadingDetails && (
                  <span className="flex items-center gap-1 text-[10px] text-teal-600 font-semibold animate-pulse">
                    <Loader2 className="h-3 w-3 animate-spin" /> Fetching ledger details...
                  </span>
                )}
              </div>
              <DialogTitle className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 mt-1">
                {customerName}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-mono mt-0.5">
                Policy No: {policyNo} {proposalNo !== '—' && `• Proposal: ${proposalNo}`}
              </DialogDescription>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Gross Premium</span>
              <span className="text-xl font-black text-teal-600 dark:text-teal-400">
                {formatInr(grossPremium)}
              </span>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Section 1: Vehicle & Identification */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
              <Car className="h-4 w-4 text-teal-600" />
              <span>Vehicle Specifications</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Model & Variant</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {modelName} {variantName ? `• ${variantName}` : ''}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Chassis (VIN)</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                  {chassisNo}
                  {chassisNo !== '—' && (
                    <Copy
                      className="h-3 w-3 text-slate-400 hover:text-slate-700 cursor-pointer inline"
                      onClick={() => copyToClipboard(chassisNo)}
                    />
                  )}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Registration No</span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {vehRegistNo}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Engine No</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                  {engineNo}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Fuel Type</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {fuelType}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Mfg Year</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {mfgYear}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Coverage & Validity */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
              <Calendar className="h-4 w-4 text-indigo-600" />
              <span>Policy Timeline & Insurer</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Insurer Partner</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {insurer}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Issue Date</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {formatDate(issueDate)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Start Date</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {formatDate(startDate)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Expiry Date</span>
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  {formatDate(expiryDate)}
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Financial & IDV Breakdown */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
              <IndianRupee className="h-4 w-4 text-emerald-600" />
              <span>Financial & IDV Breakdown</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Gross Premium</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {formatInr(grossPremium)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block uppercase">Net Premium</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {formatInr(netPremium)}
                </span>
              </div>
              {netOdPremium > 0 && (
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Net OD Premium</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {formatInr(netOdPremium)}
                  </span>
                </div>
              )}
              {tpLiability > 0 && (
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">TP Liability</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {formatInr(tpLiability)}
                  </span>
                </div>
              )}
              {totalIdv > 0 && (
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Total IDV</span>
                  <span className="font-bold text-teal-600 dark:text-teal-400">
                    {formatInr(totalIdv)}
                  </span>
                </div>
              )}
              {ncb !== '0%' && (
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">NCB Discount</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {ncb}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Dealership Attribution */}
          {(dealerCode !== '—' || subUser !== '—' || rmName !== '—') && (
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
                <Building2 className="h-4 w-4 text-blue-600" />
                <span>Dealership Attribution</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Dealer Code</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                    {dealerCode}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Branch / Sub-user</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {subUser}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Executive / RM</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {rmName}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
