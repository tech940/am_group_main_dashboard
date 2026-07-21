# KIA tables with generic (non-brand-prefixed) names — rename candidates

**Date:** 2026-07-20 · **Scope:** identify KIA-specific DB tables whose Postgres names are generic (`ro_billing_report`) rather than brand-prefixed (`kia_ro_billing_report`), so the naming can be made consistent with Hyundai (`hyundai_*`) and Platinum (`am_platinum_*`).

## Why this happened
KIA was the **first** brand onboarded, so its service / Business-Excellence report tables were created with **bare** names. When Hyundai and Platinum were added later, their equivalent tables were created **brand-prefixed**. KIA's were never renamed, leaving the inconsistency.

Your **transactional** KIA tables are already correctly prefixed and need **no** change: `kia_bookings`, `kia_booking_activity`, `kia_stock_management`, `kia_stock_local_statuses`, `kia_price_details`, `kia_vehicle_allocations`, `kia_vehicle_transfers`, `kia_proformas`, `kia_sales_report`, `kia_purchase_report`, `kia_call_center_complaints`, `kia_call_logs`, `kia_lead_followups`, `kia_finance_*`, `kia_user_profiles`, `kia_quotes`, `kia_email_logs`, `kia_callback_requests`, `kia_vehicle_tracker`, `kia_sales_targets`, `kia_approval_requests`, `kia_booking_discounts`.

## Proof these bare tables are KIA-specific
[lib/analytics/table-map.ts](../lib/analytics/table-map.ts) (`POSTGRES_TO_BIGQUERY_TABLE`) maps each bare table to the **`kia_facts.*` / `kia_aggregates.*`** BigQuery datasets — exactly parallel to `am_platinum_*` → `platinum_facts` and `hyundai_*` → `hyundai_facts`. A cross-brand grep confirms **no** hyundai/platinum/mg code references any of these bare tables.

---

## Category A — external-ingested analytics/report tables → prefix `kia_`
Read-only from the app (SELECT only); **written by the off-repo DMS ingestion pipeline**. Referenced in raw SQL across `lib/kia/**` and `app/api/brands/kia/**`. Not in the Drizzle schema.

| Generic name (Postgres) | Suggested name | Other-brand sibling (proof it's KIA) |
|---|---|---|
| `ro_billing_report` | `kia_ro_billing_report` | `hyundai_ro_billing_report`, `am_platinum_ro_billing_report` |
| `open_ro_yearly` | `kia_open_ro_yearly` | `hyundai_repair_order_list`, `am_platinum_repair_order_list` |
| `operation_wise_analysis_report` | `kia_operation_wise_analysis_report` | `hyundai_operation_wise_analysis_report`, `am_platinum_operation_wise_analysis_report` |
| `operation_wise_analysis_advisor_report` | `kia_operation_wise_analysis_advisor_report` | maps to `kia_facts.operation_wise_analysis_advisor` |
| `ew_report` | `kia_ew_report` | `hyundai_ew_report`, `am_platinum_ew_report` |
| `rsa_report` | `kia_rsa_report` | `am_hyundai_rsa_report` |
| `mcp_report` | `kia_mcp_report` | `am_hyundai_mcp_report` |
| `adv_wise_lubricants_vas` | `kia_adv_wise_lubricants_vas` | Platinum: `am_platinum_vas_period_summary` |
| `service_appointment` | `kia_service_appointment` | `am_platinum_service_appointment` |
| `demo_job_cards` | `kia_demo_job_cards` | maps to `kia_facts.demo_job_cards` |
| `demo_car_list` | `kia_demo_car_list` | maps to `kia_facts.demo_car_list` |
| `psf_yearly` | `kia_psf_yearly` | KIA PSF report. **Registered only in config** (`lib/business-excellence/comparison.ts`, "PSF starts March 2026"); no `FROM psf_yearly` query exists yet — rename it alongside the rest once the feed lands, or skip until then |

## Category B — KIA materialized views → prefix `kia_`
In-repo (created by `scripts/dashboard-performance-optimization.sql`, refreshed by `scripts/refresh-dashboard-materialized-views.js`).

| Generic name | Suggested name | Sibling |
|---|---|---|
| `ro_billing_daily_summary`, `ro_billing_daily_summary_v2` | `kia_ro_billing_daily_summary` | `am_platinum_ro_billing_daily_summary_v1/v2` |
| `workshop_performance_jc_summary_v1` | `kia_workshop_performance_jc_summary` | `am_platinum_workshop_performance_jc_summary_v2`, `am_hyundai_workshop_performance_jc_summary_v1` |
| `workshop_performance_summary_v2` | `kia_workshop_performance_summary` | — |
| `workshop_operation_addon_summary_v1` | `kia_workshop_operation_addon_summary` | — |

## Category C — app-managed operational tables → prefix `kia_`
**Confirmed KIA-only** (referenced only by `schema.ts` + KIA demo routes; the other brands have no demo-cars-list API route). The app **writes** these, so a straight rename is clean (no external writer to coordinate).

| Generic name | Suggested name | Notes |
|---|---|---|
| `demo_vehicle_details` | `kia_demo_vehicle_details` | created by `scripts/create-demo-vehicle-details.sql`; used by `app/api/brands/kia/demo-cars-list` + `demo-job-cards` |
| `demo_vehicle_remarks` | `kia_demo_vehicle_remarks` | Drizzle `demoVehicleRemarks` in [schema.ts](../lib/db/schema.ts); has a trigger `set_demo_vehicle_remarks_updated_at` |

---

## NOT rename candidates — genuinely shared / cross-brand (leave as-is)
`users`, `purchase_orders`, `purchase_order_approvals`, `workflow_history`, `finance_orders`, `finance_order_workflow`, `finance_order_comments`, `petty_cash_*` (all), `finance_sheet` + `am_finance_audit_logs` (group-wide AM Finance), `vendors`, `delegation_tasks`, `delegation_task_activity`, `delegation_contacts`, `permissions`, `permission_groups`, `role_permissions`, `user_permissions`, `permission_audit_logs`, `admin_audit_logs`, `dashboard_settings`, `user_preferences`, `user_activity_events`, `gl_accounts`, `approvals_common_data`, `approvals_branches_config`. The Hyundai/Platinum warranty + proforma tables are already correctly prefixed.

## Orphan / dead — verify ownership, then DROP (not rename)
**Never queried by any app code** (no Drizzle `.from()` and no raw SQL `FROM/JOIN` in `app/**` or `lib/**`), though they exist in the DB (they appear in `scripts/fix-rls-errors.js` / the RLS hardening list):
- Legacy scaffolding in `schema.ts` but unused: `vehicles`, `workshop_jobs`, `recon_workflows`, `inventory_items`, `inventory_transactions`, `tasks`, `comments`, `attachments`, `activity_logs`.
- Test-drive module (no TS references at all): `test_drive_employees`, `trips`, `employees`, `platinum_test_drive_vehicle`.
- `business_excellence_am_kia_new` (Drizzle `businessExcellenceData`) — **defined in `schema.ts` but never queried** (no `.from(businessExcellenceData)` and no raw SQL reference anywhere). Dead; verify & drop rather than rename. *(Moved here from Category C after verification.)*

Confirm none are read/written by an external system before dropping. These are **not** KIA branding fixes.

---

## Blast radius — everywhere a Category A/B name is referenced
A rename (or view swap) must update, in lockstep:
1. **Raw SQL** in `lib/kia/{business-excellence-contract,workshop-summary,ro-billing-kpis,service-dashboard-metrics,service-dashboard-export}.ts` and `app/api/brands/kia/{business-excellence/*,service-appointment,demo-cars-list,demo-job-cards}/route.ts` (dozens of `FROM ro_billing_report` etc.).
2. **The analytics registry** — `POSTGRES_TO_BIGQUERY_TABLE` keys **and** `SYNC_TABLE_ORDER` in [lib/analytics/table-map.ts](../lib/analytics/table-map.ts).
3. **Perf/DDL scripts** — `scripts/dashboard-performance-optimization.sql`, `scripts/business-excellence-relational-indexes.sql`, `scripts/supabase-query-performance-fixes*.sql`, `scripts/supabase-security-linter-fixes.sql` (RLS table list), `scripts/refresh-dashboard-materialized-views.js` (mat-view names).
4. **Shared BE helper** — `lib/business-excellence/comparison.ts` (if it names any table literally).
5. **The external DMS ingestion pipeline** (outside this repo) — for **Category A physical renames only**.

---

## Recommended migration approach (low-risk, phased)

The hard constraint: **Category A tables are written by an external pipeline this repo does not control.** A physical `RENAME` would break ingestion unless the pipeline is updated at the same instant. So do NOT lead with a physical rename.

### Category A (read-only in app) — compatibility VIEW first
The app only **reads** these, so give the app a clean name via a view, leaving the physical table + pipeline untouched:

1. **Create the views (ready to run):** [scripts/rename-kia-tables-step1-views.sql](../scripts/rename-kia-tables-step1-views.sql) creates a `kia_<name>` view over every Category-A base table. Idempotent (`CREATE OR REPLACE`), skips not-yet-loaded feeds like `psf_yearly`, and applies `security_invoker` + service-role-only grants so the views inherit the base tables' locked-down (no anon/authenticated) posture.
2. Migrate app raw SQL (blast-radius §1) to the `kia_*` view names.
3. Update `POSTGRES_TO_BIGQUERY_TABLE` so the new `kia_*` keys map to the same `kia_facts.*` BQ paths (BigQuery is already clean, so this is just the Postgres-side key — and it's what lets the BQ rewriter still resolve the query when `ANALYTICS_READ_SOURCE=bigquery`).
4. Ship + verify (BE parity scripts: `npm run verify:kia-be-parity` must still tie to the rupee).
5. **Later / optional**, once the external loader is updated to write the new name: `ALTER TABLE … RENAME`, point the loader at it, and drop the view. Until then, the view fully satisfies the "app uses `kia_` names" goal with **zero pipeline risk**.

> ⚠️ **Ordering:** step 1 (views) must be applied to the DB **before** the step-2 code ships, or the queries error at runtime. The code edits below are therefore provided as a template to apply *after* the migration — not pre-applied.

### Worked example — `service_appointment` end-to-end (smallest blast radius)
`service_appointment` is referenced in exactly one route plus the table map, so it's the cleanest first migration. After running step 1 (which creates `kia_service_appointment`):

**Edit 1 — [lib/analytics/table-map.ts](../lib/analytics/table-map.ts)** (rename the key so both Postgres reads and the BigQuery rewrite resolve):
```diff
-  service_appointment: 'kia_facts.service_appointment',
+  kia_service_appointment: 'kia_facts.service_appointment',
```

**Edit 2 — [app/api/brands/kia/service-appointment/route.ts](../app/api/brands/kia/service-appointment/route.ts)** (3 spots: the existence gate + two `FROM`s):
```diff
-  if (!await tableExists('service_appointment')) return 'missing'
+  if (!await tableExists('kia_service_appointment')) return 'missing'
   ...
-    FROM service_appointment
+    FROM kia_service_appointment
   ...  (both query bodies — lines ~98 and ~162)
```

**Verify:** `npm run build`, then load KIA → Service Appointment and confirm the register + counts are unchanged (the view returns identical rows). `tableExists` resolves because `to_regclass('public.kia_service_appointment')` sees the view.

Replicate the same two-edit pattern for each remaining Category-A table (update its `table-map` key + every `FROM <bare>` in its `lib/kia/**` / `app/api/brands/kia/**` queries), one table per PR so each is independently verifiable and revertible.

### Category B (materialized views) — recreate under the new name
These are in-repo. In one migration: `DROP MATERIALIZED VIEW <old>; CREATE MATERIALIZED VIEW kia_<name> AS <same definition>;` recreate its unique + secondary indexes, and update `scripts/refresh-dashboard-materialized-views.js` + the readers. Or front them with a plain view like Category A if you want a smaller first step.

### Category C (app-managed, app writes them) — straight rename in a Drizzle migration
No external writer, so rename directly and update references atomically:
```sql
ALTER TABLE public.demo_vehicle_remarks RENAME TO kia_demo_vehicle_remarks;
ALTER TABLE public.demo_vehicle_details RENAME TO kia_demo_vehicle_details;
-- rename dependent trigger/index names to match, then update schema.ts pgTable('...') + all refs
```
Update the Drizzle `pgTable('demo_vehicle_remarks', …)` string in [schema.ts](../lib/db/schema.ts) to the new name and the demo routes' raw SQL.

### Rollout guardrails
- One category at a time; run `npm run build` + the relevant `verify:*` parity scripts after each.
- Views make it reversible: drop the view / revert code with no data movement.
- Do Category A + B behind views **before** any physical rename, so nothing depends on the pipeline being updated first.
