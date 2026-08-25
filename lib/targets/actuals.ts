import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { mapWithConcurrency } from '@/lib/db/concurrency'
import { hyundaiSourceDealerSql } from '@/lib/hyundai/dealer-branch'
import { normalizePlatinumDealerCode, platinumSourceDealerSql } from '@/lib/platinum/dealer-branch'
import {
  hyundaiActiveBillSql,
  hyundaiRoBillingRoKeySql,
} from '@/lib/hyundai/business-excellence-calculations'
import {
  platinumActiveBillSql,
  platinumRoBillingRoKeySql,
} from '@/lib/platinum/business-excellence-calculations'
import { activeBillStatusSql, serviceCategoryExpression } from '@/lib/kia/service-dashboard-metrics'
// Each brand's OWN work_type CASE. Never share one across brands — see the notes on each export.
import { categorySql as hyundaiCategorySql } from '@/lib/hyundai/workshop-summary'
import { serviceCategorySql as platinumCategorySql } from '@/lib/platinum/workshop-summary'
import { getBrandDealers } from '@/lib/dealers/registry'
import { type TargetBrand } from './constants'

/**
 * Month-by-month ACTUALS for a whole fiscal year, for every branch of one brand.
 *
 * ── Why this does not call the workshop/retail readers ────────────────────────────────────────
 * The obvious implementation is `getKiaWorkshopSummary({ endDate })` once per month. Do not.
 * That reader issues ~6 statements and is hard-anchored to month-to-date, so a 12-month grid over
 * three brands is 200+ statements. Two measured facts make that fatal rather than merely slow:
 *
 *   1. Transport dominates here — ~168ms RTT and ~350ms per statement against the pooler.
 *   2. lib/db/concurrency.ts records a production outage (2026-07-28): 15 aggregate queries in one
 *      Promise.all against the :6543 transaction pooler NEVER COMPLETED, and neither did 6, which
 *      equals the server-side pool max. Only concurrency 3 was fast (969ms). Dev rewrites to :5432
 *      session mode, so none of this reproduces locally.
 *
 * So each metric family is ONE statement that groups by (year, month, branch) across the whole FY.
 * Four statements per brand at most, fanned out at concurrency 3.
 *
 * What IS reused is each brand's canonical SQL contract — the dedup keys, the active-bill test, the
 * dealer CASE expressions — so these aggregates tie back to that brand's own screens row for row.
 * scripts/verify-md-targets-actuals.ts asserts exactly that for a complete month.
 *
 * ⚠️ The RO-count basis genuinely differs per brand and is NOT normalised here: KIA dedupes
 * bill-first (bill_no -> ro_no -> id) while Hyundai/Platinum dedupe RO-first and prefix the dealer.
 * KIA's figure is therefore a deduped BILL count and the others are deduped JOB CARD counts.
 * Converting either one would move numbers that already ship on the BE pages and the cockpit, so
 * the difference is surfaced in the UI (BRAND_TARGET_CAPABILITIES.serviceRoBasis) instead.
 *
 * ⚠️ Consolidated dealer codes do NOT apply to this data. Verified: HYUNDAI_CONSOLIDATED_DEALER_CODE
 * (N5216) is referenced only by lib/hyundai/business-excellence-operations.ts, and
 * getPlatinumDealerWeights only by lib/platinum/business-excellence-vas.ts — both over the
 * operation-wise/VAS feeds, not over *_ro_billing_report. The RO billing tables map codes through a
 * flat CASE with no weights, which is why both brands' workshop readers can plainly SUM branches.
 * If service revenue is ever rebased onto the operation-wise feed, the weights come straight back.
 */

/** One brand-month-branch cell of measured reality. */
export type ActualCell = {
  salesUnits: number
  salesRevenue: number
  serviceRoCount: number
  serviceRevenue: number
  /**
   * Workshop labour, `labour_amt` ONLY — parts deliberately excluded, so these are NOT a slice of
   * serviceRevenue (labour + parts). mechLabour + bodyshopLabour === labourTotal to the rupee:
   * every one of the three is filtered to the same four canonical work_type buckets.
   */
  mechLabour: number
  bodyshopLabour: number
  labourTotal: number
}

/**
 * Per (brand, family) read outcome. Copied in spirit from lib/cockpit/cockpit-data.ts, whose header
 * records the incident where a FAILED read was cached as a confident ₹0 and understated group
 * revenue by ~53%.
 *
 *   'ok'          — the query ran and these numbers are real.
 *   'no_data'     — the query ran and this feed genuinely has no rows in the window.
 *   'unavailable' — we could NOT read it. Render an em-dash, never ₹0, and exclude from totals.
 */
export type ActualsStatus = 'ok' | 'no_data' | 'unavailable'

export type BrandActuals = {
  brand: TargetBrand
  salesStatus: ActualsStatus
  serviceStatus: ActualsStatus
  /** Keyed `${dealerCode}|${year}-${MM}`; dealerCode is BRAND_TARGET_SENTINEL for brand-level sales. */
  cells: Map<string, ActualCell>
}

export function actualsKey(dealerCode: string, year: number, month: number): string {
  return `${dealerCode}|${year}-${String(month).padStart(2, '0')}`
}

function emptyCell(): ActualCell {
  return {
    salesUnits: 0, salesRevenue: 0, serviceRoCount: 0, serviceRevenue: 0,
    mechLabour: 0, bodyshopLabour: 0, labourTotal: 0,
  }
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  return ((result as { rows?: unknown[] })?.rows ?? []) as Record<string, unknown>[]
}

/**
 * Invoice value INCLUDING tax, the basis the MD sets sales-revenue targets against.
 *
 * ⚠️ Never `invoice_price` — it is a TEXT column on all three feeds, and casting free-text money is
 * exactly what produced a live 22008 crash on the KIA BE page. Every column below is numeric.
 *
 * CGST+SGST and IGST are mutually exclusive on any one invoice (intra- vs inter-state), so summing
 * all three is correct precisely because the inapplicable pair is 0/NULL.
 */
function invoiceValueSql(alias: string) {
  const a = sql.raw(alias)
  return sql`(
    COALESCE(${a}.basic_amount, 0)::numeric
    + COALESCE(${a}.other_charge_amount, 0)::numeric
    + COALESCE(${a}.cgst_amount, 0)::numeric
    + COALESCE(${a}.sgst_amount, 0)::numeric
    + COALESCE(${a}.igst_amount, 0)::numeric
    + COALESCE(${a}.comp_cess_amount, 0)::numeric
  )`
}

/**
 * KIA outlet resolution. Order is load-bearing and mirrors OUTLET_SQL in lib/kia/retail-review.ts:
 * the feed changed shape on 2026-07-22, and reading `dealer_code` before `dealer_code_2` credits
 * every Udhampur retail to Jammu.
 */
const KIA_OUTLET_SQL = sql`UPPER(BTRIM(COALESCE(
  NULLIF(BTRIM(s.dealer_code_2), ''),
  NULLIF(BTRIM(s.dealer_code), ''),
  NULLIF(BTRIM(s.main_dealer_code), ''),
  ''
)))`

/**
 * KIA sales, per outlet per month.
 *
 * ⚠️ Retail is `delivery_date`, NOT `invoice_date`. invoice_date is TEXT in DD/MM/YYYY while
 * delivery_date is a real DATE; measured against the MD's own deck, delivery_date matched 12 of 14
 * outlet-months and invoice_date matched 1.
 *
 * ⚠️ Deduped on VIN — KIA reuses invoice numbers (16 numbers mapped to 32 VINs). The revenue SUM
 * rides on the SAME deduped subquery as the count, so both describe the identical set of vehicles.
 */
async function fetchKiaSales(startDate: string, endDate: string) {
  return db.execute(sql`
    WITH deduped AS (
      SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
        s.delivery_date,
        ${KIA_OUTLET_SQL} AS outlet,
        ${invoiceValueSql('s')} AS invoice_value
      FROM kia_sales_report s
      WHERE COALESCE(s.vin_number, '') <> ''
        AND s.delivery_date IS NOT NULL
        AND s.delivery_date >= ${startDate}::date
        AND s.delivery_date <= ${endDate}::date
      ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
    )
    SELECT
      EXTRACT(YEAR FROM delivery_date)::int  AS yr,
      EXTRACT(MONTH FROM delivery_date)::int AS mo,
      outlet                                  AS dealer,
      COUNT(*)::int                           AS units,
      COALESCE(SUM(invoice_value), 0)::float8 AS revenue
    FROM deduped
    GROUP BY 1, 2, 3
  `)
}

/**
 * Hyundai / Platinum sales, PER BRANCH per month.
 *
 * ⚠️ These used to be brand-level, on the belief that the feeds could not split by outlet. They can.
 * The "no outlet split" note in lib/hyundai/retail-review.ts describes `main_dealer_code` (genuinely
 * 100% N5216 for Hyundai); `dealer_code` / `source_dealer_code` carry a real per-branch split, and it
 * survives VIN dedup — Aug 2026 gave Hyundai 14/9/3/3/2 and Platinum 19/12/3, summing exactly to the
 * brand totals.
 *
 * Grouped through each brand's own dealer CASE so a branch key here matches the one the service
 * query produces, and so multi-code branches (Hyundai Jammu = N5203 + N5216) collapse correctly.
 */
async function fetchBrandSalesByDealer(
  brand: 'hyundai' | 'platinum',
  startDate: string,
  endDate: string,
) {
  const table = sql.raw(brand === 'hyundai' ? 'hyundai_sales_report' : 'am_platinum_sales_report')
  // Sales rows carry the branch on dealer_code; source_dealer_code is the fallback, matching the
  // order the brands' own sales-report readers use.
  const dealerSql = brand === 'hyundai'
    ? hyundaiSourceDealerSql(sql.raw('s.dealer_code'), [sql.raw('s.source_dealer_code')])
    : platinumSourceDealerSql(sql.raw('s.dealer_code'), [sql.raw('s.source_dealer_code')])

  return db.execute(sql`
    WITH deduped AS (
      SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
        COALESCE(s.confirm_date, s.delivery_date) AS retail_date,
        ${dealerSql} AS dealer,
        ${invoiceValueSql('s')} AS invoice_value
      FROM ${table} s
      WHERE COALESCE(s.vin_number, '') <> ''
        AND COALESCE(s.confirm_date, s.delivery_date) IS NOT NULL
        AND COALESCE(s.confirm_date, s.delivery_date) >= ${startDate}::date
        AND COALESCE(s.confirm_date, s.delivery_date) <= ${endDate}::date
      ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
    )
    SELECT
      EXTRACT(YEAR FROM retail_date)::int  AS yr,
      EXTRACT(MONTH FROM retail_date)::int AS mo,
      dealer,
      COUNT(*)::int                           AS units,
      COALESCE(SUM(invoice_value), 0)::float8 AS revenue
    FROM deduped
    GROUP BY 1, 2, 3
  `)
}

/**
 * KIA service, per dealer per month. Reuses the canonical dedup ranking from
 * lib/kia/workshop-summary.ts (bill_no -> ro_no -> id, highest absolute value wins) and the shared
 * active-bill test, so a month here equals that page's figure exactly.
 */
async function fetchKiaService(startDate: string, endDate: string) {
  return db.execute(sql`
    WITH raw AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        ${serviceCategoryExpression('work_type', 'service_type')} AS service_category,
        COALESCE(labour_amt, 0)::float8 AS labour_amt,
        COALESCE(part_amt, 0)::float8   AS part_amt,
        bill_date::date                 AS report_date,
        UPPER(BTRIM(COALESCE(dealer_code::text, ''))) AS dealer,
        uploaded_at,
        id
      FROM kia_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date <= ${endDate}::date
        AND ${activeBillStatusSql()}
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY jc_key
        ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC, uploaded_at DESC NULLS LAST, id DESC
      ) AS row_rank
      FROM raw
    )
    SELECT
      EXTRACT(YEAR FROM report_date)::int  AS yr,
      EXTRACT(MONTH FROM report_date)::int AS mo,
      dealer,
      COUNT(*)::int                                     AS ro_count,
      COALESCE(SUM(labour_amt + part_amt), 0)::float8   AS revenue,
      -- Labour only. The outer WHERE below already restricts to the four canonical categories, so a
      -- bare SUM is exhaustive here and mech + bodyshop reconciles to labour_total by construction.
      COALESCE(SUM(labour_amt), 0)::float8              AS labour_total,
      -- POSITIVE list, never a <> 'Accidental Repair' negation: it would be correct HERE (the outer
      -- WHERE constrains the categories) but wrong in fetchBrandService, and the two must read as
      -- the same rule. Backticks are banned in these comments -- they close the template literal.
      COALESCE(SUM(labour_amt) FILTER (
        WHERE service_category IN ('Free Service', 'Paid Service', 'Running Repair')
      ), 0)::float8                                     AS mech_labour,
      COALESCE(SUM(labour_amt) FILTER (
        WHERE service_category = 'Accidental Repair'
      ), 0)::float8                                     AS bodyshop_labour
    FROM ranked
    WHERE row_rank = 1
      -- ⚠️ Load-bearing, and verified against the reader: getKiaWorkshopSummary builds total.roCount
      -- as mechanical + accidental, i.e. only rows inside these four canonical categories. Without
      -- this filter our count read 374 against the reader's 297 for the same month — the 77 extra
      -- rows are uncategorised and carry no money, which is why REVENUE matched to the rupee either
      -- way and only the count betrayed the difference.
      AND service_category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY 1, 2, 3
  `)
}

/** Hyundai / Platinum service, per BRANCH per month, via each brand's own dealer CASE expression. */
async function fetchBrandService(brand: 'hyundai' | 'platinum', startDate: string, endDate: string) {
  const table = sql.raw(brand === 'hyundai' ? 'hyundai_ro_billing_report' : 'am_platinum_ro_billing_report')
  const roKey = brand === 'hyundai' ? hyundaiRoBillingRoKeySql() : platinumRoBillingRoKeySql()
  const activeBill = brand === 'hyundai' ? hyundaiActiveBillSql() : platinumActiveBillSql()
  const dealerSql = brand === 'hyundai'
    ? hyundaiSourceDealerSql(sql.raw('source_dealer_code'), [sql.raw('dealer_code')])
    : platinumSourceDealerSql(sql.raw('source_dealer_code'), [sql.raw('dealer_code')])
  const categoryExpr = brand === 'hyundai' ? hyundaiCategorySql('work_type') : platinumCategorySql('work_type')

  return db.execute(sql`
    WITH raw AS (
      SELECT
        ${roKey} AS jc_key,
        ${categoryExpr}                 AS service_category,
        COALESCE(labour_amt, 0)::float8 AS labour_amt,
        COALESCE(part_amt, 0)::float8   AS part_amt,
        bill_date::date                 AS report_date,
        ${dealerSql}                    AS dealer,
        uploaded_at,
        id
      FROM ${table}
      WHERE bill_date >= ${startDate}::date
        AND bill_date <= ${endDate}::date
        AND ${activeBill}
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY jc_key
        ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC, uploaded_at DESC NULLS LAST, id DESC
      ) AS row_rank
      FROM raw
    )
    SELECT
      EXTRACT(YEAR FROM report_date)::int  AS yr,
      EXTRACT(MONTH FROM report_date)::int AS mo,
      dealer,
      COUNT(*)::int                                   AS ro_count,
      COALESCE(SUM(labour_amt + part_amt), 0)::float8 AS revenue,
      -- ⚠️ Unlike fetchKiaService this query has NO canonical category filter in its outer WHERE,
      -- and it must NOT gain one: adding it would lower ro_count and revenue, which already ship.
      -- So every labour aggregate carries the canonical list INSIDE its own FILTER. A bare
      -- SUM(labour_amt) here would swallow 'Others' (Outreach Camp, RF Mechanical, Mid Term Check
      -- Up) and break the mech + bodyshop = total identity.
      COALESCE(SUM(labour_amt) FILTER (
        WHERE service_category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
      ), 0)::float8                                   AS labour_total,
      COALESCE(SUM(labour_amt) FILTER (
        WHERE service_category IN ('Free Service', 'Paid Service', 'Running Repair')
      ), 0)::float8                                   AS mech_labour,
      COALESCE(SUM(labour_amt) FILTER (
        WHERE service_category = 'Accidental Repair'
      ), 0)::float8                                   AS bodyshop_labour
    FROM ranked
    WHERE row_rank = 1
    GROUP BY 1, 2, 3
  `)
}

/**
 * Map a brand's SQL branch key back onto the dealer code the REGISTRY uses.
 *
 * The three brands do NOT agree on what a branch is called:
 *
 *   KIA      raw dealer_code         -> 'JK402' / 'JK501'   — already the registry code.
 *   Hyundai  hyundaiSourceDealerSql  -> 'JAMMU' / 'AKHNOOR' — already the registry code, because
 *                                       HYUNDAI_BRANCH_DEALERS.dealerCode is itself synthetic.
 *   Platinum platinumSourceDealerSql -> 'JAMMU' / 'RAJOURI' / 'POONCH', while the registry uses
 *                                       'N5211' / 'N6250' / 'N6828'.
 *
 * ⚠️ Platinum MUST go through normalizePlatinumDealerCode, not a local table. Poonch files under
 * TWO codes — N6828 and N6848 — and the changeover is visible in the live feed: N6828 ran 130, 175,
 * 184, 48, then 0 across Apr–Aug 2026 while N6848 carried on. platinumSourceDealerSql only maps
 * N6828, so N6848 falls through its `ELSE <resolved>` arm unchanged.
 *
 * A local map that did not know this dropped every N6848 row and reported Poonch as 0 for August
 * against 91 real rows. The canonical normalizer has always known (`N6848 -> N6828`, dealer-branch.ts:72);
 * the mistake was hand-rolling a second, poorer copy of it. N6848 also exists in the HYUNDAI feed as
 * a Billawar sub-code — the same string means different branches in different brands' tables, which
 * is exactly why every lookup here is keyed by (brand, code) and never by code alone.
 *
 * A key that still resolves to nothing is DROPPED, not passed through: both brands' CASE expressions
 * end in `ELSE <resolved>`, so an unrecognised code would otherwise become a phantom branch that no
 * target can ever be set against.
 */
function normaliseDealerKey(brand: TargetBrand, raw: string): string | null {
  const key = String(raw || '').trim().toUpperCase()
  if (!key) return null
  // The brand's own normalizer is the single source of truth for its aliases.
  if (brand === 'platinum') return normalizePlatinumDealerCode(key)
  // KIA and Hyundai already speak the registry's own codes.
  const known = new Set(getBrandDealers(brand).map((dealer) => dealer.code.toUpperCase()))
  return known.has(key) ? key : null
}

function upsertCell(cells: Map<string, ActualCell>, key: string): ActualCell {
  const existing = cells.get(key)
  if (existing) return existing
  const fresh = emptyCell()
  cells.set(key, fresh)
  return fresh
}

/**
 * Everything measured for one brand across one fiscal year.
 *
 * Each family is deadline-free but individually caught: a family that throws yields 'unavailable'
 * for that family only, so a broken service feed never blanks the sales column and — critically —
 * never renders as ₹0.
 */
export async function getBrandActuals(brand: TargetBrand, year: number, month: number): Promise<BrandActuals> {
  // One calendar month. The window is built here rather than passed in so every query below is
  // guaranteed to describe the same period.
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  const cells = new Map<string, ActualCell>()
  // Branch keys the feed produced that map to no registered branch — logged, never rendered.
  const unmapped = new Set<string>()

  // One shared shape so mapWithConcurrency infers a single T across both tasks.
  type Fetched = { kind: 'kia-sales' | 'brand-sales' | 'service'; result: unknown }
  type Outcome = { ok: true; value: Fetched } | { ok: false; value: null }

  const salesTask = async (): Promise<Fetched> => {
    if (brand === 'kia') return { kind: 'kia-sales', result: await fetchKiaSales(startDate, endDate) }
    return { kind: 'brand-sales', result: await fetchBrandSalesByDealer(brand, startDate, endDate) }
  }
  const serviceTask = async (): Promise<Fetched> => {
    if (brand === 'kia') return { kind: 'service', result: await fetchKiaService(startDate, endDate) }
    return { kind: 'service', result: await fetchBrandService(brand, startDate, endDate) }
  }

  // Concurrency 3 is the documented ceiling — see the header. Two tasks sit safely under it.
  // Each task swallows its OWN error so one broken feed cannot blank the other's column.
  const guard = (task: () => Promise<Fetched>) => async (): Promise<Outcome> => {
    try {
      return { ok: true, value: await task() }
    } catch (error) {
      console.error('[targets] actuals read failed for %s:', brand, error)
      return { ok: false, value: null }
    }
  }

  const [salesOutcome, serviceOutcome] = await mapWithConcurrency<Outcome>(
    [guard(salesTask), guard(serviceTask)],
    3,
  )

  let salesStatus: ActualsStatus = 'unavailable'
  if (salesOutcome?.ok && salesOutcome.value) {
    const rows = rowsOf(salesOutcome.value.result)
    salesStatus = rows.length > 0 ? 'ok' : 'no_data'
    for (const row of rows) {
      // Both kinds now group by a real branch — the '__brand__' sentinel is no longer used for sales.
      const dealer = normaliseDealerKey(brand, String(row.dealer || ''))
      if (!dealer) { unmapped.add(String(row.dealer || '')); continue }
      const cell = upsertCell(cells, actualsKey(dealer, num(row.yr), num(row.mo)))
      cell.salesUnits += num(row.units)
      cell.salesRevenue += num(row.revenue)
    }
  }

  let serviceStatus: ActualsStatus = 'unavailable'
  if (serviceOutcome?.ok && serviceOutcome.value) {
    const rows = rowsOf(serviceOutcome.value.result)
    serviceStatus = rows.length > 0 ? 'ok' : 'no_data'
    for (const row of rows) {
      const dealer = normaliseDealerKey(brand, String(row.dealer || ''))
      if (!dealer) { unmapped.add(String(row.dealer || '')); continue }
      const cell = upsertCell(cells, actualsKey(dealer, num(row.yr), num(row.mo)))
      cell.serviceRoCount += num(row.ro_count)
      cell.serviceRevenue += num(row.revenue)
      cell.mechLabour += num(row.mech_labour)
      cell.bodyshopLabour += num(row.bodyshop_labour)
      cell.labourTotal += num(row.labour_total)
    }
  }

  if (unmapped.size > 0) {
    console.warn('[targets] %s: ignored %d unmapped branch key(s): %s',
      brand, unmapped.size, Array.from(unmapped).join(', '))
  }

  return { brand, salesStatus, serviceStatus, cells }
}
