# BigQuery Migration — Deployment Runbook

## Prerequisites

- GCP project with BigQuery API enabled
- Service account: `bigquery.dataEditor`, `bigquery.jobUser`
- Env vars on Next.js deployment:
  - `GOOGLE_CLOUD_PROJECT`
  - `BIGQUERY_LOCATION` (default `asia-south1`)
  - `ANALYTICS_READ_SOURCE` (`postgres` | `dual` | `bigquery`)

## Step 1 — Inventory (read-only)

```bash
node scripts/inventory-supabase-storage.js
```

Output: `docs/bigquery-migration-inventory-YYYY-MM-DD.md`

## Step 2 — Create BigQuery schema

**Option A — Node (no `bq` CLI required):**

```bash
npm run bq:apply-ddl
```

**Option B — `bq` CLI:**

```bash
export PROJECT_ID=your-gcp-project
sed "s/\${PROJECT_ID}/$PROJECT_ID/g" scripts/bigquery/ddl/000_datasets.sql | bq query --use_legacy_sql=false
sed "s/\${PROJECT_ID}/$PROJECT_ID/g" scripts/bigquery/ddl/001_platinum_facts.sql | bq query --use_legacy_sql=false
sed "s/\${PROJECT_ID}/$PROJECT_ID/g" scripts/bigquery/ddl/002_kia_facts.sql | bq query --use_legacy_sql=false
sed "s/\${PROJECT_ID}/$PROJECT_ID/g" scripts/bigquery/ddl/003_hyundai_facts.sql | bq query --use_legacy_sql=false
sed "s/\${PROJECT_ID}/$PROJECT_ID/g" scripts/bigquery/ddl/010_aggregates.sql | bq query --use_legacy_sql=false
```

Sync/parity scripts use **session mode** (port `5432`) automatically when `DATABASE_URL` points at the transaction pooler (`6543`). If connections still time out, set `DATABASE_DIRECT_URL` from Supabase → Settings → Database → **Session pooler** URI.

## Step 3 — Backfill from Supabase

```bash
node scripts/bigquery/sync-incremental.js --full
node scripts/bigquery/validate-parity.js
```

## Step 4 — Enable dual-write on external import cron

See [`docs/bigquery-dual-write-contract.md`](bigquery-dual-write-contract.md).

## Step 5 — Deploy application with query layer

```bash
npm install
npm run validate
```

Deploy with `ANALYTICS_READ_SOURCE=postgres` (default).

## Step 6 — Staging dual validation

```bash
ANALYTICS_READ_SOURCE=dual npm run dev
node scripts/verify-platinum-be-api.js
node scripts/bigquery/validate-parity.js
```

Monitor logs for `[analytics:dual] mismatch`.

## Data safety rules

- **Do not drop** any Supabase analytics table until BigQuery backfill is complete **and** `bq:validate-parity` + `verify-history-range` pass for all critical tables
- Postgres remains source of truth while `ANALYTICS_READ_SOURCE=postgres` (default)
- Postgres MV refresh scheduler stays enabled until 30-day stable BQ period ends
- Archival `pg_dump` before any future DROP (separate change request)

## Step 7 — Production cutover

1. Set `ANALYTICS_READ_SOURCE=bigquery` on production
2. Bump Redis cache key versions in API routes if needed
3. Run scheduled BQ aggregate refreshes after each import
4. Keep Postgres MV refresh as fallback for 30 days
5. **Keep all Supabase analytics tables** — do not drop during cutover

## Step 8 — Decommission Supabase analytics (only after 30-day stable BQ + full parity)

Prerequisites: billing enabled, `node scripts/bigquery/verify-history-range.js` passes, `npm run bq:validate-parity` passes.

1. `pg_dump` archival backup of analytics tables
2. Stop dual-write to Postgres analytics tables
3. Drop analytics tables/MVs in maintenance window (separate change request; requires `BQ_MIGRATION_ALLOW_SUPABASE_DROPS=true`)
