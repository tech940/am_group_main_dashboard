'use client'

/**
 * INDIA — the daily snapshot, in the MD's existing report layout.
 *
 * Deliberately a plain ruled table rather than the card grid the rest of the cockpit uses. This is a
 * report that gets read down a column and compared against yesterday's, so alignment and density are
 * the design: uppercase hairline column heads, right-aligned figures on tabular numerals so digits
 * line up between rows, a hairline above the Group row, and nothing else competing for attention.
 */
import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Bucket = { count: number; net: number }
type SalesRow = {
  company: string
  retailDay: number; retailMtd: number
  bookingsDay: number | null; bookingsMtd: number | null
  enquiriesDay: number | null; enquiriesMtd: number | null
}
type ServiceRow = {
  company: string
  dayRos: number; dayNet: number; dayPerRo: number | null
  mtdRos: number; mtdNet: number; mtdPerRo: number | null
  dayIsCovered: boolean
}
type InsuranceRow = {
  company: string
  day: { renewal: Bucket; fresh: Bucket; rollover: Bucket; total: Bucket }
  mtd: { renewal: Bucket; fresh: Bucket; rollover: Bucket; total: Bucket }
}
type Snapshot = {
  day: string
  monthStart: string
  sales: SalesRow[]
  service: ServiceRow[]
  insurance: InsuranceRow[]
  notes: { sales: string; service: string; insurance: string }
  failed: string[]
}

/** Indian money at report scale: crore and lakh, because that is how these figures are spoken. */
function money(v: number) {
  const r = Math.round(Math.abs(v))
  const sign = v < 0 ? '-' : ''
  if (r >= 10000000) return `${sign}${(r / 10000000).toFixed(2)} Cr`
  if (r >= 100000) return `${sign}${(r / 100000).toFixed(2)} L`
  return `${sign}${r.toLocaleString('en-IN')}`
}
/** Premium and per-RO figures are quoted to the rupee in this report, never abbreviated. */
const rupees = (v: number) => Math.round(v).toLocaleString('en-IN')
const int = (v: number) => Math.round(v).toLocaleString('en-IN')
/** A dash, never a zero: "we do not capture this" and "it was zero" are different statements. */
const DASH = '–'

function longDay(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d))).toUpperCase()
}
function shiftDay(ymd: string, by: number) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + by))
  return dt.toISOString().slice(0, 10)
}
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

const isGroup = (c: string) => c.toLowerCase().startsWith('group')

/* ── shared table furniture ─────────────────────────────────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-4 text-[11px] font-black uppercase tracking-[0.18em] text-slate-900">{children}</h3>
  )
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[11px] font-medium leading-relaxed text-slate-400">{children}</p>
}
/** Column group heading — the RETAIL / BOOKINGS / ENQUIRIES band above the DAY / MTD pairs. */
function GroupHead({ label, span }: { label: string; span: number }) {
  return (
    <th colSpan={span} className="pb-1 pr-4 text-right text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
      {label}
    </th>
  )
}
function ColHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('border-b border-slate-200 pb-2 pr-4 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400', className)}>
      {children}
    </th>
  )
}
function Cell({ children, muted, className }: { children: React.ReactNode; muted?: boolean; className?: string }) {
  return (
    <td className={cn(
      'py-2.5 pr-4 text-right text-[13px] tabular-nums',
      muted ? 'font-medium text-slate-300' : 'font-semibold text-slate-700',
      className,
    )}>
      {children}
    </td>
  )
}
function CompanyCell({ name }: { name: string }) {
  return (
    <td className={cn(
      'py-2.5 pr-6 text-left text-[13px] whitespace-nowrap',
      isGroup(name) ? 'font-black text-slate-900' : 'font-bold text-slate-800',
    )}>
      {name}
    </td>
  )
}
function rowClass(name: string) {
  // The Group row is a total, so it gets a rule above it rather than a background fill.
  return isGroup(name) ? 'border-t-2 border-slate-300' : 'border-t border-slate-100'
}

/* ── sections ───────────────────────────────────────────────────────────────────────────────── */

function SalesTable({ rows, note }: { rows: SalesRow[]; note: string }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th />
              <GroupHead label="Retail" span={2} />
              <GroupHead label="Bookings" span={2} />
              <GroupHead label="Enquiries" span={2} />
            </tr>
            <tr>
              <ColHead className="text-left">Company</ColHead>
              <ColHead>Day</ColHead><ColHead>MTD</ColHead>
              <ColHead>Day</ColHead><ColHead>MTD</ColHead>
              <ColHead>Day</ColHead><ColHead>MTD</ColHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company} className={rowClass(r.company)}>
                <CompanyCell name={r.company} />
                <Cell>{int(r.retailDay)}</Cell>
                <Cell>{int(r.retailMtd)}</Cell>
                <Cell muted={r.bookingsDay === null}>{r.bookingsDay === null ? DASH : int(r.bookingsDay)}</Cell>
                <Cell muted={r.bookingsMtd === null}>{r.bookingsMtd === null ? DASH : int(r.bookingsMtd)}</Cell>
                <Cell muted={r.enquiriesDay === null}>{r.enquiriesDay === null ? DASH : int(r.enquiriesDay)}</Cell>
                <Cell muted={r.enquiriesMtd === null}>{r.enquiriesMtd === null ? DASH : int(r.enquiriesMtd)}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>{note}</Note>
    </div>
  )
}

function ServiceTable({ rows, note }: { rows: ServiceRow[]; note: string }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th />
              <GroupHead label="Day" span={3} />
              <GroupHead label="Month to date" span={3} />
            </tr>
            <tr>
              <ColHead className="text-left">Company</ColHead>
              <ColHead>ROs</ColHead><ColHead>Net</ColHead><ColHead>Per RO</ColHead>
              <ColHead>ROs</ColHead><ColHead>Net</ColHead><ColHead>Per RO</ColHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company} className={rowClass(r.company)}>
                <CompanyCell name={r.company} />
                {/* The feed may not have reached the day yet. That is not a zero — say so. */}
                <Cell muted={!r.dayIsCovered}>{r.dayIsCovered ? int(r.dayRos) : DASH}</Cell>
                <Cell muted={!r.dayIsCovered}>{r.dayIsCovered ? money(r.dayNet) : DASH}</Cell>
                <Cell muted={!r.dayIsCovered || r.dayPerRo === null}>
                  {r.dayIsCovered && r.dayPerRo !== null ? rupees(r.dayPerRo) : DASH}
                </Cell>
                <Cell>{int(r.mtdRos)}</Cell>
                <Cell>{money(r.mtdNet)}</Cell>
                <Cell muted={r.mtdPerRo === null}>{r.mtdPerRo === null ? DASH : rupees(r.mtdPerRo)}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>{note}</Note>
    </div>
  )
}

function InsuranceBlock({ rows, which, heading }: { rows: InsuranceRow[]; which: 'day' | 'mtd'; heading: string }) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{heading}</p>
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr>
            <th />
            <GroupHead label="Renewal" span={2} />
            <GroupHead label="New" span={2} />
            <GroupHead label="Rollover" span={2} />
            <GroupHead label="Total" span={2} />
          </tr>
          <tr>
            <ColHead className="text-left">Company</ColHead>
            <ColHead>No.</ColHead><ColHead>Net</ColHead>
            <ColHead>No.</ColHead><ColHead>Net</ColHead>
            <ColHead>No.</ColHead><ColHead>Net</ColHead>
            <ColHead>No.</ColHead><ColHead>Net</ColHead>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = r[which]
            return (
              <tr key={r.company} className={rowClass(r.company)}>
                <CompanyCell name={r.company} />
                {([b.renewal, b.fresh, b.rollover, b.total] as Bucket[]).map((x, i) => (
                  // Fragment shorthand cannot carry a key, and each bucket emits TWO cells.
                  <Fragment key={i}>
                    <Cell>{int(x.count)}</Cell>
                    {/* Day premiums are small enough to quote exactly; MTD is read at lakh scale. */}
                    <Cell>{which === 'day' ? rupees(x.net) : money(x.net)}</Cell>
                  </Fragment>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── the section ────────────────────────────────────────────────────────────────────────────── */

async function fetchSnapshot(day: string): Promise<Snapshot> {
  const res = await fetch(`/api/cockpit/india?day=${day}`, { cache: 'no-store' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load the India snapshot')
  return res.json()
}

export function IndiaSnapshotSection() {
  const [day, setDay] = useState(indiaToday)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Snapshot>({
    queryKey: ['cockpit-india', day],
    queryFn: () => fetchSnapshot(day),
    // Same reasoning as the cockpit query: the global config sets retry:false, and this endpoint
    // reads six feeds, so one blip would otherwise pin the section on an error until a manual retry.
    retry: (n, err) => (/\b(401|403|Unauthorized|Forbidden)\b/i.test((err as Error)?.message || '') ? false : n < 2),
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 6000),
  })

  const atToday = day >= indiaToday()

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-[13px] font-black uppercase tracking-[0.16em] text-slate-900">India</h2>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {longDay(day)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {isFetching && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-slate-400" />}
          <button
            type="button"
            onClick={() => setDay((d) => shiftDay(d, -1))}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50"
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={atToday}
            onClick={() => setDay((d) => shiftDay(d, 1))}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-30"
            title={atToday ? 'Already at today' : 'Next day'}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!atToday && (
            <button
              type="button"
              onClick={() => setDay(indiaToday())}
              className="ml-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              Today
            </button>
          )}
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm font-semibold text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the day across every company…
        </div>
      ) : isError || !data ? (
        <div className="py-10">
          <p className="text-sm font-bold text-rose-700">{(error as Error)?.message || 'Failed to load the India snapshot.'}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-10">
          {data.failed.length > 0 && (
            /* Named, not silently zeroed — a section that could not be read must say so. */
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-[12px] font-semibold text-amber-800">
                Could not read: {data.failed.join(', ')}. Those figures are missing, not zero.
              </p>
            </div>
          )}

          <div>
            <SectionTitle>India Sales, {longDay(day)}</SectionTitle>
            <SalesTable rows={data.sales} note={data.notes.sales} />
          </div>

          <div>
            <SectionTitle>India Service, {longDay(day)}</SectionTitle>
            <ServiceTable rows={data.service} note={data.notes.service} />
          </div>

          <div>
            <SectionTitle>India Insurance</SectionTitle>
            <div className="space-y-8">
              <InsuranceBlock rows={data.insurance} which="day" heading={longDay(day)} />
              <InsuranceBlock rows={data.insurance} which="mtd" heading={`Month to date, 1 to ${Number(day.slice(8, 10))}`} />
            </div>
            <Note>{data.notes.insurance}</Note>
          </div>
        </div>
      )}
    </section>
  )
}
