'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Loader2, PhoneCall, Percent, Clock, CheckCircle2, AlertTriangle, PhoneIncoming } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type KV = { key: string; count: number }
type Payload = {
  range: { days: number; dealer: string | null }
  calls: { total: number; reached: number; noAnswer: number; wrongNumber: number; contactRate: number; avgDurationSec: number; dispositions: KV[] }
  followups: { created: number; completed: number; overdue: number; pending: number; completionRate: number; outcomes: KV[]; bySource: KV[] }
  callbacks: { pending: number }
  agentLeaderboard: { agent: string; calls: number; reached: number; contactRate: number; avgDurationSec: number }[]
  consultantLeaderboard: { consultant: string; assigned: number; completed: number; overdue: number; converted: number }[]
  trend: { date: string; calls: number; followupsCompleted: number }[]
}

const DEALERS = [{ value: 'all', label: 'All dealers' }, { value: 'JK402', label: 'Jammu' }, { value: 'JK501', label: 'Udhampur' }]
const DAYS = [{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]
const LABELS: Record<string, string> = {
  interested: 'Interested', callback_later: 'Call back later', not_interested: 'Not interested',
  no_answer: 'No answer', wrong_number: 'Wrong number', done: 'Done', '(none)': 'No outcome',
  reached: 'Reached', rescheduled: 'Rescheduled', converted: 'Converted', manual: 'Manual', call: 'From call', callback_request: 'Callback req.',
}
function label(k: string) { return LABELS[k] || k.replace(/_/g, ' ') }
function fmtDuration(sec: number) { if (!sec) return '—'; const m = Math.floor(sec / 60); const s = sec % 60; return m ? `${m}m ${s}s` : `${s}s` }
function shortDate(iso: string) { const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }

export function KiaCallAnalyticsPage() {
  const [days, setDays] = useState(30)
  const [dealer, setDealer] = useState('all')

  const query = useQuery<Payload>({
    queryKey: ['kia-call-analytics', days, dealer],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) })
      if (dealer !== 'all') params.set('dealer', dealer)
      const res = await fetch(`/api/brands/kia/call-analytics?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })
  const d = query.data

  return (
    <MainLayout title="Call & Follow-up Analytics" subtitle="Team call activity, contact rate, and follow-up health">
      <div className="space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {DAYS.map((o) => (
              <button key={o.value} onClick={() => setDays(o.value)} className={cn('rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors', days === o.value ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900')}>{o.label}</button>
            ))}
          </div>
          <Select value={dealer} onValueChange={setDealer}>
            <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>{DEALERS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {query.isLoading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(query.error as Error)?.message || 'Failed to load.'}</div>
        ) : d ? (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Kpi icon={<PhoneCall className="h-4 w-4" />} label="Calls placed" value={d.calls.total} tone="text-indigo-600" />
              <Kpi icon={<Percent className="h-4 w-4" />} label="Contact rate" value={`${d.calls.contactRate}%`} tone="text-emerald-600" />
              <Kpi icon={<Clock className="h-4 w-4" />} label="Avg call time" value={fmtDuration(d.calls.avgDurationSec)} tone="text-slate-700" />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Follow-ups done" value={d.followups.completed} tone="text-emerald-600" sub={`${d.followups.completionRate}% of created`} />
              <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Overdue now" value={d.followups.overdue} tone="text-rose-600" />
              <Kpi icon={<PhoneIncoming className="h-4 w-4" />} label="Pending callbacks" value={d.callbacks.pending} tone="text-amber-600" />
            </div>

            {/* Trend chart */}
            <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
              <CardContent className="p-5">
                <p className="mb-3 text-[12px] font-black uppercase tracking-wider text-slate-500">Daily activity</p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }} interval={Math.max(0, Math.floor(d.trend.length / 12))} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                      <Tooltip labelFormatter={(v) => shortDate(String(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 600 }} />
                      <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                      <Bar dataKey="calls" name="Calls" fill="#6366f1" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="followupsCompleted" name="Follow-ups done" fill="#10b981" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Breakdowns */}
            <div className="grid gap-3 lg:grid-cols-2">
              <BreakdownCard title="Call dispositions" items={d.calls.dispositions} total={d.calls.total} tone="bg-indigo-500" />
              <BreakdownCard title="Follow-up outcomes" items={d.followups.outcomes} total={d.followups.completed} tone="bg-emerald-500" />
            </div>

            {/* Leaderboards */}
            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="overflow-hidden rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                <div className="border-b border-[var(--kia-hairline)] px-5 py-3"><p className="text-[12px] font-black uppercase tracking-wider text-slate-500">Call agents</p></div>
                <Table head={['Agent', 'Calls', 'Contact', 'Avg']} rows={d.agentLeaderboard.map((a) => [a.agent, String(a.calls), `${a.contactRate}%`, fmtDuration(a.avgDurationSec)])} empty="No calls in this period." />
              </Card>
              <Card className="overflow-hidden rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
                <div className="border-b border-[var(--kia-hairline)] px-5 py-3"><p className="text-[12px] font-black uppercase tracking-wider text-slate-500">Consultants (follow-ups)</p></div>
                <Table head={['Consultant', 'Assigned', 'Done', 'Overdue', 'Won']} rows={d.consultantLeaderboard.map((c) => [c.consultant, String(c.assigned), String(c.completed), String(c.overdue), String(c.converted)])} empty="No follow-ups in this period." />
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </MainLayout>
  )
}

function Kpi({ icon, label, value, tone, sub }: { icon: React.ReactNode; label: string; value: string | number; tone: string; sub?: string }) {
  return (
    <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
      <CardContent className="p-4">
        <div className={cn('flex items-center gap-1.5', tone)}>{icon}<span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span></div>
        <p className={cn('mt-1 text-2xl font-black', tone)}>{value}</p>
        {sub && <p className="text-[10px] font-bold text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function BreakdownCard({ title, items, total, tone }: { title: string; items: KV[]; total: number; tone: string }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
      <CardContent className="p-5">
        <p className="mb-3 text-[12px] font-black uppercase tracking-wider text-slate-500">{title}</p>
        {items.length === 0 ? (
          <p className="py-6 text-center text-[12px] font-semibold text-slate-400">No data in this period.</p>
        ) : (
          <div className="space-y-2">
            {items.map((i) => (
              <div key={i.key}>
                <div className="flex items-center justify-between text-[12px] font-bold">
                  <span className="capitalize text-slate-600">{label(i.key)}</span>
                  <span className="text-slate-500">{i.count}{total > 0 && <span className="ml-1 text-slate-400">· {Math.round((i.count / total) * 100)}%</span>}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.round((i.count / max) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: string[][]; empty: string }) {
  if (!rows.length) return <div className="p-8 text-center text-[12px] font-semibold text-slate-400">{empty}</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--kia-hairline)]">
            {head.map((h, i) => <th key={h} className={cn('px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-slate-50 last:border-0">
              {r.map((c, ci) => <td key={ci} className={cn('px-4 py-2.5', ci === 0 ? 'text-left font-bold text-[var(--kia-text)]' : 'text-right font-semibold text-slate-600')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
