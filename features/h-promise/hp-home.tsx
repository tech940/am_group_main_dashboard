'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CarFront,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  FileKey2,
  Gift,
  Handshake,
  Search,
  ShoppingCart,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HPromiseCapabilities } from '@/lib/h-promise/access-shared'
import { formatStockNo } from '@/lib/h-promise/constants'
import { normalizeRegNo } from '@/lib/h-promise/registration'
import { approvalLevelOf, type ApprovalQueue } from '@/lib/h-promise/status'
import type { HpVehicleRow } from '@/lib/h-promise/types'
import { useSessionValue, useVehicles } from './hp-data'
import { isHpTab, type HpTab } from './hp-keys'
import { HPromiseProvider } from './hp-drawer'
import { useHpSection, useLabel, type VehiclePanel } from './hp-context'
import { day, inr } from './hp-format'
import { EmptyState, HpButton, RegPlate, StageChip, ToneChip, type Tone } from './hp-ui'
import { DeletedTab, VehiclesTab } from './register-client'
import { OverdueTab } from './overdue-client'
import { ApprovalsClient } from './approvals-client'
import { PaymentsClient } from './payments-client'
import { InsightsClient } from './insights-client'
import { BonusDialog, ExchangeBonusView } from './exchange-view'

/**
 * AM Tata · H Promise — ONE screen (owner, 2026-09-17: "put all of them in one option … inside handle
 * everything").
 *
 *   ┌ the Apps Script's forms: Purchase · Sale · Booking · Documents · RC status (broker) · Exchange bonus ┐
 *   ├ tabs: Vehicles · Approvals · Payments · MIS & Insights · Exchange bonus · Deleted                     ┤
 *   └ the vehicle drawer, where every form opens beside the car it is about                                ┘
 *
 * Only the tabs and forms this person holds are shown. Switching tabs never leaves the page, so the register
 * loaded once serves every tab.
 */


const TAB_KEY = 'hp-tab'

type TabDef = { id: HpTab; label: string; icon: LucideIcon; show: (caps: HPromiseCapabilities) => boolean }

const TABS: readonly TabDef[] = [
  { id: 'vehicles', label: 'Vehicles', icon: CarFront, show: (caps) => caps.register.view },
  { id: 'overdue', label: 'Overdue Target Sale', icon: AlertTriangle, show: (caps) => caps.register.view },
  { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, show: (caps) => caps.approvals.view },
  { id: 'payments', label: 'Payments', icon: Wallet, show: (caps) => caps.payments.view },
  { id: 'insights', label: 'Insights', icon: BarChart3, show: (caps) => caps.insights.view },
  { id: 'bonus', label: 'Exchange bonus', icon: Gift, show: (caps) => caps.register.view },
  { id: 'deleted', label: 'Deleted', icon: Trash2, show: (caps) => caps.register.view },
]

function approvalBadgeQueues(caps: HPromiseCapabilities): ReadonlySet<ApprovalQueue | null> {
  return approvalLevelOf(caps.approvals) === 'manager' ? new Set(['manager']) : new Set(['manager', 'md'])
}

export function HPromiseApp({ caps, initialTab }: { caps: HPromiseCapabilities; initialTab?: HpTab | null }) {
  return (
    <HPromiseProvider caps={caps}>
      <HPromiseScreen initialTab={initialTab ?? null} />
    </HPromiseProvider>
  )
}

function HPromiseScreen({ initialTab }: { initialTab: HpTab | null }) {
  const { caps } = useHpSection()
  const visible = TABS.filter((tab) => tab.show(caps))
  const [saved, saveTab] = useSessionValue(TAB_KEY)
  // A link to an area (e.g. /brands/tata/h-promise/approvals) wins until the person picks a tab here.
  const [chosen, setChosen] = React.useState<HpTab | null>(null)
  const wanted = chosen ?? initialTab ?? (isHpTab(saved) ? saved : null)
  const active = visible.find((tab) => tab.id === wanted)?.id ?? visible[0]?.id ?? null
  const choose = (tab: HpTab) => {
    setChosen(tab)
    saveTab(tab)
  }

  const list = useVehicles('live', caps.anyView)
  const rows = list.data?.rows ?? []
  const counts: Partial<Record<HpTab, number>> = {
    vehicles: rows.length,
    overdue: rows.filter((row) => !row.deletedAt && row.flags.saleOverdue).length,
    // What this person can act on: the MD both waiting queues, a GSM / SM the first one, anyone else all waiting.
    approvals: rows.filter((row) => approvalBadgeQueues(caps).has(row.flags.purchaseQueue)).length
      + rows.filter((row) => approvalBadgeQueues(caps).has(row.flags.saleQueue)).length,
    payments: rows.filter((row) => row.flags.ledgerPending).length,
  }

  if (!active) {
    return (
      <EmptyState title="No H Promise areas are open to you yet" icon={<CarFront className="h-5 w-5" />}>
        Ask an admin to tick Vehicle Register, Approvals, Payment Verification or MIS &amp; Insights for you in the Access Map.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3.5">
      <FormsBar />
      <div role="tablist" aria-label="H Promise" className="hp-noscrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
        {visible.map((tab) => {
          const selected = active === tab.id
          const count = counts[tab.id]
          const isOverdueAlert = tab.id === 'overdue' && typeof count === 'number' && count > 0

          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`hp-tabbtn-${tab.id}`}
              aria-selected={selected}
              aria-controls={`hp-tab-${tab.id}`}
              onClick={() => choose(tab.id)}
              className={cn(
                '-mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-xs font-semibold transition-colors',
                selected
                  ? isOverdueAlert
                    ? 'border-rose-600 text-rose-800 font-semibold bg-rose-50/60'
                    : 'hp-accent-text border-current'
                  : isOverdueAlert
                    ? 'border-transparent text-rose-700 font-semibold hover:text-rose-900 hover:bg-rose-50/30'
                    : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              <tab.icon className={cn('h-3.5 w-3.5 shrink-0', isOverdueAlert && 'text-rose-600 animate-pulse')} aria-hidden="true" />
              <span>{tab.label}</span>
              {typeof count === 'number' && count > 0 && (
                isOverdueAlert ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10.5px] font-semibold text-white shadow-2xs animate-pulse"
                  >
                    🚨 {count}
                  </span>
                ) : (
                  <span
                    data-tone={tab.id === 'vehicles' ? 'neutral' : 'pending'}
                    className="hp-tone hp-num rounded-full px-1.5 text-[10.5px] leading-4"
                  >
                    {count}
                  </span>
                )
              )}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`hp-tab-${active}`} aria-labelledby={`hp-tabbtn-${active}`}>
        {active === 'vehicles' && <VehiclesTab />}
        {active === 'overdue' && <OverdueTab />}
        {active === 'approvals' && <ApprovalsClient />}
        {active === 'payments' && <PaymentsClient />}
        {active === 'insights' && <InsightsClient />}
        {active === 'bonus' && <ExchangeBonusView />}
        {active === 'deleted' && <DeletedTab />}
      </div>
    </div>
  )
}

// ── The forms: Streamlined Action Bar ────────────────────────────────────────────────────────────

type FormId = 'purchase' | 'sale' | 'booking' | 'documents' | 'rc' | 'bonus'
type PickPurpose = 'sale' | 'booking' | 'documents' | 'rc'

type FormDef = { id: FormId; label: string; hint: string; icon: LucideIcon; tone: Tone; allowed: (caps: HPromiseCapabilities) => boolean }

const FORMS: readonly FormDef[] = [
  { id: 'purchase', label: 'Purchase Car', hint: 'Record a car bought', icon: ShoppingCart, tone: 'stock', allowed: (caps) => caps.register.create || caps.anyView },
  { id: 'sale', label: 'Record Sale', hint: 'Sell a car from stock', icon: Handshake, tone: 'sold', allowed: (caps) => caps.register.edit || caps.anyView },
  { id: 'booking', label: 'New Booking', hint: 'Take booking on stock', icon: CalendarClock, tone: 'booked', allowed: (caps) => caps.register.edit || caps.anyView },
  { id: 'documents', label: 'Documents', hint: 'RC, KYC, insurance', icon: FileCheck2, tone: 'pending', allowed: (caps) => caps.register.edit || caps.anyView },
  { id: 'rc', label: 'Broker RC Transfer', hint: 'Broker sales transfer', icon: FileKey2, tone: 'rejected', allowed: (caps) => caps.register.edit || caps.anyView },
  { id: 'bonus', label: 'Exchange Bonus', hint: 'Bonus on exchange', icon: Gift, tone: 'accent', allowed: (caps) => caps.register.create || caps.register.view || caps.anyView },
]

function FormsBar() {
  const { caps, openNewPurchase } = useHpSection()
  const list = useVehicles('live', caps.anyView)
  const rcDue = (list.data?.rows ?? []).filter((row) => !row.deletedAt && row.flags.brokerRcPending).length
  const [picking, setPicking] = React.useState<PickPurpose | null>(null)
  const [bonusOpen, setBonusOpen] = React.useState(false)
  const forms = FORMS.filter((form) => form.allowed(caps))
  if (forms.length === 0) return null

  const open = (id: FormId) => {
    if (id === 'purchase') openNewPurchase()
    else if (id === 'bonus') setBonusOpen(true)
    else setPicking(id)
  }

  return (
    <section aria-label="Quick Actions" className="hp-noprint">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-2xs">
        <span className="px-2 text-xs font-semibold text-slate-500 hidden sm:inline-block">Quick Desk Actions:</span>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {forms.map((form) => {
            const isPurchase = form.id === 'purchase'
            return (
              <button
                key={form.id}
                type="button"
                onClick={() => open(form.id)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-all',
                  isPurchase
                    ? 'hp-accent-bg border-transparent text-white shadow-2xs hover:opacity-95'
                    : 'border-slate-200/80 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-white',
                )}
              >
                <form.icon className={cn('h-3.5 w-3.5', isPurchase ? 'text-white' : 'text-slate-500')} aria-hidden="true" />
                <span>{form.label}</span>
                {form.id === 'rc' && rcDue > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800 border border-amber-300/60">
                    {rcDue} due
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      {picking && <VehiclePicker purpose={picking} onClose={() => setPicking(null)} />}
      {bonusOpen && <BonusDialog bonus={null} onClose={() => setBonusOpen(false)} />}
    </section>
  )
}

const PICKER: Record<PickPurpose, { title: string; description: string; panel: VehiclePanel; empty: string }> = {
  sale: {
    title: 'Sell a car',
    description: 'Cars in stock or booked. A rejected sale is corrected here too.',
    panel: 'sale',
    empty: 'No car is waiting to be sold. A car must be on the register (Purchase) before it can be sold.',
  },
  booking: {
    title: 'Book a car',
    description: 'Cars in stock that are not booked or sold.',
    panel: 'booking',
    empty: 'Every car is booked or sold. A car must be on the register (Purchase) before it can be booked.',
  },
  rc: {
    title: 'RC status (broker)',
    description: 'Cars sold to a broker. Those still waiting for the RC transfer come first.',
    panel: 'broker-rc',
    empty: 'No car has been sold to a broker yet. Record the sale with "Sold to: Broker" first.',
  },
  documents: {
    title: 'Update documents',
    description: 'Sold cars with missing paperwork come first.',
    panel: 'documents',
    empty: 'No car is on the register yet.',
  },
}

function eligible(purpose: PickPurpose, row: HpVehicleRow): boolean {
  if (row.deletedAt) return false
  if (purpose === 'sale') return row.saleStatus === null || row.saleStatus === 'rejected'
  if (purpose === 'booking') return row.stage === 'in_stock' && row.saleStatus !== 'pending' && row.saleStatus !== 'approved'
  // Same rule as the server (saveBrokerRc): a recorded sale to a broker.
  if (purpose === 'rc') return row.soldTo === 'BROKER' && (row.saleStatus === 'pending' || row.saleStatus === 'approved')
  return true
}

function priority(purpose: PickPurpose, row: HpVehicleRow): number {
  if (purpose === 'sale') return row.saleStatus === 'rejected' ? 0 : row.stage === 'booked' ? 1 : 2
  if (purpose === 'rc') return row.flags.brokerRcPending ? 0 : 1
  if (purpose === 'documents') return row.flags.docsMissing ? 0 : row.flags.paperworkPending ? 1 : row.stage === 'sold' ? 2 : 3
  return 0
}

/** Pick the car a form is about; the form then opens in the vehicle drawer. */
function VehiclePicker({ purpose, onClose }: { purpose: PickPurpose; onClose: () => void }) {
  const { openVehicle, openNewPurchase, caps } = useHpSection()
  const label = useLabel()
  const list = useVehicles('live')
  const [query, setQuery] = React.useState('')
  const config = PICKER[purpose]
  const needle = query.trim().toUpperCase()
  const key = normalizeRegNo(needle)

  const matches = (list.data?.rows ?? [])
    .filter((row) => eligible(purpose, row))
    .filter((row) => {
      if (!needle) return true
      if (key.length >= 2 && row.regNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase().includes(key)) return true
      return `${row.model} ${row.colour ?? ''} ${formatStockNo(row.stockNo)} ${row.buyerName ?? ''}`.toUpperCase().includes(needle)
    })
    .sort((a, b) => priority(purpose, a) - priority(purpose, b) || b.stockNo - a.stockNo)

  const pick = (row: HpVehicleRow) => {
    onClose()
    openVehicle(row.id, config.panel)
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="hp-overlay fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="hp fixed left-1/2 top-[7vh] z-50 flex max-h-[86vh] w-[calc(100vw-2rem)] max-w-2xl sm:max-w-3xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl focus:outline-none"
        >
          <div className="border-b border-slate-100 bg-white px-6 pb-4 pt-5">
            <DialogPrimitive.Title className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">{config.title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-xs sm:text-[13px] text-slate-500 mt-0.5">{config.description}</DialogPrimitive.Description>
            <div className="relative mt-3.5">
              <label htmlFor="hp-pick-search" className="sr-only">Search by registration number, model or stock number</label>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                id="hp-pick-search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && matches.length === 1) pick(matches[0])
                }}
                placeholder="Search by registration number, model, or stock ID..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-4 text-xs sm:text-[13px] font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:border-slate-400 focus:outline-none transition-colors"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="hp-scroll min-h-0 flex-1 overflow-y-auto p-3.5 sm:p-4">
            {list.isLoading ? (
              <p role="status" className="p-6 text-center text-xs text-slate-500">Loading register…</p>
            ) : matches.length === 0 ? (
              <div className="p-4">
                <EmptyState title={needle ? 'No car matches that search' : 'Nothing to choose'}>
                  {needle ? 'Check the registration plate number, or search by model or stock number.' : config.empty}
                </EmptyState>
              </div>
            ) : (
              <ul className="space-y-2">
                {matches.slice(0, 80).map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => pick(row)}
                      className="group flex w-full items-center justify-between gap-4 rounded-xl border border-slate-100 bg-white p-3 sm:px-4 sm:py-3.5 text-left transition-all hover:border-slate-200 hover:bg-slate-50/80 hover:shadow-[0_2px_8px_rgba(0,0,0,0.03)]"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <RegPlate regNo={row.regNo} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs sm:text-[13.5px] font-semibold text-slate-900 group-hover:text-slate-950">
                              {row.model}
                            </span>
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-mono font-medium text-slate-600">
                              {formatStockNo(row.stockNo)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
                            {purpose === 'rc'
                              ? `${row.buyerName ?? 'Broker'} · Sold ${day(row.saleDate, false)}`
                              : `${label(row.location)} · Bought ${day(row.purchaseDate, false)} · ${inr(row.purchasePrice)}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StageChip stage={row.stage} />
                        {purpose === 'sale' && row.saleStatus === 'rejected' && (
                          <ToneChip tone="rejected" className="text-[10px]">Sale rejected</ToneChip>
                        )}
                        {purpose === 'rc' && (
                          row.flags.brokerRcPending
                            ? <ToneChip tone="pending" className="text-[10px]">Transfer due</ToneChip>
                            : <ToneChip tone="approved" className="text-[10px]">Transferred</ToneChip>
                        )}
                        {purpose === 'documents' && row.flags.docsMissing && (
                          <ToneChip tone="rejected" className="text-[10px]">{row.flags.missingDocs.length} missing</ToneChip>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-3.5">
            <span className="text-xs font-medium text-slate-500">
              {matches.length} {matches.length === 1 ? 'vehicle' : 'vehicles'}
            </span>
            <div className="flex items-center gap-2">
              {caps.register.create && (purpose === 'sale' || purpose === 'booking') && (
                <HpButton size="sm" variant="ghost" onClick={() => { onClose(); openNewPurchase() }}>
                  <ShoppingCart className="h-3.5 w-3.5 mr-1" /> Not on register? Record purchase
                </HpButton>
              )}
            </div>
          </div>
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
