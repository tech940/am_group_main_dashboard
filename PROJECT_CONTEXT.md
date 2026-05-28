# Project Context

Last updated: 2026-05-28

## Project Overview

Main Dashboard is a Next.js 16 App Router application for AM Group vehicle operations. It covers purchase-order workflow management and KIA Business Excellence analytics, with the current build focused on purchase-order approvals plus KIA Business Excellence sections for the unified overview, RO Billing, Workshop Performance, Open RO, and KIA Complaints.

The application is designed for operational users across Admin, Purchase Manager, EA, MD, Accounts, and brand/branch-specific teams. The core goals are fast dashboards, controlled workflow visibility, branch-aware access, and executive-style analytics.

## Current Architecture

- Framework: Next.js 16.2.6 App Router with `proxy.ts` for Supabase session refresh.
- UI: React 19, Tailwind CSS, shadcn-style primitives, Lucide icons, Recharts.
- Database: Supabase PostgreSQL accessed through Drizzle and `postgres`.
- Auth: Supabase Auth plus local `users` table profile/role records.
- Cache layers:
  - Client memory cache for successful same-origin GET `/api/*` responses during the current browser page session.
  - TanStack React Query for shared client state, query dedupe, and remount-safe reuse.
  - Redis for server-side dashboard/API caching.
  - Optional PostgreSQL materialized summary view for RO Billing daily aggregates.
- Storage: Supabase Storage for purchase-order images/PDFs.

## Cron / Import Sync Rule

The external data-import cron runs every 75 minutes from 9 AM to 6 PM and updates the base reporting tables. Materialized views do not update automatically when those base tables change.

Required post-import step:

```bash
npm run db:refresh-dashboard-views
```

Run this only after the base import succeeds. It refreshes:

- `workshop_performance_jc_summary_v1`
- `workshop_operation_addon_summary_v1`

This keeps Workshop Performance and the Business Snapshot Workshop Snapshot aligned with the fresh source tables. If this step is missed, Workshop can show stale counts even when `ro_billing_report` and `operation_wise_analysis_report` are current.

PM2 automation option:

```bash
npm run db:refresh-dashboard-views:scheduler
```

This long-running scheduler is intended for PM2. It runs the refresh command in Asia/Kolkata windows at 09:10, 10:25, 11:40, 12:55, 14:10, 15:25, 16:40, and 17:55, giving the base import cron about 10 minutes to finish first. If the import cron timing changes, update `RUN_MINUTES` in `scripts/refresh-dashboard-materialized-views-scheduler.js`.

## Database Backups

`npm run db:backup` creates a timestamped PostgreSQL custom-format dump using `pg_dump`.

`npm run db:backup:scheduler` is intended for PM2 and runs the backup once daily at 18:00 Asia/Kolkata by default.

- Backups use `DATABASE_BACKUP_URL` when present, otherwise `DATABASE_URL`.
- Backups save to `DATABASE_BACKUP_DIR` when set; otherwise they prefer `OneDrive/Main_Dashboard_Database_Backups`, falling back to `backups/database` inside the project.
- Backup files are named `main_dashboard_YYYYMMDD_HHMMSS.dump`, and local `.dump`/`backups` paths are gitignored.
- Retention defaults to 30 days and can be changed with `DATABASE_BACKUP_RETENTION_DAYS`.
- `pg_dump` is installed through Scoop and `.env` sets `PG_DUMP_PATH=C:/Users/HP/scoop/apps/postgresql/current/bin/pg_dump.exe` so backups do not depend on the shell PATH.
- The backup script removes the Prisma-only `pgbouncer` URL query parameter before calling `pg_dump`; use `DATABASE_BACKUP_URL` only if a separate direct backup connection string is required later.

## Current Visual Direction

The active UI direction is a premium glassmorphism dashboard shell:

- Main page background is white/slate with a very light `#023468` wash; avoid green/teal/cyan shell backgrounds.
- Pink/purple decorative gradients were removed at the user's request.
- Main content surfaces are intentionally translucent so the background remains visible.
- Header is a floating frosted-glass navbar with no search box.
- Sidebar uses a `#023468` navy/blue brand background and gradients, with light text/icons.
- Content receives top padding below the floating navbar so sections do not collide with it.
- Buttons and selects on translucent surfaces need visible borders, usually `#023468`/slate tinted, so controls do not disappear into the glass background.
- Admin/User Management brand accents, stat icons, primary actions, active badges, table headers, pagination, avatars, and the header profile role pill should use `#023468`/navy tones instead of green/teal/emerald.
- Grand Total rows in tables should use the same light slate/grey surface as MECH and MECH TOTAL, with a `#023468` accent, not a blue/green filled row, so green positive growth badges remain readable.
- Notification popups and Purchase Order brand accents should use `#023468`/navy tones instead of green/teal/emerald brand styling.
- Purchase Order completed/spending view uses `scope=spending` and optional `spendStartDate`/`spendEndDate`; date strings must be valid `YYYY-MM-DD` before the client sends them or the API applies them. The API compares the raw `COALESCE(received_date_time, completed_at, created_at)` spend-date expression against ISO strings cast to `timestamptz`, not JS `Date` params, to avoid postgres-js Date parameter crashes.
- KIA complaint comparison cards need visible borders. Customer Complaint Details should not have a search bar, and complaint row expand buttons should be borderless/plain with only the chevron affordance.
- Business Excellence uses the `business-excellence-boundaries` wrapper in `features/kia/business-excellence-page.tsx`; `app/globals.css` applies scoped borders to its cards, buttons, controls, rounded metric surfaces, and table cells so each section is visually distinct.
- Global top route loader is white and is manually started for sidebar navigation.

Important implementation files:

- `components/layout/main-layout.tsx`
- `components/layout/header.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/notification-bell.tsx`
- `app/globals.css`

## Main Dashboard Page

The `/dashboard` route is intentionally locked as "Coming Soon".

Reason:

- The previous dashboard contained placeholder/dummy metrics.
- Users were likely to confuse that data with real company data.

Current behavior:

- Shows a polished locked/coming-soon page.
- Sidebar Dashboard item includes a "Soon" badge.
- Live operational work currently happens in Business Excellence and Purchase Orders.

## Current Client Caching Rule

The active behavior is intentionally aggressive:

- Once a successful GET API response is loaded, the frontend reuses it for the current page session.
- Component remounts, tab switches, layout changes, modal opens, and route transitions should not trigger duplicate network calls.
- A full browser refresh/reload resets the in-memory client cache and allows fresh API calls.
- Non-GET API mutations clear the session API cache because writes can change application data.
- `/api/notifications` is excluded from the generic GET cache so realtime/unread notification behavior does not freeze.
- React Query is configured with infinite stale time and garbage-collection time for the current page session.
- Manual Refresh buttons in Business Excellence and Purchase Orders now perform a full page reload instead of silently re-calling cached APIs.

Implementation files:

- `components/providers/query-provider.tsx`
- `app/layout.tsx`
- `lib/hooks/use-user-role.ts`
- `components/layout/header.tsx`

## Business Excellence

### Active Scope

KIA Business Excellence is now route-driven and section-based. The default screen is a visual "Business Excellence Overview" command center with no tables. Detailed sections remain available as separate report routes.

### Data Source

Business Excellence now uses relational SQL tables rather than giant JSON sheet blobs. Important active tables include:

- `ro_billing_report`
- `open_ro_yearly`
- `kia_call_center_complaints`
- `operation_wise_analysis_report`
- `ew_report`
- `mcp_report`
- `rsa_report`

Important normalized columns include:

- `bill_date`
- `bill_no`
- `ro_no`
- `work_type`
- `service_type`
- `service_advisor`
- `technician`
- `model`
- `labour_amt`
- `part_amt`
- `total_amt`
- `avg_rating`
- `pick_drop`
- `uploaded_at`

All RO Billing comparisons are based on `bill_date`.

Important date bases by section:

- RO Billing: `ro_billing_report.bill_date`
- Workshop Performance core JC/revenue: `ro_billing_report.bill_date`
- Workshop VAS/WA/WB: `operation_wise_analysis_report.report_month`
- Open RO: `open_ro_yearly.ro_date`
- KIA Complaints: `kia_call_center_complaints.complaint_date`
- EW: `ew_report.reg_date`
- RSA: `rsa_report.invoice_date`
- MCP: `mcp_report.package_purchase_date`

### APIs

- `GET /api/brands/kia/business-excellence?brand=kia`
  - Metadata endpoint.
  - Currently returns only RO Billing metadata.

- `GET /api/brands/kia/business-excellence?brand=kia&sheet=ro_billing_report...`
  - RO Billing table rows endpoint.
  - Should avoid loading other sheets.

- `GET /api/brands/kia/business-excellence/ro-billing-analysis`
  - Server-side aggregation for Table, Trend, FY Trends, Analytics, and Revenue views.
  - Uses Redis cache.
  - Uses `ro_billing_daily_summary_v2` if available.
  - Falls back to raw `ro_billing_report` if summary view is missing.

- `GET /api/brands/kia/business-excellence/performance-intelligence`
  - Performance Intelligence Report API.
  - Scores transactions with SQL CTE logic.
  - Supports pagination, filters, advisor score summaries, alert counts, and full filtered export.

- `GET /api/brands/kia/business-excellence/workshop-performance`
  - New Workshop Performance API.
  - Aggregates Job Cards, labour, spares, VAS, WA/WB, advisor performance, and daily movement.
  - Combines `ro_billing_report`, `operation_wise_analysis_report`, `ew_report`, `mcp_report`, and `rsa_report` where available.
  - Uses Redis with the 75-minute dashboard TTL and returns chart/table-ready payloads.
  - Prefers `workshop_performance_jc_summary_v1` only when that materialized view covers the full requested date range; otherwise it falls back to raw `ro_billing_report` so service-type JC counts stay aligned with RO Billing.

- `GET /api/brands/kia/business-excellence/open-ro`
  - Open Repair Orders / Workshop WIP API.
  - Uses only `open_ro_yearly`.
  - Calculates dynamic aging from `CURRENT_DATE - ro_date`, aging buckets, delayed promise status, service type aging, delay reason summary, advisor load, work-type distribution, and high-priority alerts.
  - Supports filters for advisor, work type, aging bucket, insurance company, and RO date range.

- `GET /api/brands/kia/business-excellence/complaints`
  - KIA complaints analytics API.
  - Uses latest distinct complaint records from `kia_call_center_complaints`.
  - Provides KPIs, month/year comparison, complaint area breakdowns, dealer/sub-area summaries, model/source charts, and detail rows.
  - Supports date, status, dealer, area, model, and source filters.

- `GET /api/brands/kia/business-excellence/overview`
  - Default Business Excellence command-center API.
  - Combines compact, chart-ready aggregates across RO Billing, Workshop Performance, Open RO, KIA Complaints, and EW/RSA/MCP.
  - Returns a dedicated `workshopSnapshot` payload for closed workshop jobs, including total JC, workshop revenue, labour/RO, VAS amount, source coverage, and top service lines.
  - The Workshop Snapshot uses the same materialized-view freshness guard as the Workshop Performance report.
  - When the Workshop Snapshot reads `workshop_performance_jc_summary_v1`, it groups service rows by `group_type` before `service_type` so mileage slabs like `30K`/`40K` stay under `Paid Service`; keep the SELECT and GROUP BY expressions identical to avoid runtime SQL failures.
  - Uses the same Redis 75-minute dashboard TTL pattern as the other Business Excellence APIs.
  - Intentionally returns visual-summary data only; no large detail tables.

- `POST /api/brands/kia/business-excellence/ai-summary`
  - Groq-backed AI summary endpoint.
  - Supports Business Excellence Overview, RO Billing Report, Workshop Performance, Open RO, and KIA Complaints.
  - Uses compact payloads to stay within Groq token limits.
  - Monetary values must be Indian rupees only. The API prompt forbids dollar/USD output and Cr/Lakh abbreviations, and the parser normalizes returned currency text to full INR amounts before sending the summary to the UI.
  - AI summary cache key is versioned; bump the key whenever prompt/output normalization changes so stale summaries are not reused.

### Business Excellence Routes

- `/brands/kia/business-excellence` now redirects to `/brands/kia/business-excellence/overview`.
- `/brands/kia/business-excellence/overview` opens the visual Business Excellence command center.
- `/brands/kia/business-excellence/ro-billing-report` opens the RO Billing report directly.
- `/brands/kia/business-excellence/workshop-performance` opens Workshop Performance directly.
- `/brands/kia/business-excellence/open-ro` opens Open RO directly.
- `/brands/kia/business-excellence/kia-complaints` opens KIA Complaints directly.
- The report selector opens report routes in a new browser window/tab rather than replacing the current section.
- The Business Excellence client no longer waits for the metadata API just to choose the active report; Overview, RO Billing, Workshop Performance, Open RO, and KIA Complaints are known report entries, which lets the active report mount and start its own APIs earlier.

### Business Excellence Overview

Purpose:

- Default section for Business Excellence.
- No tables.
- Shows real analytics, cards, chart panels, and insight blocks across the four main sections at once:
  - RO Billing
  - Workshop Performance
  - Open RO
  - KIA Complaints

Important files:

- `features/kia/business-excellence-overview.tsx`
- `app/api/brands/kia/business-excellence/overview/route.ts`

Current UI behavior:

- Uses the shared Business Excellence date filter.
- Shows skeleton loading when the date filter changes.
- Has maximise buttons on charts.
- Expanded chart modal must have a solid white background.
- Sidebar Business Excellence link points to the overview route.
- In the overview chart grid, `Top Complaint Reasons` spans the full two-column width on xl screens for easier reading.

Current overview metrics include:

- Revenue, labour, parts, total JC, average billing.
- Workshop Snapshot for closed workshop jobs: workshop JC, workshop revenue, labour/RO, VAS amount, and top grouped service rows displayed as `Service Type | Job Cards | Revenue`.
- Open RO, delayed RO, RO over 15 days, average open aging.
- Complaint totals, open complaints, complaint aging.
- EW/RSA/MCP counts.
- EW and MCP counts in Business Excellence are filtered to `department = SERVICE` and use the selected date window: `ew_report.reg_date` for EW and `mcp_report.package_purchase_date` for MCP. EW also deduplicates by `certi_no`; when certificate number is blank, the fallback key is VIN + scheme + registration date + KIN amount.
- RSA counts and amount in Business Excellence use `rsa_report.invoice_date` for the selected month/range and deduplicate rows by `invoice_no`; when invoice number is blank, the fallback key is VIN + policy + invoice date + amount.
- Derived insight signals such as WIP pressure, billing velocity, customer voice, and add-on attachment.

### RO Billing Metrics

- Load: count of unique bill/RO records.
- Labour: sum of `labour_amt`.
- Parts: sum of `part_amt`.
- Lab/Veh: Labour / Load.
- Part/Veh: Parts / Load.
- Revenue: Labour + Parts or field-specific revenue depending on view.
- LY/CY comparisons use matching `bill_date` windows.
- Trend target logic applies +10 percent to LY totals and prorates target to the selected timeline.
- Business Excellence currency displays show full rupee figures below one lakh and two-decimal L/Cr notation at one lakh and above. Thousands must not render as K in tables.

### Performance Optimizations Completed

- Metadata API limited to RO Billing only and uses projected RO Billing columns instead of querying `information_schema` on every cold metadata build.
- RO Billing paginated table rows use a projected-column fast path and skip `information_schema` metadata lookups on row requests.
- RO Billing analysis moved toward SQL aggregation.
- RO Billing analysis now supports batched metric loading with `metrics=all` for table, trend, and FY views. The API returns a `byMetric` payload for Load, Labour, Parts, Lab/Veh, and Part/Veh from one SQL summary query, and the frontend consumes that bundle instead of firing one request per metric.
- RO Billing analysis excludes `ro_billing_report.bill_status` values `Cancel`, `Cancelled`, and `Canceled` from normal metrics, trends, leaderboards, and tables. The table view returns a separate `cancelledSummary` section so cancelled bills remain auditable without affecting active billing counts.
- RO Billing table Lab/Veh and Part/Veh rows are derived in the frontend from the converted Labour/Parts and Load tables. Parent rows such as MECH, MECH TOTAL, and Grand Total must use `total amount / total load`, not a sum of child per-vehicle values. These parent rows are weighted averages, so MECH can be lower than Paid Service if Free Service or Running Repair have lower per-vehicle values.
- `docs/BUSINESS_EXCELLENCE_SQL_QUERIES.md` documents the current Business Excellence dashboard SQL templates, date bases, dedupe keys, materialized-view usage, and refresh/index SQL. Keep this doc updated when dashboard query logic changes.
- Business Excellence visual boundary CSS is broad by design; use the `be-borderless-action` class for inline table expand controls that should not render as bordered buttons.
- FY Trends now has a dedicated SQL aggregate path and no longer fetches all RO Billing rows for the default unfiltered FY view.
- Redis TTL is 75 minutes.
- Frontend session cache prevents duplicate API hits after data loads.
- Performance Intelligence SQL now safely parses text discount fields such as `labour_disc` and `part_disc`.
- Trend X-axis now forces all days to render instead of auto-skipping labels.
- API timing utilities are present through `createApiTimer`.
- Business Excellence top Refresh button was removed; fresh data is intentionally obtained through a full page reload/session reset.
- Needed controls in the glass UI have stronger visible borders.
- All Business Excellence analytics APIs should use the same pattern where possible: route auth timing, Redis dashboard TTL, compact view-specific payloads, and Server-Timing headers.

### Database Optimization Script

Primary script:

- `scripts/dashboard-performance-optimization.sql`

Important expected database objects:

- `ro_billing_daily_summary_v2`
- `workshop_performance_summary_v2`
- indexes on bill date, work type, advisor, model, vehicle identifiers, uploaded timestamp, and performance-intelligence filters.
- Workshop Performance indexes on RO Billing, Operation-wise Analysis, EW, MCP, and RSA date/advisor/VIN fields.

After cron/import updates, refresh:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY ro_billing_daily_summary_v2;
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_summary_v2;
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1;
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;
```

Or run the project helper command:

```bash
npm run db:refresh-dashboard-views
```

## Purchase Orders

### Workflow

Expected workflow:

1. New Order -> EA approval.
2. EA approved -> MD approval.
3. MD approved -> Purchase Manager / GRN process.
4. GRN submitted -> Accounts.
5. Accounts completed -> fully completed workflow.

Important distinction:

- GRN Completed means goods are received and spending should count.
- Fully Completed means Accounts has finished final closing work.

### Visibility Rules

- Assigned users should see and receive notifications for their current stage.
- EA sees `awaiting_ea_approval` and relevant denied/hold/recovery states.
- MD sees only `awaiting_md_approval` in their default active approval queue.
- MD and EA can switch to an all-orders view when they need broader visibility.
- MD all-orders view must include branch filtering plus status filters such as pending, approved, and hold.
- Purchase Manager table view is restricted to purchase-manager users.
- Default order listing should focus on today's orders.
- Purchase Orders pagination uses 12 orders per page.

### Current UI Notes

- Purchase Orders still uses the shared glass dashboard shell.
- Table/card surfaces should remain readable on translucent backgrounds.
- The white route loader should show when navigating from the sidebar into Purchase Orders.

### APIs

- `GET /api/purchase-orders`
  - Role-aware purchase-order listing.
  - Supports pagination and filters.

- `GET/POST /api/purchase-orders/workflow`
  - Workflow details and stage actions.

- `POST /api/purchase-orders/bulk-approve`
  - Bulk workflow actions.

- `POST /api/purchase-orders/upload`
  - Purchase-order file uploads.

## Notifications

- Notification Bell uses `/api/notifications`.
- Notification API is intentionally excluded from generic session GET caching to preserve realtime/unread behavior.
- Browser/realtime notification behavior should continue to rely on Supabase realtime listeners and explicit notification state changes.

## State Management Approach

- TanStack React Query is the standard for client-side server state.
- Query keys must include all meaningful filters, pagination, view mode, date range, and role-specific inputs.
- Use `fetchQuery` or `useQuery` instead of raw `useEffect + fetch` for reusable dashboard data.
- Do not call `invalidateQueries` for simple tab switches or view changes.
- Mutations may invalidate or update related queries because the data has actually changed.
- Local component state is acceptable for purely visual state such as active tab, modal open state, selected rows, and chart expansion.

## Implementation Decisions

- Next.js 16 docs must be checked before changing route handlers, proxy behavior, caching, or App Router conventions.
- Business Excellence analytics should be server-aggregated and chart-ready; frontend should not process giant raw datasets.
- The dashboard should prefer skeletons and cached data over blocking spinners.
- Full page reload is the explicit way to request fresh client data after successful loads.
- Redis remains the backend cache layer; frontend session cache prevents repeated browser requests.
- Heavy dashboard APIs should expose compact, view-specific payloads rather than returning all sections together.

## Features Completed So Far

- Persistent login/session handling improvements.
- MD redirect and approval table/card workflows.
- EA/MD hold, deny, approve flows with optional remarks.
- Vendor image/PDF preview, delete, replace, and vendor-specific mapping.
- Purchase-order branch field and branch-aware visibility foundations.
- Purchase Manager edit flow foundations.
- GRN-based spend recognition design.
- Business Excellence relational-table migration for RO Billing focus.
- RO Billing Table, Trends, FY Trends, Analytics, Revenue, and Performance Intelligence sections.
- Business Excellence Overview is now the default route and visual command center.
- Open RO is now a Business Excellence section for workshop WIP aging, delayed promise tracking, delay-reason control, advisor load, work-type distribution, and escalation alerts.
- KIA Complaints is now a Business Excellence section using `kia_call_center_complaints`, including month/year comparison, complaint area analysis, dealer/sub-area summaries, and complaint detail expansion.
- AI Summary exists in Business Excellence and is backed by Groq. Keep payloads compact because free/on-demand Groq tiers have strict TPM limits. AI Summary output must use Indian rupees only, no dollar symbols, and no Cr/Lakh abbreviations in the summary cards.
- Business Excellence Overview Business Snapshot now includes a clear Workshop Snapshot panel distinct from Workshop WIP. Workshop Snapshot is closed-job performance; Workshop WIP is open repair-order pressure.
- Workshop Performance is now a dedicated Business Excellence report option in the sheet dropdown, directly below RO Billing Report, with server-side multi-table aggregation. JC matches the RO Billing table logic using `COUNT(DISTINCT COALESCE(bill_no, ro_no, id))`, not raw row count.
- Workshop Performance addon definitions:
  - WA = Wheel Alignment.
  - WB = Wheel Balancing.
  - VAS = Value Added Services.
  - Workshop grouping prefers `work_type` first and falls back to `service_type`.
  - `operation_wise_analysis_report` is the addon source for VAS/WA/WB, classified from `op_part_code` and `op_part_desc`.
  - The UI label `OP/Part Desc.` maps to SQL column `op_part_desc`.
  - VAS classification includes known OP/Part Desc values such as AC Evaporator Cleaning, Throttle Body Carbon Cleaning, AC Disinfectant, Rodent Repellent, Under Body Coating, Interior/Exterior Enrichment, Alloy Wheel Care, Air Intake Cleaning, Engine Dressing, Service Lubrication, Wheel Drum Painting, and Silencer Coating.
  - WA/WB classification uses OP/Part Desc values such as Wheel Alignment and Wheel Balancing.
  - Operation-wise addon amounts use `total_amt` and respect the selected Workshop date filter through `operation_wise_analysis_report.report_month`; this table is month-level, so filtering is month/year based.
  - Workshop VAS KPI now calculates both CY and LY from `operation_wise_analysis_report.report_month`; cache version was bumped after this fix so stale `LY ₹0 / N/A` VAS cards are not reused.
  - Workshop auxiliary KPI cards such as EW Count, MCP Count, and RSA Count also calculate LY/growth when prior-year data exists.
  - Workshop table has EW Count, RSA Count, and MCP Count at the end of the table, including the Grand Total row.
  - Less VAS uses only `operation_wise_analysis_report.total_amt`, is not allocated to service-type rows, and appears only on the Workshop Grand Total row because operation-wise data has no service-type split.
  - Workshop `LAB/RO(-VAS)` rolls up each displayed row's already-clamped `Labour Amt - Less VAS` amount, then divides by JC. Parent and Grand Total rows must not recompute `max(total labour - total VAS, 0)` because excess VAS in one bucket can incorrectly wipe out other buckets.
  - Workshop table display is normalized into the same operational buckets as RO Billing: Paid Service, Free Services, Running Repairs, MECH, Others, MECH TOTAL, Accident, and Grand Total.
  - Workshop API returns parent `work_type` and child `service_type` detail for table rows, so Free Services can expand into First/Second/Third Free Service where data exists.
  - Workshop API now prefers `workshop_performance_jc_summary_v1` when present. This materialized view stores pre-deduped job-card rows, allowing service table, daily movement, and advisor aggregations to avoid repeated raw `ro_billing_report` scans.
  - Workshop API now checks `workshop_performance_jc_summary_v1` date coverage before using it. If the view is stale for the selected date range, the API falls back to raw `ro_billing_report`; this prevents mismatches like Workshop Service Type showing 229 JC while RO Billing shows 276 JC for the same May 2026 range.
  - On 2026-05-28, `workshop_performance_jc_summary_v1` was found stale at max date 2026-05-22 while raw `ro_billing_report` had max `bill_date` 2026-05-28. The view was refreshed and then matched raw May counts: Grand Total 276, Paid Service 75, Free Services 75, Running Repairs 62, Others 30, Accident 34.
  - `scripts/dashboard-performance-optimization.sql` creates `workshop_performance_jc_summary_v1`; refresh it after cron imports with `REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1;`.
  - Workshop API also prefers `workshop_operation_addon_summary_v1` when present, so VAS/WA/WB regex classification is precomputed monthly instead of repeated on every request. Refresh it after cron imports with `REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;`.
  - Workshop table service buckets are expandable only when the child rows are distinct from the parent bucket, avoiding duplicate rows such as Paid Service -> Paid Service.
  - Workshop table hides mileage-only paid-service child labels such as `30K`, `40K`, etc., and keeps Accident collapsed to match the RO Billing table behavior.
  - Workshop table money values show full rupee figures below one lakh, so thousands render as `₹5,700` rather than `₹5.7K`; lakh/crore values stay compact but always use two decimals, such as `₹2.57L`.
  - Workshop charts render as full-width stacked sections to avoid cramped visuals.
  - Workshop matrix rows are compact with visible row/column borders for denser operational reading.
  - The Workshop matrix is the first full-width block in the report because it is the primary operational view.
- Executive-style analytics visuals and chart expansion behavior.
- Sales Team Leaderboard is now a dedicated Business Excellence analysis tab, backed by server-side service-advisor aggregation instead of the old in-Analytics placeholder.
- Sales Team Leaderboard top 3 ranks now use crown-style gold/silver/bronze badges.
- RO Billing Table dropdowns now avoid noisy service rows:
  - Free Services shows actual `service_type` labels such as First/Second/Third Free Service.
  - Paid Service hides mileage/package-like child labels such as `30K`, `40K`, `100K`, `110K`, etc.; these come from `ro_billing_report.service_type` but are not treated as real service labels in the UI.
  - Others expands by remaining `work_type` labels where available, such as Refurbish, E Breakdown, AMC - TM, NVI, and similar categories.
  - Blank/Unspecified/self-repeated child rows are filtered out, and parent rows only show expand controls when real child rows remain.
- Session-level frontend API caching and React Query dedupe.
- Project context documentation refresh.
- Main Dashboard locked as Coming Soon to avoid exposing dummy data.
- Header/sidebar/dashboard shell redesigned with theme-based glassmorphism.
- Business Excellence Refresh button removed.
- Open RO refresh button removed; its date filter follows the RO Billing style.
- Purchase Orders approval alert popup was removed for MD/EA approvals.
- Sidebar navigation explicitly starts the white top loading bar.

## Features In Progress

- Continued API speed tuning for RO Billing, Performance Intelligence, Open RO, KIA Complaints, and the overview API.
- Ensuring every Business Excellence chart/table uses server-ready payloads and does not trigger duplicated calls.
- Purchase Orders spending/completion UI cleanup.
- Branch-aware sidebar/backend access hardening.
- Notification realtime/browser behavior refinement.

## Pending Tasks

- Verify every major page under Network tab after cache changes:
  - Business Excellence
  - Purchase Orders
  - Admin Users
  - Header/Auth profile
  - Notification Bell
- Replace remaining direct `useEffect + fetch` sections with React Query where appropriate.
- Add more server-side precomputed summaries for Performance Intelligence if API latency grows again.
- Confirm `ro_billing_daily_summary_v2` exists in Supabase and is refreshed after cron jobs.
- Add backend route protection audits for branch/brand-specific APIs.
- Review purchase-order mutation cache updates so UI stays accurate after approve/deny/hold actions.

## Current Development Status

The current priority is performance and API call discipline. The frontend now avoids duplicate GET API calls during the current page session, while backend APIs use Redis and SQL aggregation where implemented. The next best optimization target is replacing any remaining raw data endpoints or expensive client-side transformations with smaller view-specific APIs.

## Keep This File Updated

Every code change that affects behavior, UI, data contracts, APIs, caching, auth/access, workflow rules, reporting logic, currency/date formatting, or operational assumptions must update this file in the same change set. Small mechanical edits that do not change behavior can skip it. Future AI tools and developers should treat this file as the project handoff map.
