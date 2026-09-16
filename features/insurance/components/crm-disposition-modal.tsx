'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { PhoneCall, Loader2 } from 'lucide-react'
import type { CrmDisposition } from '@/lib/insurance/crm'
import type { RenewalDue } from '@/lib/insurance/renewals'

const CRM_DISPOSITIONS: { id: CrmDisposition; label: string }[] = [
  { id: 'PENDING', label: 'Pending Call' },
  { id: 'INTERESTED', label: 'Interested / In Negotiation' },
  { id: 'FOLLOWUP_SCHEDULED', label: 'Follow-up Scheduled' },
  { id: 'RENEWED_WON', label: 'Renewed & Converted' },
  { id: 'LOST_COMPETITOR', label: 'Lost: Competitor Dealership' },
  { id: 'LOST_ONLINE', label: 'Lost: Online Portal (PolicyBazaar etc.)' },
  { id: 'LOST_PRICE', label: 'Lost: Price Disparity / Premium' },
  { id: 'SOLD_VEHICLE', label: 'Vehicle Sold / Transferred' },
  { id: 'WRONG_NUMBER', label: 'Wrong Number / Invalid Contact' },
  { id: 'NOT_INTERESTED', label: 'Not Interested / Refused' },
]

type Props = {
  lead: RenewalDue | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: {
    chassisNo: string
    policyNo?: string | null
    customerName?: string | null
    phone?: string | null
    disposition: CrmDisposition
    lossReason?: string | null
    remarks?: string | null
    followUpDate?: string | null
  }) => void
  isSaving: boolean
}

export function CrmDispositionModal({ lead, open, onOpenChange, onSave, isSaving }: Props) {
  const [disposition, setDisposition] = useState<CrmDisposition>('PENDING')
  const [lossReason, setLossReason] = useState<string>('')
  const [remarks, setRemarks] = useState<string>('')
  const [followUpDate, setFollowUpDate] = useState<string>('')

  useEffect(() => {
    if (lead) {
      setDisposition(lead.disposition || 'PENDING')
      setLossReason(lead.lossReason || '')
      setRemarks(lead.remarks || '')
      setFollowUpDate(lead.followUpDate || '')
    }
  }, [lead])

  if (!lead) return null

  const isLost = disposition.startsWith('LOST_')
  const isFollowUp = disposition === 'FOLLOWUP_SCHEDULED'

  const handleSave = () => {
    onSave({
      chassisNo: lead.chassisNo,
      policyNo: lead.policyNo,
      customerName: lead.customerName,
      disposition,
      lossReason: isLost ? lossReason || disposition : null,
      remarks: remarks || null,
      followUpDate: isFollowUp ? followUpDate || null : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl p-6 border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400">
                <PhoneCall className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Log Calling Record
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  {lead.customerName || 'Customer'} • {lead.model || 'Vehicle'}
                </DialogDescription>
              </div>
            </div>
            {lead.daysToExpiry !== undefined && (
              <Badge
                variant="secondary"
                className={
                  lead.daysToExpiry <= 7
                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 font-bold'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-bold'
                }
              >
                {lead.daysToExpiry <= 0 ? 'Expired' : `${lead.daysToExpiry}d left`}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Lead Contact & Policy Info Card */}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-3 text-xs space-y-1.5 border border-slate-200/70 dark:border-slate-800">
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Chassis / VIN:</span>
            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{lead.chassisNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Policy No:</span>
            <span className="font-mono text-slate-700 dark:text-slate-300">{lead.policyNo || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-medium">Insurer:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{lead.insuranceCompany || '—'}</span>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-3 pt-1">
          <div>
            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
              Call Disposition
            </label>
            <Select value={disposition} onValueChange={(val: CrmDisposition) => setDisposition(val)}>
              <SelectTrigger className="h-9 rounded-xl text-xs font-semibold">
                <SelectValue placeholder="Select call result" />
              </SelectTrigger>
              <SelectContent>
                {CRM_DISPOSITIONS.map((d) => (
                  <SelectItem key={d.id} value={d.id} className="text-xs font-medium">
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isFollowUp && (
            <div>
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                Scheduled Follow-up Date
              </label>
              <Input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="h-9 rounded-xl text-xs"
              />
            </div>
          )}

          {isLost && (
            <div>
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                Loss Specific Reason / Competitor Details
              </label>
              <Input
                placeholder="e.g. Renewed via PolicyBazaar for ₹14,200"
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                className="h-9 rounded-xl text-xs"
              />
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
              Telecalling Notes / Remarks
            </label>
            <Textarea
              rows={3}
              placeholder="Customer requested quote on WhatsApp with Zero Depreciation add-on..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="rounded-xl text-xs resize-none"
            />
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="h-8 rounded-xl text-xs font-semibold"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="h-8 rounded-xl text-xs font-bold bg-[var(--dashboard-primary)] text-white shadow-xs"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                Saving...
              </>
            ) : (
              'Save Disposition'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
