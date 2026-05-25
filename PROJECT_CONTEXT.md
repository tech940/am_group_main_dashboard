# Project Context

Last updated: 2026-05-25

## Project Overview

Main Dashboard is a Next.js 16 App Router application for AM Group vehicle operations. It covers purchase-order workflow management and KIA Business Excellence analytics, with the current build focused mainly on RO Billing Report performance analytics and purchase-order approvals.

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

Only KIA RO Billing Report is currently active. Other old brand/sheet sections were removed or de-prioritized to avoid slow metadata/API calls and dead navigation.

### Data Source

Business Excellence now uses relational SQL tables rather than giant JSON sheet blobs. The important active table is:

- `ro_billing_report`

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

### Database Optimization Script

Primary script:

- `scripts/dashboard-performance-optimization.sql`

Important expected database objects:

- `ro_billing_daily_summary_v2`
- indexes on bill date, work type, advisor, model, vehicle identifiers, uploaded timestamp, and performance-intelligence filters.

After cron/import updates, refresh:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY ro_billing_daily_summary_v2;
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
- MD sees only `awaiting_md_approval` in their active approval queue.
- Purchase Manager table view is restricted to purchase-manager users.
- Default order listing should focus on today's orders.
- All Orders mode uses pagination with 9 orders per page.

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
- Sidebar navigation explicitly starts the white top loading bar.

## Features In Progress

- Continued API speed tuning for RO Billing and Performance Intelligence.
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
