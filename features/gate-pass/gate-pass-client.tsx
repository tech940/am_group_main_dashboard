'use client'

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ScanLine, Plus, RefreshCw, Search, Download, Loader2, QrCode, Check, X, Ban, Copy, ExternalLink,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { formatIndiaDateTime } from '@/lib/date-time'
import { getGatePassStatusInfo } from '@/lib/gate-pass/status'
import { isGatePassApproverRole } from '@/lib/gate-pass/access-shared'
import { GatePassFormDialog } from './gate-pass-form-dialog'

export type GatePassCurrentUser = {
  id: string
  role: string
  fullName: string
  email: string
  brand: string | null
  dealers: string | null
}

type PassRow = {
  id: string
  passNo: string
  status: string
  dealerCode: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  driverName: string
  purpose: string
  purposeNote: string | null
  expectedReturnAt: string
  requestedByName: string
  requestedBy: string | null
  approvedByName: string | null
  approvalRemarks: string | null
  gateOutAt: string | null
  gateOutOdo: string | null
  gateOutGuardName: string | null
  gateInAt: string | null
  gateInOdo: string | null
  gateInGuardName: string | null
  parkedLocation: string | null
  createdAt: string
}

const TABS = [
  { key: 'awaiting', label: 'Awaiting approval', status: 'pending_approval' },
  { key: 'out', label: 'Out now', status: 'out' },
  { key: 'approved', label: 'Approved', status: 'approved' },
  { key: 'closed', label: 'Closed', status: 'returned,rejected,cancelled,expired' },
  { key: 'all', label: 'All', status: '' },
] as const

/**
 * ⚠️ Status pill colours are set with inline style, not Tailwind classes.
 *
 * app/globals.css carries an unscoped `@layer utilities` rescue net that redefines the green /
 * emerald / amber / rose / red text and background utilities to theme tokens with `!important`, and
 * a separate rule forces certain backgrounds to #ffffff inside any <table>. A `bg-amber-100` pill
 * therefore does not render amber here. Inline style is the one thing that net cannot override.
 */
const TONE_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#fef3c7', fg: '#92400e' },
  success: { bg: '#d1fae5', fg: '#065f46' },
  active: { bg: '#e0e7ff', fg: '#3730a3' },
  danger: { bg: '#ffe4e6', fg: '#9f1239' },
  muted: { bg: '#f1f5f9', fg: '#475569' },
}

function StatusPill({ status }: { status: string }) {
  const info = getGatePassStatusInfo(status)
  const tone = TONE_STYLE[info.tone] ?? TONE_STYLE.muted
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {info.pillLabel}
    </span>
  )
}

export function GatePassClient({ currentUser }: { currentUser: GatePassCurrentUser }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('awaiting')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [decisionFor, setDecisionFor] = useState<PassRow | null>(null)
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve')
  const [remarks, setRemarks] = useState('')
  const [acting, setActing] = useState(false)
  const [qr, setQr] = useState<{ passNo: string; dataUrl: string; purpose: string; url: string } | null>(null)

  const canApprove = isGatePassApproverRole(currentUser.role)
  const statusFilter = TABS.find((t) => t.key === tab)?.status ?? ''

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['gate-passes', tab, search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search) params.set('search', search)
      params.set('_t', Date.now().toString())
      const res = await fetch(`/api/gate-pass?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load gate passes.')
      return res.json() as Promise<{ rows: PassRow[]; total: number; roleFiltered: boolean }>
    },
  })

  const rows = data?.rows ?? []

  const act = async () => {
    if (!decisionFor) return
    if (decision === 'reject' && !remarks.trim()) {
      toast({ title: 'Say why', description: 'A rejection needs a reason.', variant: 'error' })
      return
    }
    setActing(true)
    try {
      const res = await fetch(`/api/gate-pass/${decisionFor.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, remarks: remarks.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not record that.')
      toast({
        title: decision === 'approve' ? 'Approved' : 'Rejected',
        description: decision === 'approve'
          ? 'The requester has been emailed the gate QR code.'
          : 'The requester has been told why.',
        variant: 'success',
      })
      const approved = decisionFor
      setDecisionFor(null); setRemarks('')
      await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
      await refetch()
      /*
       * ⚠️ An approved pass LEAVES the tab you were looking at. Without this the row simply
       * vanishes and nothing says where it went or what happens next — which reads as "the QR was
       * never generated". Move to the tab it landed on and put the code straight on screen, because
       * showing the QR IS the next step.
       */
      if (decision === 'approve') {
        setTab('approved')
        await showQr(approved)
      }
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'error' })
    } finally {
      setActing(false)
    }
  }

  const cancel = async (row: PassRow) => {
    try {
      const res = await fetch(`/api/gate-pass/${row.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Withdrawn by requester' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not cancel.')
      toast({ title: 'Cancelled', variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
      await refetch()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'error' })
    }
  }

  const showQr = async (row: PassRow) => {
    try {
      const res = await fetch(`/api/gate-pass/${row.id}/qr`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'No code available.')
      setQr({ passNo: row.passNo, dataUrl: json.dataUrl, purpose: json.purpose, url: json.url })
    } catch (e) {
      toast({ title: 'No QR', description: e instanceof Error ? e.message : '', variant: 'error' })
    }
  }

  return (
    <MainLayout>
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600"><ScanLine className="h-5 w-5" /></div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Demo Car GatePass</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Raise a pass, get it approved, and log the car out and back in at the gate.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/gate-pass/export?status=${encodeURIComponent(statusFilter)}`}>
                <Download className="mr-1.5 h-4 w-4" /> Export
              </a>
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New pass
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              {TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9"
              placeholder="Pass number, registration, model, driver" />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Pass</th>
                  <th className="px-4 py-2.5 font-medium">Vehicle</th>
                  <th className="px-4 py-2.5 font-medium">Driver</th>
                  <th className="px-4 py-2.5 font-medium">Purpose</th>
                  <th className="px-4 py-2.5 font-medium">Due back</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    {tab === 'awaiting'
                      ? 'Nothing waiting for approval.'
                      : 'No gate passes here yet.'}
                  </td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.passNo}</div>
                      <div className="text-xs text-slate-500">{row.requestedByName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.registrationNumber || '—'}</div>
                      <div className="text-xs text-slate-500">
                        {[row.model, row.color].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.driverName}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.purpose}
                      {row.purposeNote ? <div className="text-xs text-slate-500">{row.purposeNote}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatIndiaDateTime(row.expectedReturnAt) ?? '—'}</td>
                    <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {(row.status === 'approved' || row.status === 'out') ? (
                          <Button size="sm" onClick={() => showQr(row)}>
                            <QrCode className="mr-1 h-3.5 w-3.5" />
                            {row.status === 'approved' ? 'Gate QR' : 'Return QR'}
                          </Button>
                        ) : null}
                        {canApprove && row.status === 'pending_approval' ? (
                          <>
                            <Button size="sm" onClick={() => { setDecisionFor(row); setDecision('approve'); setRemarks('') }}>
                              <Check className="mr-1 h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="outline"
                              onClick={() => { setDecisionFor(row); setDecision('reject'); setRemarks('') }}>
                              <X className="mr-1 h-3.5 w-3.5" /> Reject
                            </Button>
                          </>
                        ) : null}
                        {row.requestedBy === currentUser.id
                          && (row.status === 'pending_approval' || row.status === 'approved') ? (
                          <Button size="sm" variant="outline" onClick={() => cancel(row)}>
                            <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {rows.length > 0 ? (
          <p className="text-xs text-slate-500">
            Showing {rows.length} pass{rows.length === 1 ? '' : 'es'}
            {/* The count is reported from the row set actually rendered. A server total shown next
                to a client-filtered page is what made "Showing 1-12 of 42" render six rows. */}
          </p>
        ) : null}
      </div>

      <GatePassFormDialog open={createOpen} onOpenChange={setCreateOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['gate-passes'] })} />

      <Dialog open={Boolean(decisionFor)} onOpenChange={(o) => { if (!o) setDecisionFor(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decision === 'approve' ? 'Approve' : 'Reject'} {decisionFor?.passNo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {decisionFor?.registrationNumber || 'No registration'} ·{' '}
              {[decisionFor?.model, decisionFor?.color].filter(Boolean).join(' ')} · driven by{' '}
              {decisionFor?.driverName}
            </p>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3}
              placeholder={decision === 'approve' ? 'Remarks (optional)' : 'Why are you rejecting this? (required)'} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionFor(null)} disabled={acting}>Cancel</Button>
            <Button onClick={act} disabled={acting}>
              {acting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {decision === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(qr)} onOpenChange={(o) => { if (!o) setQr(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {qr?.purpose === 'in' ? 'Return code' : 'Gate code'} · {qr?.passNo}
            </DialogTitle>
          </DialogHeader>
          {qr ? (
            <div className="space-y-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.dataUrl} alt="Gate pass QR code" width={260} height={260}
                className="mx-auto rounded-lg border border-slate-200" />
              <p className="text-sm text-slate-600">
                {qr.purpose === 'in'
                  ? 'Show this when the vehicle comes back. The guard scans it and records the closing odometer, photos and a signature.'
                  : 'Show this at the gate. The guard scans it with their own phone camera — no app, no login — then records the odometer, photos and a signature.'}
              </p>
              {/*
                * The link matters as much as the code. You cannot scan a QR with the same screen
                * that is displaying it, so testing on one machine needs this — and in real use it
                * is the fallback when a guard's camera will not focus.
                */}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => {
                  navigator.clipboard?.writeText(qr.url)
                  toast({ title: 'Link copied', description: 'Send it to the guard, or open it here.', variant: 'success' })
                }}>
                  <Copy className="mr-1.5 h-4 w-4" /> Copy link
                </Button>
                <Button variant="outline" className="flex-1" asChild>
                  <a href={qr.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 h-4 w-4" /> Open gate page
                  </a>
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
