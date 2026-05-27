# Project Context

Last updated: 2026-05-27

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

## Current Visual Direction

The active UI direction is a premium glassmorphism dashboard shell:

- Main page background uses teal/cyan/sky gradients only, aligned with the AM/KIA dashboard theme.
- Pink/purple decorative gradients were removed at the user's request.
- Main content surfaces are intentionally translucent so the background remains visible.
- Header is a floating frosted-glass navbar with no search box.
- Sidebar keeps a visible teal/blue gradient glass background and light text/icons.
- Content receives top padding below the floating navbar so sections do not collide with it.
- Buttons and selects on translucent surfaces need visible borders, usually teal/slate tinted, so controls do not disappear into the glass background.
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
  - Combines compact, chart-ready aggregates across RO Billing, Workshop/Open RO, KIA Complaints, and EW/RSA/MCP.
  - Uses the same Redis 75-minute dashboard TTL pattern as the other Business Excellence APIs.
  - Intentionally returns visual-summary data only; no large detail tables.

- `POST /api/brands/kia/business-excellence/ai-summary`
  - Groq-backed AI summary endpoint.
  - Supports Business Excellence Overview, RO Billing Report, Workshop Performance, Open RO, and KIA Complaints.
  - Uses compact payloads to stay within Groq token limits.

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

Current overview metrics include:

- Revenue, labour, parts, total JC, average billing.
- Open RO, delayed RO, RO over 15 days, average open aging.
- Complaint totals, open complaints, complaint aging.
- EW/RSA/MCP counts.
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

### Performance Optimizations Completed

- Metadata API limited to RO Billing only and uses projected RO Billing columns instead of querying `information_schema` on every cold metadata build.
- RO Billing paginated table rows use a projected-column fast path and skip `information_schema` metadata lookups on row requests.
- RO Billing analysis moved toward SQL aggregation.
- RO Billing analysis now supports batched metric loading with `metrics=all` for table, trend, and FY views. The API returns a `byMetric` payload for Load, Labour, Parts, Lab/Veh, and Part/Veh from one SQL summary query, and the frontend consumes that bundle instead of firing one request per metric.
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
- AI Summary exists in Business Excellence and is backed by Groq. Keep payloads compact because free/on-demand Groq tiers have strict TPM limits.
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
  - Workshop frontend preserves the API Grand Total addon values when rebuilding display buckets, so `LAB/RO(-VAS)` uses `(Grand Total Labour Amt - Grand Total Less VAS) / Grand Total JC`.
  - Workshop table display is normalized into the same operational buckets as RO Billing: Paid Service, Free Services, Running Repairs, MECH, Others, MECH TOTAL, Accident, and Grand Total.
  - Workshop API returns parent `work_type` and child `service_type` detail for table rows, so Free Services can expand into First/Second/Third Free Service where data exists.
  - Workshop API now prefers `workshop_performance_jc_summary_v1` when present. This materialized view stores pre-deduped job-card rows, allowing service table, daily movement, and advisor aggregations to avoid repeated raw `ro_billing_report` scans.
  - `scripts/dashboard-performance-optimization.sql` creates `workshop_performance_jc_summary_v1`; refresh it after cron imports with `REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1;`.
  - Workshop API also prefers `workshop_operation_addon_summary_v1` when present, so VAS/WA/WB regex classification is precomputed monthly instead of repeated on every request. Refresh it after cron imports with `REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;`.
  - Workshop table service buckets are expandable only when the child rows are distinct from the parent bucket, avoiding duplicate rows such as Paid Service -> Paid Service.
  - Workshop table hides mileage-only paid-service child labels such as `30K`, `40K`, etc., and keeps Accident collapsed to match the RO Billing table behavior.
  - Workshop table money values use compact Indian notation such as `₹2.57L` for readability.
  - Workshop charts render as full-width stacked sections to avoid cramped visuals.
  - Workshop matrix rows are compact with visible row/column borders for denser operational reading.
  - The Workshop matrix is the first full-width block in the report because it is the primary operational view.
- Executive-style analytics visuals and chart expansion behavior.
- Sales Team Leaderboard is now a dedicated Business Excellence analysis tab, backed by server-side service-advisor aggregation instead of the old in-Analytics placeholder.
- Sales Team Leaderboard top 3 ranks now use crown-style gold/silver/bronze badges.
- RO Billing Table dropdowns now avoid noisy service rows:
  - Free Services shows actual `service_type` labels such as First/Second/Third Free Service.
  - Paid Service hides mileage/package-like child labels such as `100K`, `110K`, etc.
  - Others expands by remaining `work_type` labels where available, such as Refurbish, E Breakdown, AMC - TM, NVI, and similar categories.
  - Blank/Unspecified/self-repeated child rows are filtered out.
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

Whenever a major feature, architecture change, API change, workflow rule, or cache/state decision is implemented, update this file in the same change set. Future AI tools and developers should treat this file as the project handoff map.
