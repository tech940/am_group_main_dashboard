'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Clock, AlertTriangle, CheckCircle2, ChevronRight, Inbox, ClipboardCheck, ShieldCheck, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FinanceDetail } from './finance-detail'
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

export function FinanceWorkspace({ canApprove }: { canApprove: boolean }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'queue' | 'processing'>('queue')
  const [selected, setSelected] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [declineRow, setDeclineRow] = useState<ApprovalQueueRow | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

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

  if (selected) return <FinanceDetail proformaId={selected} canApprove={canApprove} onBack={() => setSelected(null)} />

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
      </div>

      {actionError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">{actionError}</div>}

      {tab === 'queue' ? (
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
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-500">{formatDate(r.proformaDate)}</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{str(r.customerName) || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{str(r.modelName)} <span className="text-slate-400">· {str(r.trimDescription)}</span></td>
                      <td className="px-4 py-3 text-slate-600">{str(r.bankName) || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency(r.grandTotalCost)}</td>
                      <td className="px-4 py-3 text-slate-600">{str(r.consultant) || '—'}</td>
                      {canApprove && (
                        <td className="px-4 py-3">
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
    </div>
  )
}
