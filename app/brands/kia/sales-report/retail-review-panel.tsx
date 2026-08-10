'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { KiaRetailReview, KiaRetailSeries } from '@/lib/kia/retail-review'
import type { KiaAccessoriesPanel, KiaConversionPanel, KiaExchangePanel } from '@/lib/kia/retail-review-panels'
import type { KiaBookingsPanel, KiaEnquiryPanel } from '@/lib/kia/retail-review-pipeline'
import { KiaConversionPanelView } from './conversion-panel'
import {
  KiaAccessoriesPanelView,
  KiaBookingsPanelView,
  KiaEnquiryPanelView,
  KiaExchangePanelView,
} from './pipeline-panels'

/**
 * The MD's monthly retail review, as a tab inside the KIA Sales Report.
 *
 * ⚠️ This deliberately does NOT look like the source PowerPoint. The deck's blue header bands and
 * red cells were a reference for WHAT the numbers are, not how they should look — the panel uses
 * the Sales Report's own surfaces, typography and accent palette so it reads as part of the page
 * rather than a pasted-in slide.
 *
 * The visual primitives below mirror `sales-report-client.tsx` exactly (PRIMARY_SURFACE, the
 * gradient-topped card, the pill tabs). They are re-declared rather than imported because that
 * file imports THIS one — importing back would be circular. If the page's look changes, change
 * both.
 */

const PRIMARY_SURFACE =
  'rounded-[2rem] border border-[#d5dfea] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'

const ACCENTS = ['#c5162f', '#071a2b', '#269442', '#18a7d0', '#8835a7', '#f07c1a']

/** Grand-total rows: dark slate band with yellow figures, per the owner's spec. Inline style for
 *  the background — Tailwind arbitrary bg classes silently fail on <tr> in this app. Duplicated in
 *  conversion-panel.tsx / pipeline-panels.tsx (import here would be circular). */
export const TOTAL_ROW_STYLE = { backgroundColor: '#1f2937' } as const
export const TOTAL_TEXT = 'text-[#facc15]'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

function n0(value: number) {
  return Math.round(value).toLocaleString('en-IN')
}

type ReviewTab = 'retail' | 'conversion' | 'bookings' | 'enquiries' | 'exchange' | 'accessories'

const REVIEW_TABS: { key: ReviewTab; label: string }[] = [
  { key: 'retail', label: 'Retail & Models' },
  { key: 'conversion', label: 'Conversion' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'exchange', label: 'Exchange' },
  { key: 'accessories', label: 'Accessories' },
]

const TAB_BASE =
  'rounded-full border border-[#d5dfea] bg-white px-4 py-2 text-[13px] font-black text-slate-600 shadow-sm transition'

export function KiaRetailReviewPanel({ year: propYear, month: propMonth }: { year?: number; month?: number | null } = {}) {
  const [internalYear, setInternalYear] = useState<number>(propYear || new Date().getFullYear())
  const [tab, setTab] = useState<ReviewTab>('retail')

  const activeYear = propYear || internalYear
  const activeMonth = propMonth ?? null

  // One query per (tab, year, month). The route serves one panel per request on purpose — the panels sit
  // on different data spines with very different costs, so switching tabs never waits on another
  // tab's scan, and each stays cached for the session once loaded.
  const active = useQuery<unknown>({
    queryKey: ['kia-retail-review', tab, activeYear, activeMonth],
    queryFn: async () => {
      const panelParam = tab === 'retail' ? '' : `panel=${tab}&`
      const monthParam = activeMonth ? `&month=${activeMonth}` : ''
      const res = await fetch(`/api/brands/kia/sales-report/retail-review?${panelParam}year=${activeYear}${monthParam}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
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
        className="rounded-full border border-[#d5dfea] bg-white px-3 py-1.5 text-[13px] font-black text-slate-700 shadow-sm"
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
              ? 'border-[#071a2b] bg-[#071a2b] text-white shadow-[0_10px_20px_rgba(7,26,43,0.24)]'
              : 'hover:border-[#071a2b]/35 hover:text-[#071a2b]',
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
        <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
          <div className="h-1.5 bg-slate-200" />
          <CardContent className="p-10 text-center text-[13px] font-medium text-slate-500">Loading…</CardContent>
        </Card>
      </div>
    )
  }

  if (active.isError) {
    return (
      <div className="space-y-5">
        {tabBar}
        <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
          <div className="h-1.5 bg-[#c5162f]" />
          <CardContent className="p-10 text-center text-[13px] font-medium text-[#c5162f]">
            {(active.error as Error)?.message || 'Failed to load'}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (tab !== 'retail') {
    const panelView =
      tab === 'conversion' ? <KiaConversionPanelView panel={active.data as KiaConversionPanel} />
      : tab === 'bookings' ? <KiaBookingsPanelView panel={active.data as KiaBookingsPanel} action={yearPicker} />
      : tab === 'enquiries' ? <KiaEnquiryPanelView panel={active.data as KiaEnquiryPanel} action={yearPicker} />
      : tab === 'exchange' ? <KiaExchangePanelView panel={active.data as KiaExchangePanel} action={yearPicker} />
      : <KiaAccessoriesPanelView panel={active.data as KiaAccessoriesPanel} action={yearPicker} />
    return (
      <div className="space-y-5">
        {tabBar}
        {panelView}
      </div>
    )
  }

  const data = active.data as KiaRetailReview

  return (
    <div className="space-y-5">
      {tabBar}
      {data.notes.length > 0 && (
        <Card className={cn(PRIMARY_SURFACE, 'overflow-hidden')}>
          <div className="h-1.5 bg-[#f07c1a]" />
          <CardContent className="space-y-1 p-4">
            {data.notes.map((note) => (
              <p key={note} className="text-[12px] font-medium text-slate-600">{note}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {data.series.map((series, index) => (
        <RetailSeriesCard
          key={series.outlet}
          series={series}
          review={data}
          action={index === 0 ? yearPicker : undefined}
        />
      ))}

      <ModelCard review={data} />
    </div>
  )
}

function RetailSeriesCard({
  series, review, action,
}: { series: KiaRetailSeries; review: KiaRetailReview; action?: ReactNode }) {
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
      subtitle={`CY${review.previousYear} vs CY${review.currentYear} · by delivery date`}
      action={action}
    >
      <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
        <Table className="[&_td]:text-[12px] [&_td]:font-medium [&_th]:text-[10px]">
          <TableHeader>
            <TableRow className="bg-[#f6f9fc] hover:bg-[#f6f9fc]">
              <TableHead className="font-black uppercase tracking-[0.14em] text-slate-500">Retail</TableHead>
              {MONTHS.map((month) => (
                <TableHead key={month} className="text-right font-black uppercase tracking-[0.14em] text-slate-500">{month}</TableHead>
              ))}
              <TableHead className="text-right font-black uppercase tracking-[0.14em] text-slate-500">Total</TableHead>
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
                      behind ? 'bg-[#fdecef] font-black text-[#c5162f]' : 'text-slate-600',
                    )}
                  >
                    {show ? (row.gap > 0 ? `+${row.gap}` : row.gap) : ''}
                  </TableCell>
                )
              })}
              <TableCell className={cn(
                'text-right font-black tabular-nums',
                series.currentTotal - series.previousTotal < 0 ? 'text-[#c5162f]' : 'text-[#269442]',
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
              item.tone === 'bad' ? 'border-l-[#c5162f] bg-[#fdecef]' : 'border-l-[#071a2b] bg-white',
            )}
            style={item.tone === 'neutral' ? { borderLeftColor: ACCENTS[index % ACCENTS.length] } : undefined}
          >
            <CardContent className="p-4">
              <p className={cn(
                'text-[26px] font-black leading-none',
                item.tone === 'bad' ? 'text-[#c5162f]' : 'text-slate-900',
              )}>
                {item.value}
              </p>
              <p className="mt-2 text-[11px] font-black uppercase leading-tight tracking-[0.14em] text-slate-500">
                {item.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </ReviewCard>
  )
}

function ModelCard({ review }: { review: KiaRetailReview }) {
  const visible = Math.max(1, ...review.series.map((series) => series.baseline.lastMonthWithData ?? 1))
  const models = review.models.filter((model) => model.total > 0 || model.model !== 'Other')

  return (
    <ReviewCard
      title={`Model-wise Performance CY${review.currentYear}`}
      subtitle="Retail volume by model, month on month"
    >
      <div className="overflow-x-auto rounded-[1.5rem] border border-[#e0e7ef]">
        <Table className="[&_td]:text-[12px] [&_td]:font-medium [&_th]:text-[10px]">
          <TableHeader>
            <TableRow className="bg-[#f6f9fc] hover:bg-[#f6f9fc]">
              <TableHead className="font-black uppercase tracking-[0.14em] text-slate-500">Model</TableHead>
              {MONTHS.slice(0, visible).map((month) => (
                <TableHead key={month} className="text-right font-black uppercase tracking-[0.14em] text-slate-500">{month}</TableHead>
              ))}
              <TableHead className="text-right font-black uppercase tracking-[0.14em] text-slate-500">Total</TableHead>
              <TableHead className="text-right font-black uppercase tracking-[0.14em] text-slate-500">Avg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model, index) => (
              <TableRow key={model.model}>
                <TableCell className="font-black text-slate-800">
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ backgroundColor: ACCENTS[index % ACCENTS.length] }}
                  />
                  {model.model}
                </TableCell>
                {model.months.slice(0, visible).map((value, monthIndex) => (
                  <TableCell key={monthIndex} className="text-right tabular-nums text-slate-600">{value}</TableCell>
                ))}
                <TableCell className="text-right font-black tabular-nums text-slate-900">{model.total}</TableCell>
                <TableCell className="text-right tabular-nums text-slate-500">{n0(model.monthlyAverage)}</TableCell>
              </TableRow>
            ))}
            {/* ⚠️ Inline style, not a bg-[...] class — Tailwind arbitrary backgrounds silently
                fail on <tr> in this app (see dashboard theme notes). */}
            <TableRow style={TOTAL_ROW_STYLE}>
              <TableCell className={cn('font-black uppercase tracking-[0.1em]', TOTAL_TEXT)}>Overall</TableCell>
              {review.modelTotals.months.slice(0, visible).map((value, index) => (
                <TableCell key={index} className={cn('text-right font-black tabular-nums', TOTAL_TEXT)}>{value}</TableCell>
              ))}
              <TableCell className={cn('text-right font-black tabular-nums', TOTAL_TEXT)}>{review.modelTotals.total}</TableCell>
              <TableCell className={cn('text-right font-black tabular-nums', TOTAL_TEXT)}>{n0(review.modelTotals.monthlyAverage)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </ReviewCard>
  )
}
