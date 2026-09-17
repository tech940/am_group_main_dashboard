'use client'

import * as React from 'react'
import { Ban, Check, CheckCheck, ClipboardCheck, ExternalLink, Handshake, ShoppingCart, UserRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NOT_TAKEN, formatStockNo } from '@/lib/h-promise/constants'
import { normalizeRegNo } from '@/lib/h-promise/registration'
import {
  APPROVAL_QUEUES,
  APPROVAL_QUEUE_LABELS,
  approvalLevelOf,
  canDecideAt,
  finalDeciderLabel,
  isSelfDecision,
  type ApprovalLevel,
  type ApprovalQueue,
} from '@/lib/h-promise/status'
import type { HpVehicleRow } from '@/lib/h-promise/types'
import { toast } from '@/hooks/use-toast'
import { hpSend, useHpMutation, useVehicles } from './hp-data'
import { useHpSection, useLabel } from './hp-context'
import { ago, approverName, day, inr, inrShort, soldToLabel, when } from './hp-format'
import { ReasonDialog } from './hp-form'
import {
  Band,
  BandCell,
  EmptyState,
  ErrorState,
  HpButton,
  LoadingBlock,
  Money,
  PlateSearch,
  RegPlate,
  Segmented,
  ToneChip,
  type Tone,
} from './hp-ui'

/**
 * Approvals — two stages (owner decision, 2026-09-17):
 *
 *   Waiting for GSM / SM  →  Waiting for MD  →  Approved by MD
 *                 ↘ (the MD may approve from here too)
 *   Rejected: back with the desk; a corrected entry starts again at the GSM / SM.
 *
 * Every queue has its own vehicle search. The data is the register the page already loaded — no extra reads.
 */

type Flow = 'purchase' | 'sale'
type FlowFilter = 'all' | Flow
type Source = 'all' | 'app' | 'sheet'
type Item = { key: string; row: HpVehicleRow; flow: Flow; queue: ApprovalQueue }

const QUEUE_TONE: Record<ApprovalQueue, Tone> = { manager: 'pending', md: 'accent', approved: 'approved', rejected: 'rejected' }

const QUEUE_HELP: Record<ApprovalQueue, string> = {
  manager: 'Entered by the desk. The GSM or a Sales Manager approves first — the MD can give the final approval straight away.',
  md: 'Approved by the GSM / SM. Waiting for the MD’s final approval.',
  approved: 'Finally approved: the price is locked. The MD can reopen one from the vehicle.',
  rejected: 'Sent back to the desk with a reason. A corrected entry starts again at the GSM / SM.',
}

const EMPTY_TEXT: Record<ApprovalQueue, string> = {
  manager: 'New purchases and sales appear here as soon as the desk saves them.',
  md: 'Entries the GSM / SM approve appear here for the MD.',
  approved: 'Purchases and sales the MD approves appear here.',
  rejected: 'Nothing has been sent back.',
}

const PAGE = 30

function countText(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function days(iso: string | null, now: number): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000))
}

/** When the item entered its current queue. */
function enteredQueueAt(item: Item): string | null {
  const { row, flow, queue } = item
  if (flow === 'purchase') {
    if (queue === 'md') return row.purchaseManagerAt
    if (queue === 'manager') return row.purchaseSubmittedAt ?? row.createdAt
    return row.purchaseDecidedAt ?? row.purchaseManagerAt
  }
  if (queue === 'md') return row.saleManagerAt
  if (queue === 'manager') return row.saleSubmittedAt ?? row.updatedAt
  return row.saleDecidedAt ?? row.saleManagerAt
}

function amountOf(item: Item): number {
  return item.flow === 'purchase' ? item.row.purchasePrice : item.row.sellingPrice ?? 0
}

function stageOf(item: Item) {
  const { row, flow } = item
  return flow === 'purchase'
    ? { status: row.purchaseStatus, manager: row.purchaseManagerStatus, managerBy: row.purchaseManagerByName, managerAt: row.purchaseManagerAt, managerNote: row.purchaseManagerNote, finalRole: row.purchaseDecidedRole, finalBy: row.purchaseDecidedByName, finalAt: row.purchaseDecidedAt, reason: row.purchaseDecisionReason, edited: row.purchaseEditedAfterApproval }
    : { status: row.saleStatus, manager: row.saleManagerStatus, managerBy: row.saleManagerByName, managerAt: row.saleManagerAt, managerNote: row.saleManagerNote, finalRole: row.saleDecidedRole, finalBy: row.saleDecidedByName, finalAt: row.saleDecidedAt, reason: row.saleDecisionReason, edited: row.saleEditedAfterApproval }
}

function isOwnEntry(userId: string, item: Item): boolean {
  return item.flow === 'purchase'
    ? isSelfDecision(userId, [item.row.createdById, item.row.purchaseSubmittedById])
    : isSelfDecision(userId, [item.row.saleSubmittedById])
}

/** Plate (any spacing), model, colour, HP number, buyer, and the people on the record. */
function matchesSearch(item: Item, query: string): boolean {
  const needle = query.trim().toUpperCase()
  if (!needle) return true
  const key = normalizeRegNo(needle)
  const { row } = item
  if (key.length >= 2 && row.regNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase().includes(key)) return true
  const s = stageOf(item)
  const hay = [
    row.model, row.colour, formatStockNo(row.stockNo), String(row.stockNo), row.buyerName, row.purchasedBy, row.soldBy,
    row.purchaseSubmittedByName, row.saleSubmittedByName, s.managerBy, s.finalBy,
  ].filter(Boolean).join(' ').toUpperCase()
  return hay.includes(needle)
}

const EMPTY_SEARCHES: Record<ApprovalQueue, string> = { manager: '', md: '', approved: '', rejected: '' }

export function ApprovalsClient() {
  const { caps } = useHpSection()
  const query = useVehicles('live')
  const rows = React.useMemo(() => query.data?.rows ?? [], [query.data])
  const level = approvalLevelOf(caps.approvals)
  const [now] = React.useState(() => Date.now())

  const items = React.useMemo<Item[]>(() => rows.flatMap((row) => {
    const out: Item[] = []
    if (row.flags.purchaseQueue) out.push({ key: `${row.id}:purchase`, row, flow: 'purchase', queue: row.flags.purchaseQueue })
    if (row.flags.saleQueue) out.push({ key: `${row.id}:sale`, row, flow: 'sale', queue: row.flags.saleQueue })
    return out
  }), [rows])

  const byQueue = React.useMemo(() => {
    const map: Record<ApprovalQueue, Item[]> = { manager: [], md: [], approved: [], rejected: [] }
    for (const item of items) map[item.queue].push(item)
    return map
  }, [items])

  // The MD lands on their own queue; a GSM / SM (and anyone only looking) on the first one.
  const defaultQueue: ApprovalQueue = level === 'md' && byQueue.md.length > 0 ? 'md' : 'manager'
  const [chosen, setChosen] = React.useState<ApprovalQueue | null>(null)
  const queue = chosen ?? defaultQueue
  const [searches, setSearches] = React.useState(EMPTY_SEARCHES)
  const [flowFilter, setFlowFilter] = React.useState<FlowFilter>('all')
  const [source, setSource] = React.useState<Source>('all')
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [limit, setLimit] = React.useState(PAGE)
  const [rejecting, setRejecting] = React.useState<Item | null>(null)
  const [bulkOpen, setBulkOpen] = React.useState(false)

  const choose = (next: ApprovalQueue) => {
    setChosen(next)
    setSelected(new Set())
    setLimit(PAGE)
  }

  const waiting = queue === 'manager' || queue === 'md'
  const inQueue = byQueue[queue]
  const importedWaiting = inQueue.filter((item) => item.row.imported).length
  const visible = React.useMemo(() => {
    const list = inQueue.filter((item) =>
      (flowFilter === 'all' || item.flow === flowFilter)
      && (!waiting || source === 'all' || (source === 'sheet' ? item.row.imported : !item.row.imported))
      && matchesSearch(item, searches[queue]))
    // Waiting: oldest first. Decided: newest first.
    return list.sort((a, b) => {
      const x = enteredQueueAt(a) ?? ''
      const y = enteredQueueAt(b) ?? ''
      return waiting ? x.localeCompare(y) : y.localeCompare(x)
    })
  }, [inQueue, flowFilter, source, searches, queue, waiting])

  const canActOn = (item: Item) => canDecideAt(level, stageOf(item).status, stageOf(item).manager) && !isOwnEntry(caps.userId, item)
  const selectable = waiting ? visible.filter(canActOn) : []
  const chosenItems = selectable.filter((item) => selected.has(item.key))

  const decide = useHpMutation((input: { item: Item; decision: 'approve' | 'reject'; reason?: string }) =>
    hpSend(`/api/h-promise/vehicles/${input.item.row.id}/${input.item.flow}-decision`, 'POST', { decision: input.decision, reason: input.reason }))

  // One mutation for the whole batch, so the register reloads once at the end, not once per car.
  const decideMany = useHpMutation(async (input: { list: Item[]; note: string }) => {
    const failed: string[] = []
    for (const item of input.list) {
      try {
        await hpSend(`/api/h-promise/vehicles/${item.row.id}/${item.flow}-decision`, 'POST', { decision: 'approve', reason: input.note || undefined })
      } catch (error) {
        failed.push(`${formatStockNo(item.row.stockNo)} ${item.flow}: ${error instanceof Error ? error.message : 'failed'}`)
      }
    }
    return { done: input.list.length - failed.length, failed }
  })

  const approve = async (item: Item) => {
    try {
      await decide.mutateAsync({ item, decision: 'approve' })
      toast({
        title: level === 'md' ? `${item.flow === 'purchase' ? 'Purchase' : 'Sale'} approved by MD` : `Sent to the MD`,
        description: `${formatStockNo(item.row.stockNo)} · ${item.row.regNo}`,
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'Not approved', description: error instanceof Error ? error.message : undefined, variant: 'error' })
    }
  }

  if (query.isLoading) return <LoadingBlock label="Loading the approval queues" rows={6} />
  if (query.isError && !query.data) return <ErrorState message={query.error instanceof Error ? query.error.message : 'The queues could not be loaded.'} onRetry={() => query.refetch()} />

  const oldest = (list: Item[]) => Math.max(0, ...list.map((item) => days(enteredQueueAt(item), now)))
  const cutoff = new Date(now - 30 * 86_400_000).toISOString()
  const subs: Record<ApprovalQueue, string> = {
    manager: byQueue.manager.length ? `${inrShort(byQueue.manager.reduce((s, i) => s + amountOf(i), 0))} · oldest ${oldest(byQueue.manager)} d` : 'Nothing waiting',
    md: byQueue.md.length ? `${inrShort(byQueue.md.reduce((s, i) => s + amountOf(i), 0))} · oldest ${oldest(byQueue.md)} d` : 'Nothing waiting',
    approved: `${byQueue.approved.filter((i) => (enteredQueueAt(i) ?? '') >= cutoff).length} in the last 30 days`,
    rejected: byQueue.rejected.length ? 'Back with the desk' : 'None',
  }
  const flowCounts = { purchase: inQueue.filter((i) => i.flow === 'purchase').length, sale: inQueue.filter((i) => i.flow === 'sale').length }
  const shown = visible.slice(0, limit)
  const allChosen = selectable.length > 0 && chosenItems.length === selectable.length

  return (
    <div className="space-y-4">
      <Band cols={4} label="Approval queues">
        {APPROVAL_QUEUES.map((q) => (
          <BandCell key={q} label={APPROVAL_QUEUE_LABELS[q]} tone={QUEUE_TONE[q]} value={byQueue[q].length} sub={subs[q]} onClick={() => choose(q)} pressed={queue === q} />
        ))}
      </Band>

      <p className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-600">
        {level === 'md'
          ? <>You give the <strong className="text-slate-900">final approval</strong>. You can approve from either waiting queue — the GSM / SM step is then marked as not needed.</>
          : level === 'manager'
            ? <>You approve as <strong className="text-slate-900">GSM / SM</strong>. What you approve goes to the MD for the final approval.</>
            : 'You can see the queues. Deciding needs the approve right (GSM / SM) or the MD role.'}
      </p>

      <section aria-labelledby="hp-queue-title" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="space-y-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 id="hp-queue-title" className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              {APPROVAL_QUEUE_LABELS[queue]}
              <ToneChip tone={inQueue.length ? QUEUE_TONE[queue] : 'neutral'}>{inQueue.length}</ToneChip>
            </h3>
            <p className="text-[12.5px] text-slate-500">{QUEUE_HELP[queue]}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PlateSearch
              value={searches[queue]}
              onChange={(value) => { setSearches((current) => ({ ...current, [queue]: value })); setLimit(PAGE) }}
              placeholder="Search plate, model, HP no, name…"
            />
            <Segmented
              label="Purchases or sales"
              value={flowFilter}
              onChange={(value) => { setFlowFilter(value); setLimit(PAGE) }}
              options={[
                { value: 'all', label: 'All', count: inQueue.length },
                { value: 'purchase', label: 'Purchases', count: flowCounts.purchase },
                { value: 'sale', label: 'Sales', count: flowCounts.sale },
              ]}
            />
            {waiting && importedWaiting > 0 && (
              <Segmented
                label="Where it was entered"
                value={source}
                onChange={setSource}
                options={[
                  { value: 'all', label: 'Any source' },
                  { value: 'app', label: 'In the app' },
                  { value: 'sheet', label: 'From the sheet', count: importedWaiting },
                ]}
              />
            )}
          </div>
          {selectable.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  style={{ accentColor: 'var(--hp-accent-ink)' }}
                  checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(selectable.map((item) => item.key)))}
                />
                Select all {selectable.length} you can approve
              </label>
              {chosenItems.length > 0 && (
                <>
                  <span className="hp-num font-semibold text-slate-900">
                    · {chosenItems.length} selected · {inr(chosenItems.reduce((s, i) => s + amountOf(i), 0))}
                  </span>
                  <HpButton size="sm" variant="approve" onClick={() => setBulkOpen(true)} busy={decideMany.isPending}>
                    <CheckCheck /> Approve {chosenItems.length}{level === 'md' ? ' as MD' : ''}
                  </HpButton>
                  <HpButton size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X /> Clear</HpButton>
                </>
              )}
            </div>
          )}
        </header>

        <div className={cn(waiting ? 'hp-sunken-bg space-y-2.5 p-3 sm:p-4' : '')}>
          {visible.length === 0 ? (
            <div className="p-4">
              <EmptyState title={searches[queue] || flowFilter !== 'all' || source !== 'all' ? 'Nothing matches' : 'Nothing here'} icon={<ClipboardCheck className="h-5 w-5" />}>
                {searches[queue] || flowFilter !== 'all' || source !== 'all' ? 'Check the plate, or clear the filters.' : EMPTY_TEXT[queue]}
              </EmptyState>
            </div>
          ) : waiting ? (
            shown.map((item) => (
              <ApprovalCard
                key={item.key}
                item={item}
                level={level}
                now={now}
                busy={decide.isPending || decideMany.isPending}
                selectable={canActOn(item)}
                selected={selected.has(item.key)}
                onToggle={() => setSelected((current) => {
                  const next = new Set(current)
                  if (next.has(item.key)) next.delete(item.key)
                  else next.add(item.key)
                  return next
                })}
                onApprove={() => approve(item)}
                onReject={() => setRejecting(item)}
              />
            ))
          ) : (
            <DecidedTable items={shown} queue={queue} />
          )}
          {visible.length > limit && (
            <div className="flex justify-center p-3">
              <HpButton size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, visible.length - limit)} more of {visible.length - limit}</HpButton>
            </div>
          )}
        </div>
      </section>

      {rejecting && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setRejecting(null)}
          title={`Reject the ${rejecting.flow} of ${formatStockNo(rejecting.row.stockNo)}?`}
          description={`${rejecting.flow === 'purchase' ? 'The desk sees your reason and can correct and resubmit.' : 'The car goes back to stock until the sale is corrected.'} A corrected entry starts again at the GSM / SM.`}
          label="What needs fixing"
          confirmLabel={level === 'md' ? 'Reject as MD' : 'Reject'}
          onConfirm={async (reason) => {
            await decide.mutateAsync({ item: rejecting, decision: 'reject', reason })
            toast({ title: 'Rejected', description: `${formatStockNo(rejecting.row.stockNo)} goes back to the desk.`, variant: 'success' })
          }}
        />
      )}

      {bulkOpen && (
        <ReasonDialog
          open
          optional
          tone="accent"
          onOpenChange={(open) => !open && setBulkOpen(false)}
          title={`Approve ${chosenItems.length} ${chosenItems.length === 1 ? 'entry' : 'entries'}${level === 'md' ? ' as MD' : ''}?`}
          description={
            <>
              {countText(chosenItems.filter((i) => i.flow === 'purchase').length, 'purchase')} and {countText(chosenItems.filter((i) => i.flow === 'sale').length, 'sale')}, worth {inr(chosenItems.reduce((s, i) => s + amountOf(i), 0))}.{' '}
              {level === 'md' ? 'This is the final approval: their prices lock.' : 'They go to the MD for the final approval.'}
            </>
          }
          label="Note for the history (optional)"
          confirmLabel={`Approve ${chosenItems.length}`}
          onConfirm={async (note) => {
            const result = await decideMany.mutateAsync({ list: chosenItems, note })
            setSelected(new Set())
            toast({
              title: `${result.done} approved${level === 'md' ? ' by MD' : ''}`,
              description: result.failed.length ? `${result.failed.length} not approved — ${result.failed.slice(0, 3).join('; ')}` : undefined,
              variant: result.failed.length ? 'error' : 'success',
            })
          }}
        />
      )}
    </div>
  )
}

function ApprovalCard({
  item,
  level,
  now,
  busy,
  selectable,
  selected,
  onToggle,
  onApprove,
  onReject,
}: {
  item: Item
  level: ApprovalLevel | null
  now: number
  busy: boolean
  selectable: boolean
  selected: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
}) {
  const { caps, openVehicle } = useHpSection()
  const label = useLabel()
  const { row, flow, queue } = item
  const s = stageOf(item)
  const since = enteredQueueAt(item)
  const waited = days(since, now)
  const own = isOwnEntry(caps.userId, item)
  const approver = flow === 'purchase' ? row.purchaseWhatsappApprover : row.saleWhatsappApprover
  const enteredBy = flow === 'purchase' ? row.purchaseSubmittedByName ?? row.createdByName : row.saleSubmittedByName
  const enteredAt = flow === 'purchase' ? row.purchaseSubmittedAt ?? row.createdAt : row.saleSubmittedAt
  const FlowIcon = flow === 'purchase' ? ShoppingCart : Handshake
  const canAct = canDecideAt(level, s.status, s.manager)

  return (
    <article
      className={cn('hp-rise rounded-lg border bg-white p-3.5', selected ? 'border-[color:var(--hp-accent-edge)]' : 'border-slate-200')}
      aria-label={`${flow === 'purchase' ? 'Purchase' : 'Sale'} ${formatStockNo(row.stockNo)} ${row.regNo}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {selectable && (
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              style={{ accentColor: 'var(--hp-accent-ink)' }}
              checked={selected}
              onChange={onToggle}
              aria-label={`Select ${formatStockNo(row.stockNo)} ${flow}`}
            />
          )}
          <RegPlate regNo={row.regNo} size="md" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-slate-900">
              <FlowIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="truncate">{`${flow === 'purchase' ? 'Purchase' : 'Sale'} · ${row.model}`}</span>
            </p>
            <p className="hp-mono truncate text-[11px] text-slate-500">{formatStockNo(row.stockNo)} · {label(row.location)}</p>
          </div>
        </div>
        <ToneChip tone={waited > 7 ? 'rejected' : waited > 2 ? 'pending' : 'neutral'} title={since ? when(since) : undefined}>
          {waited === 0 ? 'Today' : `${waited} d in this queue`}
        </ToneChip>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {flow === 'purchase' ? (
          <>
            <Figure label="Bought for"><Money value={row.purchasePrice} /></Figure>
            <Figure label={`With ${row.purchaseGstPct} % GST`}><Money value={row.economics.priceWithGst} /></Figure>
            <Figure label="Bought on">{day(row.purchaseDate)}</Figure>
            <Figure label="By">{label(row.purchasedBy)}</Figure>
          </>
        ) : (
          <>
            <Figure label="Sold for"><Money value={row.sellingPrice} /></Figure>
            <Figure label="Gross profit"><Money value={row.economics.grossProfit} signed /></Figure>
            <Figure label="Net profit"><Money value={row.economics.netProfit} signed /></Figure>
            <Figure label={`${soldToLabel(row.soldTo)} · ${day(row.saleDate, false)}`}>{label(row.soldBy)}</Figure>
          </>
        )}
      </dl>

      {queue === 'md' && (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-1.5 text-[12px] hp-sunken-bg">
          <ToneChip tone="approved" dot className="text-[10.5px]">GSM / SM</ToneChip>
          <span className="text-slate-700">Approved by {s.managerBy ?? '—'}{s.managerAt ? ` · ${ago(s.managerAt, now)}` : ''}{s.managerNote ? ` — “${s.managerNote}”` : ''}</span>
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
        <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" aria-hidden="true" />{enteredBy ?? '—'}{enteredAt ? ` · ${ago(enteredAt, now)}` : ''}</span>
        <span className={cn(approver === NOT_TAKEN && 'hp-tone-text font-semibold')} data-tone={approver === NOT_TAKEN ? 'pending' : undefined}>
          WhatsApp: {approver === NOT_TAKEN ? approverName(NOT_TAKEN) : label(approver)}
        </span>
        {row.imported && <ToneChip tone="neutral" className="text-[10px]">From the sheet</ToneChip>}
        {flow === 'sale' && row.purchaseStatus !== 'approved' && <ToneChip tone="pending" className="text-[10px]">Purchase not yet approved</ToneChip>}
        {flow === 'sale' && (row.economics.netProfit ?? 0) < 0 && <ToneChip tone="rejected" className="text-[10px]">Loss</ToneChip>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {canAct && !own && (
          <>
            <HpButton size="sm" variant="approve" disabled={busy} onClick={onApprove}>
              <Check /> {level === 'md' ? 'Approve as MD' : 'Approve'}
            </HpButton>
            <HpButton size="sm" variant="outline" disabled={busy} onClick={onReject}><Ban /> Reject</HpButton>
          </>
        )}
        {canAct && own && <p className="text-[12px] text-slate-500">You entered this — someone else must decide it.</p>}
        {!canAct && level === 'manager' && queue === 'md' && <p className="text-[12px] text-slate-500">Waiting for the MD.</p>}
        <HpButton size="sm" variant="ghost" className="ml-auto" onClick={() => openVehicle(row.id)}>
          Open <ExternalLink />
        </HpButton>
      </div>
    </article>
  )
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-slate-500">{label}</dt>
      <dd className="hp-num truncate text-[13px] font-semibold text-slate-900">{children}</dd>
    </div>
  )
}

/** Approved by MD, or Rejected: who decided at each stage, newest first. */
function DecidedTable({ items, queue }: { items: Item[]; queue: ApprovalQueue }) {
  const { openVehicle } = useHpSection()
  return (
    <div className="hp-scroll max-h-[36rem]">
      <table className="hp-table min-w-[860px]">
        <thead>
          <tr>
            <th scope="col">{queue === 'approved' ? 'Approved' : 'Rejected'}</th>
            <th scope="col">Vehicle</th>
            <th scope="col">What</th>
            <th scope="col">GSM / SM</th>
            <th scope="col">MD</th>
            <th scope="col">{queue === 'approved' ? 'Note' : 'Reason'}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const { row, flow } = item
            const s = stageOf(item)
            const managerCell = s.manager === 'approved'
              ? `Approved · ${s.managerBy ?? '—'}`
              : s.manager === 'rejected'
                ? `Rejected · ${s.managerBy ?? '—'}`
                : s.finalRole ? 'Not needed' : 'Not recorded'
            const mdCell = s.status === 'approved'
              ? finalDeciderLabel(s.finalRole, s.finalBy)
              : s.manager === 'rejected'
                ? 'Not reached'
                : `Rejected · ${finalDeciderLabel(s.finalRole, s.finalBy)}`
            const note = queue === 'rejected' ? s.reason ?? s.managerNote : s.reason ?? s.managerNote
            return (
              <tr key={item.key} data-clickable="true" onClick={() => openVehicle(row.id)}>
                <td className="whitespace-nowrap text-slate-700">{when(enteredQueueAt(item))}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <RegPlate regNo={row.regNo} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-slate-800">{row.model}</span>
                      <span className="hp-mono block text-[10.5px] text-slate-500">{formatStockNo(row.stockNo)}</span>
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap text-slate-700">{flow === 'purchase' ? `Purchase · ${inr(row.purchasePrice)}` : `Sale · ${inr(row.sellingPrice)}`}</td>
                <td className="whitespace-nowrap text-slate-700">{managerCell}</td>
                <td className="whitespace-nowrap">
                  <span className={cn(s.status === 'rejected' && s.manager !== 'rejected' ? 'hp-tone-text font-medium' : 'text-slate-800')} data-tone={s.status === 'rejected' && s.manager !== 'rejected' ? 'rejected' : undefined}>
                    {mdCell}
                  </span>
                </td>
                <td className="max-w-[18rem] text-slate-600">
                  <span className="line-clamp-2">{note ?? ''}</span>
                  {row.imported && <ToneChip tone="neutral" className="mr-1 mt-0.5 text-[10px]">From the sheet</ToneChip>}
                  {s.edited && <ToneChip tone="pending" className="mt-0.5 text-[10px]">Edited after approval</ToneChip>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
