# Main Dashboard Deep Analysis Report

Last updated: 2026-05-26

## 1. Executive Summary

Main Dashboard is an AM Group operations platform built on Next.js 16, Supabase PostgreSQL, Drizzle, Redis, React Query, and Recharts. The product currently has two major working domains:

- Purchase Orders: approval workflow, branch/stage visibility, file upload, GRN/accounts progression, and EA/MD approval queues.
- KIA Business Excellence: executive analytics for RO Billing, Workshop Performance, Revenue, Trends, FY Trends, Performance Intelligence, and Sales Leaderboard.

The project has moved from basic workflow screens and JSON-sheet analytics toward a relational, cached, BI-style dashboard. The main architectural direction is correct: server-side SQL aggregation, Redis caching, session-level frontend caching, route-level report pages, and materialized summary views for heavy datasets.

The largest remaining risk is not UI complexity. It is data-contract drift: several analytics tables have different date grain, naming, and business meaning. RO Billing is row/date based, Workshop VAS/WA/WB is month based through `operation_wise_analysis_report.report_month`, Purchase Orders are workflow/state based, and notifications are realtime/session based. Future changes must respect those differences rather than forcing every section into one generic pattern.

## 2. Technology Stack

Core runtime:

- Next.js 16.2.6 App Router
- React 19.2.4
- TypeScript
- Tailwind CSS 4
- Radix UI primitives
- Lucide icons
- Recharts

Backend and data:

- Supabase Auth
- Supabase PostgreSQL
- Drizzle ORM
- `postgres` SQL client
- Supabase Storage
- Upstash Redis

Client data:

- TanStack React Query
- Custom session-level GET cache in `app/layout.tsx`
- Local state for UI-only concerns

Important rule:

- This repo uses Next.js 16. Before changing route handlers, proxy behavior, server/client boundaries, or App Router conventions, read the relevant docs under `node_modules/next/dist/docs/`.

## 3. Application Architecture

### Main Shell

Important files:

- `components/layout/main-layout.tsx`
- `components/layout/header.tsx`
- `components/layout/sidebar.tsx`
- `app/globals.css`
- `components/providers/query-provider.tsx`

The shell uses a glassmorphism visual system:

- Gradient dashboard background in light mode.
- Dark mode support through root-level class toggling.
- Sidebar retains its own teal/blue background.
- Header has no global search box.
- Buttons and selects need visible borders because many surfaces are translucent.
- A white top loader is used for route transitions.

Current issue class:

- Theme changes can easily regress because many components still use hard-coded `bg-white`, `text-slate-*`, or transparent/glass utilities.
- Any future visual changes should prefer shared shell/card/table utility classes over per-component one-off colors.

### Routes

Key user-facing routes:

- `/dashboard`
- `/purchase-orders`
- `/brands/kia/business-excellence`
- `/brands/kia/business-excellence/ro-billing-report`
- `/brands/kia/business-excellence/workshop-performance`
- `/admin`
- `/admin/users`
- `/admin/settings`
- `/auth/login`

The `/dashboard` page is intentionally locked as Coming Soon because previous content contained dummy metrics.

### API Routes

Main API groups:

- `app/api/auth/*`
- `app/api/admin/*`
- `app/api/notifications/route.ts`
- `app/api/purchase-orders/*`
- `app/api/brands/kia/business-excellence/*`
- Legacy or compatibility Business Excellence routes under `app/api/business-excellence/*`

The strongest active investment is under:

- `app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts`
- `app/api/brands/kia/business-excellence/workshop-performance/route.ts`
- `app/api/brands/kia/business-excellence/performance-intelligence/route.ts`
- `app/api/brands/kia/business-excellence/route.ts`

## 4. Authentication, Users, and Access

Auth model:

- Supabase Auth owns login/session identity.
- Local `users` table owns app role, full name, branch/brand/department, and active/deleted status.
- `proxy.ts` handles Supabase session refresh.
- `lib/auth/app-user.ts` maps Supabase user to local app user.
- `lib/auth/brand-access.ts` protects brand APIs.

Access rules currently expected:

- Admin and All Branches users see all branch/brand sections.
- Brand/branch users should only see their assigned branch.
- MD/EA purchase order queues must show only their approval-relevant orders.
- Purchase Manager-only table features should be hidden from non-purchase users.

Known fragility:

- `/api/auth/user` is on the critical path for header/profile rendering. When DB connection is slow or times out, page shell feels broken.
- Notifications may call early and return Unauthorized before auth/user context is stable.
- Avoid duplicating role logic in many components. Prefer shared helpers.

## 5. Data Model Overview

### Purchase Orders

Core domain:

- Order creation
- Vendor information
- EA approval
- MD approval
- GRN
- Accounts
- Completed/Rejected/Hold recovery states

Important files:

- `app/purchase-orders/page.tsx`
- `app/api/purchase-orders/route.ts`
- `app/api/purchase-orders/workflow/route.ts`
- `components/purchase-orders/*`
- `lib/purchase-orders/access.ts`
- `lib/notifications/workflow.ts`

Important business rules:

- MD queue should show only MD approval pending orders.
- EA queue should show EA pending and EA recovery states.
- GRN Completed counts toward spending but does not mean fully completed.
- Fully Completed requires Accounts completion.
- Deny/Hold remarks are optional.
- Approve should not ask for remarks.
- Branch assignment matters for visibility and notification delivery.

### Business Excellence Core Tables

Active KIA relational tables:

- `ro_billing_report`
- `operation_wise_analysis_report`
- `ew_report`
- `mcp_report`
- `rsa_report`
- `open_ro_yearly` exists but the Open RO section was paused/reverted.

Former JSON storage:

- `business_excellence_am_kia_new`

The desired direction is relational SQL and summary views, not giant JSON blobs.

## 6. Business Excellence Architecture

### Reports

Current active report entries:

- RO Billing Report
- Workshop Performance

Open RO was requested, then paused. The partial new Open RO API folder was removed. Do not assume Open RO exists in UI or API until it is explicitly restarted.

### Navigation

Business Excellence now uses direct URLs:

- `/brands/kia/business-excellence/ro-billing-report`
- `/brands/kia/business-excellence/workshop-performance`

This is better than local-only sheet switching because the route tells the app which report to mount. It also lets each report start its own API earlier.

### RO Billing Report

Purpose:

- Analyze closed/billed repair order performance.
- Uses `bill_date` for every comparison.

Metrics:

- Load = unique bill/RO count.
- Labour = `SUM(labour_amt)`.
- Parts = `SUM(part_amt)`.
- Lab/Veh = Labour / Load.
- Part/Veh = Parts / Load.
- Revenue = Labour + Parts or revenue-specific payload depending on section.

Views:

- Table
- Trend
- FY Trends
- Analytics
- Revenue
- Leaderboard
- Intelligence

Performance direction:

- Use batched `metrics=all` for table/trend/FY where possible.
- Use `ro_billing_daily_summary_v2` if present.
- Avoid five separate API requests for Load/Labour/Parts/Lab/Veh/Part/Veh when one SQL aggregate can produce all.

Important source files:

- `features/kia/business-excellence-page.tsx`
- `app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts`
- `scripts/dashboard-performance-optimization.sql`

### Workshop Performance

Purpose:

- Workshop-level matrix combining job cards, labour, spares, VAS, WA, WB, EW, MCP, RSA.

Important definition:

- JC = unique job cards / repair orders, not raw rows.
- Current JC logic should match RO Billing table logic using distinct bill/RO identity.

Important source:

- `ro_billing_report`: JC, labour, spares, service/work type, daily movement.
- `operation_wise_analysis_report`: VAS/WA/WB addon amounts, month-level through `report_month`.
- `ew_report`: EW count.
- `mcp_report`: MCP count.
- `rsa_report`: RSA count/revenue.

Addon definitions:

- WA = Wheel Alignment.
- WB = Wheel Balancing.
- VAS = Value Added Services.
- `operation_wise_analysis_report.op_part_desc` is the important classifier.
- `operation_wise_analysis_report.total_amt` is the addon amount source.

Critical business nuance:

- `operation_wise_analysis_report` has `report_month`, not daily invoice dates.
- Its data should be filtered by selected month/year, not exact day windows.
- Less VAS should use VAS total and subtract from labour where required.
- Because operation-wise data does not have service-type split, Less VAS is shown only in Grand Total, not allocated across service rows.

Current Workshop table issue class:

- Percentages must use Grand Total denominator where they represent whole-workshop contribution.
- Subtotal rows such as MECH and MECH TOTAL can make totals appear above 100 percent if read as additive categories. The UI should either hide percent values on subtotal rows, mark them as subtotals, or visually separate them from additive top-level categories.

Important source file:

- `app/api/brands/kia/business-excellence/workshop-performance/route.ts`

### Performance Intelligence

Purpose:

- Audit/scoring layer over RO Billing data.
- Flags 30-Day Rework, Manual Discount, Labour Leakage, Low Labour, Low Parts, workshop/model low averages, etc.

Important behavior:

- Table should appear before summary analytics.
- Filters should be fast and cacheable.
- Exports should include all filtered data, not just current page.

Risk:

- If scoring logic recomputes too many CTEs for every filter, latency climbs quickly.
- Best long-term fix is precomputed alert transaction table after cron.

## 7. Caching and Performance

### Current Cache Layers

Client session GET cache:

- Successful same-origin GET `/api/*` responses are reused during the current browser session.
- Full page reload resets cache.
- Non-GET mutations clear relevant cached state.
- Notifications are excluded from generic freezing.

React Query:

- Used for dedupe/remount-safe reuse.
- Stale time is intentionally long/session-like.

Redis:

- Dashboard cache TTL is 75 minutes.
- Intended to match hourly cron cadence plus buffer.

PostgreSQL summaries:

- `ro_billing_daily_summary_v2`
- `workshop_performance_jc_summary_v1`
- `workshop_operation_addon_summary_v1`
- `workshop_performance_summary_v2`

### Why Some APIs Still Feel Slow

Likely causes:

1. Auth/profile lookup overhead
   - Every API may call auth helpers.
   - If `/api/auth/user` or role checks hit DB repeatedly, total request time includes repeated auth DB cost.

2. Cold Redis or cache miss
   - First request after cache expiry still runs SQL.
   - Cache keys with too many variants reduce hit rate.

3. Summary view missing or stale
   - If materialized views do not exist in production or are not refreshed, route handlers fall back to raw tables.

4. Multi-metric fanout
   - If frontend calls one endpoint per metric/tab, the browser floods the API even if each call is "only" 2 to 4 seconds.

5. Expensive regex/classification live in SQL
   - Workshop VAS/WA/WB classification should remain precomputed when possible.

6. Recharts rendering cost
   - Large labels and dense data can slow render and hurt readability.

7. Notification calls
   - Notification polling/realtime fetches can overlap with heavy dashboard APIs and make the page feel slower.

### Performance Principles For Future Work

Use this order of preference:

1. Materialized summary table/view refreshed after cron.
2. SQL aggregate query over indexed columns.
3. Redis cached compact response.
4. React Query session reuse.
5. Component-level transformation only for display.
6. Avoid raw rows except paginated tables or exports.

Avoid:

- `SELECT *` on analytics tables.
- Frontend reductions over thousands of rows.
- One API call per card.
- Recomputing filter dropdown options on every table pagination request.
- Returning chart payloads in table endpoints unless needed.

## 8. Current UX Direction

The user wants:

- Premium, modern, clean dashboard.
- Glassmorphism background visible through cards/tables.
- Sidebar background kept as designed.
- No pink/purple gradients.
- Main palette based on teal/cyan/blue.
- Compact top control panels.
- No unnecessary search boxes.
- No old ERP-style table blocks where possible.
- Fullscreen chart expansion with readable white backgrounds.
- Tables should be compact but legible.

Purchase Order cards:

- Should use distinct solid or soft stage-based backgrounds.
- Hide raw PO number on cards where requested.
- Long descriptions should clamp after two lines with ellipsis.
- Cards should feel clean like reference job cards, not cluttered.

EA/MD tables:

- Should look modern, compact, and action-focused.
- Hide nonessential columns such as order number, sub-department, created, status where requested.
- Checkbox should be at far right after action buttons and visibly checked/unchecked.
- Amount-based visual hints are desired.

## 9. Known Hotspots and Fragile Areas

### `features/kia/business-excellence-page.tsx`

This file is very large and owns too much:

- RO Billing UI
- Workshop UI
- charts
- tabs
- report selector
- data fetching
- formatting helpers
- fullscreen chart expansion

Recommendation:

- Split into report modules:
  - `features/kia/business-excellence/ro-billing/*`
  - `features/kia/business-excellence/workshop-performance/*`
  - `features/kia/business-excellence/shared/*`

This would reduce regression risk and make future AI changes safer.

### Purchase Orders Page

`app/purchase-orders/page.tsx` is also large and holds workflow page state, filters, forms, modals, role views, card/table toggles, pagination, and actions.

Recommendation:

- Split page into:
  - data hook
  - role dashboard views
  - order list controls
  - order form modal
  - completed/spending panel

### Auth and Notifications

Auth/user and notifications affect every page.

Recommendation:

- Cache `/api/auth/user` carefully client-side.
- Consider adding a lightweight signed session claim or server-side user profile cache.
- Notification Bell should wait until auth state is known before showing Unauthorized errors.

## 10. API Inventory and Purpose

Auth:

- `GET /api/auth/user`: current app user.
- `POST /api/auth/login`: login.
- `POST /api/auth/logout`: logout.

Admin:

- `GET/POST/PATCH /api/admin/users`: user management, pagination/filters expected.
- `GET/POST /api/admin/settings`: settings.

Notifications:

- `GET /api/notifications?limit=20`: notification list.

Purchase Orders:

- `GET/POST /api/purchase-orders`: list/create/update purchase orders.
- `GET/POST /api/purchase-orders/workflow`: workflow details/actions.
- `POST /api/purchase-orders/bulk-approve`: bulk workflow action.
- `POST /api/purchase-orders/approve`: legacy/simple approve.
- `POST /api/purchase-orders/upload`: file upload.
- `GET /api/purchase-orders/file`: file serving/proxy.

Business Excellence:

- `GET /api/brands/kia/business-excellence`: metadata and rows depending query.
- `GET /api/brands/kia/business-excellence/rows`: row access.
- `GET /api/brands/kia/business-excellence/ro-billing-analysis`: RO Billing analytics.
- `GET /api/brands/kia/business-excellence/performance-intelligence`: audit/scoring analytics.
- `GET /api/brands/kia/business-excellence/workshop-performance`: multi-table workshop analytics.

Legacy:

- `GET /api/business-excellence`
- `GET /api/business-excellence/ro-billing-analysis`

Legacy routes should be audited. If unused, keep only compatibility wrappers or remove later after confirming no frontend references.

## 11. Recommended Next Steps

### Immediate Stabilization

1. Do not add Open RO yet.
   - The user explicitly paused it.
   - Keep focus on documenting and stabilizing current features.

2. Verify no partial Open RO artifacts remain.
   - The untracked `app/api/brands/kia/business-excellence/open-ro/` folder was removed.

3. Run a focused build/type check when ready.
   - There are many unrelated worktree changes, so expect existing errors may not belong to this report work.

4. Confirm Workshop Performance percent logic.
   - Top-level categories should sum to 100 percent.
   - Subtotals should not be counted visually as additional additive rows.

### API Speed Work

1. Confirm materialized views exist in production.
2. Confirm cron refreshes:
   - `ro_billing_daily_summary_v2`
   - `workshop_performance_jc_summary_v1`
   - `workshop_operation_addon_summary_v1`
   - `workshop_performance_summary_v2`
3. Add API timing breakdown to every Business Excellence endpoint:
   - auth
   - cache read
   - SQL
   - transform
   - serialize
4. Reduce auth DB lookups with app-user cache where safe.
5. Precompute Performance Intelligence alert rows after cron.

### Refactor Work

1. Split the Business Excellence feature file.
2. Split Purchase Orders page by responsibility.
3. Centralize common formatters:
   - currency
   - compact Indian amounts
   - percent/growth
   - date labels
4. Centralize chart card/fullscreen modal behavior.

### Data Quality Work

1. Document each analytics table:
   - date column
   - grain
   - primary identity
   - metric columns
   - known nulls
2. Add SQL validation queries for key totals.
3. Keep screenshots/business expected numbers with query links for regression checks.

## 12. Important Warnings For Future AI/Developers

- Do not use brand filtering logic for Purchase Orders unless the workflow explicitly requires branch/brand assignment. The user specifically said purchases are not brand-specific by default.
- Do not hide the Purchase Orders sidebar item. Only certain table buttons/features are role-restricted.
- Do not redesign Business Excellence structure unless requested. The user often asks to fix logic while preserving the existing UI.
- Do not add heavy all-in-one APIs for Business Excellence. Each view should fetch only what it needs, while table metrics can be batched across metric types when it reduces fanout.
- Do not allocate VAS/WA/WB service-type amounts unless the source table actually contains service-type split.
- Do not show dummy dashboard data as real. `/dashboard` is locked for this reason.
- Do not rely on frontend-only permissions for branch/role visibility.
- Do not let notifications be frozen by generic API caching.
- Do not put scripts directly inside `<html>` in React components. This caused hydration warnings.
- Avoid server/client mismatches for theme icons, notification warning dots, and browser-only values.

## 13. Current Worktree Note

At the time this report was written, the repository had multiple modified files from ongoing work and deleted `.VSCodeCounter` generated files. The Open RO API folder that had been partially created was removed. No git reset or broad revert was performed because many current changes likely belong to the user-requested ongoing work.

## 14. Mental Model For The Project

Think of the product as three layers:

1. Operational workflow layer
   - Purchase Orders, approvals, notifications, file uploads, role queues.

2. BI analytics layer
   - Business Excellence, RO Billing, Workshop Performance, Intelligence, Revenue, Trends.

3. Experience/performance layer
   - Glass UI, route loader, dark mode, session cache, Redis, materialized summaries.

Most bugs happen when these layers are mixed incorrectly:

- Workflow screens should prioritize real-time correctness and role visibility.
- BI screens should prioritize cached aggregates and fast navigation.
- UI shell should be consistent but not leak visual assumptions into business logic.

The cleanest future architecture is to make every analytics report define:

- its source tables
- its date grain
- its summary view
- its API contracts
- its cache keys
- its chart payloads
- its validation query

That would let new sections like Open RO be added safely without disturbing existing RO Billing or Workshop Performance logic.
