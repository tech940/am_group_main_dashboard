import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { addDays, indiaToday } from './catalog'

/*
 * Car Evaluation Leads — the dashboard's read of `vehicle_evaluations` (the /sell-used-car form).
 *
 * ONE statement per request (list page + counts + campaign list): the pooler costs ~250 ms a round trip.
 * Every source is read, not just 'sell-used-car': an earlier build of the form wrote 'whatsapp_campaign',
 * and any lead it took belongs on this screen too.
 */

export const LEAD_PERIODS = ['today', '7d', 'month', 'last_month', 'all'] as const
export type LeadPeriod = (typeof LEAD_PERIODS)[number]
export const LEADS_PAGE_SIZE = 50
/** The filter value for leads that arrived without a campaign tag on the link. */
export const NO_CAMPAIGN = '__none'

export type LeadFilters = { period: LeadPeriod; campaign: string | null; q: string; page: number }

export type EvaluationLead = {
  id: string
  createdAt: string
  customerName: string
  mobile: string
  brand: string
  model: string
  manufacturingYear: number
  kilometres: number | null
  kilometresBand: string | null
  evaluationDate: string | null
  interestedInNewCar: boolean
  utmSource: string | null
  utmCampaign: string | null
  notes: string | null
  source: string
}

export type LeadsResult = {
  rows: EvaluationLead[]
  total: number
  page: number
  pageSize: number
  kpis: { leads: number; wantsNewCar: number; dueToday: number; dueNextWeek: number }
  campaigns: Array<{ campaign: string; leads: number }>
  today: string
}

export function parseLeadFilters(params: URLSearchParams): LeadFilters {
  const period = LEAD_PERIODS.includes(params.get('period') as LeadPeriod) ? (params.get('period') as LeadPeriod) : 'month'
  const campaign = (params.get('campaign') || '').trim().slice(0, 100) || null
  const q = (params.get('q') || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 80)
  const page = Math.min(Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1), 1000)
  return { period, campaign, q, page }
}

/** The IST calendar window for a period, as [from, to) dates; null bounds are open. */
export function periodWindow(period: LeadPeriod, today: string = indiaToday()): { from: string | null; to: string | null } {
  const monthStart = `${today.slice(0, 7)}-01`
  switch (period) {
    case 'today':
      return { from: today, to: addDays(today, 1) }
    case '7d':
      return { from: addDays(today, -6), to: addDays(today, 1) }
    case 'month':
      return { from: monthStart, to: addDays(today, 1) }
    case 'last_month': {
      const lastMonthStart = `${addDays(monthStart, -1).slice(0, 7)}-01`
      return { from: lastMonthStart, to: monthStart }
    }
    default:
      return { from: null, to: null }
  }
}

type Raw = {
  total: number
  leads: number
  wants_new_car: number
  due_today: number
  due_next_week: number
  rows: Array<Record<string, unknown>> | string | null
  campaigns: Array<{ campaign: string; leads: number }> | string | null
}

function json<T>(value: T | string | null): T | null {
  if (value == null) return null
  return typeof value === 'string' ? (JSON.parse(value) as T) : value
}

export async function listEvaluationLeads(filters: LeadFilters): Promise<LeadsResult> {
  const today = indiaToday()
  const { from, to } = periodWindow(filters.period, today)
  const offset = (filters.page - 1) * LEADS_PAGE_SIZE

  const inPeriod = sql`
    (${from}::date IS NULL OR v.created_at >= (${from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND (${to}::date IS NULL OR v.created_at < (${to}::date::timestamp AT TIME ZONE 'Asia/Kolkata'))`
  const inCampaign = filters.campaign === NO_CAMPAIGN
    ? sql`NULLIF(BTRIM(v.utm_campaign), '') IS NULL`
    : filters.campaign
      ? sql`v.utm_campaign = ${filters.campaign}`
      : sql`TRUE`

  const digits = filters.q.replace(/\D/g, '')
  const reference = /^[0-9a-f]{4,}$/i.test(filters.q) ? filters.q.toLowerCase() : null
  const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const matchesSearch = filters.q
    ? sql`(
        v.customer_name ILIKE ${like}
        OR v.brand ILIKE ${like}
        OR v.model ILIKE ${like}
        OR (${digits.length >= 4}::boolean AND v.mobile LIKE ${`%${digits}%`})
        OR (${reference}::text IS NOT NULL AND replace(v.id::text, '-', '') LIKE ${`${reference ?? ''}%`})
      )`
    : sql`TRUE`

  const result = (await db.execute(sql`
    WITH scoped AS (
      SELECT v.* FROM public.vehicle_evaluations v WHERE ${inPeriod} AND ${inCampaign}
    ),
    matched AS (
      SELECT v.* FROM scoped v WHERE ${matchesSearch}
    ),
    page AS (
      SELECT id, created_at, customer_name, mobile, brand, model, manufacturing_year, mileage_exact,
             kilometers_driven, evaluation_date, interested_in_new_car, utm_source, utm_campaign, notes, source
      FROM matched
      ORDER BY created_at DESC, id
      LIMIT ${LEADS_PAGE_SIZE} OFFSET ${offset}
    )
    SELECT
      (SELECT count(*)::int FROM matched) AS total,
      (SELECT count(*)::int FROM scoped) AS leads,
      (SELECT count(*)::int FROM scoped WHERE interested_in_new_car) AS wants_new_car,
      (SELECT count(*)::int FROM public.vehicle_evaluations WHERE evaluation_date = ${today}) AS due_today,
      (SELECT count(*)::int FROM public.vehicle_evaluations
         WHERE evaluation_date > ${today} AND evaluation_date <= ${addDays(today, 7)}) AS due_next_week,
      (SELECT COALESCE(json_agg(p ORDER BY p.created_at DESC, p.id), '[]'::json) FROM page p) AS rows,
      (SELECT COALESCE(json_agg(c ORDER BY c.leads DESC, c.campaign), '[]'::json) FROM (
         SELECT COALESCE(NULLIF(BTRIM(v.utm_campaign), ''), ${NO_CAMPAIGN}) AS campaign, count(*)::int AS leads
         FROM public.vehicle_evaluations v WHERE ${inPeriod}
         GROUP BY 1
       ) c) AS campaigns
  `)) as unknown as Raw[]

  const raw = result[0]
  const rows = (json<Array<Record<string, unknown>>>(raw?.rows ?? null) ?? []).map((r): EvaluationLead => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    customerName: String(r.customer_name ?? ''),
    mobile: String(r.mobile ?? ''),
    brand: String(r.brand ?? ''),
    model: String(r.model ?? ''),
    manufacturingYear: Number(r.manufacturing_year),
    kilometres: r.mileage_exact == null ? null : Number(r.mileage_exact),
    kilometresBand: r.kilometers_driven == null ? null : String(r.kilometers_driven),
    evaluationDate: r.evaluation_date == null ? null : String(r.evaluation_date),
    interestedInNewCar: r.interested_in_new_car === true,
    utmSource: r.utm_source == null ? null : String(r.utm_source),
    utmCampaign: r.utm_campaign == null ? null : String(r.utm_campaign),
    notes: r.notes == null ? null : String(r.notes),
    source: String(r.source ?? ''),
  }))

  return {
    rows,
    total: raw?.total ?? 0,
    page: filters.page,
    pageSize: LEADS_PAGE_SIZE,
    kpis: {
      leads: raw?.leads ?? 0,
      wantsNewCar: raw?.wants_new_car ?? 0,
      dueToday: raw?.due_today ?? 0,
      dueNextWeek: raw?.due_next_week ?? 0,
    },
    campaigns: json<Array<{ campaign: string; leads: number }>>(raw?.campaigns ?? null) ?? [],
    today,
  }
}
