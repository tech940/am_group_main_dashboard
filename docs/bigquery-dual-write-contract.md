# Dual-Write ETL Contract (External Import Cron)

This document defines the contract between the **external import cron** (outside this repo) and the AM Group dashboard during the Supabase → BigQuery migration.

## Goals

1. Write every analytics batch to **both** Supabase PostgreSQL and Google BigQuery.
2. Use **incremental upserts** — never full-table `to_jsonb(table) ORDER BY id` exports.
3. Refresh aggregates once per successful batch (Postgres MVs until cutover; BQ scheduled queries after).

## Batch metadata

Each import batch MUST emit:

| Field | Type | Description |
|-------|------|-------------|
| `batchId` | UUID | Unique batch identifier |
| `sourceTable` | string | Logical source name (e.g. `platinum_ro_billing`) |
| `postgresTable` | string | Supabase public table name |
| `bigQueryTable` | string | FQN `${PROJECT}.dataset.table` |
| `watermarkUploadedAt` | ISO timestamp | Max `uploaded_at` in batch |
| `rowCount` | int | Rows upserted |
| `status` | enum | `success` \| `failed` \| `partial` |

Log batches to BigQuery `etl_metadata.sync_watermarks` (see DDL).

## Upsert rules

- **Key**: `row_hash` (fallback: `id::text` when hash empty)
- **Winner**: latest `uploaded_at` wins
- **Postgres**: existing importer behavior (unchanged during dual-write)
- **BigQuery**: `MERGE` from staging table scoped to batch partition date range

```sql
MERGE `${PROJECT}.platinum_facts.ro_billing` AS target
USING staging_batch AS source
ON target.row_hash = source.row_hash
WHEN MATCHED AND source.uploaded_at > target.uploaded_at THEN UPDATE SET ...
WHEN NOT MATCHED THEN INSERT ...
```

## Schema DDL

- Run all `scripts/bigquery/ddl/*.sql` once in GCP.
- **Do not** run `ALTER TABLE ADD COLUMN` on every import in Postgres (audit finding #3).
- Add columns via one-time migration scripts only.

## Post-batch refresh

| Store | Action |
|-------|--------|
| Supabase | `npm run db:refresh-dashboard-views` (until `ANALYTICS_READ_SOURCE=bigquery`) |
| BigQuery | Run scheduled queries in `scripts/bigquery/scheduled-queries/` |

## Dealer code normalization (Platinum)

Load `resolved_dealer_code` at ingest time:

- Map `N6824` → `N6250`
- Reject pseudo `ACTIVE` for branch-level facts (sum real dealer codes in all-locations mode)

## Failure handling

| Failure | Behavior |
|---------|----------|
| BigQuery write fails | Log `partial`; Postgres still succeeds (dashboard stays up) |
| Postgres write fails | Abort batch; do not commit BQ-only rows without repair flag |
| Both succeed | Update watermark; trigger aggregate refresh |

## In-repo repair / backfill

When dual-write misses rows:

```bash
node scripts/bigquery/sync-incremental.js --table am_platinum_ro_billing_report
node scripts/bigquery/sync-incremental.js --full
```

## Cutover

1. Dual-write enabled (both stores)
2. `ANALYTICS_READ_SOURCE=dual` in staging — parity logged
3. `ANALYTICS_READ_SOURCE=bigquery` in production
4. Stop Postgres analytics writes only after 30-day stable period
