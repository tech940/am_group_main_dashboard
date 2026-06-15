# SQL porting guide (Postgres → BigQuery)

High-risk modules that must be ported before `ANALYTICS_READ_SOURCE=bigquery`:

| Module | Risk | Postgres patterns |
|--------|------|-------------------|
| [`lib/platinum/ro-billing-audit.ts`](../../lib/platinum/ro-billing-audit.ts) | Multi-period CTE, daily/dealer splits | `DISTINCT ON`, `FILTER`, interval math |
| [`lib/platinum/business-excellence-vas.ts`](../../lib/platinum/business-excellence-vas.ts) | VAS regex, period comparability | `~` regex, `to_regclass` |
| [`app/api/brands/platinum/business-excellence/overview/route.ts`](../../app/api/brands/platinum/business-excellence/overview/route.ts) | 22 parallel aggregate tasks | MV fast-path, date windows |
| [`app/api/brands/platinum/business-excellence/ro-billing-analysis/route.ts`](../../app/api/brands/platinum/business-excellence/ro-billing-analysis/route.ts) | Fiscal TD/MTD/QTD/YTD | `EXTRACT(MONTH)`, grouping sets |
| Kia/Hyundai equivalents under `app/api/brands/{kia,hyundai}/business-excellence/` | Same patterns | Brand-specific dealer filters |

## Translation cheatsheet

| Postgres | BigQuery |
|----------|----------|
| `DISTINCT ON (k) ... ORDER BY uploaded_at DESC` | `ROW_NUMBER() OVER (PARTITION BY k ORDER BY uploaded_at DESC) = 1` |
| `COUNT(*) FILTER (WHERE x)` | `COUNTIF(x)` |
| `SUM(x) FILTER (WHERE y)` | `SUM(IF(y, x, 0))` |
| `bill_date < (end + INTERVAL '1 day')` | `bill_date < DATE_ADD(end, INTERVAL 1 DAY)` |
| `to_regclass('public.t')` | `INFORMATION_SCHEMA.TABLES` or config flag |
| `regexp_replace(col, '[^0-9.-]', '', 'g')` | `REGEXP_REPLACE(col, r'[^0-9.-]', '')` |
| `INTERVAL '1 day'` | `INTERVAL 1 DAY` |

## Rollout order

1. Enable `ANALYTICS_READ_SOURCE=postgres` (default — no change)
2. Dual-write ETL + backfill
3. `ANALYTICS_READ_SOURCE=dual` — log row-count diffs
4. Port high-risk SQL per module; add BQ-native query variant where needed
5. `ANALYTICS_READ_SOURCE=bigquery`

Until step 4 completes per module, `rewritePostgresTablesToBigQuery()` only renames tables — dialect-specific SQL will still fail in BigQuery mode.
