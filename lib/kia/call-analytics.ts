import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

// Call Center + Follow-up analytics for managers. Aggregates kia_call_logs, kia_lead_followups and
// kia_callback_requests over a rolling window. PII-safe: agent/consultant NAMES only — never a
// customer phone (the source tables don't even store it). Read from the main db (all tables local).

function rows(result: unknown) { return Array.isArray(result) ? result as Record<string, unknown>[] : [] }
function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function pct(part: number, whole: number) { return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0 }

const ALLOWED_DAYS = new Set([7, 30, 90])
// Dispositions/outcomes that mean a human was actually reached.
const REACHED = sql`('interested','callback_later','not_interested','done')`

export type KV = { key: string; count: number }
export type CallAnalyticsPayload = {
  range: { days: number; dealer: string | null }
  calls: { total: number; reached: number; noAnswer: number; wrongNumber: number; contactRate: number; avgDurationSec: number; dispositions: KV[] }
  followups: { created: number; completed: number; overdue: number; pending: number; completionRate: number; outcomes: KV[]; bySource: KV[] }
  callbacks: { pending: number }
  agentLeaderboard: { agent: string; calls: number; reached: number; contactRate: number; avgDurationSec: number }[]
  consultantLeaderboard: { consultant: string; assigned: number; completed: number; overdue: number; converted: number }[]
  trend: { date: string; calls: number; followupsCompleted: number }[]
}

export async function getKiaCallAnalytics(input: { days?: number; dealer?: string | null }): Promise<CallAnalyticsPayload> {
  const days = ALLOWED_DAYS.has(Number(input.days)) ? Number(input.days) : 30
  const dealer = normalizeKiaDealerCode(input.dealer || null) || null
  // Dealer scoping fragments — calls/callbacks join bookings for the code; follow-ups carry their own.
  const bDealer = dealer ? sql`AND UPPER(TRIM(b.dealer_code)) = ${dealer}` : sql``
  const fDealer = dealer ? sql`AND UPPER(TRIM(f.dealer_code)) = ${dealer}` : sql``
  const since = sql`now() - make_interval(days => ${days})`

  const [callSummary, dispositions, followSummary, outcomes, sources, callbacks, agents, consultants, callsByDay, followByDay] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE cl.disposition IN ${REACHED})::int AS reached,
        count(*) FILTER (WHERE cl.disposition = 'no_answer')::int AS no_answer,
        count(*) FILTER (WHERE cl.disposition = 'wrong_number')::int AS wrong_number,
        COALESCE(avg(cl.duration_sec) FILTER (WHERE cl.duration_sec > 0), 0)::int AS avg_duration
      FROM kia_call_logs cl LEFT JOIN kia_bookings b ON b.id = cl.booking_id
      WHERE cl.started_at >= ${since} ${bDealer}`),
    db.execute(sql`
      SELECT COALESCE(cl.disposition, '(none)') AS key, count(*)::int AS count
      FROM kia_call_logs cl LEFT JOIN kia_bookings b ON b.id = cl.booking_id
      WHERE cl.started_at >= ${since} ${bDealer}
      GROUP BY 1 ORDER BY 2 DESC`),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE f.created_at >= ${since})::int AS created,
        count(*) FILTER (WHERE f.status = 'done' AND f.completed_at >= ${since})::int AS completed,
        count(*) FILTER (WHERE f.status = 'pending' AND f.due_at < now())::int AS overdue,
        count(*) FILTER (WHERE f.status = 'pending')::int AS pending
      FROM kia_lead_followups f WHERE 1=1 ${fDealer}`),
    db.execute(sql`
      SELECT COALESCE(f.outcome, '(none)') AS key, count(*)::int AS count
      FROM kia_lead_followups f
      WHERE f.status = 'done' AND f.completed_at >= ${since} ${fDealer}
      GROUP BY 1 ORDER BY 2 DESC`),
    db.execute(sql`
      SELECT f.source AS key, count(*)::int AS count
      FROM kia_lead_followups f
      WHERE f.created_at >= ${since} ${fDealer}
      GROUP BY 1 ORDER BY 2 DESC`),
    db.execute(sql`
      SELECT count(*)::int AS pending
      FROM kia_callback_requests cr LEFT JOIN kia_bookings b ON b.id = cr.booking_id
      WHERE cr.status = 'pending' ${bDealer}`),
    db.execute(sql`
      SELECT u.full_name AS agent, count(*)::int AS calls,
        count(*) FILTER (WHERE cl.disposition IN ${REACHED})::int AS reached,
        COALESCE(avg(cl.duration_sec) FILTER (WHERE cl.duration_sec > 0), 0)::int AS avg_duration
      FROM kia_call_logs cl
      JOIN users u ON u.id = cl.agent_id
      LEFT JOIN kia_bookings b ON b.id = cl.booking_id
      WHERE cl.started_at >= ${since} ${bDealer}
      GROUP BY u.full_name ORDER BY calls DESC LIMIT 20`),
    db.execute(sql`
      SELECT f.assigned_name AS consultant,
        count(*) FILTER (WHERE f.created_at >= ${since})::int AS assigned,
        count(*) FILTER (WHERE f.status = 'done' AND f.completed_at >= ${since})::int AS completed,
        count(*) FILTER (WHERE f.status = 'pending' AND f.due_at < now())::int AS overdue,
        count(*) FILTER (WHERE f.outcome = 'converted' AND f.completed_at >= ${since})::int AS converted
      FROM kia_lead_followups f WHERE f.assigned_name IS NOT NULL ${fDealer}
      GROUP BY f.assigned_name ORDER BY assigned DESC, completed DESC LIMIT 20`),
    db.execute(sql`
      SELECT to_char((cl.started_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS date, count(*)::int AS count
      FROM kia_call_logs cl LEFT JOIN kia_bookings b ON b.id = cl.booking_id
      WHERE cl.started_at >= ${since} ${bDealer}
      GROUP BY 1`),
    db.execute(sql`
      SELECT to_char((f.completed_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS date, count(*)::int AS count
      FROM kia_lead_followups f
      WHERE f.status = 'done' AND f.completed_at >= ${since} ${fDealer}
      GROUP BY 1`),
  ])

  const cs = rows(callSummary)[0] || {}
  const fs = rows(followSummary)[0] || {}
  const total = num(cs.total)
  const reached = num(cs.reached)
  const created = num(fs.created)
  const completed = num(fs.completed)

  // Build the daily trend axis (last N days, IST) and fill from the two grouped results.
  const callMap = new Map(rows(callsByDay).map((r) => [String(r.date), num(r.count)]))
  const followMap = new Map(rows(followByDay).map((r) => [String(r.date), num(r.count)]))
  const trend: CallAnalyticsPayload['trend'] = []
  const istNow = new Date(Date.now() + 330 * 60_000)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(istNow.getTime() - i * 86_400_000)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    trend.push({ date: key, calls: callMap.get(key) || 0, followupsCompleted: followMap.get(key) || 0 })
  }

  return {
    range: { days, dealer },
    calls: {
      total, reached, noAnswer: num(cs.no_answer), wrongNumber: num(cs.wrong_number),
      contactRate: pct(reached, total), avgDurationSec: num(cs.avg_duration),
      dispositions: rows(dispositions).map((r) => ({ key: String(r.key), count: num(r.count) })),
    },
    followups: {
      created, completed, overdue: num(fs.overdue), pending: num(fs.pending),
      completionRate: pct(completed, created),
      outcomes: rows(outcomes).map((r) => ({ key: String(r.key), count: num(r.count) })),
      bySource: rows(sources).map((r) => ({ key: String(r.key), count: num(r.count) })),
    },
    callbacks: { pending: num(rows(callbacks)[0]?.pending) },
    agentLeaderboard: rows(agents).map((r) => ({
      agent: String(r.agent), calls: num(r.calls), reached: num(r.reached),
      contactRate: pct(num(r.reached), num(r.calls)), avgDurationSec: num(r.avg_duration),
    })),
    consultantLeaderboard: rows(consultants)
      .map((r) => ({ consultant: String(r.consultant), assigned: num(r.assigned), completed: num(r.completed), overdue: num(r.overdue), converted: num(r.converted) }))
      .filter((r) => r.assigned > 0 || r.completed > 0 || r.overdue > 0),
    trend,
  }
}
