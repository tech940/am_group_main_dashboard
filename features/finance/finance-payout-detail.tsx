'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X, Loader2, Save, User2, Car, FileText, Landmark, Wallet, Users, History, MessageSquare,
  BadgeIndianRupee, Lock,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Chip, FieldValue, IconTile, InspectorSkeleton } from '@/components/kia/premium'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  auditValue, dealerLabel, fieldLabel, formatDate, formatDateTime, formatMoney,
  payoutStatusMeta, receiptStatusMeta, PAYOUT_STATUS_OPTIONS, RECEIPT_STATUS_OPTIONS,
  type PayoutDetailResponse, type PayoutRow,
} from './payouts-shared'

async function fetchDetail(id: string): Promise<PayoutDetailResponse> {
  const res = await fetch(`/api/finance/payouts/${id}`, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load the record')
  return data
}

/** The finance-editable fields, grouped exactly as the detail page presents them. */
type EditState = Record<string, string>

const toEdit = (p: PayoutRow): EditState => ({
  payoutStatus: p.payoutStatus ?? '',
  reasonIfOuthouse: p.reasonIfOuthouse ?? '',
  dealerPayoutPercent: p.dealerPayoutPercent ?? '',
  dealerPayoutAmount: p.dealerPayoutAmount ?? '',
  payoutReceiptStatus: p.payoutReceiptStatus ?? '',
  dsePayoutAmount: p.dsePayoutAmount ?? '',
  dsePayoutStatus: p.dsePayoutStatus ?? '',
  dealerPayoutStatus: p.dealerPayoutStatus ?? '',
  paymentReceivedDate: p.paymentReceivedDate?.slice(0, 10) ?? '',
  amountReceived: p.amountReceived ?? '',
  invoiceNumber: p.invoiceNumber ?? '',
  bankVisitScheduled: p.bankVisitScheduled ? 'yes' : 'no',
  dateOfBankVisit: p.dateOfBankVisit?.slice(0, 10) ?? '',
  visitedBy: p.visitedBy ?? '',
  bankerRemarks: p.bankerRemarks ?? '',
  hypAsPerRc: p.hypAsPerRc ?? '',
  loginUser: p.loginUser ?? '',
  bankInterestRate: p.bankInterestRate ?? '',
  bankLogin: p.bankLogin === null ? '' : p.bankLogin ? 'yes' : 'no',
  bankInProforma: p.bankInProforma ?? '',
  vehicleRegistrationNo: p.vehicleRegistrationNo ?? '',
})

export function FinancePayoutDetail({ id, onClose, onSaved }: {
  id: string
  onClose: () => void
  onSaved: () => void
}) {
  /**
   * `edits` is an OVERLAY of just what the user touched — not a copy of the record.
   *
   * The obvious shape (copy the record into state, re-sync with an effect when it reloads) needs a
   * setState inside an effect, which costs an extra render pass and is exactly what
   * react-hooks/set-state-in-effect rejects. Deriving `value = edits[k] ?? base[k]` means the form
   * follows the server automatically: after a save, refetch gives a new `base` and the overlay is
   * cleared, so the inputs show what was actually STORED (coerced numbers/dates), not what was typed.
   */
  const [edits, setEdits] = useState<Partial<EditState>>({})
  const [saving, setSaving] = useState(false)

  const query = useQuery<PayoutDetailResponse>({
    queryKey: ['finance-payout', id],
    queryFn: () => fetchDetail(id),
  })

  const payout = query.data?.payout
  const canEdit = query.data?.canEdit ?? false

  const base = useMemo(() => (payout ? toEdit(payout) : null), [payout])
  // The spread is (base ∪ overlay); every key of `base` is present, so the result is a full
  // EditState — TS can't see that through Partial, hence the assertion.
  const edit: EditState | null = useMemo(() => (base ? { ...base, ...edits } as EditState : null), [base, edits])
  const dirty = useMemo(
    () => (base ? Object.keys(edits).filter((k) => edits[k] !== base[k]) : []),
    [base, edits],
  )

  const set = (k: string, v: string) => setEdits((prev) => ({ ...prev, [k]: v }))

  async function save() {
    if (!edit || !dirty.length) return
    setSaving(true)
    try {
      // Send ONLY what changed — the server audits per field, so a full-object PATCH would either
      // spam the trail or force it to diff.
      const patch: Record<string, unknown> = {}
      for (const k of dirty) {
        const v = edit[k]
        if (k === 'bankVisitScheduled') patch[k] = v === 'yes'
        else if (k === 'bankLogin') patch[k] = v === '' ? null : v === 'yes'
        else patch[k] = v === '' ? null : v
      }
      const res = await fetch(`/api/finance/payouts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      toast({ title: `Saved ${data.changed} change${data.changed === 1 ? '' : 's'}`, variant: 'success' })
      setEdits({}) // drop the overlay — the refetch below is now the source of truth
      await query.refetch()
      onSaved()
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : 'Try again', variant: 'error' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      {/* kia-premium MUST be re-applied here: the dialog is portalled out of the page, so it would
          otherwise land outside the token scope and render unstyled. */}
      <DialogContent
        className="kia-premium fixed left-auto right-0 top-0 h-full w-full max-w-3xl translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-l p-0 sm:rounded-none"
        style={{ background: 'var(--kia-canvas)' }}
      >
        <DialogTitle className="sr-only">Finance payout record</DialogTitle>

        {query.isLoading || !payout || !edit ? (
          <div className="p-6"><InspectorSkeleton /></div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[var(--kia-hairline)] px-5 py-4">
              <div className="min-w-0">
                <p className="kia-kicker">Finance Payout</p>
                <h2 className="truncate text-xl font-black text-[var(--kia-text)]">{payout.customerName || 'Customer'}</h2>
                <p className="mt-0.5 truncate text-[12px] font-semibold text-[var(--kia-text-soft)]">
                  {payout.model || '—'} · {dealerLabel(payout.dealerCode)} · Delivered {formatDate(payout.deliveryDate)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {payout.payoutStatus && (
                  <Chip tone={payoutStatusMeta(payout.payoutStatus).tone} dot>{payoutStatusMeta(payout.payoutStatus).label}</Chip>
                )}
                {payout.payoutReceiptStatus && (
                  <Chip tone={receiptStatusMeta(payout.payoutReceiptStatus).tone} dot>{receiptStatusMeta(payout.payoutReceiptStatus).label}</Chip>
                )}
                <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--kia-text-faint)] hover:bg-[var(--kia-surface-sunken)]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="kia-scroll flex-1 space-y-4 overflow-auto p-5 pb-24">
              {/* --- Read-only: sourced from the delivered booking --- */}
              <Card icon={User2} tone="indigo" title="Customer" kicker="From the booking">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <FieldValue label="Name" value={payout.customerName} />
                  <FieldValue label="Mobile" value={payout.customerPhone} mono />
                  <FieldValue label="PAN" value={payout.panNumber} mono />
                </div>
                {payout.customerPhone === '••••••' && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--kia-text-faint)]">
                    <Lock className="h-3 w-3" /> Mobile numbers are visible to MD and Developer only.
                  </p>
                )}
              </Card>

              <Card icon={Car} tone="sky" title="Vehicle" kicker="From the booking">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <FieldValue label="Model" value={payout.model} />
                  <FieldValue label="Dealer" value={dealerLabel(payout.dealerCode)} />
                  <EditText label="Registration No" value={edit.vehicleRegistrationNo} onChange={(v) => set('vehicleRegistrationNo', v)} disabled={!canEdit} mono />
                </div>
              </Card>

              <Card icon={FileText} tone="violet" title="Booking" kicker="From the booking">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <FieldValue label="Delivery Date" value={formatDate(payout.deliveryDate)} />
                  <FieldValue label="Sales Executive" value={payout.salesExecutive} />
                  <FieldValue label="Team Leader" value={payout.tlName} />
                  <FieldValue label="Source" value={payout.source === 'import' ? 'Legacy import' : 'Delivered booking'} />
                </div>
              </Card>

              <Card icon={BadgeIndianRupee} tone="teal" title="Loan" kicker="From the booking">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <FieldValue label="Loan Amount" value={formatMoney(payout.loanAmount)} />
                  <FieldValue label="Hypothecation" value={payout.hyp} />
                  <FieldValue label="Bank Branch" value={payout.bankBranch} />
                </div>
              </Card>

              {/* --- Editable: finance-owned --- */}
              <Card icon={Landmark} tone="amber" title="Bank" kicker="Finance">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <EditText label="HYP as per RC" value={edit.hypAsPerRc} onChange={(v) => set('hypAsPerRc', v)} disabled={!canEdit} />
                  <EditText label="Bank in Proforma" value={edit.bankInProforma} onChange={(v) => set('bankInProforma', v)} disabled={!canEdit} />
                  <EditText label="Interest Rate (%)" value={edit.bankInterestRate} onChange={(v) => set('bankInterestRate', v)} disabled={!canEdit} />
                  <EditSelect label="Bank Login" value={edit.bankLogin} onChange={(v) => set('bankLogin', v)} disabled={!canEdit}
                    options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                  <EditSelect label="Bank Visit Scheduled" value={edit.bankVisitScheduled} onChange={(v) => set('bankVisitScheduled', v)} disabled={!canEdit}
                    options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
                  <EditText label="Date of Bank Visit" value={edit.dateOfBankVisit} onChange={(v) => set('dateOfBankVisit', v)} disabled={!canEdit} type="date" />
                  <EditText label="Visited By" value={edit.visitedBy} onChange={(v) => set('visitedBy', v)} disabled={!canEdit} />
                  <EditText label="Login User" value={edit.loginUser} onChange={(v) => set('loginUser', v)} disabled={!canEdit} />
                </div>
              </Card>

              <Card icon={Wallet} tone="indigo" title="Dealer Payout" kicker="Finance">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <EditSelect label="Payout Status" value={edit.payoutStatus} onChange={(v) => set('payoutStatus', v)} disabled={!canEdit} options={PAYOUT_STATUS_OPTIONS} />
                  <EditText label="Reason (Out House)" value={edit.reasonIfOuthouse} onChange={(v) => set('reasonIfOuthouse', v)} disabled={!canEdit} />
                  <EditText label="Dealer Payout %" value={edit.dealerPayoutPercent} onChange={(v) => set('dealerPayoutPercent', v)} disabled={!canEdit} />
                  <EditText label="Dealer Payout Amount" value={edit.dealerPayoutAmount} onChange={(v) => set('dealerPayoutAmount', v)} disabled={!canEdit} />
                  <EditText label="Dealer Payout Status" value={edit.dealerPayoutStatus} onChange={(v) => set('dealerPayoutStatus', v)} disabled={!canEdit} />
                  <EditSelect label="Receipt Status" value={edit.payoutReceiptStatus} onChange={(v) => set('payoutReceiptStatus', v)} disabled={!canEdit} options={RECEIPT_STATUS_OPTIONS} />
                  <EditText label="Payment Received Date" value={edit.paymentReceivedDate} onChange={(v) => set('paymentReceivedDate', v)} disabled={!canEdit} type="date" />
                  <EditText label="Amount Received" value={edit.amountReceived} onChange={(v) => set('amountReceived', v)} disabled={!canEdit} />
                  <EditText label="Invoice Number" value={edit.invoiceNumber} onChange={(v) => set('invoiceNumber', v)} disabled={!canEdit} />
                </div>
              </Card>

              <Card icon={Users} tone="rose" title="DSE Payout" kicker="Finance">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <EditText label="DSE Payout Amount" value={edit.dsePayoutAmount} onChange={(v) => set('dsePayoutAmount', v)} disabled={!canEdit} />
                  <EditText label="DSE Payout Status" value={edit.dsePayoutStatus} onChange={(v) => set('dsePayoutStatus', v)} disabled={!canEdit} />
                </div>
              </Card>

              <Card icon={MessageSquare} tone="neutral" title="Remarks" kicker="Finance">
                <textarea
                  value={edit.bankerRemarks}
                  onChange={(e) => set('bankerRemarks', e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                  placeholder="Banker remarks…"
                  className="w-full rounded-xl border border-[var(--kia-hairline)] bg-[var(--kia-surface-sunken)] px-3 py-2 text-sm font-medium text-[var(--kia-text)] outline-none focus:border-[var(--kia-accent)] disabled:opacity-60"
                />
              </Card>

              {/* --- Timeline: the immutable audit trail --- */}
              <Card icon={History} tone="violet" title="Timeline" kicker={`${query.data?.activity.length ?? 0} change${query.data?.activity.length === 1 ? '' : 's'}`}>
                {!query.data?.activity.length ? (
                  <p className="py-4 text-center text-[13px] font-semibold text-[var(--kia-text-faint)]">
                    No edits yet. Every change to a finance field is recorded here.
                  </p>
                ) : (
                  <ol className="relative ml-2 space-y-4 border-l border-dashed border-[var(--kia-hairline-strong)] pl-5">
                    {query.data.activity.map((a) => (
                      <li key={a.id} className="relative">
                        <span
                          className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-[var(--kia-surface)]"
                          style={{ background: 'var(--kia-accent)' }}
                        />
                        <p className="text-[13px] font-bold text-[var(--kia-text)]">{fieldLabel(a.field)}</p>
                        <p className="mt-0.5 text-[12px] font-semibold">
                          <span className="text-[var(--kia-text-faint)] line-through">{auditValue(a.before)}</span>
                          <span className="mx-1.5 text-[var(--kia-text-faint)]">→</span>
                          <span className="text-[var(--kia-text)]">{auditValue(a.after)}</span>
                        </p>
                        <p className="mt-0.5 text-[11px] font-semibold text-[var(--kia-text-faint)]">
                          {a.actorName} · {a.actorRole.replace(/_/g, ' ')} · {formatDateTime(a.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>

            {/* Save bar — only when there is something to save. */}
            {canEdit && dirty.length > 0 && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-[var(--kia-hairline)] bg-[var(--kia-surface)] px-5 py-3">
                <p className="text-[12px] font-bold text-[var(--kia-text-soft)]">
                  {dirty.length} unsaved change{dirty.length === 1 ? '' : 's'}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="h-9 rounded-xl text-xs font-bold" onClick={() => setEdits({})} disabled={saving}>
                    Discard
                  </Button>
                  <Button className="h-9 gap-1.5 rounded-xl px-5 text-xs font-bold" onClick={() => void save()} disabled={saving}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                  </Button>
                </div>
              </div>
            )}
            {!canEdit && (
              <div className="absolute inset-x-0 bottom-0 border-t border-[var(--kia-hairline)] bg-[var(--kia-surface)] px-5 py-3">
                <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--kia-text-faint)]">
                  <Lock className="h-3.5 w-3.5" /> Read-only — you don&apos;t have permission to edit payout fields.
                </p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** A titled premium card. Local rather than the shared `Section` so the grid/º spacing stays tight. */
function Card({ icon: Icon, tone, title, kicker, children }: {
  icon: typeof User2
  tone: 'indigo' | 'sky' | 'violet' | 'teal' | 'amber' | 'rose' | 'neutral'
  title: string
  kicker?: string
  children: React.ReactNode
}) {
  return (
    <section className="kia-surface p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <IconTile icon={Icon} tone={tone} size="sm" />
        <div>
          <h3 className="text-[13px] font-black text-[var(--kia-text)]">{title}</h3>
          {kicker && <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-faint)]">{kicker}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function EditText({ label, value, onChange, disabled, type = 'text', mono }: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  type?: string
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-faint)]">{label}</span>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn('mt-1 h-9 rounded-xl text-[13px] font-semibold', mono && 'font-mono')}
      />
    </label>
  )
}

function EditSelect({ label, value, onChange, disabled, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  options: { value: string; label: string }[]
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-faint)]">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="mt-1 h-9 rounded-xl text-[13px] font-semibold"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  )
}
