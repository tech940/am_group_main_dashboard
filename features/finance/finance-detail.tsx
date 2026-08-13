'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Loader2, Clock, AlertTriangle, CheckCircle2, MessageSquarePlus, MessageSquare,
  Landmark, History, CalendarClock, User, Banknote, ShieldCheck, XCircle, RotateCcw,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  DELAY_REASONS, formatCountdown, formatCurrency, formatDate, formatDateTime,
  roleLabel, statusMeta, bankStatusMeta, str, isRealRemarkText, getFinanceRowMdRemarks,
  type DetailResponse, type BankAttempt,
} from './finance-shared'

function getRemarkRoleStyles(role: string | null | undefined): string {
  const r = String(role || '').toLowerCase().trim()
  switch (r) {
    case 'md':
      return 'border-rose-200 bg-rose-50/70 text-rose-900'
    case 'general_manager':
      return 'border-amber-200 bg-amber-50/70 text-amber-900'
    case 'sales_manager':
      return 'border-indigo-200 bg-indigo-50/70 text-indigo-900'
    case 'accounts':
      return 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
    case 'sales_executive':
      return 'border-sky-200 bg-sky-50/70 text-sky-900'
    default:
      return 'border-slate-200 bg-slate-50/60 text-slate-900'
  }
}

async function fetchDetail(proformaId: string): Promise<DetailResponse> {
  const res = await fetch(`/api/finance/${proformaId}`, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load finance record')
  return data
}

async function fetchBankOptions(): Promise<{ banks: { bank_name: string; bank_branch: string }[] }> {
  const res = await fetch('/api/finance/bank-options', { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load bank options')
  return data
}

async function financeAction(proformaId: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/finance/${proformaId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Action failed')
  return data
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800 break-words">{value ?? '—'}</p>
    </div>
  )
}

export function FinanceDetail({ proformaId, canApprove, currentUserRole, onBack }: { proformaId: string; canApprove: boolean; currentUserRole?: string; onBack: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['finance', 'detail', proformaId], queryFn: () => fetchDetail(proformaId) })
  const bankOptionsQuery = useQuery({ queryKey: ['finance', 'bank-options'], queryFn: fetchBankOptions, staleTime: 30 * 60 * 1000 })

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const [actionError, setActionError] = useState<string | null>(null)
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['finance', 'detail', proformaId] })
    qc.invalidateQueries({ queryKey: ['finance', 'queue'] })
  }
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => financeAction(proformaId, payload),
    onSuccess: () => { setActionError(null); invalidate() },
    onError: (e: Error) => setActionError(e.message),
  })

  // Remark form
  const [remark, setRemark] = useState('')
  // Delay dialog
  const [delayOpen, setDelayOpen] = useState(false)
  const [delayDate, setDelayDate] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [delayCustom, setDelayCustom] = useState('')
  // Bank dialog
  const [bankOpen, setBankOpen] = useState(false)
  const [bankName, setBankName] = useState('')
  const [bankBranch, setBankBranch] = useState('')
  // Reject bank attempt dialog
  const [rejectAttempt, setRejectAttempt] = useState<BankAttempt | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const bankNames = useMemo(() => {
    const set = new Set<string>()
    for (const b of bankOptionsQuery.data?.banks ?? []) if (b.bank_name) set.add(b.bank_name)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [bankOptionsQuery.data])
  const branchesForBank = useMemo(() => {
    if (!bankName) return []
    const norm = bankName.trim().toLowerCase()
    const set = new Set<string>()
    for (const b of bankOptionsQuery.data?.banks ?? []) {
      if (b.bank_name?.trim().toLowerCase() === norm && b.bank_branch) set.add(b.bank_branch)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [bankOptionsQuery.data, bankName])

  const mdRemarks = useMemo(() => {
    if (!data?.remarks && !data?.proforma) return []
    const list: { user: string; role: string; remark: string; date?: string }[] = []
    const seen = new Set<string>()

    for (const r of data?.remarks || []) {
      if (isRealRemarkText(r.remark)) {
        const roleLower = (r.createdByRole || '').toLowerCase()
        const userLower = (r.createdByName || '').toLowerCase()
        if (roleLower.includes('md') || roleLower.includes('management') || roleLower.includes('ceo') ||
            userLower.includes('md') || userLower.includes('management') || /\[MD/i.test(r.remark)) {
          const text = r.remark.trim()
          if (!seen.has(text)) {
            seen.add(text)
            list.push({ user: r.createdByName || 'MD / Management', role: 'MD', remark: text, date: formatDate(r.createdAt) })
          }
        }
      }
    }

    if (data?.proforma) {
      const pRemarks = getFinanceRowMdRemarks(data.proforma as any)
      for (const item of pRemarks) {
        const text = item.remark.trim()
        if (!seen.has(text)) {
          seen.add(text)
          list.push(item)
        }
      }
    }

    return list
  }, [data?.remarks, data?.proforma])

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
  if (isError || !data) return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(error as Error)?.message || 'Failed to load finance record.'}</div>
    </div>
  )

  const { processing, proforma, booking, remarks, bankAttempts, activity } = data
  const p = proforma as Record<string, unknown>
  const status = statusMeta(processing.financeStatus)
  const isCompleted = processing.financeStatus === 'completed'
  // Business rule: financing can be completed once the vehicle is delivered OR Accounts has confirmed
  // payment received (paymentReceived is server-derived from booking status 'ready_delivery' / metadata).
  const isDelivered = booking?.status === 'delivered' || Boolean(booking?.deliveredAt)
  const paymentReceived = Boolean(booking?.paymentReceived)
  const isBypassRole = ['finance_head', 'admin', 'developer', 'md'].includes(currentUserRole || '')
  const canComplete = isDelivered || paymentReceived || isBypassRole
  const countdown = formatCountdown(processing.expectedCompletionDate, now)
  const busy = mutation.isPending

  const submitDelay = () => {
    if (!delayDate || !delayReason) return
    if (delayReason === 'Other' && !delayCustom.trim()) return
    mutation.mutate(
      { action: 'delay', newDate: new Date(delayDate).toISOString(), reasonCategory: delayReason, reason: delayReason === 'Other' ? delayCustom.trim() : null },
      { onSuccess: () => { setDelayOpen(false); setDelayDate(''); setDelayReason(''); setDelayCustom('') } },
    )
  }
  const submitBank = () => {
    if (!bankName || !bankBranch) return
    mutation.mutate(
      { action: 'bank-add', bankName, bankBranch },
      { onSuccess: () => { setBankOpen(false); setBankName(''); setBankBranch('') } },
    )
  }
  const submitReject = () => {
    if (!rejectAttempt) return
    mutation.mutate(
      { action: 'bank-resolve', attemptId: rejectAttempt.id, status: 'Rejected', rejectionReason: rejectReason.trim() || null },
      { onSuccess: () => { setRejectAttempt(null); setRejectReason('') } },
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Queue</Button>
          <div>
            <h2 className="text-lg font-black text-slate-800">{str(p.customerName) || 'Customer'}</h2>
            <p className="text-xs font-semibold text-slate-500">{str(p.modelName)} · {str(p.trimDescription)} {str(p.vehicleColor) ? `· ${str(p.vehicleColor)}` : ''}</p>
          </div>
        </div>
        <span className={cn('rounded-full border px-3 py-1 text-xs font-bold', status.className)}>{status.label}</span>
      </div>

      {actionError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">{actionError}</div>
      )}

      {mdRemarks.length > 0 && (
        <Card className="border-2 border-rose-200 bg-rose-50/90 p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-rose-900 font-black">
            <MessageSquare className="h-4.5 w-4.5 text-rose-600" />
            <h3 className="text-xs uppercase tracking-wider">MD / Management Remarks</h3>
          </div>
          <div className="space-y-2">
            {mdRemarks.map((item, i) => (
              <div key={i} className="rounded-xl bg-white p-3.5 border border-rose-200/80 shadow-2xs">
                <p className="text-xs font-bold text-rose-950 italic">"{item.remark}"</p>
                <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-rose-700">
                  <span>{item.user}</span>
                  <span className="rounded bg-rose-100 px-2 py-0.5 font-bold uppercase">{item.role}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-5 lg:col-span-2">
          {/* Status + countdown + actions */}
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Expected completion</p>
                <p className="mt-0.5 text-sm font-bold text-slate-800">{formatDateTime(processing.expectedCompletionDate)}</p>
                <div className={cn('mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-black',
                  isCompleted ? 'bg-emerald-50 text-emerald-700' : countdown.overdue ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-indigo-700')}>
                  {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : countdown.overdue ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  {isCompleted ? `Completed ${formatDate(processing.completedAt)}` : countdown.label}
                </div>
                <p className="mt-2 text-[11px] font-semibold text-slate-400">
                  Base window {processing.baseHours}h · started {formatDateTime(processing.startedAt)}
                  {processing.delayCount > 0 ? ` · ${processing.delayCount} delay${processing.delayCount > 1 ? 's' : ''}` : ''}
                </p>
                <p className="mt-1 text-[11px] font-bold">
                  <span className="text-slate-400">Vehicle: </span>
                  <span className={canComplete ? 'text-emerald-600' : 'text-amber-600'}>
                    {isDelivered ? 'Delivered' : paymentReceived ? 'Payment received' : `Awaiting delivery / payment${booking?.status ? ` · ${str(booking.status).replace(/_/g, ' ')}` : ''}`}
                  </span>
                </p>
              </div>
              {canApprove && !isCompleted && (
                <div className="flex flex-col items-stretch gap-2">
                  <Button size="sm" variant="ghost" className="border border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900 font-bold" onClick={() => setDelayOpen(true)} disabled={busy}>
                    <CalendarClock className="h-4 w-4 text-amber-700" /> Delay
                  </Button>
                  <Button size="sm" onClick={() => mutation.mutate({ action: 'complete' })} disabled={busy || !canComplete}
                    title={canComplete ? undefined : 'Available after the vehicle is delivered or Accounts confirms payment received'}>
                    <CheckCircle2 className="h-4 w-4" /> Mark Financing Complete
                  </Button>
                  {!canComplete && <span className="text-right text-[10px] font-semibold text-amber-600">Enabled once the vehicle is delivered or Accounts confirms payment</span>}
                </div>
              )}
              {canApprove && isCompleted && (
                <Button size="sm" variant="outline" onClick={() => mutation.mutate({ action: 'reopen' })} disabled={busy}>
                  <RotateCcw className="h-4 w-4" /> Reopen Financing
                </Button>
              )}
            </div>
            {processing.financeStatus === 'delayed' && processing.lastDelayReasonCategory && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Last delay: {processing.lastDelayReasonCategory}{processing.lastDelayReason ? ` — ${processing.lastDelayReason}` : ''}
              </div>
            )}
          </Card>

          {/* Proforma info */}
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-black uppercase tracking-wide text-slate-500">Proforma Details</h3>
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3">
              <Field label="Customer" value={str(p.customerName) || '—'} />
              <Field label="Mobile" value={str(p.mobileNumber) || '—'} />
              <Field label="Email" value={str(p.customerEmail) || '—'} />
              <Field label="Customer Type" value={str(p.customerType) || '—'} />
              <Field label="Model" value={str(p.modelName) || '—'} />
              <Field label="Variant" value={str(p.trimDescription) || '—'} />
              <Field label="Fuel" value={str(p.fuelType) || '—'} />
              <Field label="Colour" value={str(p.vehicleColor) || '—'} />
              <Field label="Location" value={str(p.location) || '—'} />
              <Field label="Consultant" value={str(p.consultant) || '—'} />
              <Field label="Booking No." value={booking?.bookingNumber || '—'} />
              <Field label="Loan Amount" value={formatCurrency(p.loanAmount)} />
              <Field label="Ex-Showroom" value={formatCurrency(p.exShowroom)} />
              <Field label="Grand Total" value={<span className="font-black text-slate-900">{formatCurrency(p.grandTotalCost)}</span>} />
              <Field label="Proforma Date" value={formatDate(str(p.proformaDate))} />
            </div>
          </Card>

          {/* Bank Management */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-500"><Landmark className="h-4 w-4" /> Financing Bank</h3>
              {canApprove && !isCompleted && (
                <Button size="sm" variant="ghost" className="border border-blue-300 bg-blue-100 text-blue-800 hover:bg-blue-200 hover:text-blue-900 font-bold" onClick={() => { setBankOpen(true); setBankName(''); setBankBranch('') }} disabled={busy}>
                  <Banknote className="h-4 w-4 text-blue-700" /> Add Bank
                </Button>
              )}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs font-bold text-slate-500">Current:</span>
              <span className="text-sm font-black text-slate-800">{processing.currentBankName || '—'}</span>
              {processing.currentBankBranch && <span className="text-xs font-semibold text-slate-500">· {processing.currentBankBranch}</span>}
              {processing.currentBankStatus && (
                <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', bankStatusMeta(processing.currentBankStatus))}>{processing.currentBankStatus}</span>
              )}
            </div>
            {bankAttempts.length === 0 ? (
              <p className="text-xs font-semibold text-slate-400">No bank attempts recorded.</p>
            ) : (
              <div className="space-y-2">
                {bankAttempts.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-400">#{a.attemptNo}</span>
                        <span className="text-sm font-bold text-slate-800">{a.bankName}</span>
                        <span className="text-xs font-semibold text-slate-500">· {a.bankBranch}</span>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', bankStatusMeta(a.status))}>{a.status}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                        {formatDateTime(a.createdAt)} · {a.createdByName}
                        {a.rejectionReason ? <span className="text-rose-600"> · {a.rejectionReason}</span> : ''}
                      </p>
                    </div>
                    {canApprove && !isCompleted && a.status === 'Pending' && (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => mutation.mutate({ action: 'bank-resolve', attemptId: a.id, status: 'Approved' })} disabled={busy}>
                          <ShieldCheck className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50"
                          onClick={() => { setRejectAttempt(a); setRejectReason('') }} disabled={busy}>
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Remarks */}
          <Card className="p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-500"><MessageSquarePlus className="h-4 w-4" /> Finance Remarks</h3>
            {canApprove && (
              <div className="mb-4 space-y-2">
                <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Add a remark (kept as permanent history)…" rows={2} />
                <div className="flex justify-end">
                  <Button size="sm" disabled={busy || !remark.trim()}
                    onClick={() => mutation.mutate({ action: 'remark', remark: remark.trim() }, { onSuccess: () => setRemark('') })}>
                    Add Remark
                  </Button>
                </div>
              </div>
            )}
            {remarks.length === 0 ? (
              <p className="text-xs font-semibold text-slate-400">No remarks yet.</p>
            ) : (
              <div className="space-y-3">
                {[...remarks].reverse().map((r) => (
                  <div key={r.id} className={cn("rounded-lg border px-3 py-2", getRemarkRoleStyles(r.createdByRole))}>
                    <p className="text-sm font-medium whitespace-pre-wrap">{r.remark}</p>
                    <p className="mt-1 text-[11px] font-semibold opacity-75">{r.createdByName} · {roleLabel(r.createdByRole)} · {formatDateTime(r.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Activity log */}
        <div className="lg:col-span-1">
          <Card className="p-5 lg:sticky lg:top-4">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-500"><History className="h-4 w-4" /> Activity Log</h3>
            {activity.length === 0 ? (
              <p className="text-xs font-semibold text-slate-400">No activity yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-4">
                {activity.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500" />
                    <p className="text-sm font-bold text-slate-800">{a.title}</p>
                    {a.description && (
                      <div className={cn(
                        "mt-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold border w-fit max-w-full break-words",
                        getRemarkRoleStyles(a.actorRole)
                      )}>
                        {a.description}
                      </div>
                    )}
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                      <User className="h-3 w-3" /> {a.actorName} · {roleLabel(a.actorRole)}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-400">{formatDateTime(a.createdAt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {/* Delay dialog */}
      <Dialog open={delayOpen} onOpenChange={(o) => !busy && setDelayOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delay Financing</DialogTitle>
            <DialogDescription>Set a new expected completion date and select a reason. This is recorded in the activity log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-500">New expected completion date & time</label>
              <Input type="datetime-local" value={delayDate} onChange={(e) => setDelayDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500">Delay reason</label>
              <select value={delayReason} onChange={(e) => setDelayReason(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800">
                <option value="">Select a reason…</option>
                {DELAY_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {delayReason === 'Other' && (
              <div>
                <label className="text-xs font-bold text-slate-500">Custom reason</label>
                <Textarea value={delayCustom} onChange={(e) => setDelayCustom(e.target.value)} rows={2} placeholder="Describe the reason…" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelayOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submitDelay} disabled={busy || !delayDate || !delayReason || (delayReason === 'Other' && !delayCustom.trim())}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Delay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add bank dialog */}
      <Dialog open={bankOpen} onOpenChange={(o) => !busy && setBankOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Financing Bank</DialogTitle>
            <DialogDescription>Select a bank and branch. The previous attempt is kept in history; this becomes the current bank.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-500">Bank</label>
              <select value={bankName} onChange={(e) => { setBankName(e.target.value); setBankBranch('') }}
                className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800">
                <option value="">{bankOptionsQuery.isLoading ? 'Loading banks…' : 'Select a bank…'}</option>
                {bankNames.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500">Branch</label>
              <select value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} disabled={!bankName}
                className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 disabled:bg-slate-100">
                <option value="">{bankName ? 'Select a branch…' : 'Select a bank first'}</option>
                {branchesForBank.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBankOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submitBank} disabled={busy || !bankName || !bankBranch}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add Bank
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject bank dialog */}
      <Dialog open={Boolean(rejectAttempt)} onOpenChange={(o) => !busy && !o && setRejectAttempt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Bank Attempt</DialogTitle>
            <DialogDescription>{rejectAttempt ? `${rejectAttempt.bankName} · ${rejectAttempt.bankBranch}` : ''}</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-xs font-bold text-slate-500">Rejection reason</label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="Why was the bank rejected? (optional)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectAttempt(null)} disabled={busy}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={submitReject} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
