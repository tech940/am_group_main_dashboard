# BigQuery Migration — Rollback Runbook

## Instant read rollback (no redeploy)

Set environment variable:

```bash
ANALYTICS_READ_SOURCE=postgres
```

Dashboard immediately reads Supabase again. Redis may serve stale BQ-era cache for up to 30 minutes — flush Redis keys matching `platinum:*`, `kia:*`, `hyundai:*` if needed.

## Triggers

| Symptom | Action |
|---------|--------|
| API 500s after BQ cutover | `ANALYTICS_READ_SOURCE=postgres` |
| Parity drift > 0 rows on critical tables | `dual` mode + investigate ETL; do not drop Postgres tables |
| BigQuery quota / cost spike | `postgres` mode; pause scheduled aggregate queries |
| Bad BQ aggregate refresh | Pin previous aggregate table snapshot; `postgres` mode |

## ETL rollback

| Failure | Action |
|---------|--------|
| BQ write fails | Importer continues Postgres-only (existing behavior) |
| Dual-write corrupts data | Stop BQ writes; repair with `sync-incremental.js --table <name>` |
| Full ETL rollback | Disable BQ destination in external cron; Postgres remains source of truth |

## Data safety rules

- **Never drop** Supabase analytics tables during rollback
- Postgres MV refresh scheduler stays enabled until 30-day stable BQ period ends
- Archival `pg_dump` before any DROP

## Recovery verification

```bash
ANALYTICS_READ_SOURCE=postgres node scripts/verify-platinum-be-api.js
ANALYTICS_READ_SOURCE=postgres node scripts/verify-platinum-business-excellence.js
```

## Post-rollback

1. Root-cause parity failures in `etl_metadata.validation_runs`
2. Fix BQ SQL port per `lib/analytics/sql-dialect/porting-guide.md`
3. Re-run staging `dual` soak before second cutover attempt
