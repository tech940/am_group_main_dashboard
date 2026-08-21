'use client'

import React, { useState, type ReactNode, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { HyundaiRetailReview, HyundaiRetailSeries } from '@/lib/hyundai/retail-review'
import type { HyundaiConversionPanel, HyundaiExchangePanel } from '@/lib/hyundai/retail-review-panels'
import type { HyundaiBookingsPanel, HyundaiEnquiryPanel } from '@/lib/hyundai/retail-review-pipeline'

const PRIMARY_SURFACE =
  'rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white/88 shadow-xl shadow-slate-900/5 backdrop-blur-xl'

const ACCENTS = ['#055B65', '#0284C7', '#0D9488', '#0891B2', '#8B5CF6', '#F59E0B']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HEAD_CLASS = 'font-black uppercase tracking-[0.14em] text-slate-600'
const HEAD_ROW = 'bg-slate-50 hover:bg-slate-50'
const TABLE_CLASS = '[&_td]:text-[12px] [&_td]:font-medium [&_th]:text-[10px]'

const TOTAL_ROW_STYLE = { backgroundColor: '#0f172a' } as const
const TOTAL_TEXT = 'text-amber-300'
const TOTAL_CELL = cn('text-right font-black tabular-nums', TOTAL_TEXT)

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

function ReviewCard({
  title, subtitle, action, children, className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden', className)}>
      <div className="h-1.5 bg-[linear-gradient(90deg,#055B65_0%,#0D9488_45%,#0284C7_100%)]" />
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 p-5 pb-3">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#055B65]">{title}</h3>
          {subtitle ? <p className="mt-1 text-[13px] font-medium text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5 pt-0">{children}</CardContent>
    </Card>
  )
}

function StatTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'bad' }) {
  return (
    <Card className={cn(
      'border-l-[5px] p-0 shadow-none',
      tone === 'bad' ? 'border-l-rose-600 bg-rose-50' : 'border-l-[#055B65] bg-white',
    )}>
      <CardContent className="p-4">
        <p className={cn('text-[24px] font-black leading-none', tone === 'bad' ? 'text-rose-700' : 'text-slate-900')}>{value}</p>
        <p className="mt-2 text-[11px] font-black uppercase leading-tight tracking-[0.14em] text-slate-500">{label}</p>
      </CardContent>
    </Card>
  )
}

function PctCell({ value, warnBelow }: { value: number; warnBelow: number }) {
  return (
    <TableCell className={cn(
      'text-right tabular-nums',
      value < warnBelow ? 'bg-rose-50 font-black text-rose-700' : 'text-slate-600',
    )}>
      {value.toFixed(1)}%
    </TableCell>
  )
}

type ReviewTab = 'retail' | 'conversion' | 'bookings' | 'enquiries' | 'exchange'

const REVIEW_TABS: { key: ReviewTab; label: string }[] = [
  { key: 'retail', label: 'Retail & Models' },
  { key: 'conversion', label: 'Conversion' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'exchange', label: 'Exchange' },
]

const TAB_BASE =
  'rounded-full border border-[#d5dfea] bg-white px-4 py-2 text-[13px] font-black text-slate-600 shadow-sm transition'

function RetailSeriesCard({
  series, review, action,
}: { series: HyundaiRetailSeries; review: HyundaiRetailReview; action?: ReactNode }) {
  const b = series.baseline
  const visible = b.lastMonthWithData ?? 12

  const strip = [
    { label: `Q4 Oct–Dec ${review.previousYear}`, value: n0(b.q4Volume), tone: 'neutral' as const },
    { label: `CY${review.previousYear} Q4 Avg/Month`, value: n0(b.q4AveragePerMonth), tone: 'neutral' as const },
    { label: 'Current Avg/Month', value: n0(b.currentAveragePerMonth), tone: 'neutral' as const },
    { label: 'Vol Gap/Month', value: n0(b.volumeGapPerMonth), tone: 'bad' as const },
    { label: `De-growth over Q4-${String(review.previousYear).slice(2)}`, value: b.deGrowthPercent === null ? '—' : `${b.deGrowthPercent.toFixed(0)}%`, tone: 'bad' as const },
    { label: `Total Vol gap till ${MONTHS[Math.max(0, b.elapsedMonths - 1)]}`, value: n0(b.totalVolumeGap), tone: 'bad' as const },
  ]

  return (
    <ReviewCard
      title={`${series.label} Retail`}
      subtitle={`CY${review.previousYear} vs CY${review.currentYear} · by confirm date, deduplicated by VIN`}
      action={action}
    >
      <div className="overflow-x-auto rounded-[1.5rem] border border-[var(--dashboard-primary-border)]">
        <Table className="[&_td]:text-[12px] [&_td]:font-medium [&_th]:text-[10px]">
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead scope="col" className="font-black uppercase tracking-[0.14em] text-slate-600">Retail</TableHead>
              {MONTHS.map((month) => (
                <TableHead key={month} scope="col" className="text-right font-black uppercase tracking-[0.14em] text-slate-600">{month}</TableHead>
              ))}
              <TableHead scope="col" className="text-right font-black uppercase tracking-[0.14em] text-slate-600">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-black text-slate-700">CY{review.previousYear}</TableCell>
              {series.months.map((row) => (
                <TableCell key={row.month} className="text-right tabular-nums text-slate-600">{row.previous}</TableCell>
              ))}
              <TableCell className="text-right font-black tabular-nums text-slate-800">{series.previousTotal}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-black text-slate-900">CY{review.currentYear}</TableCell>
              {series.months.map((row) => (
                <TableCell key={row.month} className="text-right font-black tabular-nums text-slate-900">
                  {row.month <= visible ? row.current : ''}
                </TableCell>
              ))}
              <TableCell className="text-right font-black tabular-nums text-slate-900">{series.currentTotal}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-black text-slate-700">Gap</TableCell>
              {series.months.map((row) => {
                const show = row.month <= visible
                const behind = show && row.gap < 0
                return (
                  <TableCell
                    key={row.month}
                    className={cn(
                      'text-right tabular-nums',
                      behind ? 'bg-rose-50 font-black text-rose-700' : 'text-slate-600',
                    )}
                  >
                    {show ? (row.gap > 0 ? `+${row.gap}` : row.gap) : ''}
                  </TableCell>
                )
              })}
              <TableCell className={cn(
                'text-right font-black tabular-nums',
                series.currentTotal - series.previousTotal < 0 ? 'text-rose-700' : 'text-emerald-700',
              )}>
                {series.currentTotal - series.previousTotal}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {strip.map((item, index) => (
          <Card
            key={item.label}
            className={cn(
              'border-l-[5px] p-0 shadow-none',
              item.tone === 'bad' ? 'border-l-rose-600 bg-rose-50' : 'bg-white',
            )}
            style={item.tone === 'neutral' ? { borderLeftColor: ACCENTS[index % ACCENTS.length] } : undefined}
          >
            <CardContent className="p-4">
              <p className={cn(
                'text-[26px] font-black leading-none tabular-nums',
                item.tone === 'bad' ? 'text-rose-700' : 'text-slate-900',
              )}>
                {item.value}
              </p>
              <p className="mt-2 text-[11px] font-black uppercase leading-tight tracking-[0.14em] text-slate-600">
                {item.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </ReviewCard>
  )
}

function ModelCard({ review }: { review: HyundaiRetailReview }) {
  const visible = Math.max(1, ...review.series.map((series) => series.baseline.lastMonthWithData ?? 1))
  const models = review.models.filter((model) => model.total > 0 || model.model !== 'Other')

  return (
    <ReviewCard
      title={`Model-wise Performance CY${review.currentYear}`}
      subtitle="Retail units by model and month"
    >
      <div className="overflow-x-auto rounded-[1.5rem] border border-[var(--dashboard-primary-border)]">
        <Table className="[&_td]:text-[12px] [&_td]:font-medium [&_th]:text-[10px]">
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead scope="col" className="font-black uppercase tracking-[0.14em] text-slate-600">Model</TableHead>
              {MONTHS.map((month) => (
                <TableHead key={month} scope="col" className="text-right font-black uppercase tracking-[0.14em] text-slate-600">{month}</TableHead>
              ))}
              <TableHead scope="col" className="text-right font-black uppercase tracking-[0.14em] text-slate-600">Total</TableHead>
              <TableHead scope="col" className="text-right font-black uppercase tracking-[0.14em] text-slate-600">Avg/Mo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow key={model.model}>
                <TableCell className="font-black text-slate-800">{model.model}</TableCell>
                {model.months.map((units, index) => (
                  <TableCell key={index} className="text-right tabular-nums text-slate-600">
                    {index + 1 <= visible ? (units || '') : ''}
                  </TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-slate-900">{model.total}</TableCell>
                <TableCell className="text-right tabular-nums text-slate-600">{model.monthlyAverage.toFixed(1)}</TableCell>
              </TableRow>
            ))}
            <TableRow style={{ backgroundColor: '#0f172a' }}>
              <TableCell className="font-black text-white">Total</TableCell>
              {review.modelTotals.months.map((units, index) => (
                <TableCell key={index} className="text-right font-black tabular-nums text-amber-300">
                  {index + 1 <= visible ? (units || '') : ''}
                </TableCell>
              ))}
              <TableCell className="text-right font-black tabular-nums text-amber-300">{review.modelTotals.total}</TableCell>
              <TableCell className="text-right font-black tabular-nums text-amber-300">{review.modelTotals.monthlyAverage.toFixed(1)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </ReviewCard>
  )
}

function ConversionPanelView({ panel, action }: { panel: HyundaiConversionPanel; action?: ReactNode }) {
  const visible = Math.max(
    1,
    ...panel.outletMonths.flatMap((row) => row.months.map((m, idx) => (m.enquiries > 0 ? idx + 1 : 1))),
  )

  const titleLabel = panel.monthLabel ? `Source-wise Conversion (${panel.monthLabel})` : `Source-wise Conversion CY${panel.year}`

  return (
    <div className="space-y-5">
      <ReviewCard title={titleLabel} subtitle="Enquiry to test drive to booking to retail, by lead source" action={action}>
        <div className="overflow-x-auto rounded-[1.5rem] border border-[var(--dashboard-primary-border)]">
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
                <TableRow key={outlet.outlet} style={{ backgroundColor: '#055B65' }}>
                  <TableCell className="font-black uppercase tracking-[0.10em] text-white">{outlet.label}</TableCell>
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
      </ReviewCard>

      <ReviewCard title="Focus Sources, Month on Month" subtitle="Key acquisition channels tracked across the year">
        <div className="space-y-4">
          {panel.focusSources
            .filter((row) => row.months.some((month) => month.enquiries > 0))
            .map((row) => (
              <div key={`${row.outlet}-${row.source}`}>
                <div className="mb-1.5 inline-flex items-center gap-2 rounded-lg bg-[#055B65] px-3 py-1.5 text-white">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em]">{row.source}</span>
                </div>
                <div className="overflow-x-auto rounded-[1.5rem] border border-[var(--dashboard-primary-border)]">
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
    </div>
  )
}

function BookingsPanelView({ panel, action }: { panel: HyundaiBookingsPanel; action?: ReactNode }) {
  const visible = Math.max(1, ...panel.combined.months.map((m, idx) => (m.booked > 0 ? idx + 1 : 1)))
  const b = panel.backlog

  return (
    <div className="space-y-5">
      <ReviewCard title={`Bookings CY${panel.year}`} subtitle="Intake by booking month from live booking records" action={action}>
        <div className="overflow-x-auto rounded-[1.5rem] border border-[var(--dashboard-primary-border)]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Metric</TableHead>
                {MONTHS.slice(0, visible).map((month) => (
                  <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
                ))}
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-black text-slate-700">Booked</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <TableCell key={m.month} className="text-right font-black tabular-nums text-slate-900">{m.booked}</TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-[#055B65]">{panel.combined.booked}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </ReviewCard>

      <ReviewCard title="Open Booking Backlog" subtitle="Active order backlog and customer advances">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Open bookings" value={n0(b.total.open)} />
          <StatTile label="Customer money held" value={inr(b.total.amountReceived)} />
          <StatTile label="Older than 90 days" value={n0(b.total.aging.d90_plus)} tone={b.total.aging.d90_plus > 0 ? 'bad' : 'neutral'} />
          <StatTile label="Past committed delivery" value={n0(b.total.overdue)} tone={b.total.overdue > 0 ? 'bad' : 'neutral'} />
        </div>

        {b.topModels.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Top Booking Models</p>
            <div className="flex flex-wrap gap-2">
              {b.topModels.map((model) => (
                <span key={model.model} className="rounded-full border border-[var(--dashboard-primary-border)] bg-white px-3 py-1.5 text-[12px] font-black text-slate-700 shadow-sm">
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

function EnquiryPanelView({ panel, action }: { panel: HyundaiEnquiryPanel; action?: ReactNode }) {
  const visible = Math.max(1, ...panel.combined.months.map((m, idx) => (m.enquiries > 0 ? idx + 1 : 1)))

  return (
    <div className="space-y-5">
      <ReviewCard title={`Enquiry & Test Drive Intake CY${panel.year}`} subtitle="Monthly enquiry volume and test drive conversion" action={action}>
        <div className="overflow-x-auto rounded-[1.5rem] border border-[var(--dashboard-primary-border)]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Metric</TableHead>
                {MONTHS.slice(0, visible).map((month) => (
                  <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
                ))}
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-black text-slate-700">Enquiries</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <TableCell key={m.month} className="text-right font-black tabular-nums text-slate-900">{n0(m.enquiries)}</TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-[#055B65]">{n0(panel.combined.enquiries)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Test Drives</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <TableCell key={m.month} className="text-right tabular-nums text-slate-700">{n0(m.testDrives)}</TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-slate-900">{n0(panel.combined.testDrives)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">TD %</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <PctCell key={m.month} value={m.tdRatePct} warnBelow={30} />
                ))}
                <TableCell className="text-right font-black tabular-nums text-[#055B65]">{panel.combined.tdRatePct.toFixed(1)}%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </ReviewCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <ReviewCard title="Top Enquiry Models" subtitle="Lead share by model">
          <div className="space-y-2">
            {panel.topModels.map((item) => (
              <div key={item.model} className="flex items-center justify-between text-sm py-1 border-b border-slate-100 last:border-0">
                <span className="font-bold text-slate-800">{item.model}</span>
                <div className="flex items-center gap-3">
                  <span className="font-black text-slate-900">{n0(item.count)}</span>
                  <span className="text-xs text-slate-400">({item.sharePct.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </ReviewCard>

        <ReviewCard title="Top Lead Sources" subtitle="Channel contribution mix">
          <div className="space-y-2">
            {panel.topSources.map((item) => (
              <div key={item.source} className="flex items-center justify-between text-sm py-1 border-b border-slate-100 last:border-0">
                <span className="font-bold text-slate-800">{item.source}</span>
                <div className="flex items-center gap-3">
                  <span className="font-black text-slate-900">{n0(item.count)}</span>
                  <span className="text-xs text-slate-400">({item.sharePct.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>
        </ReviewCard>
      </div>
    </div>
  )
}

function ExchangePanelView({ panel, action }: { panel: HyundaiExchangePanel; action?: ReactNode }) {
  const visible = Math.max(1, ...panel.combined.months.map((m, idx) => (m.enquiries > 0 ? idx + 1 : 1)))

  return (
    <div className="space-y-5">
      <ReviewCard title={`Exchange & Trade-In Funnel CY${panel.year}`} subtitle="Customer exchange interest and valuation performance" action={action}>
        <div className="overflow-x-auto rounded-[1.5rem] border border-[var(--dashboard-primary-border)]">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Metric</TableHead>
                {MONTHS.slice(0, visible).map((month) => (
                  <TableHead key={month} className={cn(HEAD_CLASS, 'text-right')}>{month}</TableHead>
                ))}
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-black text-slate-700">Enquiries</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <TableCell key={m.month} className="text-right tabular-nums text-slate-700">{n0(m.enquiries)}</TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-[#055B65]">{n0(panel.combined.enquiries)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Exchange Opted</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <TableCell key={m.month} className="text-right font-black tabular-nums text-slate-900">{n0(m.interested)}</TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-[#055B65]">{n0(panel.combined.interested)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Exchange %</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <PctCell key={m.month} value={m.interestRatePct} warnBelow={20} />
                ))}
                <TableCell className="text-right font-black tabular-nums text-[#055B65]">{panel.combined.interestRatePct.toFixed(1)}%</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-black text-slate-700">Evaluated</TableCell>
                {panel.combined.months.slice(0, visible).map((m) => (
                  <TableCell key={m.month} className="text-right tabular-nums text-slate-700">{n0(m.evaluated)}</TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-slate-900">{n0(panel.combined.evaluated)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </ReviewCard>

      {panel.topMakers.length > 0 && (
        <ReviewCard title="Top Trade-In Vehicle Makes" subtitle="Customer existing vehicles evaluated for exchange">
          <div className="flex flex-wrap gap-2">
            {panel.topMakers.map((maker) => (
              <span key={maker.name} className="rounded-full border border-[var(--dashboard-primary-border)] bg-white px-3 py-1.5 text-[12px] font-black text-slate-700 shadow-sm">
                {maker.name} · {n0(maker.count)}
              </span>
            ))}
          </div>
        </ReviewCard>
      )}
    </div>
  )
}

export function HyundaiRetailReviewPanel({ year: propYear, month: propMonth }: { year?: number; month?: number | null } = {}) {
  const [internalYear, setInternalYear] = useState<number>(propYear || new Date().getFullYear())
  const [tab, setTab] = useState<ReviewTab>('retail')

  const activeYear = propYear || internalYear
  const activeMonth = propMonth ?? null

  const active = useQuery<unknown>({
    queryKey: ['hyundai-retail-review', tab, activeYear, activeMonth],
    queryFn: async () => {
      const panelParam = tab === 'retail' ? '' : `panel=${tab}&`
      const monthParam = activeMonth ? `&month=${activeMonth}` : ''
      const res = await fetch(`/api/brands/hyundai/sales-report/retail-review?${panelParam}year=${activeYear}${monthParam}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load the review')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return [current, current - 1, current - 2]
  }, [])

  const yearPicker = (
    <label className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.14em] text-slate-500">
      Year
      <select
        value={activeYear}
        onChange={(event) => setInternalYear(Number(event.target.value))}
        className="rounded-full border border-[var(--dashboard-primary-border)] bg-white px-3 py-1.5 text-[13px] font-black text-slate-700 shadow-sm"
      >
        {yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )

  const tabBar = (
    <div className="flex flex-wrap gap-2">
      {REVIEW_TABS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => setTab(item.key)}
          className={cn(
            TAB_BASE,
            tab === item.key
              ? 'border-[#055B65] bg-[#055B65] text-white shadow-[0_10px_20px_rgba(5,91,101,0.24)]'
              : 'hover:border-[#055B65]/35 hover:text-[#055B65]',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )

  if (active.isLoading) {
    return (
      <div className="space-y-5">
        {tabBar}
        <div className="flex h-64 items-center justify-center" aria-busy="true">
          <Loader2 className="h-6 w-6 animate-spin text-[#055B65]" />
        </div>
      </div>
    )
  }

  if (active.isError || !active.data) {
    return (
      <div className="space-y-5">
        {tabBar}
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <p className="text-sm font-bold text-rose-700">{(active.error as Error)?.message || 'Failed to load the review.'}</p>
        </div>
      </div>
    )
  }

  if (tab !== 'retail') {
    const panelView =
      tab === 'conversion' ? <ConversionPanelView panel={active.data as HyundaiConversionPanel} action={yearPicker} />
      : tab === 'bookings' ? <BookingsPanelView panel={active.data as HyundaiBookingsPanel} action={yearPicker} />
      : tab === 'enquiries' ? <EnquiryPanelView panel={active.data as HyundaiEnquiryPanel} action={yearPicker} />
      : <ExchangePanelView panel={active.data as HyundaiExchangePanel} action={yearPicker} />

    return (
      <div className="space-y-5">
        {tabBar}
        {panelView}
      </div>
    )
  }

  const data = active.data as HyundaiRetailReview

  return (
    <div className="space-y-5">
      {tabBar}
      {data.notes.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <ul className="space-y-1">
            {data.notes.map((note) => (
              <li key={note} className="text-[12px] font-semibold leading-relaxed text-amber-900">{note}</li>
            ))}
          </ul>
        </div>
      )}

      {data.series.map((series) => (
        <RetailSeriesCard key={series.label} series={series} review={data} action={yearPicker} />
      ))}

      <ModelCard review={data} />
    </div>
  )
}
