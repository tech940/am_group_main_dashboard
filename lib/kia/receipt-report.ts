import 'server-only'

import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'

// Reader for kia_receipt_report — the externally-ingested payment-receipts register (one row per
// receipt against a booking; appointment_no carries the DMS booking ref). Not in the Drizzle schema
// (the pipeline owns the table), so reads are raw SQL like the other kia_* report readers.

export type KiaReceiptFilters = {
  startDate?: string | null // YYYY-MM-DD inclusive
  endDate?: string | null // YYYY-MM-DD inclusive
  dealer?: string | null // dealer_code, e.g. JK402
  paymentType?: string | null // type_of_payment, e.g. Online / Cash
  search?: string | null
  page?: number
  pageSize?: number
  // Dealer/branch codes the user is restricted to (null/empty = all branches). A HARD boundary
  // applied to the list, KPIs, breakdowns AND the dealer filter facet — set from the user's dealer
  // scope server-side so a Sales/General Manager can never see another branch's receipts.
  allowedDealers?: string[] | null
}

type Row = Record<string, unknown>

function rows(result: unknown): Row[] {
  return Array.isArray(result) ? (result as Row[]) : []
}

function num(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// The branch boundary as a bare predicate on dealer_code, or null when unrestricted. Reused by the
// main WHERE (list/KPIs/breakdowns) and, separately, by the UNFILTERED facet sub-queries so a scoped
// user's dealer dropdown lists only their own branch(es).
function dealerScopeCondition(allowedDealers?: string[] | null): SQL | null {
  if (!allowedDealers || !allowedDealers.length) return null
  const codes = allowedDealers.map((code) => text(code).toUpperCase()).filter(Boolean)
  if (!codes.length) return null
  return sql`UPPER(TRIM(COALESCE(dealer_code, ''))) IN ${codes}`
}

function whereFor(filters: KiaReceiptFilters): SQL {
  const conditions: SQL[] = [sql`receipt_date IS NOT NULL`]
  const scope = dealerScopeCondition(filters.allowedDealers)
  if (scope) conditions.push(scope)
  if (filters.startDate && DATE_RE.test(filters.startDate)) {
    conditions.push(sql`receipt_date >= ${filters.startDate}::date`)
  }
  if (filters.endDate && DATE_RE.test(filters.endDate)) {
    conditions.push(sql`receipt_date < (${filters.endDate}::date + INTERVAL '1 day')`)
  }
  const dealer = text(filters.dealer).toUpperCase()
  if (dealer && dealer !== 'ALL') {
    conditions.push(sql`UPPER(TRIM(COALESCE(dealer_code, ''))) = ${dealer}`)
  }
  const paymentType = text(filters.paymentType).toLowerCase()
  if (paymentType && paymentType !== 'all') {
    conditions.push(sql`LOWER(TRIM(COALESCE(type_of_payment, ''))) = ${paymentType}`)
  }
  const search = text(filters.search)
  if (search) {
    const like = `%${search}%`
    conditions.push(sql`(
      receipt_no ILIKE ${like}
      OR name_of_customer ILIKE ${like}
      OR customer_id ILIKE ${like}
      OR appointment_no ILIKE ${like}
      OR invoice_no ILIKE ${like}
      OR model ILIKE ${like}
      OR kec ILIKE ${like}
    )`)
  }
  return sql.join(conditions, sql` AND `)
}

export async function getKiaBookingPaymentHistory(filters: KiaReceiptFilters) {
  const page = Math.max(1, Math.floor(num(filters.page) || 1))
  const pageSize = Math.min(100, Math.max(10, Math.floor(num(filters.pageSize) || 20)))
  const offset = (page - 1) * pageSize
  const where = whereFor(filters)
  // Facets ignore the user's filters (so options never vanish) but MUST still respect the branch
  // boundary — otherwise a scoped manager's dealer dropdown would list branches they can't query.
  const scope = dealerScopeCondition(filters.allowedDealers)
  const facetScope = scope ? sql` AND ${scope}` : sql``

  // ONE round-trip for the whole response. The summary, every breakdown, the branch-scoped facets AND
  // the current page of rows are all derived from a single shared `filtered` CTE via scalar/json
  // sub-selects — so the ~225ms pooler latency is paid once, not 3× (was: aggregate + page + count).
  // The separate COUNT is gone: `receipt_count` over `filtered` IS the total for this filter.
  const aggResult = await db.execute(sql`
      WITH filtered AS (
        SELECT id, receipt_no, receipt_date, receipt_amount, type_of_payment, name_of_customer,
               customer_id, model, appointment_no, invoice_no, kec, drawn_on, cheque_no, remarks, dealer_code
        FROM kia_receipt_report
        WHERE ${where}
      )
      SELECT
        (SELECT count(*)::int FROM filtered) AS receipt_count,
        (SELECT COALESCE(SUM(receipt_amount), 0)::float FROM filtered) AS total_amount,
        (SELECT count(DISTINCT appointment_no)::int FROM filtered WHERE COALESCE(appointment_no, '') <> '') AS unique_bookings,
        (SELECT count(DISTINCT customer_id)::int FROM filtered WHERE COALESCE(customer_id, '') <> '') AS unique_customers,
        (SELECT MIN(receipt_date)::text FROM filtered) AS min_date,
        (SELECT MAX(receipt_date)::text FROM filtered) AS max_date,
        COALESCE((SELECT jsonb_agg(t) FROM (
          SELECT receipt_date::text AS date, count(*)::int AS count, COALESCE(SUM(receipt_amount), 0)::float AS amount
          FROM filtered GROUP BY receipt_date ORDER BY receipt_date ASC
        ) t), '[]'::jsonb) AS trend,
        COALESCE((SELECT jsonb_agg(t) FROM (
          SELECT COALESCE(NULLIF(TRIM(type_of_payment), ''), 'Unspecified') AS name,
                 count(*)::int AS count, COALESCE(SUM(receipt_amount), 0)::float AS amount
          FROM filtered GROUP BY 1 ORDER BY 3 DESC
        ) t), '[]'::jsonb) AS by_payment_type,
        COALESCE((SELECT jsonb_agg(t) FROM (
          SELECT COALESCE(NULLIF(TRIM(model), ''), 'Unspecified') AS name,
                 count(*)::int AS count, COALESCE(SUM(receipt_amount), 0)::float AS amount
          FROM filtered GROUP BY 1 ORDER BY 3 DESC LIMIT 8
        ) t), '[]'::jsonb) AS by_model,
        COALESCE((SELECT jsonb_agg(t) FROM (
          SELECT COALESCE(NULLIF(TRIM(kec), ''), 'Unspecified') AS name,
                 count(*)::int AS count, COALESCE(SUM(receipt_amount), 0)::float AS amount
          FROM filtered GROUP BY 1 ORDER BY 3 DESC LIMIT 8
        ) t), '[]'::jsonb) AS by_kec,
        COALESCE((SELECT jsonb_agg(t) FROM (
          SELECT COALESCE(NULLIF(TRIM(drawn_on), ''), 'Unspecified') AS name,
                 count(*)::int AS count, COALESCE(SUM(receipt_amount), 0)::float AS amount
          FROM filtered GROUP BY 1 ORDER BY 3 DESC LIMIT 8
        ) t), '[]'::jsonb) AS by_bank,
        COALESCE((SELECT jsonb_agg(t) FROM (
          SELECT COALESCE(NULLIF(TRIM(dealer_code), ''), 'Unspecified') AS name,
                 count(*)::int AS count, COALESCE(SUM(receipt_amount), 0)::float AS amount
          FROM filtered GROUP BY 1 ORDER BY 3 DESC
        ) t), '[]'::jsonb) AS by_dealer,
        -- Current page of rows, sliced from the same CTE — folds the old separate page query in.
        COALESCE((SELECT jsonb_agg(t) FROM (
          SELECT id::text AS id, receipt_no, receipt_date::text AS receipt_date, receipt_amount::float AS receipt_amount,
                 type_of_payment, name_of_customer, customer_id, model, appointment_no, invoice_no,
                 kec, drawn_on, cheque_no, remarks, dealer_code
          FROM filtered
          ORDER BY receipt_date DESC, id DESC
          LIMIT ${pageSize} OFFSET ${offset}
        ) t), '[]'::jsonb) AS page_rows,
        -- Filter facets are UNFILTERED by the user's filters (so dropdowns keep every option) but are
        -- still constrained to the user's allowed branch(es) via facetScope.
        COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM (
          SELECT DISTINCT UPPER(TRIM(dealer_code)) AS v FROM kia_receipt_report WHERE COALESCE(dealer_code, '') <> ''${facetScope}
        ) d), '[]'::jsonb) AS facet_dealers,
        COALESCE((SELECT jsonb_agg(v ORDER BY v) FROM (
          SELECT DISTINCT TRIM(type_of_payment) AS v FROM kia_receipt_report WHERE COALESCE(type_of_payment, '') <> ''${facetScope}
        ) p), '[]'::jsonb) AS facet_payment_types
    `)

  const agg = rows(aggResult)[0] || {}
  const total = num(agg.receipt_count)

  return {
    summary: {
      receiptCount: num(agg.receipt_count),
      totalAmount: num(agg.total_amount),
      avgReceipt: num(agg.receipt_count) > 0 ? num(agg.total_amount) / num(agg.receipt_count) : 0,
      uniqueBookings: num(agg.unique_bookings),
      uniqueCustomers: num(agg.unique_customers),
      minDate: agg.min_date ? String(agg.min_date) : null,
      maxDate: agg.max_date ? String(agg.max_date) : null,
    },
    trend: jsonArray<{ date: string; count: number; amount: number }>(agg.trend),
    byPaymentType: jsonArray<{ name: string; count: number; amount: number }>(agg.by_payment_type),
    byModel: jsonArray<{ name: string; count: number; amount: number }>(agg.by_model),
    byKec: jsonArray<{ name: string; count: number; amount: number }>(agg.by_kec),
    byBank: jsonArray<{ name: string; count: number; amount: number }>(agg.by_bank),
    byDealer: jsonArray<{ name: string; count: number; amount: number }>(agg.by_dealer),
    rows: jsonArray<Row>(agg.page_rows).map((row) => ({
      id: String(row.id),
      receiptNo: text(row.receipt_no),
      receiptDate: row.receipt_date ? String(row.receipt_date) : null,
      amount: num(row.receipt_amount),
      paymentType: text(row.type_of_payment),
      customer: text(row.name_of_customer),
      customerId: text(row.customer_id),
      model: text(row.model),
      bookingNo: text(row.appointment_no),
      invoiceNo: text(row.invoice_no),
      kec: text(row.kec),
      bank: text(row.drawn_on),
      chequeNo: text(row.cheque_no),
      remarks: text(row.remarks),
      dealerCode: text(row.dealer_code),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    filters: {
      dealers: jsonArray<string>(agg.facet_dealers),
      paymentTypes: jsonArray<string>(agg.facet_payment_types),
    },
  }
}
