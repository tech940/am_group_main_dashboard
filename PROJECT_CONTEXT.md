# Project Context

Last updated: 2026-06-03

## Project Overview

Main Dashboard is a Next.js 16 App Router application for AM Group vehicle operations. It covers purchase-order workflow management, Finance Orders, and KIA Business Excellence analytics, with the current build focused on approval workflows plus KIA Business Excellence sections for the unified overview, RO Billing, Workshop Performance, Open RO, and KIA Complaints.

The application is designed for operational users across Admin, CEO, Purchase Manager, Finance Head, EA, MD, Accounts, and brand/branch-specific teams. The core goals are fast dashboards, controlled workflow visibility, branch-aware access, and executive-style analytics.

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

## Business Excellence Date & Comparison Rules

- AM KIA and AM Platinum Business Excellence must use the shared date helpers in `lib/business-excellence/comparison.ts`. The default effective filter is always current month-to-date (`YYYY-MM-01` through today), and the shell should pass that explicit filter to Overview, Executive Dashboard, RO Billing, Workshop Performance, Open RO, Complaints, Platinum SOT, AI Summary, and raw RO Billing row fetches instead of leaving `appliedDateFilter` null. A full calendar month is shown only when the user explicitly selects month start through month end. Year mode is canonical for both brands: current year sends `YYYY-01-01` through today, while past years send `YYYY-01-01` through `YYYY-12-31`. Manually selected Compare Dates remain exact and are preserved separately from the CY/current range.
- Business Excellence now includes an Admin/CEO/MD-only `Executive Dashboard` report at `/brands/kia/business-excellence/executive-dashboard`. It defaults to combined Jammu + Udhampur performance by omitting `dealer_code`, exposes an All Locations/Jammu/Udhampur selector, and reuses the RO Billing analysis endpoint for table, trend, revenue performance, growth contribution, and FY revenue/load calculations instead of introducing duplicate calculation logic. This report is intentionally excluded from the legacy raw-sheet row fetcher; it must not call `/api/brands/kia/business-excellence?sheet=executive_dashboard`.
- Executive Dashboard data is sourced from the RO Billing analysis API cache namespace `kia:business-excellence:ro-billing:v25`. Its table, daily trend, FY trend, and revenue cards use raw deduped `ro_billing_report` aggregations with the selected `dealer_code` instead of `ro_billing_daily_summary_v2`, because the summary view can be stale or branch-incomplete and can make KPI cards show zero. The Executive Dashboard freshness check is limited to `ro_billing_report` so the header timestamp does not hang while unrelated section sources are scanned.
- Executive Dashboard layout is fixed to management-card order: summary KPI strip, Overall Load table, Service Type Performance table, then the Labour Revenue, Parts Revenue, and Growth Contribution panels visible together in one row on wide screens with no toggle. Trend Graph and FY Trends render as separate full-width rows, not side-by-side. The Executive Trend Graph includes the same target-stat strip expected from RO Billing trend views: Month Target, MTD Target, MTD Achieved, Shortfall T.D, Monthly Shortfall, Projected Closing, and Asking Rate, calculated from the selected period and clamped so achieved targets do not show extra shortfall.
- Executive Dashboard tables in AM KIA, AM Platinum, and Hyundai support inline maximize/minimize controls for Overall Load, Service Type Performance, Labour Revenue, Part Revenue, and FY Trends. Maximized tables span the full available content width inside their local grid, preserve horizontal table scrolling, and keep sibling tables/panels visible below; Growth Contribution is not a table and must remain non-maximizable.
- Executive Dashboard Service Type Performance uses the same derived management rows as RO Billing (`Paid Service`, `Free Services`, `Running Repairs`, `MECH`, `Others`, `MECH TOTAL`, `Accident`, `Grand Total`) and includes its own Load/Labour/Parts/Labour per Vehicle/Parts per Vehicle selector. Labour and Parts Revenue panels reuse those derived rows and keep compact nowrap cells so values do not overlap. Executive tables use compact 11px typography; the metric selector buttons always render on solid white surfaces, and growth pills stay solid white even on black MECH/MECH TOTAL/Grand Total rows so only the growth text itself carries green/red meaning.
- Business Excellence section headers show a report-specific `Updated:` timestamp from `/api/brands/kia/business-excellence/freshness`, formatted in IST. The freshness API checks each section's relevant source tables, applies direct dealer-code filters where a table has a dealer column, and returns the latest available `uploaded_at` timestamp so users can see when each section's data was last refreshed.
- KIA Business Excellence and Demo Job Cards are branch-segregated through the global `dealer_code` URL parameter. `JK402` maps to Jammu and `JK501` maps to Udhampur. Business Excellence pages expose a common Jammu/Udhampur toggle and preserve the selected dealer while navigating reports or changing dates. APIs must read `dealer_code` and filter direct dealer columns where present; legacy tables without dealer fields derive branch by matching vehicle/VIN data against `ro_billing_report`.
- Business Snapshot KPI comparisons must be date-cutoff aligned. A current range such as `2026-06-01` to `2026-06-02` compares to `2025-06-01` to `2025-06-02`, never the full prior-year month. Revenue, Labour Revenue, and Parts Revenue remain exact `ro_billing_report.bill_date` windows using active bills only and `Revenue = labour_amt + part_amt`.
- RO Billing analysis period windows also use same-day LY for MTD/QTD/YTD comparisons. Revenue Performance tables, KPI strips, trend cards, and comparison payloads must respect the active selected date range and optional comparison range.
- RO Billing target strip calculations are selected-period driven: MTD Target is prorated by selected through-day, MTD Achieved uses only actuals through that selected day, Shortfall T.D compares MTD target vs MTD actual and clamps to `0` once achieved, Projected Closing annualizes the selected-period run rate across the selected month, Monthly Shortfall clamps to `0` once projected closing beats target, and Asking Rate uses only remaining target after MTD actuals.
- Historical/custom RO Billing trend selections must use the selected `startDate`/`endDate` first, regardless of filter mode. Completed months use the full selected month for MTD Target and MTD Achieved; they must not fall back to the current live day in a later month.
- RO Billing client-side fallback table/stat calculations align LY MTD/QTD/YTD to the selected through-day instead of using the full previous month, quarter, or year.
- Business Excellence sidebar/report-selector navigation opens in the same tab. KIA Business Excellence submenu links and report dropdown changes should not use `target="_blank"` or `window.open`.
- Business Snapshot RO Billing Daily Trend legend/tooltip labels must distinguish Current Year (CY) and Last Year (LY).
- Complaint health/status logic is inverted: higher complaints or positive complaint growth is worse, so complaint cards must not show GOOD when CY complaints rise materially above LY.
- RO Billing Analysis progression toggles are exclusive. Selecting Labour, Parts, Total Revenue, or Load hides all other series instead of fading them.
- Revenue bucket and RO Billing chart tooltips format numeric values with Indian separators and at most two decimals; raw floating-point precision must never be shown.
- Revenue Performance Labour and Parts views break down revenue by Mechanical, Accidental, Paid Service, Free Service, Running Repair, Others, and Total across MTD/QTD/YTD CY/LY/Growth. Growth percentages render as white-background bright success/risk pills so positive/negative values remain readable on black MECH/Grand Total rows.
- Revenue Performance Growth view must show the exact CY selected date range, LY/custom comparison date range, CY revenue, LY revenue, and formula `Growth = (CY Revenue - LY Revenue) / LY Revenue x 100`; it must not use vague labels such as "month over month" when the selected period may be custom or historical.
- RO Billing work-type table/matrix summaries read from raw `ro_billing_report` rows for correctness. The daily summary view can lag behind imports, so the management matrix avoids it to keep MTD/QTD/YTD values internally consistent.
- RO Billing table and Revenue Performance total rows roll up available LY child values instead of letting one child `N/A` make `MECH TOTAL`, `Grand Total`, `Total Labour`, or `Total Parts` display `N/A`; individual child rows can still show `N/A` when that specific service category has no comparable LY load.
- Business Excellence calendar views are optional modal overlays, not inline dashboard panels. Open RO and KIA Complaints expose `Calendar View` buttons above their KPI sections, and RO Billing exposes a `Calendar` launcher beside Table/Trend/FY/Analytics. The calendars open as full-viewport popups with scrollable responsive content, close controls, and reuse the section's loaded detail/trend data. RO Billing calendar day targets use rolling redistribution only inside calendar views: each day target is recalculated from `remaining monthly target / remaining days`, where remaining target is reduced by actual CY achievement up to the previous day. Normal trend cards, KPI strips, and non-calendar target summaries do not use this rolling calendar logic.

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
- Notification permission modal styling must follow the active theme palette using dashboard variables and `app-primary-action`/`app-outline-action`; avoid fixed navy/magenta modal backgrounds.
- Purchase Order completed/spending view uses `scope=spending` and optional `spendStartDate`/`spendEndDate`; date strings must be valid `YYYY-MM-DD` before the client sends them or the API applies them. The API compares the raw `COALESCE(received_date_time, completed_at, created_at)` spend-date expression against ISO strings cast to `timestamptz`, not JS `Date` params, to avoid postgres-js Date parameter crashes.
- KIA complaint comparison cards need visible borders. Customer Complaint Details should not have a search bar, and complaint row expand buttons should be borderless/plain with only the chevron affordance.
- KIA Complaints analytics must not go blank when the selected CY/current date range has zero complaint rows. The complaints API keeps KPI/detail-register rows scoped to the selected current range, but area/dealer/model/source/sub-area analytical tables use an `analysis_scope` fallback: current-period rows when present, otherwise the combined CY and LY comparison windows. Cache namespace `kia:business-excellence:complaints:v6` includes this behavior.
- Open RO Service Type Aging expanded rows should stay compact: only vehicle number, workshop days, and aging category are shown inline. Clicking a vehicle opens a popup with the full RO/customer/advisor/status/financial/alert/remarks details.
- Business Excellence uses the `business-excellence-boundaries` wrapper in `features/kia/business-excellence-page.tsx`; `app/globals.css` applies scoped borders to its cards, buttons, controls, rounded metric surfaces, and table cells so each section is visually distinct.
- Global top route loader follows the selected theme's `--dashboard-primary` color and is manually started for sidebar navigation.
- The navbar has a full theme picker in `components/layout/header.tsx`. It stores the selected option in `localStorage` as `dashboard-accent`, applies it to `<html data-dashboard-accent="...">`, and offers Skydash, StarAdmin, Breeze, Corona, Purple, Midnight, Executive Navy, Executive Dark, Clean Corporate, and Modern Luxury palettes. Corona is the default palette for new/unsaved sessions. `app/layout.tsx` applies the stored accent before interactive paint and maps older saved accent names back to Corona.
- `Midnight` is a dark-color accent palette only; selecting it must not automatically enable `.dark` mode. `app/layout.tsx` includes a one-time migration that resets the old forced `dashboard-theme=dark` state for users who had selected Midnight before this behavior was decoupled. The separate moon/sun button remains the only control that changes light/dark mode.
- `Executive Dark` is a full dark theme option and intentionally sets `dashboard-theme=dark` when selected. `Clean Corporate` and `Modern Luxury` intentionally set `dashboard-theme=light` when selected. Older accent-only palettes leave the moon/sun mode untouched.
- Shared theme colors live in `app/globals.css` as `--dashboard-primary`, `--dashboard-primary-dark`, `--dashboard-primary-light`, `--dashboard-primary-soft`, `--dashboard-primary-border`, RGB/HSL variants, and `--dashboard-support-1..5`. Existing hard-coded `#023468`/navy Tailwind arbitrary classes and matching SVG chart strokes/fills are globally mapped to these variables so major headers, buttons, table headers, sidebar gradients, charts, and Business Excellence boundaries follow the selected palette.
- Success, warning, and danger utilities are also tokenized in `app/globals.css` through `--dashboard-success-*`, `--dashboard-warning-*`, and `--dashboard-danger-*`, so green/yellow/red badges, growth labels, status pills, borders, and chart accents can follow Executive Dark, Clean Corporate, and Modern Luxury without fixed Tailwind colors leaking through.
- Primary CTA buttons must use the high-contrast action tokens `--dashboard-action-bg`, `--dashboard-action-hover`, and `--dashboard-action-fg`, or the `app-primary-action` class. Do not use palette `primary-light` as a CTA gradient end because light palettes such as Skydash make white button text hard to read. Outline toolbar/filter/pagination buttons should use `app-outline-action`, including disabled pagination controls so labels remain readable.
- Purchase Order workflow and completion/spending filter buttons must use `app-primary-action` for active states and `app-outline-action` for inactive states; avoid local `bg-slate-*` plus forced muted helper text because palette overrides can make active labels unreadable.
- Purchase Order EA/MD approval dashboards, table headers, approve buttons, card-view controls, and Stage 3 approval panels must use dashboard theme tokens (`app-primary-action`, `app-outline-action`, `--dashboard-action-bg`, `--dashboard-action-fg`) instead of fixed white/teal/purple/indigo styling so labels remain readable across all palettes.
- Purchase Order EA/MD approval table and card views include a small image/document preview icon per order. The icon opens request/vendor/bill/GRN/accounts/quotation/invoice/payment documents directly from the approval dashboard, and its hover text includes the exact PO number, department, requester, and vendor so approvers know which transaction they are on.
- Purchase Order document preview must never leave approvers on an endless spinner. Image/PDF previews timeout after 10 seconds into a clear "Preview not available" state with an Open file fallback; unknown file types skip inline preview and show Open file immediately.
- Authenticated app-user lookup should tolerate transient Supabase/Postgres pooler connection hiccups: `lib/auth/app-user.ts` retries once for `CONNECT_TIMEOUT`/connection-terminated errors, and `lib/db/index.ts` uses a 15-second Postgres connect timeout.
- Before making changes live, run `npm run pre-live`. It executes `scripts/pre-live-check.js`, which validates required env vars, checks Postgres connectivity, runs ESLint, runs `tsc --noEmit`, and performs a production build.
- ESLint intentionally ignores `scripts/**` and `public/**`; the dashboard has CommonJS maintenance scripts and service-worker assets that are not part of the Next app source lint surface.
- Login and Admin User Management create-user password inputs include show/hide password icon buttons so users can reveal passwords while typing when needed.
- Finance Head is a first-class role in User Management and can be assigned from the admin user form.
- Admin User Management table avatars use the `.admin-user-avatar` class with theme action tokens so initials remain visible on glass table rows.

Important implementation files:

- `components/layout/main-layout.tsx`
- `components/layout/header.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/notification-bell.tsx`
- `app/globals.css`
- `lib/branches.ts`
- `lib/dashboard-config.ts`
- `features/finance-orders/finance-orders-page.tsx`
- `app/api/finance-orders/route.ts`
- `app/api/finance-orders/workflow/route.ts`

Shared repeated dropdown/config data should live in `lib/dashboard-config.ts` or a focused config file that it re-exports. Branch definitions stay in `lib/branches.ts`; `lib/dashboard-config.ts` re-exports branch helpers and owns shared user-role options plus Finance Order bank options. Do not reintroduce one-off hardcoded branch, role, or bank lists inside pages/forms.

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
- Every section that starts an API request must render a section-level skeleton for the data surface being replaced, whether that surface is cards, charts, tables, or detail panels. Do not leave stale rows/cards visible during a date/filter/advisor/page-change fetch unless the UI also shows a dedicated inline skeleton for the exact refreshing sub-surface.

Implementation files:

- `components/providers/query-provider.tsx`
- `app/layout.tsx`
- `lib/hooks/use-user-role.ts`
- `components/layout/header.tsx`

## Business Excellence

### Active Scope

KIA Business Excellence is route-driven and section-based. The default screen is a CEO/MD "Business Excellence Overview" command center with KPI cards, one management-grade RO Billing performance table, compact section comparison cards, and only a few charts after the decision data. Detailed sections remain available as separate report routes.

Business Excellence overview is now CEO/MD-first: the landing route does not render the Executive Layer V2.1 widget, and the Business Snapshot section is KPI-only. Snapshot KPI cards include a clickable Business Health Score card, Revenue, Labour Revenue, Parts Revenue, Load/JC, Average Billing, Labour/Vehicle, Parts/Vehicle, VAS Revenue, Open RO, WIP Risk, Complaint Closure, Add-on Penetration, and Accident WIP. Snapshot card surfaces stay white even for good/watch/risk tones; use colored borders/text/badges instead of green/amber filled card backgrounds. The Health Score is calculated from snapshot data using weighted revenue/labour/parts/load/average billing/VAS growth plus delayed RO, >15D RO, and complaint control risk signals; clicking the card opens a calculation breakdown with weights, scores, CY revenue, LY revenue, positive drivers, and negative drivers. The snapshot header also shows overall CY vs LY growth. The landing hierarchy is KPI cards, the existing RO Billing Performance table with Metric/CY/LY/Growth, a second RO Billing matrix showing Load/Labour/Parts/Labour per Vehicle/Parts per Vehicle across TD, MTD, QTD, and YTD, a work-type RO Billing table with the same Load/Labour/Parts/Labour per Vehicle/Parts per Vehicle metric selector used in the detailed RO Billing report, a RO Billing daily trend chart using the same analysis data as the detailed RO Billing report with visible line value labels, compact CY/LY/Growth cards for Workshop/Open RO/Complaints/Add-ons, then a maximum of three charts at the bottom. Business Snapshot default LY comparisons use same-day historical cutoff windows when no explicit Compare Dates range is selected: month-anchored/current-month ranges compare through the same day last year, QTD/current-quarter through the same quarter day last year, YTD through the same calendar date last year, and current FY through the same financial-year day last year. Explicit Compare Dates still uses the exact user-selected LY range. Open RO and WIP Risk are current-status/as-of metrics and show `No comparable LY` unless a historical as-of WIP snapshot source exists. Detailed report routes can still render Executive Layer V2.1 before charts/tables; that layer must not duplicate AI Summary narration or show its own AI Summary button. It remains a compact management command center with section-specific score/status, previous score/change, positive and negative score drivers, target achievement, top driver, biggest concern, focus areas, and data confidence. RO Billing detailed navigation includes the analyst views Table, Trend, FY Trends, Analytics, Revenue, Leaderboard, and Intelligence, and must not wrap the detailed content in the old admin-only AccessControlOverlay; branch-authorized KIA users must see the full RO Billing report. The separate admin performance diagnostics button/panel remains removed from the Business Excellence shell. Success/positive color is standardized around LAB(80 -85.05 36.36), converted to sRGB #00e97e and used directly for positive text/background tokens in global CSS. The Business Excellence date picker is intentionally capped to a compact panel that is about 860px wide, not full dashboard width. Overview API summary chunks include lightweight LY comparison metrics directly and use cache namespace `kia:business-excellence:overview:v29`, so Business Snapshot cards never sit on "LY loading" or reuse stale full-month LY payloads while waiting for secondary chart data. Overview RO Billing KPI/comparison SQL applies the same active bill-status rule as the detailed RO Billing analysis endpoint, excluding `cancel`, `cancelled`, and `canceled` bills so Snapshot LY revenue cannot be inflated by cancelled billing rows.
- Executive health builders must tolerate the initial undefined React Query payload while section data is loading. They should treat missing payloads as empty data instead of reading fields directly from `undefined`, otherwise server/dev renders can crash before the query resolves.

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
- Workshop VAS: `operation_wise_analysis_report.report_period_start/report_period_end`; Workshop WA/WB: `operation_wise_analysis_advisor_report.report_period_start/report_period_end`
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
  - Uses Redis with the 40-minute dashboard TTL and returns chart/table-ready payloads.
  - Prefers `workshop_performance_jc_summary_v1` only when that materialized view covers the full requested date range; otherwise it falls back to raw `ro_billing_report` so service-type JC counts stay aligned with RO Billing.
  - Supports an `advisor` query parameter for the Service Type Performance tables. The selected service advisor filters JC/revenue, VAS/WA/WB, daily trend, and core service rows at the SQL/cache-key layer while the advisor dropdown itself remains populated from the unfiltered advisor summary for the active date range. EW/RSA/MCP auxiliary counts are suppressed in advisor-filtered payloads because those sources are not reliably advisor-attributable.

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
  - When the Workshop Snapshot reads `workshop_performance_jc_summary_v1`, it groups service rows by `group_type` only; do not fall back to `service_type` for visible labels because that can reintroduce mileage slabs like `30K`/`40K`. Keep the SELECT and GROUP BY expressions identical to avoid runtime SQL failures.
  - Uses the same Redis 40-minute dashboard TTL pattern as the other Business Excellence APIs.
  - Intentionally returns visual-summary data only; no large detail tables.

- `GET /api/brands/hyundai/repair-orders`
  - AM Hyundai Repair Orders API used inside the Hyundai Business Excellence shell.
  - Reads `hyundai_repair_order_list`, enforces Hyundai Business Excellence access first with a legacy `hyundai.repair_orders.view` fallback, returns summary KPIs, filter options, source `MAX(uploaded_at)`, and 10-row paginated repair-order rows.
  - Supports search across RO number, registration, VIN, model, advisor, technician, status, and RO status, plus status/work-type/advisor/date filters.
  - Uses Redis dashboard TTL and returns an empty warning payload if the source table is not installed yet.

- `GET /api/brands/hyundai/business-excellence/ro-billing-report`
  - AM Hyundai RO Billing Report API used inside the Hyundai Business Excellence shell.
  - Reads `hyundai_ro_billing_report`, enforces `hyundai.business_excellence.view`, returns summary KPIs, bill/work-type/advisor options, source `MAX(uploaded_at)`, and 10-row paginated billing rows.
  - Supports search across bill number, RO number, customer, mobile, VIN, registration, model, advisor, technician, and work type, plus bill-type/work-type/advisor/date filters.
  - Uses Redis dashboard TTL and returns an empty warning payload if the source table is not installed yet.

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
- Redis dashboard TTL is 40 minutes.
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
- The theme-colored route loader should show when navigating from the sidebar into Purchase Orders.

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

## Finance Orders

Finance Orders is a separate module from Purchase Orders. It has its own route, APIs, tables, workflow, and permissions.

### Data Model

Dedicated tables:

- `finance_orders`
- `finance_order_workflow`
- `finance_order_comments`

Database setup script:

```bash
npm run db:setup-finance-orders
```

The npm script loads `.env`, applies `scripts/create-finance-orders.sql`, and verifies that the three Finance Order tables exist. Use this instead of running `psql "$DATABASE_URL" ...` directly from PowerShell, because running outside the project folder can leave `DATABASE_URL` empty and make `psql` try local `localhost:5432`. The SQL adds the `finance_head` and `ceo` role enum values when missing, creates Finance Order stage/status enums, and creates the three Finance Order tables plus indexes. This script must run in the target database before the module is used.

### Form Fields

The Finance Order form captures:

- Total Payout Received
- Invoice Number
- Payment Received Date
- DSE Payout
- Hyp / Bank Name
- DSE Name
- Dealer

All fields are validated on the client and again in `/api/finance-orders` before insert/update.

### Workflow

Current workflow:

1. Finance Head/Admin creates a draft or submits a Finance Order.
2. Submitted orders move to Accounts payment verification.
3. Accounts/Admin checks whether payment has been received.
4. If payment is received, Accounts marks `Payment Received` and the order moves to EA approval.
5. EA can Approve, Hold, or Deny.
6. EA approval moves the order to MD approval.
7. MD can Approve, Hold, or Deny.
8. MD approval completes the Finance Order.

Hold and deny actions require remarks. Accounts hold/deny sends the order back to Finance Head visibility with remarks. Every save/submit/payment verification/approval/hold/deny action writes an audit row to `finance_order_workflow`; action remarks are also stored in `finance_order_comments`.

### Access Rules

- Only Admin, CEO, MD, EA, Accounts, and Finance Head can access `/finance-orders` and `/api/finance-orders`.
- Sidebar visibility follows the same allowed-role set.
- Backend APIs enforce the role checks and do not rely on sidebar visibility.
- Only Admin and Finance Head can create Finance Orders.
- Finance Head can see and manage only their own Finance Orders.
- Admin, CEO, EA, MD, and Accounts can read all Finance Orders.
- Accounts can read all Finance Orders and act only on Accounts payment-verification queue orders.
- Accounts/Admin can mark payment received, hold, or deny in the Accounts queue.
- EA/Admin can act on EA approval queue orders.
- MD/Admin can act on MD approval queue orders.
- Finance Head users redirect to `/finance-orders` after login and from the root route.
- Accounts, EA, and MD land on `My Queue` by default, which is server-filtered to only the pending Finance Orders for their current stage. They can switch to `All Orders` explicitly when they need wider visibility.
- Accounts, EA, and MD visibility is also branch-aware. If their assigned branch access is not `All Branches`, Finance Orders are filtered by the order's Dealer branch. Older Finance Orders that stored dealer labels such as `AM Kia` are still matched against the branch key.

### Notifications

Finance Orders uses the existing notification table and bell pattern with `metadata.module = finance_orders` and `actionUrl = /finance-orders?orderId=...`.

Notification routing:

- Submitted Finance Order -> Accounts
- Accounts payment received -> EA
- Accounts Hold/Deny -> Admin, relevant Finance Head, and creator
- EA Approved -> MD
- EA Hold/Deny -> Admin, relevant Finance Head, and creator
- MD Hold/Deny -> Admin, branch EA users, relevant Finance Head, and creator
- MD Approved/Fully Approved -> relevant Finance Head, Admin, and creator
- Stage notifications to Accounts, EA, and MD are branch-scoped using the Finance Order Dealer branch, with `All Branches` users still included.
- The relevant Finance Head is resolved like Purchase Orders resolves the responsible Purchase Manager: use the order creator when they are Finance Head, otherwise the first Finance Head workflow actor. Do not notify unrelated branch Finance Heads for Admin-created orders because Finance Head visibility is limited to orders they own/touched.

### UI Notes

The Finance Orders UI intentionally does not copy the older Purchase Orders form. It uses a modern SaaS-style layout with a clean header, compact queue/status summary cards, a payout spending section, and a compact searchable register with both Table and Cards view modes. Table view is the default. Register filters include a modern status-group dropdown for `Pending`, `All`, `Completed`, and `On Hold`, plus branch, exact status, search, and the role-aware `My Queue`/`All Orders` toggle. The register toolbar is right-aligned with compact fixed-width controls so it uses the empty space on the right instead of crowding the section title. Avoid rendering the status-group choices as separate buttons because they overlap in the register toolbar on narrow screens. The spending section owns payout totals to avoid duplicated payout cards in the top summary; it has start date, end date, and branch filters and reads aggregate payout/DSE/completed/pending values from the Finance Orders API instead of deriving totals from the visible page only. Row/card-level `Open` actions use the active theme action color and open a popup-based order detail/approval/audit review. Finance card view uses a light theme-tinted gradient. EA/MD/Admin table users can select multiple actionable rows and run bulk Approve, Hold, or Deny actions; each actionable table row also exposes Approve, Hold, Deny, and Open actions. Finance Order popups use theme-colored headers, visibly separated detail fields, and close automatically after successful workflow actions. The popup status badge sits inside the title content, not in the top-right close-button area. The form uses a responsive grid, datalist-backed bank field, branch-backed Dealer select, validation messages, and skeleton loading states.
When the Finance Orders register is in the completed view, show a PDF export action. It calls `/api/finance-orders?export=completed` with current branch/search visibility filters and returns every completed Finance Order the user can access, not only the current paginated page. The PDF export uses the app's existing print-window pattern for print/save-as-PDF output.
Finance Orders approval CTAs must stay high contrast on the glass sidebar panel: Approve/Open use the `finance-primary-action` class, Hold uses `finance-warning-action`, Deny uses `finance-danger-action`, and approval checkboxes use `finance-order-checkbox` so checked/indeterminate states stay visible across themes.
Dealer on the Finance Order form uses the same branch option source as Admin User Management's Assigned Branch Access (`USER_BRANCH_OPTIONS` from `lib/branches.ts`) and stores the branch value while displaying the readable branch label.
Finance Order bank options come from `FINANCE_BANK_OPTIONS` in `lib/dashboard-config.ts`; keep new bank names there so the form and future finance features stay in sync.

## Notifications

- Notification Bell uses `/api/notifications`.
- Notification API is intentionally excluded from generic session GET caching to preserve realtime/unread behavior.
- Browser/realtime notification behavior should continue to rely on Supabase realtime listeners and explicit notification state changes.
- Notification permission prompts and browser notification fallback labels must stay module-neutral (`workflow`/`order`) because the same bell now serves Purchase Orders and Finance Orders.

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
- Open RO Job Card Delay Reason Summary mirrors the Service Type Aging vehicle drilldown: status rows aggregate counts by `new_r_o_status`, clicking a status directly expands compact vehicle rows, and clicking a vehicle opens the full-detail popup. Reason rows are intentionally not shown inline; each compact vehicle row shows Vehicle No, Delay Reason, Workshop Days, Aging Category, and RO Number. The Open RO cache key was bumped after the status/reason payload change.
- Open RO Service Type Aging expanded rows stay compact with Vehicle No, Workshop Days, and Aging Category only; clicking a vehicle opens a full-detail popup.
- KIA Complaints is now a Business Excellence section using `kia_call_center_complaints`, including month/year comparison, complaint area analysis, dealer/sub-area summaries, and complaint detail expansion.
- AI Summary exists in Business Excellence and is backed by Groq. Keep payloads compact because free/on-demand Groq tiers have strict TPM limits. AI Summary output must use Indian rupees only, no dollar symbols, and no Cr/Lakh abbreviations in the summary cards.
- Business Excellence Overview Business Snapshot now includes a clear Workshop Snapshot panel distinct from Workshop WIP. Workshop Snapshot is closed-job performance; Workshop WIP is open repair-order pressure.
- Business Excellence high-latency endpoints now load in chunks for faster first paint:
  - Overview `/api/brands/kia/business-excellence/overview` defaults to `chunk=summary` and returns KPI/snapshot cards first; the frontend then fetches `chunk=secondary` for charts and LY comparisons.
  - Open RO `/api/brands/kia/business-excellence/open-ro` defaults to `chunk=summary`; the frontend then fetches `chunk=details` for vehicle rows and drilldowns.
  - KIA Complaints `/api/brands/kia/business-excellence/complaints` defaults to `chunk=summary`; the frontend then fetches `chunk=secondary` for charts/comparison and `chunk=details` for register rows.
  - Legacy/direct requests without `chunk` intentionally return the summary payload only, so large default responses do not hit Vercel timeouts.
- API requests are excluded from the Supabase session middleware matcher because API routes already enforce their own auth. This avoids paying the Supabase auth network check twice for every dashboard API call. `getAuthenticatedAppUser()` now prefers verified Supabase claims and caches the active app-user lookup in memory for 60 seconds with in-flight dedupe, so parallel dashboard chunks do not repeat the same `users` query.
- Workshop Performance is now a dedicated Business Excellence report option in the sheet dropdown, directly below RO Billing Report, with server-side multi-table aggregation. JC matches the RO Billing table logic using `COUNT(DISTINCT COALESCE(bill_no, ro_no, id))`, not raw row count.
- Workshop Performance addon definitions:
  - WA = Wheel Alignment.
  - WB = Wheel Balancing.
  - VAS = Value Added Services.
  - KIA Business Excellence management-facing service categories, charts, filters, snapshot workshop rows, Workshop Performance core rows, RO Billing analysis groups, and Open RO work-type options use `ro_billing_report.work_type` / source `work_type` as the canonical category. `service_type` is detail/audit-only and must not drive visible BE grouping or filter labels because it contains mileage/package slabs such as `10K`, `30K`, `40K`, and `70K`.
  - `operation_wise_analysis_report` is the addon source for VAS/WA/WB, classified from `op_part_code` and `op_part_desc`.
  - The UI label `OP/Part Desc.` maps to SQL column `op_part_desc`.
  - VAS classification includes known OP/Part Desc values such as AC Evaporator Cleaning, Throttle Body Carbon Cleaning, AC Disinfectant, Rodent Repellent, Under Body Coating, Interior/Exterior Enrichment, Alloy Wheel Care, Air Intake Cleaning, Engine Dressing, Service Lubrication, Wheel Drum Painting, and Silencer Coating. Painting Charges S1 and Removal & Refit Work S1 are explicitly excluded.
  - WA/WB classification uses OP/Part Desc values such as Wheel Alignment and Wheel Balancing.
  - Operation-wise addon amounts use `total_amt`. VAS in both Business Snapshot and Workshop Performance must use cumulative `report_period_start` / `report_period_end` windows for the selected range, not the broad `report_month` bucket, so partial-month selections do not pull full-month VAS.
  - Workshop VAS amount is calculated from distinct `operation_wise_analysis_report` rows with `report_type` in `Operation` or `Part`; this keeps VAS as labour plus parts. Classification is based on known VAS descriptions, not generic operation-code substrings, so bodyshop-style codes such as `A10VAS1...` are not included merely because the code contains `VAS`.
  - Workshop VAS KPI now calculates CY from `operation_wise_analysis_report.report_period_start` / `report_period_end`, matching Business Snapshot for partial-month ranges; cache version was bumped after this fix so stale month-level VAS cards are not reused.
  - Business Snapshot VAS Revenue comparisons first use exact `operation_wise_analysis_report.report_period_start` / `report_period_end` matches across both `Operation` and `Part` rows. If no exact operation-wise period exists, the overview falls back to filtered `adv_wise_lubricants_vas` rows by exact `gst_invoice_date` and sums `taxable_amount` for VAS-like labour/part descriptions. It must never fall back to a full-month `report_month` bucket for a partial selected range; for example `2025-06-01` to `2025-06-04` resolves from invoice-level VAS rows instead of full June 2025 operation-wise VAS.
  - Workshop auxiliary KPI cards such as EW Count, MCP Count, and RSA Count also calculate LY/growth when prior-year data exists.
  - Workshop table has EW Count, RSA Count, and MCP Count at the end of the table, including the Grand Total row.
  - Workshop Performance now renders a second "Service type core performance table" directly below the full Service Type Performance table. The core table uses the legacy detailed service breakdown with Paid Service, Free Services, Running Repairs, MECH, Others, MECH TOTAL, Accident, and Grand Total, while hiding VAS %, WA/WB count/amount/RO %, Less VAS, EW Count, RSA Count, and MCP Count.
  - Less VAS uses only `operation_wise_analysis_report.total_amt`, is not allocated to service-type rows, and appears only on the Workshop Grand Total row because operation-wise data has no service-type split.
  - Workshop `LAB/RO(-VAS)` rolls up each displayed row's already-clamped `Labour Amt - Less VAS` amount, then divides by JC. Parent and Grand Total rows must not recompute `max(total labour - total VAS, 0)` because excess VAS in one bucket can incorrectly wipe out other buckets.
  - Workshop table display used to normalize into RO Billing-style operational buckets, but the management-facing Service Type Performance table now uses the simplified MECH vs Accident advisor classification described below.
  - Service Type Performance table was simplified for management: the Workshop Performance API returns `MECH`, `Accident`, and `Grand Total` rows for that table. Paid Service, Free Services, Running Repairs, Others, and MECH TOTAL remain hidden from the main management table and are preserved in the separate Service Type Core Performance table.
  - Workshop MECH vs Accident classification is centralized in `lib/business-excellence/workshop-classification.ts`. `ACCIDENT_ADVISORS = ['Parul Bakshi', 'Naresh']`; all other service advisors are classified as MECH.
  - Workshop Service Type Performance JC/revenue/labour/parts/discount are grouped by advisor category at the SQL layer using `workshop_performance_jc_summary_v1` when fresh, otherwise raw `ro_billing_report`. WA/WB are grouped by the same advisor category from `operation_wise_analysis_advisor_report`; total VAS uses the period-aware `operation_wise_analysis_report` amount so it stays aligned with Business Snapshot.
  - Workshop Service Type Performance rows are no longer expandable because the main table is intentionally limited to MECH, Accident, and Grand Total management categories. The Service Type Core Performance table keeps the legacy expandable detailed buckets.
  - Workshop API now prefers `workshop_performance_jc_summary_v1` when present. This materialized view stores pre-deduped job-card rows, allowing service table, daily movement, and advisor aggregations to avoid repeated raw `ro_billing_report` scans.
  - Workshop API now checks `workshop_performance_jc_summary_v1` date coverage before using it. If the view is stale for the selected date range, the API falls back to raw `ro_billing_report`; this prevents mismatches like Workshop Service Type showing 229 JC while RO Billing shows 276 JC for the same May 2026 range.
  - On 2026-05-28, `workshop_performance_jc_summary_v1` was found stale at max date 2026-05-22 while raw `ro_billing_report` had max `bill_date` 2026-05-28. The view was refreshed and then matched raw May counts: Grand Total 276, Paid Service 75, Free Services 75, Running Repairs 62, Others 30, Accident 34.
  - `scripts/dashboard-performance-optimization.sql` creates `workshop_performance_jc_summary_v1`; refresh it after cron imports with `REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1;`.
  - Workshop API still prefers `workshop_operation_addon_summary_v1` for WA/WB when present, but VAS is recalculated from deduped operation rows at request time until the materialized view is recreated with the corrected definition. Refresh it after cron imports with `REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;`.
  - The older Workshop bucket expansion behavior for Paid/Free/Running/Others was removed from the active Service Type Performance table; RO Billing still keeps its own detailed service-type expansion behavior.
  - Workshop table money values show full rupee figures below one lakh, so thousands render as `₹5,700` rather than `₹5.7K`; lakh/crore values stay compact but always use two decimals, such as `₹2.57L`.
  - Workshop charts render as full-width stacked sections to avoid cramped visuals.
  - Workshop matrix rows are compact with visible row/column borders for denser operational reading.
  - The Workshop matrix is the first full-width block in the report because it is the primary operational view.
- Executive-style analytics visuals and chart expansion behavior.
- Sales Team Leaderboard is now a dedicated Business Excellence analysis tab, backed by server-side service-advisor aggregation instead of the old in-Analytics placeholder.
- Sales Team Leaderboard top 3 ranks now use crown-style gold/silver/bronze badges.
- RO Billing Table dropdowns now avoid noisy service rows:
  - Free Services shows actual `service_type` labels such as First/Second/Third Free Service.
  - Running Repairs expands by populated `technician` values because `ro_billing_report.service_type` is usually blank for Running Repair rows.
  - Paid Service does not expose mileage/package-like child labels such as `30K`, `40K`, `100K`, `110K`, etc.; these come from `ro_billing_report.service_type`, which is not a real BE service category.
  - Others expands by remaining `work_type` labels where available, such as Refurbish, E Breakdown, AMC - TM, NVI, and similar categories.
  - Blank/Unspecified/self-repeated child rows are filtered out, and parent rows only show expand controls when real child rows remain.
- RO Billing Analysis period windows use Bill Date and calendar periods. CY remains to-date for the selected period: MTD starts on selected month day 1, QTD starts on selected calendar quarter day 1, and YTD starts on January 1. LY comparison uses completed historical periods: full same month last year for MTD, full same quarter last year for QTD, and full previous calendar year for YTD. TD remains the same day last year. Do not use the Indian fiscal-year April 1 start for RO Billing YTD, because in April-June it makes QTD and YTD identical.
- Business Excellence now has a shared historical comparison framework in `lib/business-excellence/comparison.ts`. The shell date UX is intentionally split: `Select Date` opens only the current-period calendar range picker, and supported sections show a separate `Compare Dates` button that opens two calendar range pickers, one for CY/current range and one for LY/comparison range. The old quick-preset chip list (Today, MTD, QTD, etc.) and comparison-mode dropdowns are not shown in this shell. KIA and Platinum year filters must be normalized through the same helper contract and must preserve `periodMode=year` plus `year` while redirecting or switching Business Excellence tabs.
- Business Excellence comparison-supported datasets are `ro_billing_report`, `rsa_report`, `adv_wise_lubricants_vas`, `kia_call_center_complaints`, `operation_wise_analysis_report`, and `operation_wise_analysis_advisor_report`. `open_ro_yearly`, `ew_report`, `mcp_report`, and `psf_yearly` must not show misleading LY/comparison values until enough history exists; Open RO explicitly reports comparison as unsupported in API metadata.
- Workshop KPI cards suppress EW and MCP LY/growth badges because those sources do not yet have enough history for reliable comparison.
- Business Excellence API query strings now carry `periodPreset`, `comparisonMode=custom`, `comparisonStartDate`, and `comparisonEndDate` only when a custom comparison range is selected. Overview and Workshop Performance now use the custom comparison dates as their LY/comparison ranges; RO Billing table MTD/current-period rows and daily trend comparison series use the selected comparison range instead of hard-coded same-date-last-year windows; KIA Complaints uses the custom comparison range for its comparison summary. Open RO keeps comparison hidden/unsupported.
- Business Excellence page header no longer shows the `Unified Date` pill; the header stays focused on the active date range and only shows comparison text after a comparison range is applied.
- Business Excellence date controls show the selected CY/current range, LY comparison range, and Apply/Clear actions in a compact strip above the calendars instead of a right-side preview column, so the compare-date controls are visible before users interact with the calendar grids.
- RO Billing table always renders the full TD / MTD / QTD / YTD period grid, even when custom comparison dates are active. Comparison dates update the CY/LY values, but the table must not collapse into a compact `Current Period / Comparison Period / Growth` layout.
- KIA Complaints detail rows expose `customerRemark` from `kia_call_center_complaints.complaint_remarks`, and the expanded Customer Complaint Details row labels it explicitly as Customer Remark.
- Business Excellence AI Summary opens in a modal instead of rendering inline inside the report. The AI prompt is tuned for a concise CEO/dealer-principal brief: 4 metric signals, 4 findings, 3 watchouts, and 3 actions, with the cache key bumped so old verbose summaries are not reused.
- Business Excellence detailed report Executive Health/Decision Layer panels are collapsed by default and are only shown after clicking the Show Health button in the report header controls.
- Demo Job Cards is a dedicated AM Kia sidebar module directly below Business Excellence at `/brands/kia/demo-job-cards`. It now works as a lightweight operational follow-up tracker, not an analytics dashboard. It uses the dedicated `demo_job_cards` relational table, dedupes to `1 vehicle = 1 row` using VIN with registration fallback, and picks the latest `ro_date` row per vehicle.
- Demo Job Cards next due logic is `next_demo_due_date = latest ro_date + 15 days`. Upcoming Demo Due alerts show vehicles where `next_demo_due_date - current_date <= 5`, sorted by closest due date first. The page intentionally removed KPI overload, aging charts, advisor charts, status charts, and monthly trend charts.
- Demo Job Cards remarks are stored only in `demo_vehicle_remarks`. Run `psql "$DATABASE_URL" -f scripts/create-demo-vehicle-remarks.sql` to create the table and supporting indexes. The table stores `vin`/vehicle key, `remark`, `created_by`, denormalized `created_by_name`, timestamps, and soft-delete support. The UI supports add remark, edit remark, and view remark history in a modal.
- Demo Job Cards has its own Demo Vehicle Health model based on upcoming due vehicles, overdue vehicles, remark coverage, and demo compliance. It uses due drivers, compliance risks, follow-up opportunities, focus areas, score drivers, target achievement, and data confidence without adding AI-style narrative text.
- Demo Job Cards health panel is collapsed by default and is only shown after clicking the Show Health button in the page header.
- Business Excellence overview health score dialog is viewport-bounded and internally scrollable. The dialog content uses a max height based on `100dvh`, a scrollable body, and horizontal table scrolling so the health breakdown no longer clips off-screen on shorter laptop displays.
- All actual sidebar navigation links open in a new browser tab (`target="_blank"` with prefetch disabled) so Purchase Orders, Finance Orders, Admin pages, Business Excellence, and Demo Job Cards can be kept open side by side without replacing the current section. The old Dashboard sidebar item and Main Menu heading were removed. Sidebar brand/admin parent rows remain expand/collapse controls.
- The Demo Job Cards sidebar item opens in a new browser tab. Its API reads `demo_job_cards`, uses an exact `work_type = 'Test Drive/CC Maintenance'` predicate, includes model and mileage in row/alert/table/export payloads, caches vehicle lists for 30 minutes, and invalidates `kia:demo-job-cards:*` cache entries whenever remarks are added or edited.
- Demo Job Cards remark add/edit modal auto-closes after a successful save. Remark modal close buttons use a dedicated high-contrast `demo-remarks-close` override so the close icon remains visible despite dashboard glass CSS.
- Demo Job Cards vehicle table uses centered header/body/action alignment and a slightly smaller body font (`13px`, with compact `11px` VIN/badge text) for denser operational scanning.
- Demo Cars List is a dedicated AM Kia Service sidebar module at `/brands/kia/demo-cars-list`. It reads `demo_car_list` directly and only renders vehicles where `test_drive_vin = YES`, deduped by latest `vin_no`. It displays only available requested columns: model, variant, color, customer/name, main dealer, invoice date, amount, VIN, retail date, age (`current_date - retail_date`), and registration number; Transporter is intentionally not shown in the table, though it can remain visible in the vehicle details popup. If any optional source column is missing, the API skips that display column instead of failing. The page has All/Jammu/Udhampur filters using `billing_dealer_code` mapping `JK402 -> Jammu` and `JK501 -> Udhampur` when that column exists, 10-row pagination ordered by highest age first, and compact centered table layout.
- Demo Cars List no longer uses remarks. It stores per-vehicle operational details in `demo_vehicle_details`; run `psql "$DATABASE_URL" -f scripts/create-demo-vehicle-details.sql` to create/update it. Saved fields are registration number, tracker status (`installed`/`not_installed`), service date, current reading in KMS, on-road price, and vehicle status (`active`/`sold`), plus update user and timestamp. The API auto-syncs the `registration_number` column/index for existing details tables and prefers the saved registration number over source registration values in the table. Its API caches vehicle pages for 30 minutes under `kia:demo-cars-list:*` and invalidates that namespace whenever vehicle details are saved; the client also filters out legacy `transporterName` column metadata so cached pre-cleanup payloads cannot render Transporter in the table. Demo Cars List shows source freshness from `demo_car_list.uploaded_at`; Demo Job Cards shows source freshness from the latest source RO date.
- Service Appointment is a dedicated AM Kia Service sidebar module at `/brands/kia/service-appointment`. It reads `service_appointment`, enforces `kia.service_appointment.view`, uses the shared Jammu/Udhampur `dealer_code` URL pattern (`JK402`/`JK501`), shows source freshness from `MAX(uploaded_at)`, and is calendar-only: no appointment register table, search, pagination, or popup launcher should be rendered. The calendar groups the selected month by parsed appointment date (`a_t_date_time`, then web appointment date, then appointment done date fallback), supports visible status filters for All/Open/Close/Cancel/Customer not reported, maps old `closed` and `cancelled` URL values to `close` and `cancel`, and treats customer-not-reported/no-show style statuses as `customer_not_reported` instead of open. It shows monthly booked/open/close/cancel/customer-not-reported totals and renders each day as a solid white rounded cell with a centered date badge and compact stat chips (`Bk`, `Op`, `Cl`, `Cn`, `Nr`) beneath it. Service Appointment API cache namespace `kia:service-appointment:v3` returns summary totals scoped to the selected calendar month/status and includes the dealer's latest `service_appointment.uploaded_at` in the cache key so new imports do not keep showing stale calendar data. The page Refresh action sends a cache-bypass query and `cache: no-store` fetch to avoid both Redis and browser-session GET cache when users need immediate fresh data.
- RO Billing expanded service dropdown child rows use full grid borders on every cell so expanded Free Services/Others rows remain visually connected to the parent table. A scoped `.glass-dashboard-content .ro-analysis-table th, td` CSS rule enforces these borders with `!important` because the glass-dashboard table background rules can otherwise make child-row borders disappear.
- Business Excellence tables use a shared management-row treatment for `MECH`, `MECH TOTAL`, and `Grand Total` rows wherever those labels are rendered. These rows have a black background with white text, while growth/percentage tone cells and badges keep their green/red/neutral semantic colors for readability.
- RO Billing analysis cache namespace is `kia:business-excellence:ro-billing:v25` and `platinum:business-excellence:ro-billing:v25`. Business Snapshot overview cache namespaces are `kia:business-excellence:overview:v29` and `platinum:business-excellence:overview:v31`; Workshop Performance cache namespaces are `kia:business-excellence:workshop-performance:v32` and `platinum:business-excellence:workshop-performance:v33`. Platinum Complaints cache namespace is `platinum:business-excellence:complaints:v12`; Platinum Open RO cache namespace is `platinum:business-excellence:open-ro:v11`; Platinum SOT cache namespace is `platinum:business-excellence:sot:v3`; Platinum Performance Intelligence is `platinum:business-excellence:performance-intelligence:v9`. KIA raw relational row caches remain `business-excellence:relational:*:v7`; Platinum raw relational RO Billing row cache is `business-excellence:relational:am_platinum_ro_billing_report:v8`; KIA RO Billing base-row cache is `kia:business-excellence:ro-billing:base-rows:v7`; KIA Performance Intelligence is `kia:business-excellence:performance-intelligence:v8`; KIA Open RO is `kia:business-excellence:open-ro:v9`. YTD LY comparisons use last year's year-to-date window (`01 Jan LY` through the same CY cutoff date last year), and QTD LY uses last year's quarter-to-date window instead of full prior quarter/year totals. The overview cache namespace was bumped on 05 Jun 2026 so VAS comparison cards can use invoice-level same-day LY fallback data and operation-wise labour+parts VAS without reusing stale unavailable/full-month or operation-only payloads; it was bumped again after excluding Painting Charges S1 and Removal & Refit Work S1 from VAS, again after enforcing explicit MTD/year date defaults for KIA and Platinum, again after Platinum Snapshot/Workshop VAS moved to the shared latest-snapshot de-dupe resolver, again after KIA BE service grouping was made `work_type`-only for management-facing labels, again after KIA RO Billing fast table rows gained Free Services and Running Repairs child dropdowns without exposing Paid Service mileage labels, again after Platinum LY/zero comparison statuses, complaint business-date fallback, and Open RO/VAS non-comparable wording were corrected, again after Platinum dealer coverage metadata/all-location handling was added, and again after Platinum overview optional-source resilience plus no-selected-range Snapshot states were added. Workshop Performance cache was bumped after moving VAS from month-level `report_month` filtering to period-aware `report_period_start` / `report_period_end` filtering, after the MTD/year default pass, after the shared Platinum VAS resolver was wired into Workshop Performance, after KIA core service rows stopped using `service_type` labels, after Platinum snapshot VAS gained explicit `No comparable LY` metadata, and after Platinum dealer coverage metadata was added. The Platinum raw relational RO Billing cache was bumped when row payloads gained dealer coverage metadata. The cache system remains enabled and will repopulate after the fresh responses. Business Snapshot's RO Billing matrix includes an explicit `Revenue` row in addition to Load, Labour, Parts, Labour/Vehicle, and Parts/Vehicle so Snapshot Revenue is compared against Revenue YTD instead of the Labour-only YTD row.
- Open RO now includes an optional calendar-style operational month view as a full-viewport popup. It stays hidden until the `Calendar View` button is clicked, groups loaded Open RO detail rows by `roDate`, shows daily WIP, delayed, >15D, accident, and running-repair counts, and lets users click a date to inspect vehicles before opening the full vehicle detail modal.
- Open RO, KIA Complaints, RO Billing calendar popups, and the Business Excellence date range picker use the scoped `solid-calendar-surface` class to opt out of the global glass-dashboard transparency rule. Calendar overlays must keep hard white inner panels so dashboard content and navbar controls never show through the calendar surface. Open RO and Complaints calendar popups are true modal dialogs with a full-viewport backdrop, locked body/root scrolling while open, and non-interactive background content. They are grid-first full-width views with the old selected-date side panel hidden, and their selected date is derived from the active global date range so stale selections from a previous month do not survive filter changes.
- RO Billing calendar access is popup-only. The old inline calendar render path is disabled so the Calendar control cannot render behind the dashboard header or show transparent over the report content.
- Business Excellence date controls use a narrower single-date calendar container (`max-w-[640px]`) while the compare-date layout keeps the wider two-calendar container (`max-w-[860px]`). The date panel Apply button carries `calendar-apply-action`, a scoped solid theme-filled override, so it stays readable inside the glass dashboard calendar surface.
- Business Excellence date filters are dashboard-level URL state. Active `startDate`, `endDate`, `compareStartDate`, `compareEndDate`, `periodPreset`, `periodMode`, and `year` query params are read on page load, preserved when switching Business Excellence sections, and survive refresh/back-forward. AM KIA and AM Platinum default internally to current month-to-date (`YYYY-MM-01` through today) without forcing default dates into the URL. `Reset Dates` / clear removes date/year/compare params from the URL while preserving `dealer_code`, then the page falls back internally to current MTD. In Compare Dates mode, year buttons choose the comparison/LY year directly (for example 2022 becomes `2022-01-01..2022-12-31`) and users can then narrow that comparison month/date. Date picker month views must re-sync when selected current or comparison dates change so the calendar does not remain on an old year. Shared API query builders now emit both the public URL names (`compareStartDate`/`compareEndDate`) and legacy API names (`comparisonStartDate`/`comparisonEndDate`) for compatibility; Open RO and KIA Complaints APIs read both names and have bumped cache namespaces so stale unfiltered responses do not mask URL filter fixes. Business Snapshot comparison mode must never blank cards or charts; overview chart chunks keep summary chart rows when secondary comparison chunks return empty arrays and render a visible `No Data Available` state when a chart genuinely has no values.
- Platinum VAS for Business Snapshot and Workshop Performance uses the shared resolver in `lib/platinum/business-excellence-vas.ts`. If exact `report_period_start`/`report_period_end` operation-wise data becomes available, use that exact period; otherwise use the latest `uploaded_at` snapshot from `am_platinum_operation_wise_analysis_report`. Latest-snapshot VAS is filtered to known VAS code/description patterns, excludes bodyshop/paint rows including `Painting Charges S1` and `Removal & Refit Work S1`, excludes pseudo `ACTIVE` in all-dealer mode by summing real Platinum dealer codes, and de-duplicates by dealer + normalized `(op_part_code, op_part_desc)` using `MAX(total_amt)` (`vasDedupeMode = code_desc_max`). Snapshot VAS is shown as as-of data and is not LY-comparable until a date-scoped Platinum VAS source exists.
- Platinum BE comparison labels are source-aware: RO Billing-backed metrics use historical `am_platinum_ro_billing_report.bill_date` data from 2021 onward and show `LY 0` for valid exact-window zeroes instead of "LY unavailable"; Platinum Complaints uses `COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)` as its business date because `complaint_date` can be blank in the source; Platinum Open RO is current-status/as-of data and must show `No comparable LY` unless a historical as-of snapshot source exists; Platinum VAS is latest-upload snapshot data and must also show `No comparable LY` rather than generic "LY unavailable".
- Platinum BE dealer selection supports explicit all-location URLs with `dealer_code=all`; missing `dealer_code` and `dealer_code=all` both mean no dealer filter at API level, while the UI still defaults to `N5211` unless the user selects All Locations. Every Platinum BE section must offer All Locations and preserve `dealer_code=all` on tab changes, date changes, reset, and reload. Dealer source policy is source-specific: RO-backed sections use `COALESCE(dealer_code, main_dealer_code)`, Open RO uses `dealer`, EW uses `dlr_no`, Complaints/SOT use `source_dealer_code`, and VAS latest-snapshot all-location totals include real Platinum dealer codes while excluding pseudo `ACTIVE`. Platinum BE responses should include dealer coverage metadata (`dealerCode`, `isAllLocations`, `hasDataInRange`, `rowCountInRange`, `latestAvailableDate`, `dateBasis`, `emptyReason`); non-all dealer views with no selected-range rows should show a clear coverage banner with latest available date including year instead of silently rendering an empty dashboard or falling back to another period. In the Business Snapshot, no selected-range RO Billing data is a separate state from valid exact zero: RO-backed Snapshot metrics use `No selected-range data`, Business Health shows `N/A` / no score, and those zero rows must not contribute to growth or health scoring; valid date-scoped sources that truly have LY zero still display `LY 0`.
- Global dashboard risk text uses `lab(53 89.72 88.48)` for `.text-rose-700` and dark-mode rose/red text overrides. Inside dashboard tables, red and green growth/status badges use white backgrounds instead of tinted red/green backgrounds so the semantic color is carried by text/border, not the fill.
- Dashboard Redis cache TTL is 30 minutes (`CACHE_TTL.DASHBOARD`) so Business Excellence and operational dashboards refresh cached API payloads sooner than the import cadence.
- `scripts/business-excellence-relational-indexes.sql` includes the historical comparison date indexes for bill date, invoice date, GST invoice date, RO close date, complaint date, and operation report month fields. Run it as standalone SQL because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction.
- Session-level frontend API caching and React Query dedupe.
- Project context documentation refresh.
- Main Dashboard locked as Coming Soon to avoid exposing dummy data.
- Header/sidebar/dashboard shell redesigned with theme-based glassmorphism.
- Business Excellence Refresh button removed.
- Open RO refresh button removed; its date filter follows the RO Billing style.
- Purchase Orders approval alert popup was removed for MD/EA approvals.
- Sidebar navigation opens new tabs instead of driving in-tab route transitions, so the in-tab top loading bar is not started by sidebar clicks.
- Access Control Manager is an admin-only module at `/admin/permissions`. It extends the existing `permissions` / `role_permissions` tables with `permission_groups`, `user_permissions`, and `permission_audit_logs`, backed by `scripts/create-permissions-manager.sql` and `npm run db:setup-permissions-manager`. The connected database has been initialized with the permission manager tables and seed rows, and stale `permissions:v1:user:*` Redis keys were cleared after setup. The registry lives in `lib/permissions/registry.ts`, effective user permissions are cached in Redis for 75 minutes via `lib/permissions/service.ts`, and updates clear the selected user's permission cache. Branch assignment itself grants view access to that branch's registered module tree by default (for example AM Kia users can view all KIA sections regardless of global role); Access Control user-level overrides still win and can explicitly lock a section.
- Access Control Manager UI shows all users, role templates, hierarchical sidebar-style sections, action-level toggles (`view`, `create`, `edit`, `delete`, `approve`), visible/inherited override state, bulk allow/remove/reset controls, and an audit trail. User Management now shows a key icon shortcut for admins to open a user's permission editor directly.
- Permission checks must not crash the app when the optional permissions-manager SQL tables have not been created yet. `lib/permissions/service.ts` falls back to in-code role templates for user permission snapshots and catalog display when `permission_groups` or related tables are missing; the full editable permission center still requires running `scripts/create-permissions-manager.sql`.
- Sidebar reads `/api/auth/permissions` and renders denied Purchase Orders, Finance Orders, Business Excellence, and Demo Job Cards entries as locked items with a contact-admin message instead of silently hiding them. AM Kia and AM Hyundai sidebar navigation are department-grouped as `Service`, `Sales`, and `H Promise`; current AM Kia modules live under `Service`, and AM Hyundai mirrors the same department shape. Hyundai Service now starts with the live `Business Excellence` section at `/brands/hyundai/business-excellence/overview`; its internal dropdown follows the KIA Business Excellence flow inside one shell with Overview, RO Billing Report, Open RO/Repair Orders, Extended Warranty, Complaints, PSF Analytics, Booking Analytics, and Operation Wise Analysis. Hyundai Overview uses the consolidated `/api/brands/hyundai/business-excellence/overview` endpoint, which server-aggregates `hyundai_ro_billing_report`, `hyundai_repair_order_list`, `hyundai_ew_report`, `hyundai_call_center_complaints`, `hyundai_psf_yearly`, `hyundai_operation_wise_analysis_report`, and the first available Hyundai booking table candidate. Detailed RO Billing and Repair Orders keep their own paginated register APIs. Hyundai Business Excellence carries date and branch filters in URL state; `branch=all|jammu|udhampur` maps Jammu to `N5216/N6846/N6847` and Udhampur to `N5217/N6848/N6849` until final Hyundai dealer-code mapping is confirmed. Brand sections and department sections no longer auto-expand by default; users open AM Kia/AM Hyundai manually from the sidebar. Admin-only Access Control appears under Admin Panel only for the admin role.
- Hyundai Business Excellence parity v1 replaces the earlier lightweight Hyundai dashboard with a KIA-style shell in `features/hyundai/business-excellence-page.tsx`. Canonical same-tab routes are `/brands/hyundai/business-excellence/overview`, `/executive-dashboard`, `/ro-billing-report`, `/open-ro`, `/workshop-performance`, and `/hyundai-complaints`; the old `/repair-orders` route redirects to `/open-ro` while preserving URL filters. The Hyundai shell now uses global URL-driven `startDate`, `endDate`, `compareStartDate`, `compareEndDate`, `branch`, `metric`, and `view` state, solid KIA-style buttons, metric buttons, RO Billing tabs (Table, Trend, Calendar, FY Trends, Analytics, Revenue, Leaderboard, Intelligence), skeleton loading, source freshness, black management rows, white growth pills, and configured-empty states for sections without Hyundai source tables.
- Hyundai Business Excellence UI parity must reuse the shared KIA Business Excellence chrome from `features/business-excellence/shared-ui.tsx` for report headers, Radix report dropdowns, branch pills, date/compare panels, tab buttons, metric buttons, and growth badges. Do not reintroduce Hyundai-only native date inputs, raw `<select>` report controls, narrow table shells, or separate button/growth styling; Hyundai data adapters may differ, but the visual shell and interaction components should stay shared with the KIA Business Excellence design system.
- Hyundai Business Excellence server adapters live in `lib/hyundai/business-excellence.ts` and new API routes `/api/brands/hyundai/business-excellence/ro-billing-analysis`, `/open-ro`, and `/freshness`. RO Billing uses `hyundai_ro_billing_report` with `bill_date`, `r_o_no`, `bill_no`, dealer fallback `dealer_code/main_dealer_code/source_dealer_code`, `work_type`, `service_advisor`, `labour_amt`, `part_amt`, `total_amt`, and discount columns. Open RO uses `hyundai_repair_order_list` with `r_o_date`, status fallback `r_o_status/status`, advisor fallback `service_adv/svc_adv`, technician fallback `man_tech/tech_name`, promise/closing/cancel dates, and dealer fallback `source_dealer_code/dealer/main_dealer/dlr_no`. The shared Hyundai adapter applies KIA-style Paid Service, Free Services, Running Repairs, MECH, Others, MECH TOTAL, Accident, and Grand Total rollups; TD/MTD/QTD/YTD LY windows use same-day prior-year cutoffs rather than full prior periods.
- Hyundai Business Excellence missing-section parity uses KIA-compatible endpoints for `/workshop-performance`, `/complaints`, `/performance-intelligence`, and `/ai-summary`. RO Billing and Open RO remain `sourceStatus: live` when their Hyundai tables are available. Workshop Performance derives its core tables/KPIs from live Hyundai RO Billing where possible and marks pending add-on metrics as sample. Hyundai Complaints returns a visible `sourceStatus: sample` / `Sample Data / Source Pending` payload until a real complaint table is connected. The Hyundai UI must show these source badges near section headers/freshness so sample data never looks like live company data, while still rendering full KIA-style sections instead of blank placeholders.
- AM Platinum is registered as a managed branch with the same sidebar department structure as AM Kia and AM Hyundai: Service, Sales, and H Promise. The Service section exposes Business Excellence, Service Appointment, Demo Job Cards, Demo Cars List, and Platinum Proforma links under `/brands/platinum/*`. Platinum has branch and permission registry entries (`platinum.*`) so User Management branch assignment, branch-module presets, and Access Control can manage it consistently; current Platinum routes render guarded setup placeholders until real Platinum data modules are connected.
- User Management create/edit dialogs include a Branch Role preset when Assigned Branch Access is a real branch or All Branches. The preset is branch-generic, not KIA-only, and is implemented in `lib/branch-module-access.ts`; it writes user-level permission overrides through `updateUserPermissionOverrides`, logs audit rows, and clears permission cache. Available scoped presets include Branch Admin, Executive Branch View, Business Analytics, Service, Sales, H Promise, Workshop Operations, Customer Operations, Proforma User, and Proforma Approver. `branch_admin` grants full defined module actions inside only the selected branch prefix; department presets resolve child permission groups through `PERMISSION_GROUPS.parentKey` so modules can live under Service/Sales/H Promise without brittle string matching. Current branch root permission groups exist for KIA, Tata, Hyundai, Platinum, Honda, KTM, Triumph, Bajaj, and MG; KIA, Hyundai, and Platinum have department-level Service/Sales/H Promise permission groups, with their current service modules under each brand's `service` group. Section presets affect whichever module permission groups exist under the selected branch prefix, so future branch modules can plug into the same behavior without a new database role column. Create/edit dialog dropdowns are forced to open downward with a compact max height so role/branch menus do not cover the upper form fields. Creating a new user with the default `inherit` branch role must not call the permission override writer because brand-new users have no overrides to clear; non-inherit branch presets use batched permission deletes/upserts instead of per-permission writes.
- Kia Proforma is a dedicated AM Kia sidebar module under the KIA area. The sidebar shows one common `Kia Proforma` entry at `/brands/kia/proforma`; the Proforma page itself owns the internal navbar for Generate Proforma, All Proforma Details, Finance Remarks, Pending Approval, Hyp / Ins Analytics, and Business Insights. `/brands/kia/proforma` opens Generate Proforma by default, while `/brands/kia/proforma/[section]` deep links still work for the other active sections. The old Proforma User Database and Stock sections are intentionally removed from navigation and routes; user management belongs in the Admin Dashboard.
- Kia Proforma UI uses dedicated `kia-proforma-primary-action` and `kia-proforma-outline-action` classes in `app/globals.css` so nav tabs, action buttons, filters, approval controls, analytics toggles, restore/open/pagination, and save buttons consistently follow the active dashboard theme. Primary/action states use a visible theme-filled background; secondary states use a solid theme-tinted fill instead of plain white or transparent glass. The `kia-proforma-shell` CSS guardrail forces Proforma inputs, selects, table utility controls, Finance Remarks controls, and Pending Approval controls to use solid readable surfaces across light/dark/Executive Navy themes. Generate Proforma inputs/selects/textareas use stronger themed borders, and tables use compact `text-xs` nowrap cells so short/medium values stay on one line and columns size to content with horizontal scrolling. Proforma datalist options are deduped case-insensitively before render so duplicate price rows do not create duplicate React option keys.
- Kia Proforma database support is defined in `lib/db/schema.ts` and `scripts/create-kia-proforma.sql`. The SQL creates `kia_user_profiles`, `kia_price_details`, `kia_proforma_lookup_options`, and `kia_proformas`, adds indexes, and enables RLS so normal users see their own proformas by `login_email` while approver users can see/manage approval and user database views. Run it with `psql "$DATABASE_URL" -f scripts/create-kia-proforma.sql` against the real Supabase/Postgres URL.
- Kia Proforma server routes are `/api/brands/kia/proforma`, `/api/brands/kia/proforma/[id]`, `/api/brands/kia/proforma/[id]/preview`, `/api/brands/kia/proforma/options`, `/api/brands/kia/proforma/settings`, and `/api/brands/kia/proforma/analytics`.
- Kia Proforma Generate page is grouped into Customer Details, Vehicle & Bank Insurance, Price Details, and Discounts & Deductions cards, laid out as two section cards per row on desktop and stacked on smaller screens. It validates customer/mobile/email fields, loads model/trim/bank/branch/insurance options from `kia_price_details`, saves rows to `kia_proformas`, clears the form, and updates profile activity. Bank/branch/trim pricing rules are centralized in `lib/kia-proforma/pricing.ts`: banks come from `kia_price_details.bank_name`/old HYP, branches come from `kia_price_details.bank_branch`/old BANK BRACH and filter by the selected bank, invalid bank input clears bank plus branch, invalid branch input clears branch, trim matching is case-insensitive and canonicalizes to the stored trim value, price prefill uses the selected trim, and registration is `registration_charges` for canonical `CASH` or `registration_charges + statutory_charges` for every other bank. When bank changes with a selected trim, registration/prefill recalculates immediately. Totals are always `ex_showroom + tcs_value + registration_charges + insurance_value + fastag_value + accessories_kit + ext_warranty`, then grand total subtracts cash discount, exchange, booking amount, govt employee discount, and additional discount.
- Kia Proforma All Details and Finance Remarks share visibility rules. They include search, dynamic column filtering with value checklists, Proforma Date/month/year filtering, Clear All filters, horizontal tables, fixed `#`, sticky Customer Name, per-header hide controls, Manage Columns, approved preview links, finance status updates, finance remarks, and finance updated timestamps. Finance Remarks also has a dedicated Proforma Date input and shows a Bank Name filter when `Current month` status is selected. Column visibility is stored in `localStorage` per user and table (`kia-proforma:hidden-columns:<userId>:<tableKey>`) instead of profile settings, and every Proforma table renders 10 records per page with previous/next/page-number controls.
- Kia Proforma Pending Approval is approver-only. It excludes approved rows, supports customer/mobile search, dynamic column value filters, Clear All filters, non-empty visible columns, fixed `#`, sticky Customer Name, and verifies discount/insurance/warranty fields. It supports Approve All, builds `NOT APPROVED | FIELD - reason` approval statuses when any field fails, otherwise marks rows `APPROVED`, stamps `approved_by`, and uses a clean `/preview` placeholder until PDF storage generation is connected.
- Kia Proforma approved invoice rendering lives in `lib/kia-proforma/invoice.ts`. The renderer keeps the legacy Apps Script-style Proforma Invoice layout with dealer header, customer/bank block, approved invoice field map, payment details, dealership code logic (`J&K BANK` => `JKB0993J003`, otherwise `NOT APPLICABLE`), terms, exchange docs, and govt employee docs. The preview route now streams an inline `application/pdf` response with a PDF filename so browser tabs open the native PDF viewer with print/download controls instead of an HTML page. When a Pending Approval row is approved, the API generates the same PDF buffer, uploads it through the existing Supabase Storage helper under `purchase-orders/kia-proforma`, saves the public URL in `kia_proformas.link_preview`, and falls back to the inline PDF preview route if storage upload fails. The generated PDF uses a bordered invoice sheet, AM Group logo images on the top-left and top-right header, and a large low-contrast AM Group logo image watermark behind every page before invoice text is drawn; it must not show KIA text/logo as the watermark. Payment account details and dealership code are rendered as separate spaced lines so `AC. No. / Branch / IFSC` never overlaps the dealership code.
- Kia Proforma analytics builds pivot-style bank/insurance/status tables and Recharts business-insight visuals from `kia_proformas`. Hyp / Ins Analytics supports bank/insurance/status pivots, daily/monthly/yearly grouping, in-house/out-house status filtering, All/TOP 5 toggles, Clear All, consultant checklist filtering, 10-row pagination, and period-column visibility persisted in `localStorage` per user/table. Business Insights charts include category trend, approval distribution, In House vs Out House, customer address integrity, model distribution, and fuel type distribution.
- Kia Proforma historical import uses `scripts/import-kia-proforma-xlsx.js`. The importer reads workbook values directly, so Excel `####` display clipping does not corrupt dates/numbers; date-only cells use the workbook's formatted date to avoid Excel serial timezone drift. It maps `PRICE DETAILS` into `kia_price_details` (including bank/branch lookup rows as `__BANK_OPTION__` rows filtered out of model/trim options), `FILTER` into `kia_proforma_lookup_options`, `Proforma Data` plus `Form Responses 1` into `kia_proformas`, and derives active `kia_user_profiles` from login emails/consultants. Use `node scripts/import-kia-proforma-xlsx.js --file "C:\Users\HP\Downloads\KIA PROFORMA (Responses).xlsx"` for dry run and add `--setup --replace --apply` to create/adjust tables and replace only rows imported from that workbook source.
- Kia Proforma latest price-only refresh uses `scripts/import-kia-price-details-csv.js`. It reads the current `PRICE DETAILS` CSV, upserts `kia_price_details` by case-insensitive model + trim + bank + branch + insurance key, preserves lookup-only bank/branch rows as `__BANK_OPTION__`, skips duplicate rows inside the CSV, updates existing rows, inserts new rows, and removes duplicate existing DB rows only when the same key already has multiple records. On 02 Jun 2026, importing `KIA PROFORMA (Responses) - PRICE DETAILS.csv` inserted 65 rows, updated 487 rows, skipped 11 duplicate CSV rows, and deduped 0 existing DB rows.
- The first historical Kia Proforma import from `KIA PROFORMA (Responses).xlsx` loaded 739 unique proformas, 49 user profiles, 175 vehicle price rows, 388 bank/branch lookup rows, and 181 FILTER dropdown lookup values from the old Apps Script workbook.
- Permission registry includes `kia.proforma` so the Access Control Manager can govern the module. Normal/viewer-style users receive default Proforma view/create/edit access; `admin`, `ceo`, `md`, `ea`, and `manager` roles receive approver access defaults and see Pending Approval in the Proforma navbar. Kia Proforma route pages and APIs now enforce `kia.proforma.view`, `kia.proforma.create`, `kia.proforma.edit`, and `kia.proforma.approve` server-side, and `canApproveKiaProformaForUser` treats either legacy profile approver/global approver roles or the scoped `kia.proforma.approve` permission as approval authority. This allows a user to be a KIA-only Proforma Approver or Branch Admin without receiving global admin access.
- Kia Proforma route pages render the module shell with `kia.proforma.view` access; actual saves still require the POST/API `kia.proforma.create` permission. The options API returns explicit JSON failures and accepts both array and `{ rows }` Drizzle raw-query result shapes, so model/trim/bank/insurance lookup loading does not silently collapse. Proforma table fetches keep a visible retryable error state instead of leaving blank panels when `/api/brands/kia/proforma` fails.
- Dashboard theme selector includes `Executive Navy`, a premium dark-navy palette centered on `#031430` with coordinated navy hover, soft card, border, support, and chart colors.

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
