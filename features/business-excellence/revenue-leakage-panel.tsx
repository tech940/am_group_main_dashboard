'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Revenue-leakage table for the Business Excellence overview, DEALER-WISE.
 *
 * Surfaces the RO-billing anomalies that quietly cost the workshop money: bills with nothing
 * charged, and discount concentration. One component serves Hyundai and Platinum — the two RO
 * billing tables share an identical 36-column schema.
 */

type LeakageRow = {
  dealer: string; ros: number; totalAmt: number; labourAmt: number; partAmt: number
  zeroLabour: number; zeroParts: number; zeroBoth: number; zeroTotal: number; negativeTotal: number
  totalDisc: number; labourDisc: number; partDisc: number
  discRunningRepair: number; discAccidental: number; discPaidService: number
  discVsLabourPct: number; discVsTotalPct: number; zeroBothPct: number
  freeServiceRos: number; paidServiceZeroLabour: number; roundOffAbs: number
}

const inr = (v: number) =>
  v >= 10000000 ? `₹${(v / 10000000).toFixed(2)}Cr`
    : v >= 100000 ? `₹${(v / 100000).toFixed(2)}L`
      : `₹${Math.round(v).toLocaleString('en-IN')}`
const num = (v: number) => Math.round(v || 0).toLocaleString('en-IN')

/** Discount as a share of labour. The group figure is the yardstick — an outlier is what matters. */
function discTone(pct: number, groupPct: number) {
  if (groupPct > 0 && pct >= groupPct * 2) return 'bg-rose-100 text-rose-800'
  if (groupPct > 0 && pct >= groupPct * 1.4) return 'bg-amber-100 text-amber-800'
  return 'text-slate-700'
}

export function RevenueLeakagePanel({
  brand,
  dealerCode,
  startDate,
  endDate,
}: {
  brand: 'hyundai' | 'platinum' | 'kia'
  dealerCode?: string | null
  startDate?: string | null
  endDate?: string | null
}) {
  const params = new URLSearchParams({ brand })
  if (dealerCode && dealerCode !== 'all') params.set('dealer', dealerCode)
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)

  const q = useQuery({
    queryKey: ['be-revenue-leakage', params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/be/revenue-leakage?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load revenue leakage')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })

  const rows: LeakageRow[] = q.data?.byDealer || []
  const t = q.data?.totals

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <p className="text-[12px] font-black uppercase tracking-wider text-slate-700">Revenue leakage — by dealer</p>
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-slate-400">
            Repair orders billed with nothing charged, and where discount is concentrated.
            {/* Always show the window the SERVER resolved, not what we asked for — an empty table is
                otherwise indistinguishable from a filter that matched nothing. */}
            {q.data?.window ? ` ${q.data.window.startDate} to ${q.data.window.endDate}.` : ''}
            {dealerCode && dealerCode !== 'all' ? ` Branch: ${dealerCode}.` : ''}
          </p>
        </div>
        {t && (
          <div className="flex flex-wrap gap-4 text-right">
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">Nothing billed</p>
              <p className="text-lg font-black text-rose-600">{num(t.zeroBoth)}</p>
              <p className="text-[10px] font-semibold text-slate-400">of {num(t.ros)} ROs</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">Total discount</p>
              <p className="text-lg font-black text-slate-900">{inr(t.totalDisc)}</p>
              <p className="text-[10px] font-semibold text-slate-400">{t.discVsLabourPct}% of labour</p>
            </div>
          </div>
        )}
      </div>

      {q.isError ? (
        <div className="p-8 text-center text-[12px] font-semibold text-rose-700">{(q.error as Error)?.message}</div>
      ) : q.isLoading ? (
        <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" /></div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-[12px] font-semibold text-slate-500">No repair orders match this selection.</p>
          <p className="mt-1 text-[11px] text-slate-400">
            {dealerCode && dealerCode !== 'all'
              ? `Nothing billed at ${dealerCode} between ${q.data?.window?.startDate} and ${q.data?.window?.endDate}.`
              : 'No billing rows in this date range.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50">
                <tr className="text-left">
                  {['Dealer', 'ROs', '0 labour', '0 parts', 'Nothing billed', 'Labour ₹', 'Total disc',
                    'Disc / labour', 'RR disc', 'Acc disc', 'Paid svc, 0 labour'].map((h, i) => (
                    <th key={h} className={cn('whitespace-nowrap px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-400',
                      i > 0 && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dealer} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-3 py-2.5 font-black text-slate-900">{r.dealer}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-600">{num(r.ros)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-600">{num(r.zeroLabour)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-600">{num(r.zeroParts)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={cn('rounded-md px-1.5 py-0.5 font-black',
                        r.zeroBothPct >= 20 ? 'bg-rose-100 text-rose-800' : r.zeroBothPct >= 10 ? 'bg-amber-100 text-amber-800' : 'text-slate-700')}>
                        {num(r.zeroBoth)} <span className="text-[9px] font-semibold opacity-70">{r.zeroBothPct}%</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{inr(r.labourAmt)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-900">{inr(r.totalDisc)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={cn('rounded-md px-1.5 py-0.5 font-black', discTone(r.discVsLabourPct, t?.discVsLabourPct || 0))}>
                        {r.discVsLabourPct}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-600">{inr(r.discRunningRepair)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-600">{inr(r.discAccidental)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-600">{num(r.paidServiceZeroLabour)}</td>
                  </tr>
                ))}
              </tbody>
              {t && rows.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-black text-slate-900">
                    <td className="px-3 py-2.5">All dealers</td>
                    <td className="px-3 py-2.5 text-right">{num(t.ros)}</td>
                    <td className="px-3 py-2.5 text-right">{num(t.zeroLabour)}</td>
                    <td className="px-3 py-2.5 text-right">{num(t.zeroParts)}</td>
                    <td className="px-3 py-2.5 text-right">{num(t.zeroBoth)}</td>
                    <td className="px-3 py-2.5 text-right">{inr(t.labourAmt)}</td>
                    <td className="px-3 py-2.5 text-right">{inr(t.totalDisc)}</td>
                    <td className="px-3 py-2.5 text-right">{t.discVsLabourPct}%</td>
                    <td className="px-3 py-2.5 text-right">{inr(t.discRunningRepair)}</td>
                    <td className="px-3 py-2.5 text-right">{inr(t.discAccidental)}</td>
                    <td className="px-3 py-2.5 text-right">{num(t.paidServiceZeroLabour)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="border-t border-slate-100 px-5 py-2.5 text-[10px] font-medium text-slate-400">
            &quot;Nothing billed&quot; = zero labour AND zero parts on the same RO. &quot;Disc / labour&quot; is highlighted
            where a dealer runs above the group rate ({t?.discVsLabourPct ?? 0}%) — amber past 1.4×, red past 2×.
            RR = Running Repair, Acc = Accidental Repair.
          </p>
        </>
      )}
    </div>
  )
}
