'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Clock, AlertTriangle, CheckCircle2, ChevronRight, Inbox, ClipboardCheck, ShieldCheck, XCircle, X, ClipboardList, WalletCards, FileText } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FinanceDetail } from './finance-detail'
import { FinancePayoutsDashboard } from './finance-payouts-dashboard'
import {
  formatCountdown, formatCurrency, formatDate, statusMeta, bankStatusMeta, str,
  type QueueResponse, type ApprovalQueueRow, type ProcessingRow,
} from './finance-shared'

async function fetchQueue(): Promise<QueueResponse> {
  const res = await fetch('/api/finance/queue', { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load finance queue')
  return data
}

async function proformaApproval(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/brands/kia/proforma/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approval', ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Approval failed')
  return data
}

export function FinanceWorkspace({ canApprove, currentUserRole }: { canApprove: boolean; currentUserRole?: string }) {
  const qc = useQueryClient()
  // 'payouts' is the post-delivery ledger — a SUBSECTION of Finance, not a new sidebar item and not
  // a booking stage. It shares this section's `finance.view` gate; editing needs `finance.edit`.
  const [tab, setTab] = useState<'queue' | 'processing' | 'payouts'>('queue')
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [declineRow, setDeclineRow] = useState<ApprovalQueueRow | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [previewRow, setPreviewRow] = useState<ApprovalQueueRow | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { data, isLoading, isError, error } = useQuery({ queryKey: ['finance', 'queue'], queryFn: fetchQueue })

  const approval = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => proformaApproval(id, body),
    onSuccess: () => { setActionError(null); qc.invalidateQueries({ queryKey: ['finance', 'queue'] }) },
    onError: (e: Error) => setActionError(e.message),
  })

  if (selected) return <FinanceDetail proformaId={selected} canApprove={canApprove} currentUserRole={currentUserRole} onBack={() => setSelected(null)} />

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
  if (isError || !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(error as Error)?.message || 'Failed to load finance queue.'}</div>

  const approvalQueue = data.approvalQueue ?? []
  const processing = data.processing ?? []
  const busy = approval.isPending

  const submitDecline = () => {
    if (!declineRow) return
    approval.mutate(
      { id: declineRow.id, body: { decision: 'decline', declineReason: declineReason.trim() || 'Declined at Finance' } },
      { onSuccess: () => { setDeclineRow(null); setDeclineReason('') } },
    )
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab('queue')}
          className={cn('inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-colors',
            tab === 'queue' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}>
          <ClipboardCheck className="h-4 w-4" /> Awaiting Approval
          <span className="rounded-full bg-white/70 px-1.5 text-xs font-black">{approvalQueue.length}</span>
        </button>
        <button onClick={() => setTab('processing')}
          className={cn('inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-colors',
            tab === 'processing' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}>
          <Inbox className="h-4 w-4" /> In Processing
          <span className="rounded-full bg-white/70 px-1.5 text-xs font-black">{processing.length}</span>
        </button>
        <button onClick={() => setTab('payouts')}
          className={cn('inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-colors',
            tab === 'payouts' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}>
          <WalletCards className="h-4 w-4" /> Payouts
        </button>
      </div>

      {actionError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">{actionError}</div>}

      {tab === 'payouts' ? (
        <FinancePayoutsDashboard />
      ) : tab === 'queue' ? (
        <Card className="overflow-hidden p-0">
          {approvalQueue.length === 0 ? (
            <div className="p-10 text-center text-sm font-semibold text-slate-400">No proformas awaiting finance approval.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Model / Variant</th>
                    <th className="px-4 py-3">Bank</th>
                    <th className="px-4 py-3 text-right">Grand Total</th>
                    <th className="px-4 py-3">Consultant</th>
                    {canApprove && <th className="px-4 py-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {approvalQueue.map((r: ApprovalQueueRow) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 cursor-pointer" onClick={() => setPreviewRow(r)}>
                      <td className="px-4 py-3 font-semibold text-slate-500">{formatDate(r.proformaDate)}</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{str(r.customerName) || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{str(r.modelName)} <span className="text-slate-400">· {str(r.trimDescription)}</span></td>
                      <td className="px-4 py-3 text-slate-600">{str(r.bankName) || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency(r.grandTotalCost)}</td>
                      <td className="px-4 py-3 text-slate-600">{str(r.consultant) || '—'}</td>
                      {canApprove && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" className="h-8" disabled={busy}
                              onClick={() => approval.mutate({ id: r.id, body: { decision: 'approve' } })}>
                              <ShieldCheck className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50" disabled={busy}
                              onClick={() => { setDeclineRow(r); setDeclineReason('') }}>
                              <XCircle className="h-3.5 w-3.5" /> Decline
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {processing.length === 0 ? (
            <div className="p-10 text-center text-sm font-semibold text-slate-400">No proformas in finance processing yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Model / Variant</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Countdown</th>
                    <th className="px-4 py-3">Current Bank</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {processing.map((r: ProcessingRow) => {
                    const s = statusMeta(r.financeStatus)
                    const done = r.financeStatus === 'completed'
                    const cd = formatCountdown(r.expectedCompletionDate, now)
                    return (
                      <tr key={r.processingId} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60" onClick={() => setSelected(r.proformaId)}>
                        <td className="px-4 py-3 font-bold text-slate-800">{str(r.customerName) || '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{str(r.modelName)} <span className="text-slate-400">· {str(r.trimDescription)}</span></td>
                        <td className="px-4 py-3"><span className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-bold', s.className)}>{s.label}</span></td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center gap-1 text-xs font-bold',
                            done ? 'text-emerald-600' : cd.overdue ? 'text-rose-600' : 'text-slate-600')}>
                            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : cd.overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                            {done ? `Completed ${formatDate(r.completedAt)}` : cd.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-slate-700">{str(r.currentBankName) || '—'}</span>
                          {r.currentBankStatus && <span className={cn('ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold', bankStatusMeta(r.currentBankStatus))}>{r.currentBankStatus}</span>}
                        </td>
                        <td className="px-4 py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-slate-300" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Decline dialog */}
      <Dialog open={Boolean(declineRow)} onOpenChange={(o) => !busy && !o && setDeclineRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Proforma</DialogTitle>
            <DialogDescription>{declineRow ? `${str(declineRow.customerName)} · ${str(declineRow.modelName)}` : ''}</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-bold text-slate-500">Reason for declining</label>
            <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} rows={3} placeholder="Why is this proforma being declined?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineRow(null)} disabled={busy}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={submitDecline} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details drawer */}
      <AnimatePresence>
        {previewRow && (
          <BookingDetailsDrawer
            row={previewRow}
            currentUserRole={currentUserRole}
            onClose={() => setPreviewRow(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function FieldValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50/60 p-2.5 border border-slate-100/80">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-700 break-words">{value ?? '—'}</p>
    </div>
  )
}

function BookingDetailsDrawer({
  row,
  currentUserRole,
  onClose,
}: {
  row: ApprovalQueueRow | null
  currentUserRole?: string
  onClose: () => void
}) {
  if (!row || typeof document === 'undefined') return null

  const canViewPii = currentUserRole?.toLowerCase() === 'md' || currentUserRole?.toLowerCase() === 'developer'
  const maskPii = (val: string | null | undefined) => {
    const v = String(val ?? '').trim()
    if (!v) return '—'
    return canViewPii ? v : '••••••'
  }

  const money = (value: unknown) => formatCurrency(value)

  const priceFields: { label: string; value: string | number | null }[] = [
    { label: 'Ex-Showroom', value: row.exShowroom },
    { label: 'TCS', value: row.tcsValue },
    { label: 'Registration', value: row.registrationCharges },
    { label: 'Insurance', value: row.insuranceValue },
    { label: 'FASTag', value: row.fastagValue },
    { label: 'Accessories Kit', value: row.accessoriesKit },
    { label: 'Ext. Warranty', value: row.extWarranty },
    { label: 'Cash Discount', value: row.cashDiscount },
    { label: 'Exchange Value', value: row.exchangeValue },
    { label: 'Booking Amount', value: row.bookingAmount },
    { label: 'Govt. Emp. Discount', value: row.govtEmployeeDiscount },
    { label: 'Additional Discount', value: row.additionalDiscount },
  ]

  // Fallbacks to Booking data
  const customerName = row.customerName || row.bookingCustomerName || '—'
  const mobileNumber = row.mobileNumber || row.bookingCustomerPhone
  const customerEmail = row.customerEmail || row.bookingCustomerEmail
  const customerAddress = row.customerAddress || row.bookingCustomerAddress || '—'
  
  const modelName = row.modelName || row.bookingModel || '—'
  const trimDescription = row.trimDescription || row.bookingVariant || '—'
  const fuelType = row.fuelType || row.bookingFuelType || '—'
  const vehicleColor = row.vehicleColor || row.bookingColor || '—'
  
  const bankName = row.bankName || row.bookingBankName || '—'
  const loanAmount = row.loanAmount ?? row.bookingLoanAmount

  // Document Extractors
  const bMeta = (row.bookingMetadata || {}) as Record<string, unknown>
  const pMeta = (row.importMetadata || {}) as Record<string, unknown>
  const docMeta = (pMeta.customerDocuments || {}) as Record<string, unknown>

  const getDocVal = (key: string): string => {
    return String(bMeta[key] || docMeta[key] || pMeta[key] || '').trim()
  }

  const panNumber = getDocVal('panNumber')
  const panCardUrl = getDocVal('panCardUrl')
  const panCardName = getDocVal('panCardName')

  const aadhaarNumber = getDocVal('aadhaarNumber')
  const aadhaarCardUrl = getDocVal('aadhaarCardUrl')
  const aadhaarCardName = getDocVal('aadhaarCardName')

  const employeeIdUrl = getDocVal('employeeIdUrl')
  const employeeIdName = getDocVal('employeeIdName')

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-[99998] bg-slate-950/40 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed inset-y-0 right-0 z-[99999] flex h-full w-[480px] max-w-[95vw] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl"
        initial={{ x: 480, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 480, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 35 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative overflow-hidden border-b border-slate-200 p-5 text-white bg-slate-900">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                Booking Details {row.bookingNumber ? `· #${row.bookingNumber}` : ''}
              </p>
              <p className="mt-1 truncate text-lg font-extrabold tracking-tight">{customerName}</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-300">{modelName} · {trimDescription}</p>
            </div>
            <button
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-track]:bg-transparent">
          {/* Customer Details */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-indigo-600" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Customer Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldValue label="Customer" value={customerName} />
              <FieldValue label="Mobile" value={maskPii(mobileNumber)} />
              <FieldValue label="Email" value={maskPii(customerEmail)} />
              <FieldValue label="Type" value={row.customerType || '—'} />
              <FieldValue label="Proforma Date" value={formatDate(row.proformaDate)} />
              <FieldValue label="Consultant" value={row.consultant || row.bookingConsultant || '—'} />
              <FieldValue label="Aadhaar Number" value={maskPii(aadhaarNumber)} />
              <FieldValue label="PAN Number" value={maskPii(panNumber)} />
              <div className="col-span-2">
                <FieldValue label="Address" value={customerAddress} />
              </div>
            </div>
          </div>

          {/* Customer Identity Documents Links */}
          {(() => {
            const docs = [
              { label: 'PAN Card', url: panCardUrl, name: panCardName },
              { label: 'Aadhaar Card', url: aadhaarCardUrl, name: aadhaarCardName },
              { label: 'Employee ID', url: employeeIdUrl, name: employeeIdName },
            ].filter((d) => d.url)
            if (!docs.length || !canViewPii) return null
            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-rose-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Customer Documents</h3>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {docs.map((d) => (
                    <a
                      key={d.label}
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
                    >
                      <FileText className="h-4 w-4 text-slate-400" /> {d.label}
                    </a>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Bank / Finance Details */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <WalletCards className="h-4 w-4 text-emerald-600" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Bank / Finance Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldValue label="Bank" value={bankName} />
              <FieldValue label="Branch" value={row.bankBranch || '—'} />
              <FieldValue label="Loan Amount" value={money(loanAmount)} />
              <FieldValue label="Insurance Co." value={row.insuranceCompany || '—'} />
              <FieldValue label="Vehicle Status" value={row.vehicleStatus || '—'} />
              <FieldValue label="Finance Status" value={row.financeStatus || '—'} />
            </div>
          </div>

          {/* Vehicle & Price Details */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-violet-600" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Vehicle & Price Details</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldValue label="Model" value={modelName} />
              <FieldValue label="Variant" value={trimDescription} />
              <FieldValue label="Fuel" value={fuelType} />
              <FieldValue label="Colour" value={vehicleColor} />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-2 gap-3">
                {priceFields.map((field) => (
                  <FieldValue key={field.label} label={field.label} value={money(field.value)} />
                ))}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer Cost</p>
                <p className="mt-1 text-sm font-extrabold text-slate-700">{money(row.totalCustomerCost)}</p>
              </div>
              <div className="rounded-xl bg-indigo-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Grand Total</p>
                <p className="mt-1 text-sm font-extrabold text-indigo-700">{money(row.grandTotalCost)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white p-4">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose}>
            Close
          </Button>
        </div>
      </motion.div>
    </>,
    document.body
  )
}

