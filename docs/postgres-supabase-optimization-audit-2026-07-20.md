# PostgreSQL / Supabase Performance Optimization Audit — 2026-07-20

**Branch:** `am_hyundai_4june` · **Scope:** application-generated queries only (Drizzle ORM over `postgres-js`, raw `sql``…``, and Supabase-client `.from()/.rpc()`).
**Explicitly excluded:** Supabase-internal queries (`realtime.*`, `pg_catalog`, `information_schema`, PostgREST schema cache, timezone tables); one-off diagnostic scripts (`scripts/{diagnose,inspect,compare,probe,audit,check}-*`, everything in `scratch/`).

---

> **Update (2026-07-20, post-audit):** live request logs surfaced a concrete hot-path problem not visible from static reading — the KIA **booking-detail endpoint** running 2–7 s under per-row hover-prefetch bursts. Root-caused (pooler connection starvation) and **fixed in code** — see **§14**. Separately, two index recommendations were **withdrawn** after confirming they already exist (§6 correction).

## 0. Executive summary — read this first

**This codebase is already heavily optimized.** It has been through at least three prior performance passes (see `docs/database-performance-audit-2026-06-14.md`, `scripts/dashboard-performance-optimization.sql`, `scripts/supabase-performance-fast-follow-2026-06-26.sql`, `scripts/postgres-performance-audit-fixes*.sql`). The evidence:

- **~250 indexes** across `schema.ts` inline `index()` declarations, 13 `apply-migration-*.ts` scripts, and ~15 `scripts/*.sql` files.
- **Materialized views** for the heaviest BE aggregations, refreshed with `REFRESH MATERIALIZED VIEW CONCURRENTLY` on a scheduler (`scripts/refresh-dashboard-materialized-views.js`).
- **Redis response-caching** (`getCachedData`) + HTTP `stale-while-revalidate` on the expensive dashboard routes.
- **Correct upsert discipline** — `ON CONFLICT` at 16 sites and partial unique indexes (e.g. `kia_vehicle_allocations (vin_number) WHERE released_at IS NULL`).
- **Deliberate round-trip folding** — e.g. the KIA bookings list collapses 7 queries into 3 via scalar sub-selects; the booking detail endpoint projects exact columns to stop pulling discarded JSONB.

So there is **no systemic problem to fix.** The findings below are a short list of *specific* remaining opportunities. The single most valuable action is **§1: verify which of the manually-applied index scripts are actually live**, because the repo cannot prove that on its own.

### What the 18 requested checks turned up

| # | Requested check | Verdict |
|---|---|---|
| 1 | Find every DB query | Done — 717 `db.*` calls across 158 files, 191 API routes, ~40 lib readers, 10 prod crons. |
| 2 | Detect anti-patterns | See §2–§7. Very few genuine instances. |
| 3 | Per-query file/why/fix | §3 (findings), each with file:line + optimized version. |
| 4 | Routes making many DB calls → merge | Already folded (bookings list 7→3; BE overview 19 in one `Promise.all`). One residual: §3.4. |
| 5 | Replace `SELECT *` | §5 — a handful of multi-row list reads pull full JSONB; low impact. |
| 6 | `ORDER BY` needs index | §3.1, §3.3, §6 — 3 unindexed sorts (all low-scale today). |
| 7 | `WHERE` needs index | §6 — **no** confirmed gaps; every hot WHERE column is indexed. |
| 8 | `JOIN` → composite index | Joins are on PK/FK columns already indexed; no gaps. |
| 9 | `LIMIT/OFFSET` → keyset | §7 — OFFSET used on paginated lists; fine at current scale, keyset noted for scale. |
| 10 | Dedup cleanup (`ROW_NUMBER`+`DELETE`) → UNIQUE/UPSERT | **None in production.** App already uses UPSERT + partial unique indexes. §8. |
| 11 | Batch inserts → COPY/batch 200–500 | **No batch/loop inserts exist** — all inserts single-row. §8. |
| 12 | Materialized views → incremental/scheduled | Already `CONCURRENTLY` + scheduled; incremental noted as future. §9. |
| 13 | Cron jobs — repeated queries | §10 — sweeps are full-table but hourly + off the request path (already moved there deliberately). |
| 14 | Supabase query optimization | Covered throughout; `analyticsDb` provider abstracts Postgres/BigQuery. |
| 15 | Index review (missing/unused/dup/composite) | §6 — 6 additive indexes recommended; some duplication between scripts noted. |
| 16 | FKs / cascades overhead | §11 — FKs are plain `REFERENCES` (NO ACTION); no cascade storms. |
| 17 | `EXPLAIN ANALYZE` recommendations | §12 — target list + ready commands. |
| 18 | Final report (bottlenecks/gains/files/SQL/risk) | This document + `scripts/optimization-audit-followups-2026-07-20.sql`. |

### Top bottlenecks, ranked

| Rank | Bottleneck | Impact | Fix | Risk |
|---|---|---|---|---|
| 1 | **Index-application drift** — DDL applied manually, live state unverifiable from repo | Potentially **catastrophic** (a missing BE report index = seq scan on the hottest tables) | Run §1 verification, reconcile | None (read-only) |
| 2 | **KIA bookings list KPI mega-aggregate** recomputes bidirectional-ILIKE stock matching ~4× per request | High on that endpoint at scale (unindexable scan of `kia_stock_management`) | Precompute stock-availability in the maintenance cron (§3.1) | Medium (touches "not in stock" logic) |
| 3 | **Petty-cash approval-queue N+1** — up to ~600 round-trips | High on that endpoint | Batch to 3 queries (§3.2); lookups already indexed | Low |
| 4 | **BE overview base-CTE recomputation** ×3–4 per request | Medium (cached; analytics DB) | Grouping-sets / single-pass (§3.4) | Medium |
| 5 | **Missing indexes** (6, additive) | Low–medium, mostly scale | `scripts/optimization-audit-followups-2026-07-20.sql` (§6) | Low |

**Estimated gains:** #1 is a *correctness-of-assumption* check, not a speedup — but if it surfaces an unapplied BE index, fixing it is a 10–100× win on that report. #2 removes the dominant cost from the bookings list (hard to quantify without live `EXPLAIN`; the scanned table grows with DMS stock, currently modest). #3 turns ~600 round-trips into ~3 on the petty-cash approval queue — the clearest, safest win. #4 roughly halves the DB work of the BE overview *cache-miss* path. #5 is insurance for growth.

---

## 1. ⚠️ Highest-value action: verify applied indexes (no repo can prove this)

Index DDL in this project lives in **three** places, all applied **manually**:

1. `lib/db/schema.ts` — inline Drizzle `index()` (only live if `drizzle-kit push`/`migrate` was run).
2. `scripts/apply-migration-00NN.ts` — run individually via `tsx`.
3. `scripts/*.sql` (≈15 files) — pasted into the Supabase SQL editor by hand.

There is **no single migration ledger**, so the repo cannot tell you whether e.g. `scripts/business-excellence-relational-indexes.sql` (the `ro_billing_report` date/dealer indexes) was ever executed on production. If it wasn't, the Business Excellence dashboards are seq-scanning the largest tables in the system — which would dwarf every other finding here.

**Do this first** (read-only, in `scripts/optimization-audit-followups-2026-07-20.sql` §0):

```sql
-- What is actually applied:
SELECT tablename, indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;

-- Are the heavy BE report tables indexed on their date columns?
SELECT tablename, indexname FROM pg_indexes
 WHERE schemaname='public'
   AND tablename IN ('ro_billing_report','open_ro_yearly','kia_call_center_complaints',
                     'ew_report','mcp_report','rsa_report','psf_yearly',
                     'hyundai_ro_billing_report','am_platinum_ro_billing_report');

-- Empirical seq-scan hotspots:
SELECT relname, seq_scan, idx_scan, n_live_tup, seq_tup_read
  FROM pg_stat_user_tables WHERE schemaname='public'
 ORDER BY seq_tup_read DESC LIMIT 40;
```

Diff the first result against the repo's DDL. **Follow-up (separate task):** consolidate all index DDL into tracked Drizzle migrations so this class of drift can't recur.

---

## 2. Anti-pattern sweep — what exists across the whole codebase

Project-wide greps (excluding `scratch/` + diagnostic scripts):

- **`SELECT *` / `db.select()` full-row:** present, but almost entirely single-row reads or lists where the client consumes most columns. The one place it mattered (booking detail pulling discarded JSONB) is **already fixed** with explicit projections (`lib/kia/bookings.ts:1093-1127`). Residual: §5.
- **N+1 (`.map(async … db)`):** exactly **one** genuine DB N+1 — `lib/petty-cash/server.ts:346`. The other two `.map(async)` hits are a bounded 3-brand parallel probe (`lib/cockpit/cockpit-data.ts:140`) and a client-side HTTP fan-out (`kia-bookings-client.tsx:1729`), neither a DB N+1.
- **Query-in-`for`-loop:** none. Every `for (const … of …)` in `lib/` iterates **already-fetched result rows** in memory (aggregation), not the DB.
- **`OFFSET` pagination:** used on the paginated lists (petty-cash, bookings, POs). Fine at current scale; keyset noted §7.
- **`COUNT(*)`:** the standard "separate count + page" pagination pattern. Legitimate; noted §7.
- **`ROW_NUMBER`:** all production uses are read-time dedup of analytics tables or materialized-view definitions — **not** dedup-cleanup-with-DELETE. §8.
- **Batch inserts:** none — no `.values([…])` array inserts, no insert-in-loop. §8.

---

## 3. Detailed findings (with fixes)

### 3.1 KIA bookings list — KPI mega-aggregate recomputes unindexable stock matching — `efficiency` · **High (at scale)** · **Risk: Medium**

- **File:** `lib/kia/bookings.ts:687-811` (the `aggRows` sub-select block), reused shapes at `:548-611` (list filters), `:855-875` (per-page flag query), `:1464-1553` (`getKiaBookingMatchingVehicles`).
- **Query (shape):** a single `db.execute` computes `status_counts`, dealer/model/consultant option lists, `today_count`, `model_counts`, `active_allocations`, `no_payment_count`, **`not_in_stock_count`, `in_stock_count`, and `not_in_stock_breakdown`** — the last three each embed the same correlated subquery against `kia_stock_management ⨝ kia_stock_local_statuses` with **bidirectional ILIKE** matching:
  ```sql
  AND (sm.model ILIKE '%'||kb.model||'%' OR kb.model ILIKE '%'||sm.model||'%')
  AND (coalesce(sm.variant,'')='' OR sm.variant ILIKE '%'||kb.variant||'%' OR kb.variant ILIKE '%'||sm.variant||'%')
  AND NOT EXISTS (SELECT 1 FROM kia_vehicle_allocations aa WHERE aa.vin_number=sm.vin_number AND aa.released_at IS NULL)
  ```
- **Why slow:** `col ILIKE '%'||param||'%'` is not indexable by btree; the **bidirectional** form (`param ILIKE '%'||col||'%'`) defeats even a `pg_trgm` GIN index. This scan of the whole stock feed runs **~4× inside the one aggregate query**, plus once more per page load (`:855` `flagCandidates`), plus again in the matching-vehicles endpoint. Folding into one round-trip (already done) does not reduce the *work* — it's the same scan repeated.
- **Optimized version:** move "is this booking's vehicle in stock" **out of the read path** into the existing hourly maintenance job (`POST /api/brands/kia/maintenance`). Compute per-booking availability once per cron tick and persist it — either a boolean column on `kia_bookings` (mirroring the existing `metadata.vehicleNotInStock` flag already set by `markKiaSoldAllocations`) or a tiny `kia_booking_stock_flags(booking_id, in_stock, computed_at)` table. The list then reads a boolean instead of re-deriving it. The DMS feed refreshes ~daily, so hourly precomputation is far finer-grained than the data.
- **Index need:** none that helps (the predicate is unindexable); this is a *precompute/caching* fix, not an index fix.
- **Risk: Medium** — changes how the "Not in stock / In stock" KPI and per-row badge are sourced; must keep parity with the current live computation (there is already an established definition in `listFilters`). Ship behind verification against current counts.

### 3.2 Petty-cash approval queue — N+1 (up to ~600 round-trips) — `n+1` · **High** · **Risk: Low**

- **File:** `lib/petty-cash/server.ts:345-368` (`getPettyCashApprovalQueue`), same shape in `getPettyCashRequestDetails:1138-1142`.
- **Query:** after fetching up to 200 requests, for **each** row:
  ```ts
  const [history, allocation] = await Promise.all([
    db.select().from(pettyCashApprovalHistory).where(eq(...requestId, row.id))...,
    db.select().from(pettyCashAllocations).where(eq(...requestId, row.id)).limit(1)...,
  ])
  const userMap = await getUserMap(history.map(h => h.performedBy).concat([row.createdBy]))
  ```
  → 200 × (2 parallel + 1 user query) ≈ **400–600 statements**, throttled through a 6-connection pool.
- **Why slow:** classic per-row fan-out — ~600 round-trips through a 4–6 connection pool. The lookups themselves are indexed; the cost is the round-trip *count*, not scans.
- **Optimized version:** three set-based queries, grouped in JS:
  ```ts
  const ids = rows.map(r => r.id)
  const [histories, allocs] = await Promise.all([
    db.select().from(pettyCashApprovalHistory)
      .where(inArray(pettyCashApprovalHistory.requestId, ids))
      .orderBy(asc(pettyCashApprovalHistory.createdAt)),
    db.select().from(pettyCashAllocations)
      .where(inArray(pettyCashAllocations.requestId, ids)),
  ])
  const userIds = [...histories.map(h => h.performedBy), ...rows.map(r => r.createdBy)]
  const userMap = await getUserMap(userIds)          // getUserMap already batches (inArray)
  // group histories/allocs by requestId in Maps, then assemble
  ```
  → **3 statements** total, regardless of row count. `getUserMap` (`:212`) is already the correct batched primitive — it's just being called inside the loop instead of once.
- **Index need:** none — `petty_cash_allocations(request_id)` **already exists** as a unique index (`petty_cash_allocations_request_idx`), and so does `petty_cash_approval_history(request_id, created_at)`. This is a pure round-trip-count fix, no DDL.
- **Risk: Low** — pure read refactor, identical output; the index is additive.

### 3.3 KIA finance processing detail — sequential reads + `SELECT *` — `efficiency` · **Low** · **Risk: Low**

- **File:** `lib/finance/finance-processing.ts:233-249` (`getKiaFinanceProcessingDetail`).
- **Query:** `processing` (by `proformaId`) → then `proforma` (by `proformaId`) → then `booking` → then `Promise.all([remarks, bankAttempts, activity])`. The first two are sequential but independent (both keyed by `proformaId`, known up front); all use `db.select()` full-row (`kia_proformas` = 48 columns).
- **Optimized version:** run `processing` + `proforma` in the same `Promise.all` (they don't depend on each other); project the columns the detail view actually serializes. Saves ~1 round-trip and the JSONB deserialization of unused proforma columns.
- **Index need:** none (both are single-row PK/unique lookups).
- **Risk: Low.** Small win; list ordering indexes are in §6 (A3/A4).

### 3.4 BE overview — same dedup base-CTE recomputed 3–4× per request — `efficiency` · **Medium** · **Risk: Medium**

- **File:** `app/api/brands/kia/business-excellence/overview/route.ts:558-769` (Hyundai/Platinum clones: `app/api/brands/{hyundai,platinum}/business-excellence/overview/route.ts`).
- **Query:** `roBillingBaseSql` (a `ROW_NUMBER`-dedup CTE over `ro_billing_report` for the window) is inlined into **three** separate statements (`roDailyRows`, `roMixRows`, `advisorRows`) in the `Promise.all`; `openRoBaseSql` into ~4; `complaintsBaseSql` into ~3. Postgres does not share a CTE across separate statements, so each re-scans + re-dedups the same window.
- **Why slow:** the expensive part (windowed dedup over the report window) is paid 3–4× concurrently instead of once. Mitigated by: Redis response cache + HTTP SWR (so only cache-miss pays it), `analyticsDb` indexing, chunked payload (`summary`/`secondary`/`full`), and the `workshop_performance_jc_summary_v1` materialized fast-path (`shouldUseWorkshopJcSummary`).
- **Optimized version (cache-miss path only):** compute each base once and derive the multiple aggregations in a single statement using `GROUP BY GROUPING SETS`/`FILTER`, or materialize the deduped base into a `TEMP TABLE`/CTE-once-then-multiple-`GROUP BY` within one statement. Given the caching already in place, treat this as a second-tier optimization.
- **Index need:** none new (depends on the `ro_billing_report`/`open_ro_yearly` date indexes — **verify per §1**).
- **Risk: Medium** — these routes are numerically sensitive (BE parity is verified against source to the rupee via `verify:*-be-parity`); any rewrite must pass those parity scripts unchanged.

---

## 4. Merging multiple DB calls per route

Most opportunities here are **already taken**:
- **Bookings list** — 7 queries folded to 3 (`lib/kia/bookings.ts:675-812`), explicitly documented in-code.
- **Bookings detail** — 5 parallel projected reads (`:1101-1127`); the sweeps that used to run on this read were moved to cron.
- **BE overview** — 19 statements in one `Promise.all` (`:582-769`).
- **Cockpit** — coverage probe, then 6 heavy readers fanned out in one `Promise.all` (`lib/cockpit/cockpit-data.ts:204-213`), all `.catch(()=>null)` + cached.

Remaining: §3.2 (petty-cash queue, the one true N+1) and §3.4 (BE base-CTE). Note the codebase's own rule (from `docs/` and in-code comments): **`Promise.all` inside a `db.transaction` does not pipeline** on the Supabase pooler, and reads should be hoisted out of transactions — already largely observed. One minor residual: `createKiaBooking` (`lib/kia/bookings.ts:1043-1064`) does the assignee `users` lookup *inside* the create transaction; it depends only on `appUser.email`/`appUser.id` (known before the tx), so it can be hoisted out to shorten the transaction. Low impact (create is not hot), Low risk.

---

## 5. `SELECT *` → projections

Genuine multi-row reads that pull full rows (incl. JSONB) where projection would help:
- `lib/kia/bookings.ts:683` — list page `db.select().from(kiaBookings)` pulls `metadata` JSONB for every page row. (The detail endpoint already projects; the list still doesn't.)
- `lib/petty-cash/server.ts:266, 335` — `listPettyCashRequests` / approval queue pull full `requestForm`/`supportingFiles` JSONB.
- `lib/finance/finance-processing.ts:234-248` — detail full-row reads (48-col proforma).

**Impact: Low–Medium.** These return to UIs that use most fields; the measurable cost is JSONB deserialization (Vercel Fluid bills Active CPU, per the in-repo note at `bookings.ts:1099`). Worth projecting only the list reads that pull large JSONB and don't display it. **Risk: Low**, but touches response shapes — verify the client doesn't rely on the dropped fields.

---

## 6. Index review — missing / duplicate / composite

> **Correction (2026-07-20):** an earlier grep matched `index(` but not `uniqueIndex(`, so two indexes were wrongly reported "missing" and have been **withdrawn**: `petty_cash_allocations(request_id)` already exists as `uniqueIndex('petty_cash_allocations_request_idx')`, and `finance_orders.order_number` is `.unique()`. The table below is the corrected, additive-only set (all **scale-oriented, low priority**).

**Genuinely absent (additive, in `scripts/optimization-audit-followups-2026-07-20.sql`):**

| Index | Table(cols) | Serves | Priority |
|---|---|---|---|
| `kia_bookings_active_updated_idx` | `kia_bookings(updated_at DESC) WHERE deleted_at IS NULL` | default list sort | Med (scale) |
| `kia_bookings_active_created_idx` | `kia_bookings(created_at DESC) WHERE deleted_at IS NULL` | asc sort / today filter | Med (scale) |
| `kia_finance_processing_updated_idx` | `kia_finance_processing(updated_at DESC)` | processing list sort | Low (scale) |
| `kia_proformas_approval_date_idx` | `kia_proformas(approval_status, proforma_date DESC) WHERE deleted_at IS NULL` | finance approval queue | Low |

**Well-covered (no action):** `users` (partial `role,is_active,brand`; `last_seen_at`; unique `supabase_id`), **all `petty_cash_*`** (incl. `petty_cash_allocations.request_id`), `kia_bookings` (dealer/status/created, consultant, allocated_vin, proforma, finance_order), `kia_vehicle_allocations` (incl. partial uniques), `kia_proformas`/`mg_proformas`, `finance_sheet` (incl. GIN trigram search), `kia_lead_followups`, `kia_call_logs`, `delegation_tasks`, `purchase_orders`, `workflow_history`, warranty tables, and the BE report tables **(subject to §1 verification)**.

**Duplicate / redundant to clean up (low priority):** several BE report indexes are defined **twice** under different names — e.g. `ro_billing_report(bill_date)` exists as both `idx_ro_billing_report_bill_date` (`dashboard-performance-optimization.sql`) and `ro_billing_report_bill_date_idx` (`business-excellence-relational-indexes.sql`); similar pairs for `bill_date_work_type`, `bill_date_service_type`, `ro_no`, `bill_no`, `vin`, `uploaded_at`. Duplicate indexes cost write throughput and storage for no read benefit. After §1, `DROP INDEX CONCURRENTLY` the redundant twin of each pair (keep one naming convention).

**Unused indexes:** cannot be determined from the repo — check `pg_stat_user_indexes.idx_scan = 0` on the live DB after a representative period, then drop with care.

---

## 7. LIMIT/OFFSET → keyset pagination

OFFSET pagination is used on: `listPettyCashRequests`/`listPettyCashExpenses` (`lib/petty-cash/server.ts:266,466`), `getKiaBookingsList` (`lib/kia/bookings.ts:686`), purchase orders, admin lists. Each also runs a separate `COUNT(*)` for the total.

**Assessment:** fine today (tables are small; page sizes 12–50). OFFSET degrades only at deep offsets on large tables, which these aren't yet. **Recommendation:** leave as-is; adopt keyset (`WHERE (created_at, id) < (:cursor)` ORDER BY matching an index) **only if** a table crosses ~10⁵ rows *and* users page deep. The `COUNT(*)` is standard; if it ever shows up hot, switch to an estimated count (`pg_class.reltuples`) for unfiltered views. No change shipped.

---

## 8. Dedup cleanup & batch inserts — already correct

- **Dedup:** there are **no** production `ROW_NUMBER … DELETE` cleanup jobs. Every `ROW_NUMBER` is read-time dedup in analytics/BE or inside a materialized-view definition. Data integrity is enforced the right way — **partial unique indexes** (`kia_vehicle_allocations (vin_number)`/`(booking_id) WHERE released_at IS NULL`, `kia_finance_payouts (booking_id) WHERE booking_id IS NOT NULL`, `kia_stock_local_statuses (vin_number)`) plus **`ON CONFLICT` upserts** at 16 sites. This is exactly what task 10 recommends; nothing to change.
- **Batch inserts:** none exist — all inserts are single-row `.values({...})`. No 100s-of-rows statements, no insert-in-loop. Task 11 has no target. (If bulk import paths are added later, batch 200–500 rows/statement or use `COPY`.)

---

## 9. Materialized views

Already mature: `ro_billing_daily_summary(_v2)`, `workshop_performance_*_summary_*`, `workshop_operation_addon_summary_v1`, and the `am_platinum_*` family, all with a `UNIQUE` index enabling `REFRESH … CONCURRENTLY`, driven by `scripts/refresh-dashboard-materialized-views.js` (scheduler). A redundant full-history `am_platinum_ro_billing_daily_summary_v1` was already retired. **Future (optional):** the daily-grain summaries are candidates for *incremental* refresh (only recompute the last N days on each tick) instead of full `CONCURRENTLY` rebuilds — worthwhile only once refresh duration becomes a problem; today the concurrent refresh is non-blocking. No change shipped.

---

## 10. Cron jobs

Production crons (from `package.json`): `kia:maintenance`, `kia:followup-reminders`, `delegation:reminders`, `users:deactivate-idle`, `db:detect-kia-sold`, `db:refresh-dashboard-views`, `db:enforce-retention`, `db:backup`, `bq:sync`, `service-dashboard-email`.

- The **KIA maintenance sweeps** (`expireKiaTemporaryAllocations`, `startKiaArrivedAllocationCountdowns`, `markKiaSoldAllocations`, `markKiaTransferMissing`, `expireKiaStockHolds` — `lib/kia/bookings.ts:235-515,1862`) run full-table `UPDATE … WHERE EXISTS (… kia_stock_management … upper(trim(vin_number)) …)`. These were **deliberately moved off the request path** to this hourly job (documented at `:517-522`), which is the right call. Optional functional indexes for the VIN match are in the follow-up script §B (low priority — hourly, and freshness-gated so they no-op on an empty feed).
- Reminder/deactivation crons are set-based single statements — fine.
- `db:refresh-dashboard-views` — see §9.

No cron issues its queries in a per-row loop. No change required.

---

## 11. Foreign keys / cascades

FKs are overwhelmingly plain `REFERENCES` (NO ACTION), and application deletes are soft (`deleted_at`), so there is no cascade-write amplification on the hot paths. The one `ON DELETE CASCADE` is `kia_user_profiles.auth_user_id → users(id)` — it only fires when a user row is hard-deleted (rare, admin-only) and removes that user's single profile row, so it is harmless. FK columns used in joins/filters are indexed where hot (activity tables `(…_id, created_at)`, all `petty_cash_*`). No change required.

---

## 12. EXPLAIN ANALYZE targets

Run these on the live DB (session-mode connection) to quantify before/after. Substitute a realistic date window / id.

```sql
-- (a) Bookings list KPI aggregate — the §3.1 hotspot (expect the stock-match subqueries to dominate)
EXPLAIN (ANALYZE, BUFFERS) /* paste the aggRows SELECT from lib/kia/bookings.ts:687-811 */ ;

-- (b) Petty-cash allocation lookup — confirm it ALREADY uses its unique index (should be Index Scan)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM petty_cash_allocations WHERE request_id = '<uuid>';

-- (c) BE overview base — the deduped ro_billing_report window (§3.4); confirm it uses a bill_date index
EXPLAIN (ANALYZE, BUFFERS)
WITH raw AS (SELECT bill_date, bill_no, ro_no, id FROM ro_billing_report
             WHERE bill_date >= '2026-07-01' AND bill_date < '2026-08-01')
SELECT count(*) FROM raw;

-- (d) Bookings default list page — before/after kia_bookings_active_updated_idx (§6)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM kia_bookings WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 15;

-- (e) Finance approval queue — before/after kia_proformas_approval_date_idx (§6)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM kia_proformas WHERE approval_status='MANAGER_APPROVED' AND deleted_at IS NULL
ORDER BY proforma_date DESC LIMIT 200;
```

---

## 13. Files to modify (summary)

| File | Change | Section | Risk |
|---|---|---|---|
| *(live DB)* | Verify applied indexes; reconcile drift | §1 | None |
| `scripts/optimization-audit-followups-2026-07-20.sql` | Apply 6 additive indexes | §6 | Low |
| `lib/petty-cash/server.ts:345-368` | Batch the approval-queue N+1 → 3 queries | §3.2 | Low |
| `lib/kia/bookings.ts` (maintenance cron + list) | Precompute stock-availability off the read path | §3.1 | Medium |
| `app/api/brands/*/business-excellence/overview/route.ts` | Single-pass / grouping-sets for base CTEs | §3.4 | Medium |
| `lib/finance/finance-processing.ts:233-249` | Parallelize + project detail reads | §3.3 | Low |
| `lib/kia/bookings.ts:1043-1064` | Hoist assignee lookup out of the create tx | §4 | Low |
| *(later)* Consolidate index DDL into tracked migrations; drop duplicate BE indexes | §1, §6 | Low |

---

## 14. Implemented fix — KIA booking-detail latency under prefetch bursts (2026-07-20)

**Symptom (live logs):** `/brands/kia/proforma/bookings` embeds the full bookings CRM (`KiaBookingsClient embedMode`), which hover-prefetches `/api/brands/kia/bookings/[id]` per row. Each detail call logged `detail=3.4–6.6 s` and `profile=300–850 ms`, several firing in a burst ("api again and again").

**Root cause — connection starvation, not query cost.** `getKiaBookingDetail` fanned out **7 statements** (1 booking + a 6-way `Promise.all`: allocation, activity, transfers, proforma, finance-order, follow-up notes), and the route added a per-request `ensureKiaUserProfile` lookup. The pool is `DATABASE_POOL_MAX = 4` (dev) / `6` (prod). A burst of ~8 prefetches × 7 statements ≈ 56 queries contending for 4–6 connections at ~225 ms pooler RTT each → every call balloons to seconds. Amplified in dev (small pool, cold cache, Turbopack compile overhead visible as the `next.js: …ms` figures).

**Changes (behaviour-preserving):**
1. [lib/kia/bookings.ts](../lib/kia/bookings.ts) `getKiaBookingDetail`: folded the booking + its three 1:1 relations (active allocation, proforma header, finance-order header) into **one LEFT-JOIN** query; the three multi-row lists (activity, transfers, follow-up notes) stay a parallel batch. **7 statements → 4.** Payload is identical — the allocation is still the full row (or `null` via an `id` guard that covers both Drizzle left-join null shapes); proforma/finance are the same projected objects; activity/transfers/follow-up merge unchanged.
2. [app/api/brands/kia/bookings/[id]/route.ts](../app/api/brands/kia/bookings/[id]/route.ts) + [lib/kia-proforma/server.ts](../lib/kia-proforma/server.ts): the `profile` phase now uses a new **read-only, 60 s-cached** `getCachedKiaUserProfile(email)` instead of `ensureKiaUserProfile` (which did a create-on-GET). A prefetch burst from one user hits the DB **once** for the profile instead of per call, and a GET no longer writes. Cache is invalidated on profile create and on `touchKiaUserProfile`.

**Net:** per detail request drops from ~8 statements (auth + profile + 7) to ~4–5, and the profile phase to ~0 after the first call in a burst — roughly halving the connection demand that was the burst-latency multiplier. **Verified:** `tsc --noEmit` clean (0 errors); Turbopack compiles the routes (unauthed hit → 401, no 500); no dev-log errors. Authenticated before/after timing is visible directly in the dev terminal on the next reload of the proforma→bookings page.

**Follow-ups §3.1 and §3.2 are now also implemented — see §15.**

---

## 15. Implemented follow-ups — petty-cash N+1 + bookings-list ILIKE (2026-07-20)

**§3.2 — petty-cash approval-queue N+1 → batched.** [lib/petty-cash/server.ts](../lib/petty-cash/server.ts) `getPettyCashApprovalQueue`: the per-row fan-out (up to 200 rows × [history + allocation + a `getUserMap` call] ≈ **~600 statements**) is replaced by **4 statements** — one `inArray` query each for all histories and all allocations across the page, plus one batched `getUserMap`, grouped in JS by `request_id`. Output is identical: per-request history stays in `created_at ASC` order (the global result is ASC, preserved by push order), and `petty_cash_allocations` has a UNIQUE index on `request_id` so there is exactly ≤1 allocation per request. Empty-page guard added. No DDL (the lookups were already indexed).

**§3.1 — bookings-list ILIKE aggregate, one scan removed (safe subset).** [lib/kia/bookings.ts](../lib/kia/bookings.ts) `getKiaBookingsList`: `in_stock_count` re-ran the entire bidirectional-ILIKE stock-match scan a **second** time purely to compute the complement of `not_in_stock_count`. Since the not-in-stock predicate is a total boolean per booking, `in_stock` is the exact complement within the in-flight set — it is now derived as `eligible_count − not_in_stock_count` (a cheap indexed count replaces the second heavy scan). **Zero semantic change**, one of the ~three heavy scans eliminated. The fuller single-CTE consolidation (compute the predicate once for count **and** breakdown) and the cron-precompute remain available but need live-data parity verification before shipping — deliberately NOT done blind.

**Verified (both):** `tsc --noEmit` clean (0 errors); fresh Turbopack build serves the routes (`/api/petty-cash/approvals` → 403, `/api/brands/kia/bookings` → 401 — auth gate, no 500). Authenticated correctness (petty-cash queue contents; the unchanged "In Stock" KPI) is confirmable by loading the pages — the numbers must match exactly, since both changes are output-preserving.

---

## Appendix — audit method & coverage

Performed by **direct source reading** (the strongest fidelity for exact file:line + query citations). Region-parallel subagents were attempted first but the background-agent infrastructure failed repeatedly (stream watchdog), so the audit proceeded by reading the hotspots in full and reconciling the remainder against a complete index inventory.

- **Read in full:** `lib/kia/bookings.ts` (2361 lines), `lib/finance/finance-processing.ts`, `lib/petty-cash/server.ts`, `app/api/brands/kia/business-excellence/overview/route.ts`, `lib/cockpit/cockpit-data.ts`, plus `schema.ts` index/table definitions and the key `scripts/*.sql` perf files.
- **Reconciled (not line-by-line read):** the ~180 remaining API routes and lib readers — via project-wide greps for every anti-pattern (`SELECT *`, `.offset`, `COUNT`, `ROW_NUMBER`, `ILIKE`, `.map(async)`, `for`-loops, `.values([`, `onConflict`) and cross-checking their WHERE/ORDER/JOIN columns against the full index inventory. Hyundai/Platinum/MG BE and proforma routes are near-clones of the KIA versions audited here.
- **Not exercised:** live `EXPLAIN ANALYZE` / `pg_stat_*` (no production DB connection was made — see §1/§12 for the exact commands to run).

If you want, I can (a) implement §3.2 (the safe N+1 fix) now, (b) drive §1's verification once you provide a read-only DB connection, or (c) deep-read any specific region (admin, warranty, MG, purchase-orders) line-by-line.
