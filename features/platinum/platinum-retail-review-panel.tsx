'use client'

import React, { useState, type ReactNode, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { PlatinumRetailReview, PlatinumRetailSeries } from '@/lib/platinum/retail-review'
import type { PlatinumConversionPanel, PlatinumExchangePanel } from '@/lib/platinum/retail-review-panels'
import type { PlatinumBookingsPanel, PlatinumEnquiryPanel } from '@/lib/platinum/retail-review-pipeline'

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

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3.5 w-1 rounded-full bg-[#055B65]" />
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">{title}</h3>
      </div>
      {subtitle ? <p className="ml-3 mt-0.5 text-[11px] text-slate-500">{subtitle}</p> : null}
    </div>
  )
}

function YearSelect({
  value,
  onChange,
}: {
  value: number
  onChange: (year: number) => void
}) {
  const currentYear = new Date().getUTCFullYear()
  const years = [currentYear, currentYear - 1, currentYear - 2]
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-[11px] font-semibold text-slate-400">Year:</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-sm focus:border-[#055B65] focus:outline-none"
      >
        {years.map((y) => (
          <option key={y} value={y}>CY{y}</option>
        ))}
      </select>
    </div>
  )
}

function RetailReviewTab({ selectedYear }: { selectedYear: number }) {
  const { data, isLoading } = useQuery<PlatinumRetailReview>({
    queryKey: ['platinum', 'retail-review', 'retail', selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/brands/platinum/sales-report/retail-review?year=${selectedYear}&panel=retail`)
      if (!res.ok) throw new Error('Failed to load Platinum retail review')
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#055B65]" />
      </div>
    )
  }

  if (!data) return <div className="p-8 text-center text-sm text-slate-500">No review data available</div>

  const series = data.series[0]

  return (
    <div className="space-y-6">
      <ReviewCard title="Platinum Retail (Delivered Vehicles)" subtitle={`CY${data.previousYear} vs CY${data.currentYear} Monthly Comparison`}>
        <div className="overflow-x-auto">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Outlet</TableHead>
                <TableHead className={HEAD_CLASS}>Year</TableHead>
                {MONTHS.map((m) => (
                  <TableHead key={m} className={cn(HEAD_CLASS, 'text-right')}>{m}</TableHead>
                ))}
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Total</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Monthly Avg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {series && (
                <>
                  <TableRow>
                    <TableCell rowSpan={3} className="font-bold text-slate-800 align-top pt-3 border-r border-slate-100">
                      {series.label}
                    </TableCell>
                    <TableCell className="font-semibold text-slate-500">CY{data.previousYear}</TableCell>
                    {series.months.map((m) => (
                      <TableCell key={m.month} className="text-right tabular-nums text-slate-600">
                        {m.previous > 0 ? n0(m.previous) : '—'}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-bold tabular-nums text-slate-800">{n0(series.previousTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600">{series.previousMonthlyAverage.toFixed(1)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-bold text-[#055B65]">CY{data.currentYear}</TableCell>
                    {series.months.map((m) => (
                      <TableCell key={m.month} className="text-right font-bold tabular-nums text-slate-900">
                        {m.current > 0 ? n0(m.current) : '—'}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-black tabular-nums text-[#055B65]">{n0(series.currentTotal)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-[#055B65]">{series.currentMonthlyAverage.toFixed(1)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-slate-50/50">
                    <TableCell className="font-semibold text-slate-400">Gap</TableCell>
                    {series.months.map((m) => (
                      <TableCell
                        key={m.month}
                        className={cn(
                          'text-right font-bold tabular-nums',
                          m.gap > 0 ? 'text-emerald-600' : m.gap < 0 ? 'text-rose-600' : 'text-slate-400'
                        )}
                      >
                        {m.current > 0 || m.previous > 0 ? (m.gap > 0 ? `+${n0(m.gap)}` : n0(m.gap)) : '—'}
                      </TableCell>
                    ))}
                    <TableCell
                      className={cn(
                        'text-right font-black tabular-nums',
                        series.currentTotal - series.previousTotal > 0 ? 'text-emerald-600' : 'text-rose-600'
                      )}
                    >
                      {series.currentTotal - series.previousTotal > 0
                        ? `+${n0(series.currentTotal - series.previousTotal)}`
                        : n0(series.currentTotal - series.previousTotal)}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-slate-500">
                      {(series.currentMonthlyAverage - series.previousMonthlyAverage).toFixed(1)}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </ReviewCard>

      <ReviewCard title="Model-Wise Monthly Retail" subtitle={`CY${data.currentYear} Vehicle Mix by Month`}>
        <div className="overflow-x-auto">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Model</TableHead>
                {MONTHS.map((m) => (
                  <TableHead key={m} className={cn(HEAD_CLASS, 'text-right')}>{m}</TableHead>
                ))}
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Total</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Monthly Avg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.models.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="font-semibold text-slate-800">{row.model}</TableCell>
                  {row.months.map((val, idx) => (
                    <TableCell key={idx} className="text-right tabular-nums text-slate-700">
                      {val > 0 ? n0(val) : '—'}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-bold tabular-nums text-slate-900">{n0(row.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{row.monthlyAverage.toFixed(1)}</TableCell>
                </TableRow>
              ))}
              <TableRow style={TOTAL_ROW_STYLE}>
                <TableCell className={cn('font-black', TOTAL_TEXT)}>TOTAL</TableCell>
                {data.modelTotals.months.map((val, idx) => (
                  <TableCell key={idx} className={TOTAL_CELL}>
                    {val > 0 ? n0(val) : '—'}
                  </TableCell>
                ))}
                <TableCell className={TOTAL_CELL}>{n0(data.modelTotals.total)}</TableCell>
                <TableCell className={TOTAL_CELL}>{data.modelTotals.monthlyAverage.toFixed(1)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </ReviewCard>
    </div>
  )
}

function ConversionTab({ selectedYear }: { selectedYear: number }) {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const { data, isLoading } = useQuery<PlatinumConversionPanel>({
    queryKey: ['platinum', 'retail-review', 'conversion', selectedYear, selectedMonth],
    queryFn: async () => {
      const url = `/api/brands/platinum/sales-report/retail-review?year=${selectedYear}&panel=conversion${
        selectedMonth ? `&month=${selectedMonth}` : ''
      }`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load Platinum conversion review')
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#055B65]" />
      </div>
    )
  }

  if (!data) return <div className="p-8 text-center text-sm text-slate-500">No conversion data available</div>

  const outlet = data.outlets[0]

  return (
    <div className="space-y-6">
      <ReviewCard
        title="Source-Wise Conversion Funnel"
        subtitle={data.monthLabel || `Full Year ${data.year}`}
        action={
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">Month:</span>
            <select
              value={selectedMonth ?? ''}
              onChange={(e) => setSelectedMonth(e.target.value ? Number(e.target.value) : null)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-sm focus:border-[#055B65] focus:outline-none"
            >
              <option value="">Full Year</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Source</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>ENQ</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>TD</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>BKG</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>RET</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>E2TD %</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>E2BKG %</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>E2RET %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlet?.sources.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-semibold text-slate-800">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(r.enquiries)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(r.testDrives)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(r.bookings)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-slate-900">{n0(r.retails)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{r.e2td.toFixed(1)}%</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{r.e2bkg.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-[#055B65]">{r.e2ret.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
              {outlet?.total && (
                <TableRow style={TOTAL_ROW_STYLE}>
                  <TableCell className={cn('font-black', TOTAL_TEXT)}>TOTAL</TableCell>
                  <TableCell className={TOTAL_CELL}>{n0(outlet.total.enquiries)}</TableCell>
                  <TableCell className={TOTAL_CELL}>{n0(outlet.total.testDrives)}</TableCell>
                  <TableCell className={TOTAL_CELL}>{n0(outlet.total.bookings)}</TableCell>
                  <TableCell className={TOTAL_CELL}>{n0(outlet.total.retails)}</TableCell>
                  <TableCell className={TOTAL_CELL}>{outlet.total.e2td.toFixed(1)}%</TableCell>
                  <TableCell className={TOTAL_CELL}>{outlet.total.e2bkg.toFixed(1)}%</TableCell>
                  <TableCell className={TOTAL_CELL}>{outlet.total.e2ret.toFixed(1)}%</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </ReviewCard>
    </div>
  )
}

function BookingsTab({ selectedYear }: { selectedYear: number }) {
  const { data, isLoading } = useQuery<PlatinumBookingsPanel>({
    queryKey: ['platinum', 'retail-review', 'bookings', selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/brands/platinum/sales-report/retail-review?year=${selectedYear}&panel=bookings`)
      if (!res.ok) throw new Error('Failed to load Platinum bookings review')
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#055B65]" />
      </div>
    )
  }

  if (!data) return <div className="p-8 text-center text-sm text-slate-500">No booking review data</div>

  return (
    <div className="space-y-6">
      <ReviewCard title="Monthly Booking Intake & Flow" subtitle={`CY${data.year} Intake and Flow`}>
        <div className="overflow-x-auto">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Month</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Booked</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Cancelled</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Retailed</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Open Backlog</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.combined.months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="font-semibold text-slate-800">{MONTHS[m.month - 1]}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-slate-900">{n0(m.booked)}</TableCell>
                  <TableCell className="text-right tabular-nums text-rose-600">{n0(m.cancelled)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600">{n0(m.retailed)}</TableCell>
                  <TableCell className="text-right font-black tabular-nums text-[#055B65]">{n0(m.open)}</TableCell>
                </TableRow>
              ))}
              <TableRow style={TOTAL_ROW_STYLE}>
                <TableCell className={cn('font-black', TOTAL_TEXT)}>TOTAL</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(data.combined.booked)}</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(data.combined.cancelled)}</TableCell>
                <TableCell className={TOTAL_CELL}>—</TableCell>
                <TableCell className={TOTAL_CELL}>—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </ReviewCard>
    </div>
  )
}

function EnquiriesTab({ selectedYear }: { selectedYear: number }) {
  const { data, isLoading } = useQuery<PlatinumEnquiryPanel>({
    queryKey: ['platinum', 'retail-review', 'enquiries', selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/brands/platinum/sales-report/retail-review?year=${selectedYear}&panel=enquiries`)
      if (!res.ok) throw new Error('Failed to load Platinum enquiry review')
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#055B65]" />
      </div>
    )
  }

  if (!data) return <div className="p-8 text-center text-sm text-slate-500">No enquiry review data</div>

  return (
    <div className="space-y-6">
      <ReviewCard title="Monthly Enquiries & Test Drives" subtitle={`CY${data.year} Intake and Test Drive Ratio`}>
        <div className="overflow-x-auto">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Month</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Enquiries</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Test Drives</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>TD Rate %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.combined.months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="font-semibold text-slate-800">{MONTHS[m.month - 1]}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-slate-900">{n0(m.enquiries)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(m.testDrives)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-[#055B65]">{m.tdRatePct.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
              <TableRow style={TOTAL_ROW_STYLE}>
                <TableCell className={cn('font-black', TOTAL_TEXT)}>TOTAL</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(data.combined.enquiries)}</TableCell>
                <TableCell className={TOTAL_CELL}>{n0(data.combined.testDrives)}</TableCell>
                <TableCell className={TOTAL_CELL}>{data.combined.tdRatePct.toFixed(1)}%</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </ReviewCard>
    </div>
  )
}

function ExchangeTab({ selectedYear }: { selectedYear: number }) {
  const { data, isLoading } = useQuery<PlatinumExchangePanel>({
    queryKey: ['platinum', 'retail-review', 'exchange', selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/brands/platinum/sales-report/retail-review?year=${selectedYear}&panel=exchange`)
      if (!res.ok) throw new Error('Failed to load Platinum exchange review')
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#055B65]" />
      </div>
    )
  }

  if (!data) return <div className="p-8 text-center text-sm text-slate-500">No exchange review data</div>

  return (
    <div className="space-y-6">
      <ReviewCard title="Exchange Funnel & Conversions" subtitle={`CY${data.year} Interest to Retail Flow`}>
        <div className="overflow-x-auto">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow className={HEAD_ROW}>
                <TableHead className={HEAD_CLASS}>Month</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Enquiries</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Interested</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Evaluated</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Retailed</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Interest %</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Eval %</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'text-right')}>Eval $\to$ Ret %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="font-semibold text-slate-800">{MONTHS[m.month - 1]}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(m.enquiries)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(m.interested)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-700">{n0(m.evaluated)}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-slate-900">{n0(m.retailed)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{m.interestRatePct.toFixed(1)}%</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-600">{m.evalRatePct.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-[#055B65]">{m.evalToRetPct.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ReviewCard>
    </div>
  )
}

export function PlatinumRetailReviewPanel() {
  const currentYear = new Date().getUTCFullYear()
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [activeTab, setActiveTab] = useState<'retail' | 'conversion' | 'bookings' | 'enquiries' | 'exchange'>('retail')

  const tabs = [
    { key: 'retail', label: 'Retail & Models' },
    { key: 'conversion', label: 'Conversion' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'enquiries', label: 'Enquiries' },
    { key: 'exchange', label: 'Exchange' },
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-xl px-4 py-2 text-xs font-bold transition-all',
                activeTab === tab.key
                  ? 'bg-[#055B65] text-white shadow-md shadow-[#055B65]/20'
                  : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/80'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <YearSelect value={selectedYear} onChange={setSelectedYear} />
      </div>

      {activeTab === 'retail' && <RetailReviewTab selectedYear={selectedYear} />}
      {activeTab === 'conversion' && <ConversionTab selectedYear={selectedYear} />}
      {activeTab === 'bookings' && <BookingsTab selectedYear={selectedYear} />}
      {activeTab === 'enquiries' && <EnquiriesTab selectedYear={selectedYear} />}
      {activeTab === 'exchange' && <ExchangeTab selectedYear={selectedYear} />}
    </div>
  )
}
