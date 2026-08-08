'use client'

import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { KiaAccessoriesPanel, KiaExchangePanel } from '@/lib/kia/retail-review-panels'
import type { KiaBookingsPanel, KiaEnquiryPanel } from '@/lib/kia/retail-review-pipeline'

/**
 * Bookings / Enquiries / Exchange / Accessories — the remaining MD Review tabs.
 *
 * Same card chrome as retail-review-panel.tsx and conversion-panel.tsx (re-declared, not imported,
 * because those files import this one's siblings — see the note there). If the page's look
 * changes, all of them change together.
 */

const PRIMARY_SURFACE =
  'rounded-[2rem] border border-[#d5dfea] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const HEAD_CLASS = 'font-black uppercase tracking-[0.14em] text-slate-500'
const HEAD_ROW = 'bg-[#f6f9fc] hover:bg-[#f6f9fc]'
const TABLE_CLASS = '[&_td]:text-[12px] [&_td]:font-medium [&_th]:text-[10px]'

/** Grand-total rows: dark slate band with yellow figures, per the owner's spec. Inline style for
 *  the background — Tailwind arbitrary bg classes silently fail on <tr> in this app. Same
 *  constants in retail-review-panel.tsx / conversion-panel.tsx (importing across would be circular). */
const TOTAL_ROW_STYLE = { backgroundColor: '#1f2937' } as const
const TOTAL_TEXT = 'text-[#facc15]'
const TOTAL_CELL = cn('text-right font-black tabular-nums', TOTAL_TEXT)

function ReviewCard({
  title, subtitle, action, children,
}: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
      <div className="h-1.5 bg-[linear-gradient(90deg,#c5162f_0%,#071a2b_40%,#18a7d0_100%)]" />
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-5 pb-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#c5162f]">{title}</p>
          {subtitle ? <p className="mt-1 text-[13px] font-medium text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5 pt-0">{children}</CardContent>
    </Card>
  )
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <div className="mt-3 space-y-1">
      {notes.map((note) => <p key={note} className="text-[11px] font-medium text-slate-500">{note}</p>)}
    </div>
  )
}

function StatTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'bad' }) {
  return (
    <Card className={cn(
      'border-l-[5px] p-0 shadow-none',
      tone === 'bad' ? 'border-l-[#c5162f] bg-[#fdecef]' : 'border-l-[#071a2b] bg-white',
    )}>
      <CardContent className="p-4">
        <p className={cn('text-[24px] font-black leading-none', tone === 'bad' ? 'text-[#c5162f]' : 'text-slate-900')}>{value}</p>
        <p className="mt-2 text-[11px] font-black uppercase leading-tight tracking-[0.14em] text-slate-500">{label}</p>
      </CardContent>
    </Card>
  )
}

function n0(value: number) {
  return Math.round(value).toLocaleString('en-IN')
}

function inr(value: number) {
  const r = Math.round(Math.abs(value))
  const sign = value < 0 ? '-' : ''
  if (r >= 10000000) return `${sign}₹${(r / 10000000).toFixed(2)}Cr`
  if (r >= 100000) return `${sign}₹${(r / 100000).toFixed(2)}L`
  return `${sign}₹${r.toLocaleString('en-IN')}`
}

function PctCell({ value, warnBelow }: { value: number; warnBelow: number }) {
  return (
    <TableCell className={cn(
      'text-right tabular-nums',
      value < warnBelow ? 'bg-[#fdecef] font-black text-[#c5162f]' : 'text-slate-600',
    )}>
      {value.toFixed(1)}%
    </TableCell>
  )
}

/* ------------------------------------------------------------------------------------ *
 * Bookings
 * ------------------------------------------------------------------------------------ */

export function KiaBookingsPanelView({ panel, action }: { panel: KiaBookingsPanel; action?: ReactNode }) {
  const visible = Math.max(1, ...panel.combined.months.map((month, index) => (month.booked > 0 ? index + 1 : 1)))
  const sections = [
    { key: 'ALL', label: 'Both outlets', months: panel.combined.months, booked: panel.combined.booked, cancelled: panel.combined.cancelled, cancelRate: panel.combined.cancelRate },
    ...panel.byOutlet.map((outlet) => ({ key: outlet.outlet, label: `${outlet.outlet} — ${outlet.label}`, months: outlet.months, booked: outlet.booked, cancelled: outlet.cancelled, cancelRate: outlet.cancelRate })),
  ]
  const b = panel.backlog

  return (
    <div className="space-y-5">
      <ReviewCard
        title={`Bookings CY${panel.year}`}
        subtitle="Intake by booking month, on each booking's latest status"
        action={action}
      >
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.key}>
              <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                {section.label} · {n0(section.booked)} booked · {n0(section.cancelled)} cancelled ({section.cancelRate.toFixed(1)}%)
              </p>
              <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
                <Table className={TABLE_CLASS}>
                  <TableHeader>
                    <TableRow className={HEAD_ROW}>
                      <TableHead className={HEAD_CLASS}>Metric</TableHead>
                      {MONTHS.slice(0, visible).map((month) => (
                        <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Booked</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className="text-right font-black tabular-nums text-slate-900">{month.booked}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Cancelled</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className={cn('text-right tabular-nums', month.cancelled > 0 ? 'text-[#c5162f]' : 'text-slate-600')}>
                          {month.cancelled}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Retailed</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className="text-right tabular-nums text-slate-600">{month.retailed}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Still open</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className="text-right tabular-nums text-slate-600">{month.open}</TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
        <Notes notes={panel.notes} />
      </ReviewCard>

      <ReviewCard
        title="Open booking backlog"
        subtitle="Every booking whose latest status is neither retailed nor cancelled — any booking year"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Open bookings" value={n0(b.total.open)} />
          <StatTile label="Customer money held" value={inr(b.total.amountReceived)} />
          <StatTile label="Older than 90 days" value={n0(b.total.aging.d90_plus)} tone={b.total.aging.d90_plus > 0 ? 'bad' : 'neutral'} />
          <StatTile label="Past committed delivery" value={n0(b.total.overdue)} tone={b.total.overdue > 0 ? 'bad' : 'neutral'} />
        </div>

        <div className="mt-4 overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                {['Outlet', 'Open', 'Money held', '≤30d', '31–60d', '61–90d', '>90d'].map((head, index) => (
                  <TableHead key={head} className={cn(HEAD_CLASS, index > 0 && 'text-right')}>{head}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.outlets.map((outlet) => (
                <TableRow key={outlet.outlet}>
                  <TableCell className="font-black text-slate-800">{outlet.outlet} — {outlet.label}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-slate-900">{n0(outlet.open)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{inr(outlet.amountReceived)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{outlet.aging.d0_30}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{outlet.aging.d31_60}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{outlet.aging.d61_90}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', outlet.aging.d90_plus > 0 ? 'bg-[#fdecef] font-black text-[#c5162f]' : 'text-slate-600')}>
                    {outlet.aging.d90_plus}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow style={TOTAL_ROW_STYLE}>
                <TableCell className={cn('font-black uppercase tracking-[0.1em]', TOTAL_TEXT)}>Total</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(b.total.open)}</TableCell>
                <TableCell className={TOTAL_CELL}>{inr(b.total.amountReceived)}</TableCell>
                <TableCell className={TOTAL_CELL}>{b.total.aging.d0_30}</TableCell>
                <TableCell className={TOTAL_CELL}>{b.total.aging.d31_60}</TableCell>
                <TableCell className={TOTAL_CELL}>{b.total.aging.d61_90}</TableCell>
                <TableCell className={TOTAL_CELL}>{b.total.aging.d90_plus}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {b.topModels.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Open bookings by model</p>
            <div className="flex flex-wrap gap-2">
              {b.topModels.map((model) => (
                <span key={model.model} className="rounded-full border border-[#d5dfea] bg-white px-3 py-1.5 text-[12px] font-black text-slate-700 shadow-sm">
                  {model.model} · {model.count}
                </span>
              ))}
            </div>
          </div>
        )}
      </ReviewCard>
    </div>
  )
}

/* ------------------------------------------------------------------------------------ *
 * Enquiries
 * ------------------------------------------------------------------------------------ */

export function KiaEnquiryPanelView({ panel, action }: { panel: KiaEnquiryPanel; action?: ReactNode }) {
  const visible = Math.max(1, ...panel.lostMonths.map((month, index) => (month.enquiries > 0 ? index + 1 : 1)))

  return (
    <div className="space-y-5">
      <ReviewCard
        title={`Model-wise Demand CY${panel.year}`}
        subtitle="What customers ask about, test drive, book and buy — by model"
        action={action}
      >
        <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                {['Model', 'ENQ', 'TD', 'BKG', 'RET', 'E2TD', 'E2BKG', 'E2RET'].map((head, index) => (
                  <TableHead key={head} className={cn(HEAD_CLASS, index > 0 && 'text-right')}>{head}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.models.map((model) => (
                <TableRow key={model.model}>
                  <TableCell className="font-black text-slate-800">{model.model}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(model.enquiries)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(model.testDrives)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(model.bookings)}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-slate-900">{n0(model.retails)}</TableCell>
                  <PctCell value={model.e2td} warnBelow={40} />
                  <PctCell value={model.e2bkg} warnBelow={10} />
                  <PctCell value={model.e2ret} warnBelow={5} />
                </TableRow>
              ))}
              <TableRow style={TOTAL_ROW_STYLE}>
                <TableCell className={cn('font-black uppercase tracking-[0.1em]', TOTAL_TEXT)}>{panel.modelTotal.model}</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(panel.modelTotal.enquiries)}</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(panel.modelTotal.testDrives)}</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(panel.modelTotal.bookings)}</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(panel.modelTotal.retails)}</TableCell>
                <TableCell className={TOTAL_CELL}>{panel.modelTotal.e2td.toFixed(1)}%</TableCell>
                <TableCell className={TOTAL_CELL}>{panel.modelTotal.e2bkg.toFixed(1)}%</TableCell>
                <TableCell className={TOTAL_CELL}>{panel.modelTotal.e2ret.toFixed(1)}%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <Notes notes={panel.notes} />
      </ReviewCard>

      <ReviewCard title="Lost enquiries" subtitle="Enquiries that ended without a sale, by the month they were raised">
        <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Metric</TableHead>
                {MONTHS.slice(0, visible).map((month) => (
                  <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-black text-slate-700">Enquiries</TableCell>
                {panel.lostMonths.slice(0, visible).map((month) => (
                  <TableCell key={month.month} className="text-right tabular-nums text-slate-700">{n0(month.enquiries)}</TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Lost</TableCell>
                {panel.lostMonths.slice(0, visible).map((month) => (
                  <TableCell key={month.month} className="text-right tabular-nums text-[#c5162f]">{n0(month.lost)}</TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Lost %</TableCell>
                {panel.lostMonths.slice(0, visible).map((month) => (
                  <TableCell key={month.month} className={cn(
                    'text-right tabular-nums',
                    month.lostRatio > 60 ? 'bg-[#fdecef] font-black text-[#c5162f]' : 'text-slate-600',
                  )}>
                    {month.lostRatio.toFixed(0)}%
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {panel.lostReasons.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Top lost reasons</p>
            <div className="flex flex-wrap gap-2">
              {panel.lostReasons.map((reason) => (
                <span key={reason.reason} className="rounded-full border border-[#d5dfea] bg-white px-3 py-1.5 text-[12px] font-black text-slate-700 shadow-sm">
                  {reason.reason} · {n0(reason.count)}
                </span>
              ))}
            </div>
          </div>
        )}
      </ReviewCard>
    </div>
  )
}

/* ------------------------------------------------------------------------------------ *
 * Exchange
 * ------------------------------------------------------------------------------------ */

export function KiaExchangePanelView({ panel, action }: { panel: KiaExchangePanel; action?: ReactNode }) {
  const visible = Math.max(1, ...panel.months.map((month, index) => (month.totalEnquiries > 0 ? index + 1 : 1)))
  const sections = [
    { key: 'ALL', label: 'Both outlets', months: panel.months },
    ...panel.byOutlet.map((outlet) => ({ key: outlet.outlet, label: `${outlet.outlet} — ${outlet.label}`, months: outlet.months })),
  ]

  return (
    <div className="space-y-5">
      <ReviewCard
        title={`Exchange CY${panel.year}`}
        subtitle="Exchange interest, evaluations and penetration into retail"
        action={action}
      >
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.key}>
              <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{section.label}</p>
              <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
                <Table className={TABLE_CLASS}>
                  <TableHeader>
                    <TableRow className={HEAD_ROW}>
                      <TableHead className={HEAD_CLASS}>Metric</TableHead>
                      {MONTHS.slice(0, visible).map((month) => (
                        <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Exch Enq</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className="text-right tabular-nums text-slate-700">{n0(month.exchangeEnquiries)}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Evaluations</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className="text-right tabular-nums text-slate-700">{n0(month.evaluations)}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Exch Net</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className="text-right font-black tabular-nums text-slate-900">{n0(month.exchangeNet)}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Retail Net</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <TableCell key={month.month} className="text-right tabular-nums text-slate-700">{n0(month.retailNet)}</TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-black text-slate-700">Penetration</TableCell>
                      {section.months.slice(0, visible).map((month) => (
                        <PctCell key={month.month} value={month.exchangePenetration} warnBelow={10} />
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
        <Notes notes={panel.notes} />
      </ReviewCard>
    </div>
  )
}

/* ------------------------------------------------------------------------------------ *
 * Accessories
 * ------------------------------------------------------------------------------------ */

export function KiaAccessoriesPanelView({ panel, action }: { panel: KiaAccessoriesPanel; action?: ReactNode }) {
  const visible = Math.max(1, ...panel.months.map((month, index) => ((month.retailNdp > 0 || month.vehicleRetail > 0) ? index + 1 : 1)))

  return (
    <div className="space-y-5">
      <ReviewCard
        title={`Accessories CY${panel.year}`}
        subtitle="Counter sales value and per-car realisation, month on month"
        action={action}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Retail NDP (year)" value={inr(panel.total.retailNdp)} />
          <StatTile label="Retail MRP (year)" value={inr(panel.total.retailMrp)} />
          <StatTile label="Vehicles retailed" value={n0(panel.total.vehicleRetail)} />
          <StatTile label="Per-car NDP" value={inr(panel.total.perCarNdp)} />
        </div>

        <div className="mt-4 overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Metric</TableHead>
                {MONTHS.slice(0, visible).map((month) => (
                  <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-black text-slate-700">Retail NDP</TableCell>
                {panel.months.slice(0, visible).map((month) => (
                  <TableCell key={month.month} className="text-right tabular-nums text-slate-700">{inr(month.retailNdp)}</TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Vehicles</TableCell>
                {panel.months.slice(0, visible).map((month) => (
                  <TableCell key={month.month} className="text-right tabular-nums text-slate-700">{month.vehicleRetail}</TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Per-car NDP</TableCell>
                {panel.months.slice(0, visible).map((month) => (
                  <TableCell key={month.month} className="text-right font-black tabular-nums text-slate-900">{inr(month.perCarNdp)}</TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                {['Outlet', 'Retail NDP', 'Retail MRP', 'Vehicles', 'Per-car NDP'].map((head, index) => (
                  <TableHead key={head} className={cn(HEAD_CLASS, index > 0 && 'text-right')}>{head}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.byDealer.map((dealer) => (
                <TableRow key={dealer.outlet}>
                  <TableCell className="font-black text-slate-800">{dealer.outlet} — {dealer.label}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{inr(dealer.retailNdp)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{inr(dealer.retailMrp)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(dealer.vehicleRetail)}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-slate-900">{inr(dealer.perCarNdp)}</TableCell>
                </TableRow>
              ))}
              <TableRow style={TOTAL_ROW_STYLE}>
                <TableCell className={cn('font-black uppercase tracking-[0.1em]', TOTAL_TEXT)}>Total</TableCell>
                <TableCell className={TOTAL_CELL}>{inr(panel.total.retailNdp)}</TableCell>
                <TableCell className={TOTAL_CELL}>{inr(panel.total.retailMrp)}</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(panel.total.vehicleRetail)}</TableCell>
                <TableCell className={TOTAL_CELL}>{inr(panel.total.perCarNdp)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {panel.topItems.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Top accessory lines by value</p>
            <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
              <Table className={TABLE_CLASS}>
                <TableHeader>
                  <TableRow className={HEAD_ROW}>
                    {['Item', 'Qty', 'NDP value', 'MRP value'].map((head, index) => (
                      <TableHead key={head} className={cn(HEAD_CLASS, index > 0 && 'text-right')}>{head}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {panel.topItems.map((item) => (
                    <TableRow key={item.item}>
                      <TableCell className="font-medium text-slate-800">{item.item}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">{n0(item.qty)}</TableCell>
                      <TableCell className="text-right font-black tabular-nums text-slate-900">{inr(item.ndp)}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">{inr(item.mrp)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {panel.unavailableFields.length > 0 && (
          <p className="mt-3 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
            Not held in this system: {panel.unavailableFields.join(' · ')}
          </p>
        )}
        <Notes notes={panel.notes} />
      </ReviewCard>
    </div>
  )
}
