'use client'

import React, { type ReactNode } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { KiaConversionPanel } from '@/lib/kia/retail-review-panels'

/**
 * Conversion — the MD's slides 5 to 8, inside the Sales Report's MD Review tab.
 *
 * Its own file so `retail-review-panel.tsx` can import it without the two files importing each
 * other. The card chrome below is the same as the retail panel's and the same as the Sales
 * Report's own `ChartCard`; if the page's look changes, all three change together.
 */

const PRIMARY_SURFACE =
  'rounded-[2rem] border border-[#d5dfea] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

const HEAD_CLASS = 'font-black uppercase tracking-[0.14em] text-slate-500'
const HEAD_ROW = 'bg-[#f6f9fc] hover:bg-[#f6f9fc]'
const TABLE_CLASS = '[&_td]:text-[12px] [&_td]:font-medium [&_th]:text-[10px]'

/**
 * Per-outlet colour bands — one distinct palette per dealer so rows are
 * instantly scannable without reading the code label.
 *
 * JK402 Jammu  → teal/navy (matches the brand primary)
 * JK501 Udhampur → warm amber/orange
 * Fallback for any future third outlet → slate
 */
const OUTLET_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  JK402: { bg: '#0d4f6c', text: '#ffffff', border: '#0a3d55' },
  JK501: { bg: '#7c3d12', text: '#ffffff', border: '#6b3410' },
}

function outletHeaderStyle(outlet: string): React.CSSProperties {
  const c = OUTLET_COLORS[outlet] ?? { bg: '#1f2937', text: '#ffffff', border: '#111827' }
  return { backgroundColor: c.bg, borderColor: c.border }
}

function outletHeaderTextClass(outlet: string) {
  return 'font-black uppercase tracking-[0.10em] text-white'
}

/** Grand-total rows: dark slate band with yellow figures, per the owner's spec. Inline style for
 *  the background — Tailwind arbitrary bg classes silently fail on <tr> in this app. Same
 *  constants in retail-review-panel.tsx / pipeline-panels.tsx (importing across would be circular). */
const TOTAL_ROW_STYLE = { backgroundColor: '#1f2937' } as const
const TOTAL_TEXT = 'text-[#facc15]'

/** Red-flags a weak ratio, mirroring the deck's own highlighting. */
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

function MonthHeader({ visible }: { visible: number }) {
  return (
    <>
      {MONTHS.slice(0, visible).map((month) => (
        <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
      ))}
    </>
  )
}

export function KiaConversionPanelView({
  panel, action,
}: { panel: KiaConversionPanel; action?: ReactNode }) {
  const visible = Math.max(
    1,
    ...panel.outletMonths.flatMap((row) => row.months.map((month, index) => (month.enquiries > 0 ? index + 1 : 1))),
  )

  const titleLabel = panel.monthLabel ? `Source-wise Conversion (${panel.monthLabel})` : `Source-wise Conversion CY${panel.year}`

  return (
    <div className="space-y-5">
      <ReviewCard
        title={titleLabel}
        subtitle="Enquiry to test drive to booking to retail, by lead source"
        action={action}
      >
        <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                {['Outlet / Source', 'ENQ', 'TD', 'BKG', 'RET', 'E2TD', 'E2BKG', 'E2RET'].map((head, index) => (
                  <TableHead key={head} className={cn(HEAD_CLASS, index > 0 && 'text-right')}>{head}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.outlets.flatMap((outlet) => [
                <TableRow key={outlet.outlet} style={outletHeaderStyle(outlet.outlet)}>
                  <TableCell className={cn('font-black uppercase tracking-[0.10em]', outletHeaderTextClass(outlet.outlet))}>{outlet.label}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-white">{outlet.total.enquiries.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-white">{outlet.total.testDrives.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-white">{outlet.total.bookings.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-white">{outlet.total.retails.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-white">{outlet.total.e2td.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-white">{outlet.total.e2bkg.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-white">{outlet.total.e2ret.toFixed(1)}%</TableCell>
                </TableRow>,
                ...outlet.sources.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="pl-8 font-medium text-slate-800">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-700">{row.enquiries.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-700">{row.testDrives.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-700">{row.bookings.toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right font-black tabular-nums text-slate-900">{row.retails.toLocaleString('en-IN')}</TableCell>
                    <PctCell value={row.e2td} warnBelow={40} />
                    <PctCell value={row.e2bkg} warnBelow={10} />
                    <PctCell value={row.e2ret} warnBelow={5} />
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 space-y-1">
          {panel.notes.map((note) => (
            <p key={note} className="text-[11px] font-medium text-slate-500">{note}</p>
          ))}
        </div>
      </ReviewCard>

      <ReviewCard
        title="Hyperlocal and Walk-in, month on month"
        subtitle="The two sources tracked most closely on the review"
      >
        <div className="space-y-4">
          {panel.focusSources
            .filter((row) => row.months.some((month) => month.enquiries > 0))
            .map((row) => (
              <div key={`${row.outlet}-${row.source}`}>
                <div
                  className="mb-1.5 inline-flex items-center gap-2 rounded-lg px-3 py-1.5"
                  style={outletHeaderStyle(row.outlet)}
                >
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-white">
                    {row.outlet}
                  </span>
                  <span className="text-[11px] text-white/70">·</span>
                  <span className="text-[11px] font-semibold text-white/90">{row.source}</span>
                </div>
                <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
                  <Table className={TABLE_CLASS}>
                    <TableHeader>
                      <TableRow className={HEAD_ROW}>
                        <TableHead className={HEAD_CLASS}>Metric</TableHead>
                        <MonthHeader visible={visible} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-black text-slate-700">ENQ</TableCell>
                        {row.months.slice(0, visible).map((month, index) => (
                          <TableCell key={index} className="text-right tabular-nums text-slate-700">{month.enquiries}</TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-black text-slate-700">RET</TableCell>
                        {row.months.slice(0, visible).map((month, index) => (
                          <TableCell key={index} className="text-right tabular-nums text-slate-700">{month.retails}</TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-black text-slate-700">E2RET</TableCell>
                        {row.months.slice(0, visible).map((month, index) => (
                          <PctCell key={index} value={month.e2ret} warnBelow={5} />
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
        </div>
      </ReviewCard>

      <ReviewCard title="Outlet by month" subtitle="Enquiry, booking and test drive conversion each month">
        <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Outlet / Metric</TableHead>
                <MonthHeader visible={visible} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.outletMonths.flatMap((row) => [
                <TableRow key={`${row.outlet}-enq`} style={outletHeaderStyle(row.outlet)}>
                  <TableCell className={outletHeaderTextClass(row.outlet)}>
                    {row.outlet} · Enquiries
                  </TableCell>
                  {row.months.slice(0, visible).map((month, index) => (
                    <TableCell key={index} className="text-right font-black tabular-nums text-white">{month.enquiries}</TableCell>
                  ))}
                </TableRow>,
                <TableRow key={`${row.outlet}-bkg`}>
                  <TableCell className="pl-8 font-medium text-slate-800">Bookings</TableCell>
                  {row.months.slice(0, visible).map((month, index) => (
                    <TableCell key={index} className="text-right tabular-nums text-slate-700">{month.bookings}</TableCell>
                  ))}
                </TableRow>,
                <TableRow key={`${row.outlet}-pbkg`}>
                  <TableCell className="pl-8 font-medium text-slate-800">% Bkg to Enq</TableCell>
                  {row.months.slice(0, visible).map((month, index) => (
                    <PctCell key={index} value={month.e2bkg} warnBelow={10} />
                  ))}
                </TableRow>,
                <TableRow key={`${row.outlet}-td`}>
                  <TableCell className="pl-8 font-medium text-slate-800">Test Drives</TableCell>
                  {row.months.slice(0, visible).map((month, index) => (
                    <TableCell key={index} className="text-right tabular-nums text-slate-700">{month.testDrives}</TableCell>
                  ))}
                </TableRow>,
                <TableRow key={`${row.outlet}-ptd`}>
                  <TableCell className="pl-8 font-medium text-slate-800">% TD to Enq</TableCell>
                  {row.months.slice(0, visible).map((month, index) => (
                    <PctCell key={index} value={month.e2td} warnBelow={40} />
                  ))}
                </TableRow>,
              ])}
            </TableBody>
          </Table>
        </div>
      </ReviewCard>
    </div>
  )
}
