'use client'

import * as React from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CalendarClock,
  Car,
  Check,
  ChevronDown,
  CircleDashed,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Handshake,
  History,
  IndianRupee,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { FILE_KIND_POLICY, NOT_TAKEN, formatStockNo, type FileKind } from '@/lib/h-promise/constants'
import { INSURANCE_STATE_LABELS } from '@/lib/h-promise/stage'
import { APPROVAL_LEVEL_LABELS, approvalLevelOf, approvalQueueOf, canDecideAt, finalDeciderLabel, isSelfDecision, type ManagerStatus } from '@/lib/h-promise/status'
import type { HpEvent, HpFileRef, HpVehicleDetail } from '@/lib/h-promise/types'
import { hpSend, useHpMutation, useVehicle, useVehiclePreviews } from './hp-data'
import { useHpSection, useLabel, type VehiclePanel } from './hp-context'
import { approverName, day, days, inr, km, paperworkLabel, soldToLabel, when, yesNo } from './hp-format'
import { FileTile, ReasonDialog } from './hp-form'
import {
  Dl,
  ErrorState,
  Field,
  HpButton,
  LoadingBlock,
  Money,
  Notice,
  RegPlate,
  Skeleton,
  StageChip,
  StatusChip,
  ToneChip,
  type Tone,
} from './hp-ui'
import { PurchaseForm } from './forms/purchase-form'
import { BookingForm, RefundForm, findBooking } from './forms/booking-forms'
import { SaleForm } from './forms/sale-form'
import { BrokerRcForm, DocumentsForm, LedgerForm } from './forms/paperwork-forms'

const PANEL_TITLES: Record<VehiclePanel, string> = {
  overview: '',
  'edit-purchase': 'Edit purchase',
  booking: 'Record booking',
  'booking-edit': 'Correct booking',
  refund: 'Refund booking',
  sale: 'Sale',
  documents: 'Documents',
  'broker-rc': 'RC status (broker)',
  ledger: 'Payment ledger',
}

// ── Lifecycle rail ───────────────────────────────────────────────────────────────────────────────

type StepState = 'done' | 'current' | 'blocked' | 'todo' | 'skip'
type Step = { key: string; label: string; state: StepState; tone: Tone; icon: LucideIcon; note: string }

function queueNote(queue: ReturnType<typeof approvalQueueOf>): string {
  if (queue === 'manager') return 'GSM / SM'
  if (queue === 'md') return 'MD'
  if (queue === 'approved') return 'Approved'
  if (queue === 'rejected') return 'Rejected'
  return '—'
}

function lifecycle(v: HpVehicleDetail): Step[] {
  const saleRecorded = v.saleStatus === 'pending' || v.saleStatus === 'approved'
  const hadBooking = v.bookings.length > 0
  const present = new Set(v.presentFiles)
  const steps: Step[] = [
    { key: 'purchase', label: 'Purchase', state: 'done', tone: 'accent', icon: Car, note: day(v.purchaseDate, false) },
    {
      key: 'approval',
      label: 'Approval',
      state: v.purchaseStatus === 'approved' ? 'done' : v.purchaseStatus === 'rejected' ? 'blocked' : 'current',
      tone: v.purchaseStatus === 'approved' ? 'approved' : v.purchaseStatus === 'rejected' ? 'rejected' : 'pending',
      icon: ClipboardCheck,
      note: queueNote(approvalQueueOf(v.purchaseStatus, v.purchaseManagerStatus)),
    },
    {
      key: 'booking',
      label: 'Booking',
      state: v.booking ? 'done' : saleRecorded && !hadBooking ? 'skip' : 'todo',
      tone: v.booking ? 'booked' : 'neutral',
      icon: CalendarClock,
      note: v.booking ? day(v.booking.bookingDate, false) : saleRecorded && !hadBooking ? 'Direct sale' : hadBooking ? 'Refunded' : 'Open',
    },
    {
      key: 'sale',
      label: 'Sale',
      state: saleRecorded ? 'done' : v.saleStatus === 'rejected' ? 'blocked' : 'todo',
      tone: saleRecorded ? 'sold' : v.saleStatus === 'rejected' ? 'rejected' : 'neutral',
      icon: Handshake,
      note: saleRecorded ? day(v.saleDate, false) : v.saleStatus === 'rejected' ? 'Rejected' : 'Not sold',
    },
    {
      key: 'sale-approval',
      label: 'Sale approval',
      state: v.saleStatus === 'approved' ? 'done' : v.saleStatus === 'pending' ? 'current' : v.saleStatus === 'rejected' ? 'blocked' : 'todo',
      tone: v.saleStatus === 'approved' ? 'approved' : v.saleStatus === 'pending' ? 'pending' : v.saleStatus === 'rejected' ? 'rejected' : 'neutral',
      icon: BadgeCheck,
      note: v.saleStatus ? queueNote(approvalQueueOf(v.saleStatus, v.saleManagerStatus)) : '—',
    },
    {
      key: 'ledger',
      label: 'Ledger',
      state: present.has('payment_ledger') ? 'done' : saleRecorded ? 'current' : 'todo',
      tone: present.has('payment_ledger') ? 'approved' : saleRecorded ? 'pending' : 'neutral',
      icon: Wallet,
      note: present.has('payment_ledger') ? 'Verified' : saleRecorded ? 'Due' : '—',
    },
    {
      key: 'documents',
      label: 'Documents',
      state: !v.flags.docsMissing && ['rc', 'seller_pan', 'seller_aadhaar', 'insurance_copy'].every((k) => present.has(k as FileKind)) ? 'done' : saleRecorded ? 'current' : 'todo',
      tone: saleRecorded && v.flags.docsMissing ? 'pending' : ['rc', 'seller_pan', 'seller_aadhaar', 'insurance_copy'].every((k) => present.has(k as FileKind)) ? 'approved' : 'neutral',
      icon: FileCheck2,
      note: saleRecorded && v.flags.docsMissing ? `${v.flags.missingDocs.length} missing` : '',
    },
  ]
  if (v.soldTo === 'BROKER' && saleRecorded) {
    steps.push({
      key: 'broker-rc',
      label: 'RC status',
      state: present.has('rc_transfer') ? 'done' : 'current',
      tone: present.has('rc_transfer') ? 'approved' : 'pending',
      icon: FileText,
      note: present.has('rc_transfer') ? 'Done' : 'Due',
    })
  }
  return steps
}

function LifecycleRail({ vehicle }: { vehicle: HpVehicleDetail }) {
  const steps = lifecycle(vehicle)
  return (
    <ol className="hp-rail" aria-label="Where this vehicle is">
      {steps.map((step, index) => {
        const Icon = step.state === 'done' ? Check : step.state === 'blocked' ? X : step.state === 'skip' ? CircleDashed : step.icon
        const previousDone = index > 0 && (steps[index - 1].state === 'done' || steps[index - 1].state === 'skip')
        return (
          <li key={step.key} className="hp-rail-step" data-state={step.state === 'skip' ? 'skip' : step.state === 'done' ? 'done' : 'open'} data-done={previousDone && step.state !== 'todo'} data-tone={step.tone}>
            <span className="hp-rail-node" aria-hidden="true"><Icon className="h-3.5 w-3.5" /></span>
            <span className="text-[11px] font-semibold leading-tight text-slate-800">{step.label}</span>
            <span className={cn('text-[10.5px] leading-tight', step.state === 'current' || step.state === 'blocked' ? 'hp-tone-text font-semibold' : 'text-slate-500')}>
              {step.note || ' '}
            </span>
            <span className="sr-only">{step.state === 'done' ? 'done' : step.state === 'current' ? 'in progress' : step.state === 'blocked' ? 'refused' : step.state === 'skip' ? 'not needed' : 'not yet'}</span>
          </li>
        )
      })}
    </ol>
  )
}

// ── History ──────────────────────────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { label: string; tone: Tone }> = {
  imported: { label: 'Imported from the Google Sheet', tone: 'neutral' },
  purchase_created: { label: 'Purchase recorded', tone: 'accent' },
  purchase_updated: { label: 'Purchase edited', tone: 'neutral' },
  purchase_manager_approved: { label: 'Purchase approved by GSM / SM', tone: 'approved' },
  purchase_manager_rejected: { label: 'Purchase rejected by GSM / SM', tone: 'rejected' },
  purchase_manager_reset: { label: 'Purchase sent back to GSM / SM', tone: 'pending' },
  purchase_approved: { label: 'Purchase approved by MD', tone: 'approved' },
  purchase_rejected: { label: 'Purchase rejected by MD', tone: 'rejected' },
  purchase_resubmitted: { label: 'Purchase resubmitted', tone: 'pending' },
  purchase_reopened: { label: 'Purchase reopened', tone: 'pending' },
  booking_recorded: { label: 'Booking recorded', tone: 'booked' },
  booking_updated: { label: 'Booking corrected', tone: 'neutral' },
  booking_refunded: { label: 'Booking refunded', tone: 'rejected' },
  sale_recorded: { label: 'Sale recorded', tone: 'sold' },
  sale_updated: { label: 'Sale edited', tone: 'neutral' },
  sale_manager_approved: { label: 'Sale approved by GSM / SM', tone: 'approved' },
  sale_manager_rejected: { label: 'Sale rejected by GSM / SM', tone: 'rejected' },
  sale_manager_reset: { label: 'Sale sent back to GSM / SM', tone: 'pending' },
  sale_approved: { label: 'Sale approved by MD', tone: 'approved' },
  sale_rejected: { label: 'Sale rejected by MD', tone: 'rejected' },
  sale_resubmitted: { label: 'Sale resubmitted', tone: 'pending' },
  sale_reopened: { label: 'Sale reopened', tone: 'pending' },
  sale_withdrawn: { label: 'Sale withdrawn', tone: 'rejected' },
  documents_updated: { label: 'Documents updated', tone: 'neutral' },
  broker_rc_updated: { label: 'RC status updated', tone: 'neutral' },
  ledger_uploaded: { label: 'Payment ledger uploaded', tone: 'approved' },
  ledger_replaced: { label: 'Payment ledger replaced', tone: 'pending' },
  vehicle_deleted: { label: 'Vehicle deleted', tone: 'rejected' },
  vehicle_restored: { label: 'Vehicle restored', tone: 'accent' },
  document_viewed: { label: 'Document opened', tone: 'neutral' },
  document_downloaded: { label: 'Document downloaded', tone: 'neutral' },
}

const FIELD_LABELS: Record<string, string> = {
  regNo: 'Registration', model: 'Model', colour: 'Colour', manufacturingYear: 'Year', odometerKm: 'Odometer',
  engineNo: 'Engine no', chassisNo: 'Chassis no', location: 'Location', purchaseDate: 'Purchase date',
  purchasePrice: 'Purchase price', purchaseGstPct: 'GST %', expectedProfit: 'Expected profit', expectedSaleDate: 'Expected sale date',
  purchaseRemarks: 'Remarks', purchaseFinanced: 'Financed', purchasedBy: 'Bought by', salesConsultant: 'Consultant',
  sellerPhone: "Seller's phone", purchaseWhatsappApprover: 'WhatsApp approval', saleDate: 'Sale date',
  sellingPrice: 'Selling price', otherCost: 'Other cost', isDemo: 'Demo', soldTo: 'Sold to', saleFinanced: 'Financed sale',
  soldBy: 'Sold by', buyerName: 'Buyer', buyerPhone: "Buyer's phone", buyerAddress: "Buyer's address",
  saleWhatsappApprover: 'Sale WhatsApp approval', insuranceEndDate: 'Insurance end', hypothecation: 'Hypothecation',
  rtoStatus: 'RTO', documentsRemarks: 'Document remarks', brokerRcRemarks: 'RC status remarks',
  bookingDate: 'Booking date', amount: 'Amount', remarks: 'Remarks', refundDate: 'Refund date', kind: 'Document',
}
const MONEY_FIELDS = new Set(['purchasePrice', 'expectedProfit', 'sellingPrice', 'otherCost', 'amount'])
const DATE_FIELDS = new Set(['purchaseDate', 'expectedSaleDate', 'saleDate', 'insuranceEndDate', 'bookingDate', 'refundDate'])

function showValue(field: string, value: unknown, label: (v: string) => string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (MONEY_FIELDS.has(field) && typeof value === 'number') return inr(value)
  if (DATE_FIELDS.has(field) && typeof value === 'string') return day(value)
  if (field === 'hypothecation' || field === 'rtoStatus') return paperworkLabel(String(value))
  if (field === 'soldTo') return soldToLabel(String(value))
  if (field.toLowerCase().includes('approver')) return approverName(String(value))
  if (field === 'kind' && typeof value === 'string') return FILE_KIND_POLICY[value as FileKind]?.label ?? value
  return label(String(value))
}

function changeLines(event: HpEvent, label: (v: string) => string): string[] {
  const lines: string[] = []
  for (const [field, raw] of Object.entries(event.changes ?? {})) {
    if (field === 'files' && raw && typeof raw === 'object') {
      for (const [kind, what] of Object.entries(raw as Record<string, string>)) {
        lines.push(`${FILE_KIND_POLICY[kind as FileKind]?.label ?? kind} ${what}`)
      }
      continue
    }
    const name = FIELD_LABELS[field] ?? field
    if (raw && typeof raw === 'object' && 'changed' in (raw as object)) {
      lines.push(`${name} changed`)
    } else if (raw && typeof raw === 'object' && 'from' in (raw as object)) {
      const { from, to } = raw as { from: unknown; to: unknown }
      lines.push(`${name}: ${showValue(field, from, label)} → ${showValue(field, to, label)}`)
    } else if (event.action.endsWith('_created') || event.action.endsWith('_recorded') || event.action === 'booking_refunded' || event.action.startsWith('document_')) {
      if (field === 'kind') lines.push(showValue(field, raw, label))
      else if (!['sheetRow', 'filesInSheet', 'purchaseApproval', 'saleApproval', 'filesRetired'].includes(field)) lines.push(`${name}: ${showValue(field, raw, label)}`)
    }
  }
  return lines
}

function HistoryList({ events }: { events: HpEvent[] }) {
  const label = useLabel()
  const [all, setAll] = React.useState(false)
  const visible = all ? events : events.slice(0, 12)
  if (events.length === 0) return <p className="text-sm text-slate-500">No history yet.</p>
  return (
    <div>
      <ol className="relative space-y-3 border-l border-slate-200 pl-4">
        {visible.map((event) => {
          const meta = ACTION_LABELS[event.action] ?? { label: event.action.replace(/_/g, ' '), tone: 'neutral' as Tone }
          const lines = changeLines(event, label)
          return (
            <li key={event.id} className="relative">
              <span data-tone={meta.tone} className="hp-tone-fill absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white" aria-hidden="true" />
              <p className="text-[13px] font-semibold text-slate-900">{meta.label}</p>
              <p className="text-[11.5px] text-slate-500">{event.actorName} · {when(event.createdAt)}</p>
              {event.remarks && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[12.5px] text-slate-700">“{event.remarks}”</p>}
              {lines.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
                  {lines.slice(0, 8).map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
      {events.length > 12 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="hp-accent-text mt-3 text-xs font-semibold">
          {all ? 'Show fewer' : `Show all ${events.length} entries`}
        </button>
      )}
    </div>
  )
}

// ── Sections ─────────────────────────────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, action, children, tone }: { title: string; icon: LucideIcon; action?: React.ReactNode; children: React.ReactNode; tone?: Tone }) {
  return (
    <section className="border-t border-slate-100 py-4 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-900">
          <span data-tone={tone ?? 'accent'} className="hp-tone inline-flex h-6 w-6 items-center justify-center rounded-md">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Files({ vehicle, kinds }: { vehicle: HpVehicleDetail; kinds: FileKind[] }) {
  const files = vehicle.files.filter((file) => kinds.includes(file.kind))
  const missing = kinds.filter((kind) => !files.some((file) => file.kind === kind))
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {files.map((file) => <FileTile key={file.id} file={file} />)}
      {missing.map((kind) => (
        <div key={kind} className="hp-file-tile flex items-center gap-2.5 rounded-lg p-2" data-filled="false">
          <span className="flex h-11 w-11 items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-300"><FileText className="h-4 w-4" aria-hidden="true" /></span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-semibold text-slate-500">{FILE_KIND_POLICY[kind].label}</span>
            <span className="block text-[11px] text-slate-400">Not uploaded</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function MoneyStrip({ vehicle }: { vehicle: HpVehicleDetail }) {
  const e = vehicle.economics
  const sold = vehicle.stage === 'sold'
  const cells: Array<{ label: string; value: React.ReactNode; sub?: string; strong?: boolean }> = [
    { label: 'Bought for', value: <Money value={vehicle.purchasePrice} />, sub: `${vehicle.purchaseGstPct} % GST → ${inr(e.priceWithGst)}` },
    sold
      ? { label: 'Sold for', value: <Money value={vehicle.sellingPrice} />, sub: vehicle.otherCost ? `Other cost ${inr(vehicle.otherCost)}` : 'No other cost' }
      : { label: 'Holding cost', value: <Money value={e.interest} />, sub: `${e.interestDays ?? 0} days at the interest rate` },
    sold
      ? { label: 'Gross profit', value: <Money value={e.grossProfit} signed />, sub: `With GST ${e.grossProfitWithGst === null ? '—' : inr(e.grossProfitWithGst)}` }
      : { label: 'Expected profit', value: <Money value={vehicle.expectedProfit} />, sub: 'As entered at purchase' },
    sold
      ? { label: 'Net profit', value: <Money value={e.netProfit} signed />, sub: `After ${inr(e.interest)} interest · ${e.interestDays ?? 0} d`, strong: true }
      : { label: 'In stock', value: days(vehicle.flags.daysInStock), sub: vehicle.flags.longAging ? 'Over 60 days' : 'Since purchase' },
  ]
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className={cn('border-b border-r border-slate-100 px-3.5 py-3', cell.strong && 'hp-accent-soft')}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{cell.label}</p>
          <p className="hp-num mt-0.5 text-lg font-semibold text-slate-900">{cell.value}</p>
          {cell.sub && <p className="mt-0.5 text-[11px] text-slate-500">{cell.sub}</p>}
        </div>
      ))}
    </div>
  )
}

function Overview({ vehicle, onPanel }: { vehicle: HpVehicleDetail; onPanel: (panel: VehiclePanel, bookingId?: string) => void }) {
  const { caps } = useHpSection()
  const label = useLabel()
  const saleRecorded = vehicle.saleStatus === 'pending' || vehicle.saleStatus === 'approved'
  const canEdit = caps.register.edit
  const activeBooking = vehicle.bookings.find((booking) => booking.status === 'active')

  return (
    <div className="space-y-1">
      {vehicle.redacted && (
        <Notice tone="neutral" icon={<ShieldAlert className="h-4 w-4" />} className="mb-3">
          Phone numbers, the buyer&apos;s address and identity documents are hidden at your access level.
        </Notice>
      )}
      {vehicle.flags.saleOverdue && (
        <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4 text-rose-600 animate-pulse" />} className="mb-3 border-rose-300 bg-rose-50/90 text-rose-950 font-medium shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="font-bold uppercase tracking-wider text-rose-700">🚨 Target Sale Date Breached:</strong> Target date was <strong>{day(vehicle.expectedSaleDate)}</strong> ({vehicle.flags.daysOverdue} days overdue).
            </div>
            {canEdit && (
              <HpButton size="sm" variant="accent" onClick={() => onPanel('sale')}>
                Record Sale
              </HpButton>
            )}
          </div>
        </Notice>
      )}
      {vehicle.imported && (
        <p className="mb-3 text-[11.5px] text-slate-500">Moved from the Google Sheet (row {vehicle.importRow ?? '—'}). Photos were copied into private storage.</p>
      )}
      <MoneyStrip vehicle={vehicle} />

      <div className="pt-4">
        <Section title="Purchase" icon={Car} action={<StatusChip flow="purchase" status={vehicle.purchaseStatus} managerStatus={vehicle.purchaseManagerStatus} />}>
          <Dl className="sm:grid-cols-3">
            <Field label="Purchase date">{day(vehicle.purchaseDate)}</Field>
            <Field label="Expected sale date">
              {vehicle.expectedSaleDate ? (
                <span className={cn('font-semibold', vehicle.flags.saleOverdue && 'text-rose-600')}>
                  {day(vehicle.expectedSaleDate)}
                  {vehicle.flags.saleOverdue && (
                    <span className="ml-1.5 inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 text-[10.5px] font-bold text-rose-700">
                      {vehicle.flags.daysOverdue}d overdue
                    </span>
                  )}
                </span>
              ) : (
                '—'
              )}
            </Field>
            <Field label="Location">{label(vehicle.location)}</Field>
            <Field label="Bought by">{label(vehicle.purchasedBy)}</Field>
            <Field label="WhatsApp approval">{vehicle.purchaseWhatsappApprover === NOT_TAKEN ? approverName(NOT_TAKEN) : label(vehicle.purchaseWhatsappApprover)}</Field>
            <Field label="Financed">{yesNo(vehicle.purchaseFinanced)}</Field>
            <Field label="Consultant">{vehicle.salesConsultant ?? '—'}</Field>
            <Field label="Seller's phone">{vehicle.sellerPhone ?? '—'}</Field>
            <Field label="Odometer">{km(vehicle.odometerKm)}</Field>
            <Field label="Year">{vehicle.manufacturingYear ?? '—'}</Field>
            <Field label="Engine no"><span className="hp-mono text-[12px]">{vehicle.engineNo ?? '—'}</span></Field>
            <Field label="Chassis no"><span className="hp-mono text-[12px]">{vehicle.chassisNo ?? '—'}</span></Field>
            <Field label="Entered">{vehicle.purchaseSubmittedByName ?? vehicle.createdByName}{vehicle.purchaseSubmittedAt ? ` · ${when(vehicle.purchaseSubmittedAt)}` : ''}</Field>
            {vehicle.purchaseRemarks && <Field label="Remarks" wide>{vehicle.purchaseRemarks}</Field>}
          </Dl>
          <ApprovalTrail
            status={vehicle.purchaseStatus}
            manager={{ status: vehicle.purchaseManagerStatus, by: vehicle.purchaseManagerByName, at: vehicle.purchaseManagerAt, note: vehicle.purchaseManagerNote }}
            final={{ role: vehicle.purchaseDecidedRole, by: vehicle.purchaseDecidedByName, at: vehicle.purchaseDecidedAt, reason: vehicle.purchaseDecisionReason }}
            editedAfterApproval={vehicle.purchaseEditedAfterApproval}
          />
          <Files vehicle={vehicle} kinds={['purchase_approval_screenshot']} />
        </Section>

        <Section
          title="Booking"
          icon={CalendarClock}
          tone="booked"
          action={canEdit && !saleRecorded && !activeBooking ? <HpButton size="sm" variant="soft" onClick={() => onPanel('booking')}>Record booking</HpButton> : undefined}
        >
          {vehicle.bookings.length === 0 ? (
            <p className="text-sm text-slate-500">{saleRecorded ? 'Sold without a booking.' : 'Not booked.'}</p>
          ) : (
            <ul className="space-y-2">
              {vehicle.bookings.map((booking) => (
                <li key={booking.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-slate-900">
                      <span className="hp-num">{inr(booking.amount)}</span> on {day(booking.bookingDate)}
                    </p>
                    <ToneChip tone={booking.status === 'active' ? 'booked' : 'neutral'} dot>{booking.status === 'active' ? 'Live' : 'Refunded'}</ToneChip>
                  </div>
                  {booking.remarks && <p className="mt-1 text-[12.5px] text-slate-600">{booking.remarks}</p>}
                  {booking.status === 'refunded' && (
                    <p className="mt-1 text-[12px] text-slate-500">Refunded {day(booking.refundDate)} by {booking.refundedByName ?? '—'}{booking.refundRemarks ? ` — “${booking.refundRemarks}”` : ''}</p>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {booking.files.map((file) => <FileTile key={file.id} file={file} />)}
                  </div>
                  {canEdit && booking.status === 'active' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <HpButton size="sm" variant="outline" onClick={() => onPanel('booking-edit', booking.id)}><Pencil /> Correct</HpButton>
                      {!saleRecorded && <HpButton size="sm" variant="outline" onClick={() => onPanel('refund', booking.id)}><Undo2 /> Refund</HpButton>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Sale"
          icon={Handshake}
          tone="sold"
          action={vehicle.saleStatus ? <StatusChip flow="sale" status={vehicle.saleStatus} managerStatus={vehicle.saleManagerStatus} /> : canEdit ? <HpButton size="sm" variant="soft" onClick={() => onPanel('sale')}>Record sale</HpButton> : undefined}
        >
          {vehicle.saleStatus === null ? (
            <p className="text-sm text-slate-500">Not sold yet.</p>
          ) : (
            <>
              <Dl className="sm:grid-cols-3">
                <Field label="Sale date">{day(vehicle.saleDate)}</Field>
                <Field label="Sold to">{soldToLabel(vehicle.soldTo)}</Field>
                <Field label="Sold by">{label(vehicle.soldBy)}</Field>
                <Field label="Buyer">{vehicle.buyerName ?? '—'}</Field>
                <Field label="Buyer's phone">{vehicle.buyerPhone ?? '—'}</Field>
                <Field label="Demo">{yesNo(vehicle.isDemo)}</Field>
                <Field label="Financed">{yesNo(vehicle.saleFinanced)}</Field>
                <Field label="WhatsApp approval">{vehicle.saleWhatsappApprover === NOT_TAKEN ? approverName(NOT_TAKEN) : label(vehicle.saleWhatsappApprover)}</Field>
                <Field label="Entered">{vehicle.saleSubmittedByName ?? '—'}{vehicle.saleSubmittedAt ? ` · ${when(vehicle.saleSubmittedAt)}` : ''}</Field>
                {!vehicle.redacted && vehicle.buyerAddress && <Field label="Address" wide>{vehicle.buyerAddress}</Field>}
              </Dl>
              <ApprovalTrail
                status={vehicle.saleStatus}
                manager={{ status: vehicle.saleManagerStatus, by: vehicle.saleManagerByName, at: vehicle.saleManagerAt, note: vehicle.saleManagerNote }}
                final={{ role: vehicle.saleDecidedRole, by: vehicle.saleDecidedByName, at: vehicle.saleDecidedAt, reason: vehicle.saleDecisionReason }}
                editedAfterApproval={vehicle.saleEditedAfterApproval}
              />
              <Files vehicle={vehicle} kinds={['buyer_pan', 'buyer_aadhaar', 'form_c', 'sale_approval_screenshot', 'gate_pass_photo']} />
            </>
          )}
        </Section>

        <Section title="Payment" icon={Wallet} tone={vehicle.flags.ledgerPending ? 'pending' : 'approved'}
          action={caps.payments.edit && saleRecorded && (vehicle.flags.ledgerPending || caps.isSuperAdmin)
            ? <HpButton size="sm" variant="soft" onClick={() => onPanel('ledger')}>{vehicle.flags.ledgerPending ? 'Upload ledger' : 'Replace ledger'}</HpButton>
            : undefined}
        >
          {!saleRecorded ? (
            <p className="text-sm text-slate-500">The ledger is uploaded once the car is sold.</p>
          ) : vehicle.flags.ledgerPending ? (
            <p className="text-sm text-slate-600">Waiting for accounts to upload the ledger.</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">Verified{vehicle.paymentVerifiedByName ? ` by ${vehicle.paymentVerifiedByName}` : ''}{vehicle.paymentVerifiedAt ? ` · ${when(vehicle.paymentVerifiedAt)}` : ''}.</p>
              <Files vehicle={vehicle} kinds={['payment_ledger']} />
            </>
          )}
        </Section>

        <Section title="Documents" icon={FileCheck2} tone={vehicle.flags.docsMissing ? 'pending' : 'accent'}
          action={canEdit ? <HpButton size="sm" variant="soft" onClick={() => onPanel('documents')}>Update</HpButton> : undefined}
        >
          <Dl className="sm:grid-cols-3">
            <Field label="Insurance ends" hint={vehicle.flags.insurance && vehicle.flags.insurance !== 'ok' ? INSURANCE_STATE_LABELS[vehicle.flags.insurance] : undefined}>{day(vehicle.insuranceEndDate)}</Field>
            <Field label="Hypothecation">{paperworkLabel(vehicle.hypothecation)}</Field>
            <Field label="RTO">{paperworkLabel(vehicle.rtoStatus)}</Field>
            {vehicle.documentsRemarks && <Field label="Remarks" wide>{vehicle.documentsRemarks}</Field>}
          </Dl>
          <Files vehicle={vehicle} kinds={['rc', 'seller_aadhaar', 'seller_pan', 'insurance_copy', 'credit_note', 'form_35', 'rto_mail'].filter((kind) =>
            ['rc', 'seller_aadhaar', 'seller_pan', 'insurance_copy'].includes(kind) || vehicle.files.some((file) => file.kind === kind)) as FileKind[]} />
        </Section>

        {vehicle.soldTo === 'BROKER' && saleRecorded && (
          <Section title="RC status (broker)" icon={FileText} tone={vehicle.flags.brokerRcPending ? 'pending' : 'approved'}
            action={canEdit ? <HpButton size="sm" variant="soft" onClick={() => onPanel('broker-rc')}>Update</HpButton> : undefined}
          >
            <p className="text-sm text-slate-600">{vehicle.brokerRcRemarks ?? (vehicle.flags.brokerRcPending ? 'Waiting for the broker to transfer the RC.' : 'Transferred.')}</p>
            <Files vehicle={vehicle} kinds={['rc_transfer']} />
          </Section>
        )}

        <Section title="History" icon={History} tone="neutral">
          <HistoryList events={vehicle.events} />
          {vehicle.replacedFiles.length > 0 && (
            <details className="mt-3 text-[12px] text-slate-600">
              <summary className="cursor-pointer font-semibold">Replaced files ({vehicle.replacedFiles.length})</summary>
              <ul className="mt-2 space-y-1">
                {vehicle.replacedFiles.map((file) => (
                  <li key={file.id}>
                    {FILE_KIND_POLICY[file.kind].label} — uploaded by {file.uploadedByName} {when(file.uploadedAt)}, replaced {when(file.supersededAt)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>
      </div>
    </div>
  )
}

/**
 * The two approval stages, one line each: GSM / SM, then MD. A rejection shows its reason; an MD decision taken
 * before any manager reads "skipped" on the first line.
 */
function ApprovalTrail({
  status,
  manager,
  final,
  editedAfterApproval,
}: {
  status: string | null
  manager: { status: ManagerStatus | null; by: string | null; at: string | null; note: string | null }
  final: { role: string | null; by: string | null; at: string | null; reason: string | null }
  editedAfterApproval: boolean
}) {
  if (!status) return null
  const stamp = (at: string | null) => (at ? ` · ${when(at)}` : '')
  const quote = (text: string | null) => (text ? ` — “${text}”` : '')
  const managerLine: { tone: Tone; text: string } = (() => {
    switch (manager.status) {
      case 'approved': return { tone: 'approved', text: `Approved by ${manager.by ?? '—'}${stamp(manager.at)}${quote(manager.note)}` }
      case 'rejected': return { tone: 'rejected', text: `Rejected by ${manager.by ?? '—'}${stamp(manager.at)}${quote(manager.note)}` }
      case 'skipped': return { tone: 'neutral', text: final.role ? 'Not needed — the MD decided first' : 'Not recorded (from the Google Sheet)' }
      default: return { tone: 'pending', text: 'Waiting for the GSM or a Sales Manager' }
    }
  })()
  const finalLine: { tone: Tone; text: string } = status === 'approved'
    ? { tone: 'approved', text: `Approved by ${finalDeciderLabel(final.role, final.by)}${stamp(final.at)}${quote(final.reason)}${editedAfterApproval ? ' · edited after approval' : ''}` }
    : status === 'rejected'
      ? manager.status === 'rejected'
        ? { tone: 'neutral', text: 'Not reached — rejected at the GSM / SM stage' }
        : { tone: 'rejected', text: `Rejected by ${finalDeciderLabel(final.role, final.by)}${stamp(final.at)}${quote(final.reason)}` }
      : { tone: 'pending', text: manager.status === 'approved' ? 'Waiting for the MD' : 'Waiting (the MD may approve now)' }
  return (
    <ol className="hp-sunken-bg mt-3 space-y-1.5 rounded-lg px-3 py-2.5 text-[12.5px]" aria-label="Approval">
      {([['manager', managerLine], ['md', finalLine]] as const).map(([level, line]) => (
        <li key={level} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <ToneChip tone={line.tone} dot className="shrink-0 text-[10.5px]">{APPROVAL_LEVEL_LABELS[level]}</ToneChip>
          <span className={cn('min-w-0 flex-1', line.tone === 'rejected' ? 'hp-tone-text font-medium' : 'text-slate-700')} data-tone={line.tone === 'rejected' ? 'rejected' : undefined}>
            {line.text}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Shown for the instant between the click and the full record: the money, and placeholders for the rest. */
function PartialOverview({ vehicle }: { vehicle: HpVehicleDetail }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <MoneyStrip vehicle={vehicle} />
      <p role="status" className="text-[12px] text-slate-500">Loading documents and history…</p>
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-2 border-t border-slate-100 pt-4">
          <Skeleton className="h-5 w-40" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, cell) => <Skeleton key={cell} className="h-9" />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────

type Pending =
  | null
  | { kind: 'reject-purchase' | 'reject-sale' | 'reopen-purchase' | 'reopen-sale' | 'withdraw-sale' | 'delete' | 'resubmit-purchase' }

function Actions({ vehicle, onPanel }: { vehicle: HpVehicleDetail; onPanel: (panel: VehiclePanel) => void }) {
  const { caps, closeDrawer } = useHpSection()
  const [pending, setPending] = React.useState<Pending>(null)
  const [error, setError] = React.useState<string | null>(null)
  const id = vehicle.id

  const decide = useHpMutation((input: { flow: 'purchase' | 'sale'; decision: 'approve' | 'reject'; reason?: string }) =>
    hpSend(`/api/h-promise/vehicles/${id}/${input.flow}-decision`, 'POST', { decision: input.decision, reason: input.reason }))
  const post = useHpMutation((input: { path: string; body: unknown; method?: 'POST' | 'DELETE' }) =>
    hpSend(`/api/h-promise/vehicles/${id}${input.path}`, input.method ?? 'POST', input.body))

  if (vehicle.deletedAt) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Notice tone="rejected" className="flex-1">Deleted {when(vehicle.deletedAt)} by {vehicle.deletedByName ?? '—'}: “{vehicle.deleteReason}”</Notice>
        {caps.register.delete && (
          <HpButton variant="accent" busy={post.isPending} onClick={() => post.mutateAsync({ path: '/restore', body: {} }).catch((e) => setError(e.message))}>
            <RotateCcw /> Restore
          </HpButton>
        )}
        {error && <p role="alert" data-tone="rejected" className="hp-tone-text w-full text-xs font-medium">{error}</p>}
      </div>
    )
  }

  const purchaseSelf = isSelfDecision(caps.userId, [vehicle.createdById, vehicle.purchaseSubmittedById])
  const saleSelf = isSelfDecision(caps.userId, [vehicle.saleSubmittedById])
  // Two stages: a GSM / SM decides the first; the MD decides finally, at any point before the end.
  const level = approvalLevelOf(caps.approvals)
  const canDecidePurchase = canDecideAt(level, vehicle.purchaseStatus, vehicle.purchaseManagerStatus)
  const canDecideSale = canDecideAt(level, vehicle.saleStatus, vehicle.saleManagerStatus)
  const asWho = level === 'md' ? ' as MD' : ''
  const ownOpen = caps.register.create && vehicle.createdById === caps.userId && vehicle.purchaseStatus !== 'approved'
  const canEditPurchase = caps.register.edit || ownOpen
  const saleRecorded = vehicle.saleStatus === 'pending' || vehicle.saleStatus === 'approved'
  const approvedSomething = vehicle.purchaseStatus === 'approved' || vehicle.saleStatus === 'approved'
  const canDelete = caps.register.delete && (!approvedSomething || caps.approvals.final)

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work.')
    }
  }

  const menuItems: Array<{ label: string; icon: LucideIcon; onSelect: () => void; danger?: boolean }> = []
  if (canEditPurchase) menuItems.push({ label: vehicle.purchaseStatus === 'rejected' ? 'Fix and resubmit purchase' : 'Edit purchase', icon: Pencil, onSelect: () => onPanel('edit-purchase') })
  if (caps.register.edit && vehicle.saleStatus !== null) menuItems.push({ label: 'Edit sale', icon: Pencil, onSelect: () => onPanel('sale') })
  if (caps.register.edit) menuItems.push({ label: 'Update documents', icon: FileCheck2, onSelect: () => onPanel('documents') })
  if (caps.register.edit && vehicle.soldTo === 'BROKER' && saleRecorded) menuItems.push({ label: 'RC status (broker)', icon: FileText, onSelect: () => onPanel('broker-rc') })
  if (caps.approvals.final && vehicle.purchaseStatus === 'approved') menuItems.push({ label: 'Reopen purchase', icon: RotateCcw, onSelect: () => setPending({ kind: 'reopen-purchase' }) })
  if (caps.approvals.final && vehicle.saleStatus === 'approved') menuItems.push({ label: 'Reopen sale', icon: RotateCcw, onSelect: () => setPending({ kind: 'reopen-sale' }) })
  if (caps.register.edit && (vehicle.saleStatus === 'pending' || vehicle.saleStatus === 'rejected')) menuItems.push({ label: 'Withdraw sale', icon: Undo2, onSelect: () => setPending({ kind: 'withdraw-sale' }), danger: true })
  if (canDelete) menuItems.push({ label: 'Delete vehicle', icon: Trash2, onSelect: () => setPending({ kind: 'delete' }), danger: true })

  const primary: React.ReactNode[] = []
  if (canDecidePurchase) {
    if (purchaseSelf) {
      primary.push(<p key="ps" className="text-[12px] text-slate-500">You entered this purchase — someone else must decide it.</p>)
    } else {
      primary.push(
        <HpButton key="pa" variant="approve" busy={decide.isPending} onClick={() => run(() => decide.mutateAsync({ flow: 'purchase', decision: 'approve' }))}>
          <Check /> Approve purchase{asWho}
        </HpButton>,
        <HpButton key="pr" variant="outline" onClick={() => setPending({ kind: 'reject-purchase' })}><Ban /> Reject</HpButton>,
      )
    }
  }
  if (canDecideSale) {
    if (saleSelf) {
      primary.push(<p key="ss" className="text-[12px] text-slate-500">You entered this sale — someone else must decide it.</p>)
    } else {
      primary.push(
        <HpButton key="sa" variant="approve" busy={decide.isPending} onClick={() => run(() => decide.mutateAsync({ flow: 'sale', decision: 'approve' }))}>
          <Check /> Approve sale{asWho}
        </HpButton>,
        <HpButton key="sr" variant="outline" onClick={() => setPending({ kind: 'reject-sale' })}><Ban /> Reject sale</HpButton>,
      )
    }
  }
  if (vehicle.purchaseStatus === 'rejected' && canEditPurchase) {
    primary.push(<HpButton key="fix" variant="accent" onClick={() => onPanel('edit-purchase')}><Pencil /> Fix and resubmit</HpButton>)
  }
  if (vehicle.saleStatus === 'rejected' && caps.register.edit) {
    primary.push(<HpButton key="fixs" variant="accent" onClick={() => onPanel('sale')}><Pencil /> Fix sale and resubmit</HpButton>)
  }
  if (caps.register.edit && vehicle.saleStatus === null && primary.length === 0) {
    primary.push(<HpButton key="sell" variant="accent" onClick={() => onPanel('sale')}><IndianRupee /> Record sale</HpButton>)
  }
  if (caps.payments.edit && saleRecorded && vehicle.flags.ledgerPending && primary.length === 0) {
    primary.push(<HpButton key="ledger" variant="accent" onClick={() => onPanel('ledger')}><Wallet /> Upload ledger</HpButton>)
  }

  const dialog = pending && {
    'reject-purchase': { title: 'Reject this purchase?', confirm: 'Reject purchase', label: 'What needs fixing', go: (reason: string) => decide.mutateAsync({ flow: 'purchase', decision: 'reject', reason }) },
    'reject-sale': { title: 'Reject this sale?', confirm: 'Reject sale', label: 'What needs fixing', go: (reason: string) => decide.mutateAsync({ flow: 'sale', decision: 'reject', reason }) },
    'reopen-purchase': { title: 'Reopen the approved purchase?', confirm: 'Reopen purchase', label: 'Why it is being reopened', go: (reason: string) => post.mutateAsync({ path: '/purchase-reopen', body: { reason } }) },
    'reopen-sale': { title: 'Reopen the approved sale?', confirm: 'Reopen sale', label: 'Why it is being reopened', go: (reason: string) => post.mutateAsync({ path: '/sale-reopen', body: { reason } }) },
    'withdraw-sale': { title: 'Withdraw this sale?', confirm: 'Withdraw sale', label: 'Why the sale fell through', go: (reason: string) => post.mutateAsync({ path: '/sale-withdraw', body: { reason } }) },
    'resubmit-purchase': { title: 'Resubmit the purchase?', confirm: 'Resubmit', label: 'What was corrected', go: (reason: string) => post.mutateAsync({ path: '/purchase-resubmit', body: { remarks: reason } }) },
    delete: { title: `Delete ${formatStockNo(vehicle.stockNo)}?`, confirm: 'Delete vehicle', label: 'Why it is being deleted', go: async (reason: string) => { await post.mutateAsync({ path: '', body: { reason }, method: 'DELETE' }); closeDrawer() } },
  }[pending.kind]

  const descriptions: Record<string, string> = {
    'reject-purchase': 'The desk sees your reason and can correct and resubmit. A resubmitted purchase starts again at the GSM / SM.',
    'reject-sale': 'The car goes back to stock until the sale is corrected and resubmitted. A resubmitted sale starts again at the GSM / SM.',
    'reopen-purchase': 'The purchase goes back to the GSM / SM so its price can be corrected, then needs approving again. You can approve it again at any time.',
    'reopen-sale': 'The sale goes back to the GSM / SM so it can be corrected or withdrawn, then needs approving again.',
    'withdraw-sale': 'The sale details and its buyer documents are retired (kept in the history). The car goes back to stock.',
    delete: 'It leaves the register and the MIS. It can be restored from the Deleted tab.',
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary}
      {menuItems.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <HpButton variant="outline" aria-label="More actions">More <ChevronDown /></HpButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="hp min-w-[13rem]">
            {menuItems.map((item, index) => (
              <React.Fragment key={item.label}>
                {item.danger && !menuItems[index - 1]?.danger && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={item.onSelect} data-tone={item.danger ? 'rejected' : undefined} className={cn('gap-2', item.danger && 'hp-tone-text')}>
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {error && <p role="alert" data-tone="rejected" className="hp-tone-text w-full text-xs font-medium">{error}</p>}
      {dialog && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={dialog.title}
          description={descriptions[pending!.kind]}
          label={dialog.label}
          confirmLabel={dialog.confirm}
          tone={pending!.kind.startsWith('reopen') || pending!.kind === 'resubmit-purchase' ? 'accent' : 'rejected'}
          onConfirm={async (reason) => { await dialog.go(reason) }}
        />
      )}
    </div>
  )
}

// ── The sheet body ───────────────────────────────────────────────────────────────────────────────

function withPreviews(file: HpFileRef, previews: Readonly<Record<string, string>> | undefined): HpFileRef {
  if (file.previewUrl || !previews) return file
  const url = previews[file.id]
  return url ? { ...file, previewUrl: url } : file
}

export function VehicleSheetBody({ id, panel, bookingId }: { id: string; panel: VehiclePanel; bookingId?: string }) {
  const { openVehicle, meta } = useHpSection()
  const query = useVehicle(id)
  const previewQuery = useVehiclePreviews(id)
  const previews = previewQuery.data?.previews
  const vehicle = React.useMemo(() => {
    const data = query.data
    if (!data || !previews) return data
    return {
      ...data,
      files: data.files.map((file) => withPreviews(file, previews)),
      bookings: data.bookings.map((booking) => ({ ...booking, files: booking.files.map((file) => withPreviews(file, previews)) })),
    }
  }, [query.data, previews])
  const partial = Boolean(vehicle?.partial)
  const label = useLabel()
  const toOverview = React.useCallback(() => openVehicle(id, 'overview'), [id, openVehicle])
  const onPanel = React.useCallback((next: VehiclePanel, nextBooking?: string) => openVehicle(id, next, nextBooking), [id, openVehicle])

  if (!vehicle && !query.isError) {
    return <div className="p-6"><LoadingBlock label="Loading the vehicle" rows={8} /></div>
  }
  if (!vehicle) {
    return <div className="p-6"><ErrorState message={query.error instanceof Error ? query.error.message : 'The vehicle could not be loaded.'} onRetry={() => query.refetch()} /></div>
  }

  const header = (
    <header className="hp-sunken-bg border-b border-slate-200 px-5 pb-4 pt-5 sm:px-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 pr-10">
        <RegPlate regNo={vehicle.regNo} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="hp-mono text-[11px] font-semibold tracking-[0.1em] text-slate-500">{formatStockNo(vehicle.stockNo)} · {label(vehicle.location)}</p>
          <h2 className="truncate text-lg font-semibold tracking-tight text-slate-900">
            {vehicle.model}
            <span className="font-normal text-slate-500">{[vehicle.colour, vehicle.manufacturingYear].filter(Boolean).length ? ` · ${[vehicle.colour, vehicle.manufacturingYear].filter(Boolean).join(' · ')}` : ''}</span>
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StageChip stage={vehicle.stage} />
            <StatusChip flow="purchase" status={vehicle.purchaseStatus} managerStatus={vehicle.purchaseManagerStatus} prefix="Purchase" />
            {vehicle.saleStatus && <StatusChip flow="sale" status={vehicle.saleStatus} managerStatus={vehicle.saleManagerStatus} prefix="Sale" />}
            {vehicle.flags.longAging && <ToneChip tone="rejected">{vehicle.flags.daysInStock} days in stock</ToneChip>}
            {vehicle.flags.insurance === 'expired' && <ToneChip tone="rejected">Insurance expired</ToneChip>}
          </div>
        </div>
      </div>
      {panel === 'overview' && (
        <>
          <div className="mt-4"><LifecycleRail vehicle={vehicle} /></div>
          <div className="mt-4"><Actions vehicle={vehicle} onPanel={onPanel} /></div>
        </>
      )}
    </header>
  )

  if (panel === 'overview') {
    return (
      <>
        {header}
        <div className="hp-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {query.isError && (
            <div className="mb-3">
              <ErrorState
                message={partial ? (query.error instanceof Error ? query.error.message : 'The full record could not be loaded.') : 'Showing the last loaded copy — the latest could not be fetched.'}
                onRetry={() => query.refetch()}
              />
            </div>
          )}
          {partial ? <PartialOverview vehicle={vehicle} /> : <Overview vehicle={vehicle} onPanel={onPanel} />}
        </div>
      </>
    )
  }

  if (partial) {
    return (
      <>
        <div className="hp-sunken-bg flex items-center gap-3 border-b border-slate-200 px-5 py-3 pr-14 sm:px-6">
          <HpButton variant="ghost" size="sm" onClick={toOverview} aria-label="Back to the vehicle"><Undo2 /> Back</HpButton>
          <RegPlate regNo={vehicle.regNo} size="sm" />
          <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{PANEL_TITLES[panel]} · <span className="font-normal text-slate-500">{vehicle.model}</span></p>
        </div>
        <div className="p-6">
          {query.isError
            ? <ErrorState message={query.error instanceof Error ? query.error.message : 'The vehicle could not be loaded.'} onRetry={() => query.refetch()} />
            : <LoadingBlock label="Opening the form" rows={7} />}
        </div>
      </>
    )
  }

  const booking = findBooking(vehicle, bookingId)
  let body: React.ReactNode = null
  switch (panel) {
    case 'edit-purchase':
      body = <PurchaseForm vehicle={vehicle} onDone={toOverview} onCancel={toOverview} />
      break
    case 'booking':
      body = <BookingForm vehicle={vehicle} onDone={toOverview} onCancel={toOverview} />
      break
    case 'booking-edit':
      body = booking ? <BookingForm vehicle={vehicle} booking={booking} onDone={toOverview} onCancel={toOverview} /> : null
      break
    case 'refund':
      body = booking && booking.status === 'active' ? <RefundForm vehicle={vehicle} booking={booking} onDone={toOverview} onCancel={toOverview} /> : null
      break
    case 'sale':
      body = <SaleForm vehicle={vehicle} onDone={toOverview} onCancel={toOverview} />
      break
    case 'documents':
      body = <DocumentsForm vehicle={vehicle} onDone={toOverview} onCancel={toOverview} />
      break
    case 'broker-rc':
      body = <BrokerRcForm vehicle={vehicle} onDone={toOverview} onCancel={toOverview} />
      break
    case 'ledger':
      body = <LedgerForm vehicle={vehicle} onDone={toOverview} onCancel={toOverview} />
      break
  }
  return (
    <>
      <div className="hp-sunken-bg flex items-center gap-3 border-b border-slate-200 px-5 py-3 pr-14 sm:px-6">
        <HpButton variant="ghost" size="sm" onClick={toOverview} aria-label="Back to the vehicle"><Undo2 /> Back</HpButton>
        <RegPlate regNo={vehicle.regNo} size="sm" />
        <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{PANEL_TITLES[panel]} · <span className="font-normal text-slate-500">{vehicle.model}</span></p>
      </div>
      {body ?? <div className="p-6"><ErrorState message="That booking is no longer live." /></div>}
      {!meta && <span className="sr-only">Loading lists…</span>}
    </>
  )
}
