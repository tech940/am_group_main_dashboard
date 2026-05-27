# Main Dashboard KT Handover

Last updated: 2026-05-27

This document is the practical knowledge-transfer guide for the Main Dashboard project. It is written for a developer, analyst, or owner who has to continue the project without the original day-to-day context.

## 1. What This Project Is

Main Dashboard is an AM Group operations and analytics dashboard built with Next.js. It currently has two main business areas:

- Purchase Orders: operational workflow for purchase requests, approvals, GRN, accounts, files, and notifications.
- KIA Business Excellence: analytics dashboards for service operations, RO billing, workshop WIP, complaints, and workshop performance.

The application is not a generic BI tool. It is a business-specific operational dashboard, so the most important thing is preserving the meaning of each metric and workflow state.

## 2. Stack Summary

- Framework: Next.js 16.2.6 App Router.
- UI: React 19, Tailwind CSS 4, Radix/shadcn-style components, Lucide icons.
- Charts: Recharts.
- Database: Supabase PostgreSQL.
- DB access: Drizzle ORM with `postgres`.
- Auth: Supabase Auth plus local `users` table for app roles/profile.
- Storage: Supabase Storage for purchase-order images/PDFs.
- Server cache: Upstash Redis.
- Client cache: React Query plus custom same-session GET cache in `app/layout.tsx`.

Important rule: this repo uses Next.js 16. Before changing App Router routes, route handlers, proxy/session behavior, or server/client boundaries, read the relevant docs under `node_modules/next/dist/docs/`.

## 3. How To Run

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build check:

```bash
npm run build
```

Type check:

```bash
npx tsc --noEmit
```

Lint:

```bash
npx eslint
```

Environment values are read through `config/env-config.ts`. The most important values are:

- `DATABASE_URL`
- Supabase URL/key values
- Redis values
- `GROQ_API_KEY` for AI Summary
- Optional `GROQ_MODEL`, defaulting to `llama-3.3-70b-versatile`

If AI Summary says `GROQ_API_KEY is not configured`, usually the dev server was started before `.env` was updated. Restart the dev server.

## 4. Main Routes

User-facing routes:

- `/dashboard`
- `/purchase-orders`
- `/brands/kia/business-excellence`
- `/brands/kia/business-excellence/overview`
- `/brands/kia/business-excellence/ro-billing-report`
- `/brands/kia/business-excellence/workshop-performance`
- `/brands/kia/business-excellence/open-ro`
- `/brands/kia/business-excellence/kia-complaints`
- `/admin`
- `/admin/users`
- `/admin/settings`
- `/auth/login`

The `/dashboard` route is intentionally a polished "Coming Soon" page because earlier dashboard metrics were dummy data and must not be confused with live company data.

## 5. Key Folders And Files

Layout and shell:

- `components/layout/main-layout.tsx`
- `components/layout/header.tsx`
- `components/layout/sidebar.tsx`
- `components/layout/notification-bell.tsx`
- `app/globals.css`
- `components/providers/query-provider.tsx`

Auth and access:

- `proxy.ts`
- `lib/auth/app-user.ts`
- `lib/auth/brand-access.ts`
- `lib/hooks/use-user-role.ts`

Database:

- `lib/db/index.ts`
- `lib/db/schema.ts`
- `config/env-config.ts`

Purchase Orders:

- `app/purchase-orders/page.tsx`
- `app/api/purchase-orders/route.ts`
- `app/api/purchase-orders/workflow/route.ts`
- `app/api/purchase-orders/upload/route.ts`
- `app/api/purchase-orders/file/route.ts`
- `components/purchase-orders/*`
- `lib/purchase-orders/access.ts`
- `lib/notifications/workflow.ts`

KIA Business Excellence:

- `features/kia/business-excellence-page.tsx`
- `features/kia/business-excellence-overview.tsx`
- `features/kia/open-ro-section.tsx`
- `features/kia/kia-complaints-section.tsx`
- `app/brands/kia/business-excellence/page.tsx`
- `app/brands/kia/business-excellence/[report]/page.tsx`
- `app/api/brands/kia/business-excellence/*`

Project docs:

- `PROJECT_CONTEXT.md`
- `PROJECT_DEEP_ANALYSIS.md`
- `PROJECT_KT_HANDOVER.md`

## 6. Auth, Roles, And Access Model

Supabase Auth owns the login session. The local `users` table owns application identity details:

- role
- full name
- brand
- branch
- department
- active/deleted state

Brand APIs should use `requireBrandApiAccess('kia')`.

Expected role behavior:

- Admin can access all relevant sections.
- Brand/branch users should only see their permitted brand/branch data.
- MD and EA have special purchase-order approval queues.
- Purchase Manager has table/edit/process features that should not be exposed to everyone.

Do not rely on frontend-only permissions. If visibility matters, enforce it in the API.

## 7. Caching Model

The app is intentionally aggressive about caching dashboard GET calls.

Client-side:

- Same-origin successful GET `/api/*` responses are reused within the current browser page session.
- Non-GET mutations clear relevant cached state.
- `/api/notifications` is excluded so notifications do not freeze.
- React Query is used for dedupe and remount-safe data reuse.

Server-side:

- Redis is used for dashboard analytics APIs.
- Dashboard Redis TTL is 75 minutes.
- Cache keys must include date filters, report type, filters, page, role/branch if relevant, and cache version.

Practical rule:

- If analytics numbers look stale after a logic fix, bump the API cache version in the cache key.
- A full browser reload resets the client session cache.

## 8. Visual And UX Direction

The current visual style is premium glassmorphism:

- teal/cyan/blue dashboard background
- frosted glass header
- visible teal/blue sidebar
- translucent content cards
- modern compact controls
- visible borders on selects/buttons
- white fullscreen chart modals
- no pink/purple decorative gradients
- no old ERP-heavy look unless the table is operationally necessary

Important UX expectations:

- Prefer skeleton loaders over plain spinners.
- Charts should have maximise buttons.
- Expanded charts must have a solid white background.
- Tables should be compact, but row/column borders should remain readable.
- Date filters should be visually consistent across Business Excellence sections.

## 9. Purchase Orders Business Logic

Workflow:

1. New order is created.
2. EA approval.
3. MD approval.
4. Purchase Manager / GRN process.
5. Accounts.
6. Fully completed.

Important distinction:

- GRN Completed means goods are received and spending should count.
- Fully Completed means Accounts has completed final closing.

Expected queue behavior:

- MD default view should show only orders awaiting MD approval assigned/relevant to him.
- MD and EA can switch to all-orders view when broader visibility is needed.
- MD all-orders view should support branch filtering and status filters such as pending, approved, and hold.
- Purchase Orders pagination uses 12 per page.
- MD/EA approval should not show an annoying alert every time an approval succeeds.
- Skeleton loading should show when MD applies branch/status filters.

Important API endpoints:

- `GET /api/purchase-orders`
- `POST /api/purchase-orders`
- `GET/POST /api/purchase-orders/workflow`
- `POST /api/purchase-orders/bulk-approve`
- `POST /api/purchase-orders/upload`
- `GET /api/purchase-orders/file`

Notification behavior:

- Notifications are stage/workflow based.
- Do not freeze notification APIs with generic dashboard cache.
- Notification logic lives mainly in `lib/notifications/workflow.ts` and `app/api/notifications/route.ts`.

## 10. Business Excellence Overview

Default route:

- `/brands/kia/business-excellence` redirects to `/brands/kia/business-excellence/overview`.

Purpose:

- A no-table command center.
- Shows combined analytics across RO Billing, Workshop/Open RO, KIA Complaints, and EW/RSA/MCP.
- It should answer: "How is the business doing right now?" without forcing the user into detailed report tables.

Important files:

- `features/kia/business-excellence-overview.tsx`
- `app/api/brands/kia/business-excellence/overview/route.ts`

Important API:

- `GET /api/brands/kia/business-excellence/overview`

Key metrics:

- Revenue
- Labour
- Parts
- Total JC
- Average billing
- Open RO
- Delayed RO
- RO over 15 days
- Complaint totals/open complaints
- EW/RSA/MCP counts

Important revenue rule:

- In the overview, Revenue must reconcile with Labour + Parts.
- Do not use `total_amt` for the overview revenue card if it causes mismatch with Labour and Parts.
- A recent fix changed overview revenue to `labour_amt + part_amt` and bumped the overview cache key.

Important data freshness rule:

- The selected date range may be May 1-26, but source data can be available only through May 22.
- The overview displays source coverage chips such as "Billing data through 22 May".
- If numbers seem short for the current month, check max source dates before assuming the query is wrong.

## 11. Business Excellence Report Routes

Active report routes:

- `/brands/kia/business-excellence/overview`
- `/brands/kia/business-excellence/ro-billing-report`
- `/brands/kia/business-excellence/workshop-performance`
- `/brands/kia/business-excellence/open-ro`
- `/brands/kia/business-excellence/kia-complaints`

The report selector opens the selected report in a new browser window/tab.

## 12. Business Excellence Data Sources And Date Columns

Never assume all reports use the same date column.

RO Billing:

- Table: `ro_billing_report`
- Date column: `bill_date`
- Identity: distinct `COALESCE(bill_no, ro_no, id)`
- Revenue-style values: `labour_amt`, `part_amt`, `total_amt`

Workshop Performance:

- Core JC/revenue source: `ro_billing_report.bill_date`
- VAS/WA/WB source: `operation_wise_analysis_report.report_month`
- EW source: `ew_report.reg_date`
- RSA source: `rsa_report.invoice_date`
- MCP source: `mcp_report.package_purchase_date`

Open RO:

- Table: `open_ro_yearly`
- Date column: `ro_date`
- Active status: `LOWER(status) = 'open'`
- Aging: `CURRENT_DATE - ro_date`
- Promise breach: current date greater than `COALESCE(revised_promise_date_time, promise_date_time)`

KIA Complaints:

- Table: `kia_call_center_complaints`
- Date column: `complaint_date`
- Uses latest distinct complaint rows by `complaint_no`
- Status groups: Closed, Hold, Pending, Open

## 13. RO Billing Report

Purpose:

- Analyze closed/billed repair orders.

Main file:

- `app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts`

Frontend:

- `features/kia/business-excellence-page.tsx`

Views:

- Table
- Trend
- FY Trends
- Analytics
- Revenue
- Leaderboard
- Intelligence

Metrics:

- Load = distinct bill/RO count.
- Labour = `SUM(labour_amt)`.
- Parts = `SUM(part_amt)`.
- Lab/Veh = Labour / Load.
- Part/Veh = Parts / Load.
- Revenue should usually be Labour + Parts unless a specific view intentionally uses another value.

Performance:

- Uses Redis.
- Uses batched `metrics=all` where possible.
- Uses `ro_billing_daily_summary_v2` if available.
- Falls back to raw `ro_billing_report`.

## 14. Workshop Performance

Purpose:

- Workshop service matrix and operational performance view.
- Combines job cards, labour, parts, VAS, WA/WB, EW, RSA, MCP.

Main API:

- `GET /api/brands/kia/business-excellence/workshop-performance`

Main file:

- `app/api/brands/kia/business-excellence/workshop-performance/route.ts`

Important logic:

- JC must be distinct bill/RO identity, not raw row count.
- Service grouping prefers `work_type` and falls back to `service_type`.
- VAS/WA/WB comes from `operation_wise_analysis_report`, which is month-level.
- Less VAS appears only on Grand Total because operation-wise data does not have a service-type split.
- EW/RSA/MCP columns are at the end of the table and appear in the Grand Total row.

Materialized views:

- `workshop_performance_jc_summary_v1`
- `workshop_operation_addon_summary_v1`

Refresh after imports:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1;
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;
```

## 15. Open RO

Purpose:

- Workshop WIP control tower.
- Shows open repair orders currently present in the workshop.

Main API:

- `GET /api/brands/kia/business-excellence/open-ro`

Frontend:

- `features/kia/open-ro-section.tsx`

Data source:

- `open_ro_yearly` only.

Important fields:

- `r_o_no`
- `ro_date`
- `reg_no`
- `vin`
- `model`
- `work_type`
- `service_type`
- `customer_name`
- `service_adv`
- `main_technician`
- `status`
- `new_r_o_status`
- `ro_sub_status`
- `promise_date_time`
- `revised_promise_date_time`
- `insurance_company_name`
- `delay_reason`

Important metrics:

- Total Open RO
- Average aging
- Over 15 days
- Delayed RO
- Accident jobs
- Running repairs

Aging buckets:

- `0-4D`
- `5-7D`
- `8-15D`
- `>15D`

Open RO is operational, not revenue-focused.

## 16. KIA Complaints

Purpose:

- Analyze external/KIA call-center complaints.

Main API:

- `GET /api/brands/kia/business-excellence/complaints`

Frontend:

- `features/kia/kia-complaints-section.tsx`

Data source:

- `kia_call_center_complaints`

Important behavior:

- Uses latest distinct complaint record per complaint number.
- Supports month/year comparison.
- Shows primary complaint areas, sub-area analysis, dealer resolution summary, model/source breakdown, and complaint detail expansion.
- Should not copy old UI exactly; it follows the project’s modern table/card style.

## 17. AI Summary

Main API:

- `POST /api/brands/kia/business-excellence/ai-summary`

Provider:

- Groq API.

Current model:

- `llama-3.3-70b-versatile`

Supported reports:

- Business Excellence Overview
- RO Billing Report
- Workshop Performance
- Open RO (Repair Orders)
- KIA Complaints

Critical rule:

- Keep AI payloads compact. Groq free/on-demand tiers can fail on TPM if the dataset is too large.
- Do not send full raw tables to AI.
- Use compact KPI/chart/alert payloads.

## 18. Database And Performance Notes

Important script:

- `scripts/dashboard-performance-optimization.sql`

Expected database objects include:

- `ro_billing_daily_summary_v2`
- `workshop_performance_jc_summary_v1`
- `workshop_operation_addon_summary_v1`
- `workshop_performance_summary_v2`

Important index areas:

- RO Billing: `bill_date`, `work_type`, `service_type`, `service_advisor`, model, bill/RO identifiers, uploaded timestamp.
- Open RO: `ro_date`, `status`, `work_type`, `service_adv`, `new_r_o_status`, `ro_sub_status`.
- Complaints: `complaint_date`, status, dealer, area/model/source columns.
- Workshop auxiliary: EW/RSA/MCP date fields.

Performance principles:

- Prefer server-side SQL aggregation.
- Prefer materialized summaries for repeated heavy logic.
- Prefer Redis cached compact payloads.
- Prefer React Query for frontend API state.
- Avoid frontend reduction of giant raw datasets.
- Avoid one API call per card.

## 19. Known Fragile Areas

`features/kia/business-excellence-page.tsx` is too large. It contains many report UI concerns, chart helpers, date filters, AI summary logic, and RO Billing sections. Future refactor should split it into report-specific modules.

`app/purchase-orders/page.tsx` is also large. It mixes filters, view modes, workflow actions, modals, forms, and role dashboards. Future refactor should split data hooks and UI components.

Auth and notifications affect every page. Be cautious when changing:

- `proxy.ts`
- `app/api/auth/user/route.ts`
- `components/layout/notification-bell.tsx`
- `app/api/notifications/route.ts`

Business Excellence date logic is easy to break. Always confirm:

- selected range
- source date column
- max available source date
- cache key version
- whether the metric is daily, monthly, current WIP, or historical

## 20. Things Not To Do

- Do not show dummy dashboard metrics as real.
- Do not use `total_amt` blindly when business expects Labour + Parts.
- Do not assume current-month source data exists through today.
- Do not freeze notification APIs in generic GET cache.
- Do not rely only on frontend role checks.
- Do not return all raw rows from analytics APIs unless it is a paginated table/export endpoint.
- Do not allocate VAS/WA/WB by service type unless the source table actually has that split.
- Do not make Business Excellence overview a huge all-detail endpoint. It should stay compact.
- Do not use brand filtering logic for Purchase Orders unless a workflow/branch rule explicitly requires it.
- Do not remove the Purchase Orders sidebar item; only specific buttons/features are role-limited.

## 21. Quick Debug Playbook

If Business Excellence numbers look wrong:

1. Check the selected date range.
2. Check the source date column for that section.
3. Query max source date for the table.
4. Check if Redis cache key version needs a bump.
5. Compare API output against a direct SQL aggregate.
6. Confirm whether revenue should be Labour + Parts or `total_amt`.
7. Confirm whether the source is daily or month-level.

If Purchase Orders visibility looks wrong:

1. Check the user role and branch in local `users`.
2. Check `lib/purchase-orders/access.ts`.
3. Check API query parameters from Network tab.
4. Check whether the user is in default queue or all-orders view.
5. Check workflow status values in DB.

If UI still shows old data after a fix:

1. Full browser reload.
2. Check React Query key.
3. Check custom GET cache behavior.
4. Bump Redis API cache version if server payload logic changed.
5. Restart dev server if environment variables changed.

If AI Summary fails:

1. Confirm `GROQ_API_KEY` is in `.env`.
2. Restart dev server.
3. Check token/TPM error from Groq.
4. Reduce compact dataset size.
5. Confirm selected report is supported by the AI summary API.

## 22. Current Priorities For Next Owner

1. Stabilize Business Excellence numbers with validation SQL for each section.
2. Confirm current-month source date coverage after every data import.
3. Split large frontend files by responsibility.
4. Add or refresh materialized summaries for heavy analytics.
5. Audit role/branch access for all purchase-order and brand APIs.
6. Keep UI consistent with glass theme, but prioritize correctness over visual novelty.
7. Keep `PROJECT_CONTEXT.md` and this KT document updated after major changes.

## 23. Suggested KT Walkthrough Agenda

For a live KT session, cover in this order:

1. Product purpose and user roles.
2. How to run locally and where environment values live.
3. Authentication and access flow.
4. Purchase Orders workflow from creation to Accounts.
5. Business Excellence routing and report selector behavior.
6. RO Billing metric definitions.
7. Workshop Performance data sources and month-level VAS nuance.
8. Open RO aging and WIP logic.
9. Complaints latest-record logic and month/year comparison.
10. Caching layers and how stale data happens.
11. Current known fragile files.
12. How to validate a dashboard number with SQL.
13. Pending refactors and recommended next tasks.

## 24. One-Sentence Mental Model

This project is a role-aware operations dashboard plus cached SQL analytics layer; most bugs come from mixing workflow state, source-date semantics, cache behavior, or metric definitions.
