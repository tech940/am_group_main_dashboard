'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Trophy, Target, TrendingUp, Users, Save, X } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type LeaderRow = {
  rank: number
  consultant: string
  dealer: string
  bookings: number
  deliveries: number
  conversion: number
  bookingTarget: number
  deliveryTarget: number
  bookingAchievement: number | null
  deliveryAchievement: number | null
}
type Payload = {
  context: { year: number; month: number; label: string; dealerCode: string | null }
  availableMonths: { year: number; month: number; label: string }[]
  summary: { consultants: number; bookings: number; deliveries: number; conversion: number; bookingTarget: number; deliveryTarget: number; bookingAchievement: number | null; deliveryAchievement: number | null }
  leaderboard: LeaderRow[]
  consultants: { consultant: string; dealer: string }[]
}

const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
function dealerLabel(code: string) { return DEALER_LABELS[code] || code }
function monthKeyOf(year: number, month: number) { return `${year}-${String(month).padStart(2, '0')}` }

function achievementTone(value: number | null) {
  if (value === null) return 'text-slate-400'
  if (value >= 100) return 'text-emerald-600'
  if (value >= 70) return 'text-amber-600'
  return 'text-rose-600'
}

export function KiaSalesPerformancePage({ canSetTargets }: { canSetTargets: boolean }) {
  const [monthKey, setMonthKey] = useState('') // '' = latest available
  const [dealer, setDealer] = useState('all')
  const [targetsOpen, setTargetsOpen] = useState(false)

  const [year, month] = monthKey ? monthKey.split('-').map(Number) : [null, null]
  const query = useQuery<Payload>({
    queryKey: ['kia-sales-performance', monthKey, dealer],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (year && month) { params.set('year', String(year)); params.set('month', String(month)) }
      if (dealer !== 'all') params.set('dealer_code', dealer)
      const res = await fetch(`/api/brands/kia/sales-performance?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load sales performance')
      return res.json()
    },
  })
  const data = query.data
  const summary = data?.summary

  const numberFmt = (n: number) => n.toLocaleString('en-IN')

  return (
    <MainLayout title="Sales Performance" subtitle="AM Kia consultant targets & leaderboard">
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={monthKey || (data ? monthKeyOf(data.context.year, data.context.month) : '')} onValueChange={setMonthKey}>
              <SelectTrigger className="h-10 w-[180px] rounded-xl"><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>
                {(data?.availableMonths || []).map((m) => (
                  <SelectItem key={monthKeyOf(m.year, m.month)} value={monthKeyOf(m.year, m.month)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dealer} onValueChange={setDealer}>
              <SelectTrigger className="h-10 w-[170px] rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dealers</SelectItem>
                <SelectItem value="JK402">Jammu (JK402)</SelectItem>
                <SelectItem value="JK501">Udhampur (JK501)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {canSetTargets && (
            <Button onClick={() => setTargetsOpen(true)} disabled={!data} className="h-10 gap-2 rounded-xl bg-[var(--dashboard-action-bg)] font-bold text-white">
              <Target className="h-4 w-4" /> Set Targets
            </Button>
          )}
        </div>

        {query.isLoading ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(query.error as Error)?.message || 'Failed to load.'}</div>
        ) : data && summary ? (
          <>
            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard icon={Users} tone="slate" label="Consultants" value={numberFmt(summary.consultants)} sub={`for ${data.context.label}`} />
              <SummaryCard icon={Target} tone="blue" label="Bookings" value={numberFmt(summary.bookings)}
                sub={summary.bookingTarget > 0 ? `of ${numberFmt(summary.bookingTarget)} target · ${summary.bookingAchievement}%` : 'no target set'}
                subTone={summary.bookingTarget > 0 ? achievementTone(summary.bookingAchievement) : undefined} />
              <SummaryCard icon={Trophy} tone="emerald" label="Deliveries" value={numberFmt(summary.deliveries)}
                sub={summary.deliveryTarget > 0 ? `of ${numberFmt(summary.deliveryTarget)} target · ${summary.deliveryAchievement}%` : 'no target set'}
                subTone={summary.deliveryTarget > 0 ? achievementTone(summary.deliveryAchievement) : undefined} />
              <SummaryCard icon={TrendingUp} tone="violet" label="Conversion" value={`${summary.conversion}%`} sub="of this month's bookings, % delivered" />
            </div>

            {/* Leaderboard */}
            <Card className="overflow-hidden rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
              <div className="flex items-center gap-2 border-b border-[var(--kia-hairline)] px-5 py-3.5">
                <Trophy className="h-4 w-4 text-amber-500" />
                <p className="text-[13px] font-black uppercase tracking-wider text-[var(--kia-text-soft)]">Consultant Leaderboard · {data.context.label}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--kia-hairline)] text-[10px] font-black uppercase tracking-wider text-[var(--kia-text-faint)]">
                      <th className="px-4 py-2.5">#</th>
                      <th className="px-4 py-2.5">Consultant</th>
                      <th className="px-4 py-2.5">Dealer</th>
                      <th className="px-4 py-2.5 text-right">Bookings</th>
                      <th className="px-4 py-2.5 text-right">Bkg Target</th>
                      <th className="px-4 py-2.5 text-right">Deliveries</th>
                      <th className="px-4 py-2.5 text-right">Del Target</th>
                      <th className="px-4 py-2.5 text-right">Conv.</th>
                      <th className="px-4 py-2.5 text-right">Achieved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.map((row) => (
                      <tr key={`${row.dealer}-${row.consultant}`} className="border-b border-[var(--kia-hairline)] last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5">
                          <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black',
                            row.rank === 1 ? 'bg-amber-100 text-amber-700' : row.rank === 2 ? 'bg-slate-200 text-slate-700' : row.rank === 3 ? 'bg-orange-100 text-orange-700' : 'text-[var(--kia-text-faint)]')}>{row.rank}</span>
                        </td>
                        <td className="px-4 py-2.5 font-bold text-[var(--kia-text)]">{row.consultant}</td>
                        <td className="px-4 py-2.5 text-[var(--kia-text-soft)]">{dealerLabel(row.dealer)}</td>
                        <td className="px-4 py-2.5 text-right font-black tabular-nums text-[var(--kia-text)]">{row.bookings}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--kia-text-faint)]">{row.bookingTarget || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-black tabular-nums text-emerald-600">{row.deliveries}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--kia-text-faint)]">{row.deliveryTarget || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[var(--kia-text-soft)]">{row.conversion}%</td>
                        <td className={cn('px-4 py-2.5 text-right font-black tabular-nums', achievementTone(row.deliveryAchievement))}>
                          {row.deliveryAchievement === null ? '—' : `${row.deliveryAchievement}%`}
                        </td>
                      </tr>
                    ))}
                    {data.leaderboard.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-sm font-semibold text-[var(--kia-text-faint)]">No sales activity for this month.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}
      </div>

      {targetsOpen && data && (
        <SetTargetsDialog
          open={targetsOpen}
          onClose={() => setTargetsOpen(false)}
          data={data}
          dealerFilter={dealer}
          onSaved={() => { setTargetsOpen(false); void query.refetch() }}
        />
      )}
    </MainLayout>
  )
}

function SummaryCard({ icon: Icon, tone, label, value, sub, subTone }: { icon: typeof Users; tone: 'slate' | 'blue' | 'emerald' | 'violet'; label: string; value: string; sub: string; subTone?: string }) {
  const toneBg: Record<string, string> = { slate: 'bg-slate-100 text-slate-600', blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', violet: 'bg-violet-50 text-violet-600' }
  return (
    <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--kia-text-soft)]">{label}</p>
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', toneBg[tone])}><Icon className="h-4 w-4" /></span>
        </div>
        <p className="mt-3 text-[28px] font-black leading-none text-[var(--kia-text)]">{value}</p>
        <p className={cn('mt-2 text-[12px] font-semibold', subTone || 'text-[var(--kia-text-soft)]')}>{sub}</p>
      </CardContent>
    </Card>
  )
}

function SetTargetsDialog({ open, onClose, data, dealerFilter, onSaved }: {
  open: boolean
  onClose: () => void
  data: Payload
  dealerFilter: string
  onSaved: () => void
}) {
  // Consultants in scope (respect the current dealer filter), pre-filled with existing targets.
  const scoped = useMemo(
    () => data.consultants.filter((c) => dealerFilter === 'all' || c.dealer === dealerFilter),
    [data.consultants, dealerFilter],
  )
  const existing = useMemo(() => {
    const map = new Map<string, { bookingTarget: number; deliveryTarget: number }>()
    for (const r of data.leaderboard) map.set(`${r.dealer}|${r.consultant.trim().toUpperCase()}`, { bookingTarget: r.bookingTarget, deliveryTarget: r.deliveryTarget })
    return map
  }, [data.leaderboard])

  // The dialog mounts fresh each time it opens, so build the editable rows once in the initializer.
  const [rows, setRows] = useState<{ consultant: string; dealer: string; bookingTarget: string; deliveryTarget: string }[]>(() =>
    scoped.map((c) => {
      const t = existing.get(`${c.dealer}|${c.consultant.trim().toUpperCase()}`)
      return { consultant: c.consultant, dealer: c.dealer, bookingTarget: t?.bookingTarget ? String(t.bookingTarget) : '', deliveryTarget: t?.deliveryTarget ? String(t.deliveryTarget) : '' }
    }),
  )
  const [saving, setSaving] = useState(false)

  function setCell(index: number, key: 'bookingTarget' | 'deliveryTarget', value: string) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, [key]: value.replace(/\D/g, '').slice(0, 5) } : r)))
  }

  async function save() {
    setSaving(true)
    try {
      const entries = rows.map((r) => ({ dealerCode: r.dealer, consultantName: r.consultant, bookingTarget: Number(r.bookingTarget || 0), deliveryTarget: Number(r.deliveryTarget || 0) }))
      const res = await fetch('/api/brands/kia/sales-performance/targets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ year: data.context.year, month: data.context.month, entries }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save targets')
      toast({ title: 'Targets saved', description: `Updated for ${data.context.label}.`, variant: 'success' })
      onSaved()
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-100 p-5">
          <DialogTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-[var(--dashboard-action-bg)]" /> Set Targets · {data.context.label}</DialogTitle>
          <DialogDescription>Monthly booking &amp; delivery targets per consultant{dealerFilter !== 'all' ? ` · ${dealerLabel(dealerFilter)}` : ''}. Leave blank for no target.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] overflow-y-auto px-5 py-3">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-white">
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                <th className="py-2">Consultant</th>
                <th className="py-2">Dealer</th>
                <th className="py-2 w-28 text-right">Bookings</th>
                <th className="py-2 w-28 text-right">Deliveries</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.dealer}-${r.consultant}`} className="border-t border-slate-100">
                  <td className="py-1.5 font-bold text-slate-800">{r.consultant}</td>
                  <td className="py-1.5 text-slate-500">{dealerLabel(r.dealer)}</td>
                  <td className="py-1.5 text-right"><Input value={r.bookingTarget} onChange={(e) => setCell(i, 'bookingTarget', e.target.value)} inputMode="numeric" placeholder="0" className="h-9 w-24 rounded-lg text-right tabular-nums" /></td>
                  <td className="py-1.5 text-right"><Input value={r.deliveryTarget} onChange={(e) => setCell(i, 'deliveryTarget', e.target.value)} inputMode="numeric" placeholder="0" className="h-9 w-24 rounded-lg text-right tabular-nums" /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-sm font-semibold text-slate-400">No consultants found for this dealer.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 p-4">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}><X className="mr-1 h-4 w-4" /> Cancel</Button>
          <Button className="h-10 gap-2 rounded-xl bg-[var(--dashboard-action-bg)] px-6 font-bold text-white" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Targets
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
