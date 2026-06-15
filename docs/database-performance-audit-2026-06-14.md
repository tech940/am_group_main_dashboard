# Database Performance Audit - 2026-06-14

## Scope

This audit inspected the existing Supabase/PostgreSQL implementation first:

- `pg_stat_statements`
- `pg_stat_user_tables`
- table and index sizes
- live `EXPLAIN (ANALYZE, BUFFERS)`
- hypothetical indexes through `hypopg`
- Platinum, Hyundai warranty, API, cache, frontend, and refresh code

No additional database, warehouse, or cache service is recommended. The measured
workload is well within PostgreSQL's range; the main problems are repeated raw
scans, expression/index mismatches, import behavior, and excessive query fan-out.

## Highest Impact Findings

### 1. Platinum coverage scans the raw billing fact table

Evidence:

- `am_platinum_ro_billing_report`: about 68,390 rows and 139 MB including indexes.
- The coverage statement averaged 1,859 ms over 21 calls in
  `pg_stat_statements`.
- A live plan took 2,417 ms, performed a parallel sequential scan, and read
  8,431 shared blocks.
- The equivalent canonical-summary plan took 92 ms cold and read 65 blocks.
- The same summary plan took 10.1 ms warm and used the existing
  `(dealer_code, bill_date)` unique index.
- Summary/fact reconciliation matched exactly for June 1-12, 2026:
  Jammu 335 invoices, Rajouri 173, Poonch 63.

Root cause:

The normalized dealer `CASE` expression and cancelled-bill predicate prevented
the existing raw-table indexes from being useful. The endpoint also repeated
aggregation already present in `am_platinum_ro_billing_daily_summary_v2`.

Fix implemented:

`fetchPlatinumRoBillingCoverage`, Open RO coverage, and complaint coverage now
read their canonical materialized summaries.

Expected impact:

- Roughly 13x-26x faster cold RO coverage.
- Fewer raw-table reads during Overview, RO Billing, Open RO, and Complaints.
- Coverage counts now use canonical deduplicated records instead of imported
  physical rows.

### 2. Operation/VAS period lookup filters thousands of rows after index access

Evidence:

- 2,125 calls, 30.3 ms mean, 64.3 seconds cumulative.
- Live plan used only the `report_type` index and removed 3,660 rows after
  filtering dealer and period.
- Live execution was 27.9 ms for a representative Jammu period.
- `hypopg` changed the plan to a composite expression index and reduced planner
  cost from 1,376 to 8.

Root cause:

The query filters `UPPER(TRIM(source_dealer_code))`, `report_type`, start date,
and effective end date, but only separate plain-column indexes exist.

Smallest fix:

Apply `am_platinum_operation_period_lookup_idx` from
`scripts/postgres-performance-audit-fixes.sql`.

### 3. Import jobs repeatedly read and rewrite complete historical tables

Evidence from `pg_stat_statements`:

- Full Platinum billing export through `to_jsonb(table) ORDER BY id`:
  9 calls, 21.2 seconds mean, 190.8 seconds cumulative, 639,757 rows returned.
- Full Platinum VAS export: 9 calls, 15.7 seconds mean.
- Full operation export: 9 calls, 9.2 seconds mean.
- Full service-appointment export: 9 calls, 2.4 seconds mean.
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS source_dealer_code` ran 713 times
  against Open RO and averaged 1.13 seconds.

Root cause:

The external import/synchronization process appears to inspect all historical
rows, recompute hashes, and rerun schema DDL on recurring imports.

Smallest fix:

1. Move schema DDL to a one-time migration.
2. Track a source watermark such as modified time/import batch.
3. Fetch and hash only changed source rows.
4. Upsert changed batches by `row_hash`; do not serialize the full destination
   table before every import.
5. Refresh summaries once after a successful import batch.

This importer is not present in this repository, so its code was not changed
here.

### 4. Dashboard summary APIs still fan out into many SQL statements

Evidence:

- Platinum Open RO launches 10 parallel operations.
- Platinum SOT launches 10 parallel operations.
- Platinum Complaints launches roughly 12 operations depending on chunk.
- Overview uses a limiter, but still builds many independent aggregate tasks.
- The PostgreSQL client pool is capped at 10 connections.

Root cause:

Each chart/KPI was implemented as an independent query over the same filtered
source. Concurrent requests can consume the entire pool and queue unrelated
work.

Smallest next change:

- Consolidate KPIs and chart groups with `FILTER`, `GROUPING SETS`, or JSON
  aggregates over one materialized base query.
- Keep details in a separate paginated request.
- Cap route-local concurrency at 3-4, below the pool size.

Target: no summary route should execute more than five SQL statements.

### 5. Hyundai warranty fetches all rows before filtering and pagination

Evidence:

- `hyundai_warranty_claim_list` has about 13,217 rows.
- The API selects every source row, creates every record key, fetches actions
  for the complete key list, then searches, filters, sorts, and paginates in
  Node.js.
- The historical statement averaged 52.9 ms when it returned only about 609
  rows per call; current table size is materially larger.

Root cause:

Pagination is applied after full-table transfer. Matrix/chart needs were coupled
to row delivery.

Smallest next change:

- Push dealer, date, status, claim type, search, sort, limit, and offset into SQL.
- Fetch actions only for the page keys.
- Run one separate grouped aggregate query for KPIs/matrix/charts.
- Add composite indexes based on the final SQL filter order, not before.

### 6. Duplicate indexes add write and storage cost

Evidence:

Many imported tables have both a constraint-backed unique `row_hash` index and
an identical manually-created unique index. This includes Platinum billing,
Open RO, operation analysis, service appointment, complaints, and Hyundai
warranty.

Root cause:

Import/schema automation created a second index after the unique constraint had
already created one.

Fix provided:

The SQL migration drops only the redundant manually named copies and retains
the constraint-backed indexes.

Expected impact:

Lower insert/update cost and less index maintenance. This is a capacity cleanup,
not the primary request-latency fix.

### 7. Frontend caching retains filter variants indefinitely

Evidence:

- React Query used `gcTime: Infinity`.
- A second global fetch cache stored every unique API URL.
- Expired entries were removed only if that exact URL was requested again.

Root cause:

Date, dealer, pagination, and filter combinations continuously create new cache
keys.

Fix implemented:

- React Query garbage collection is now 30 minutes.
- Expired global fetch-cache entries are pruned during API access.

The existing 15-minute freshness behavior remains unchanged.

### 8. Complaints performs an immediate second summary request

Evidence:

The complaints screen requests `chunk=summary`, then immediately requests
`chunk=secondary` before the user opens secondary analysis.

Smallest next change:

Move the secondary request behind chart visibility, viewport intersection, or
explicit user intent, matching the Overview behavior.

## Refresh Jobs

The fallback scheduler refreshes full historical materialized views eight times
per business day. The measured generic materialized-view refreshes take roughly
0.9-1.15 seconds each; the Platinum fact materialization has taken about four
seconds.

Do not reduce the fallback schedule until the external importer is verified to
refresh summaries after every successful import. After that verification:

- refresh once per completed import;
- keep one morning and one evening fallback;
- consider incremental daily summary upserts if source history becomes much
  larger.

## Verification Completed

- Live database statistics and sizes collected.
- `pg_stat_statements` inspected.
- Live `EXPLAIN ANALYZE` collected for raw coverage and operation lookup.
- `hypopg` validated the operation-period index.
- Canonical summary counts reconciled to the materialized fact for all Platinum
  dealers.
- Targeted ESLint passed.
- TypeScript `--noEmit` passed.
- Next.js 16.2.6 production build passed.

## Deployment Order

1. Deploy the coverage and frontend cache code changes.
2. Run `scripts/postgres-performance-audit-fixes.sql` outside a transaction.
3. Monitor `pg_stat_statements` for one business day.
4. Refactor Open RO/SOT/Complaints query fan-out.
5. Refactor Hyundai warranty to SQL pagination and grouped aggregates.
6. Fix the external importer before changing the refresh fallback schedule.
