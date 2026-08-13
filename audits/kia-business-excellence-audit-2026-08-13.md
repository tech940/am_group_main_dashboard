# KIA Business Excellence — Audit Report

**Scope:** 14 API routes under `app/api/brands/kia/business-excellence/`, `lib/kia/*` (contract, service-dashboard-metrics, ro-billing-kpis, workshop-summary), `features/kia/business-excellence-page.tsx` (8,741 lines) and its six sibling section components, `lib/permissions/registry.ts`, `lib/auth/brand-access.ts`.
**Date:** 2026-08-13 · **Findings:** 72 (1 P0, 29 P1, 34 P2, 8 P3) · **10 independently verified against the live analytics DB and running code.**

---

## 1. Health Score

| Dimension | Score | Key finding |
|---|:--:|---|
| **Data Correctness** | **1** / 4 | The Open RO tab is returning HTTP 500 in production *today*; separately, charts and KPI cards on the same screen use two different dedupe rules and provably do not sum to each other. |
| **Access Control** | **2** / 4 | Auth is on all 14 routes and there is no SQL injection anywhere — but the 7 registry sub-permissions are never read, so a "complaints-only" branch user reads the entire revenue book, and customer names/reg numbers are shipped to Groq. |
| **Performance** | **2** / 4 | Excellent three-tier cache and per-phase timing instrumentation, undermined by full-table scans on unindexable expressions in the hottest CTEs and a 711 KB unsplit client chunk. |
| **Accessibility** | **1** / 4 | Zero `role=` attributes and 8 `aria-*` across 8,741 lines; 15 charts are unnamed `role="application"` keyboard stops; every prior-year figure renders at 2.5:1 contrast. |
| **Design & Integrity** | **1** / 4 | A hardcoded `* 1.1` is presented as the dealership's "Month Target" and "Monthly Shortfall"; a failed fetch renders confident ₹0 instead of an error. |
| **Total** | **7 / 20** | **Poor** (6–9) |

---

## 2. Executive Summary

Severity counts: **P0 = 1 · P1 = 29 · P2 = 34 · P3 = 8.**

The section is architecturally well-built — the caching layer, the auth composite, the SQL-injection discipline and the dedupe contract are all genuinely good, and several past incidents are documented in-code at the exact line that fixes them. What has decayed is the **last mile between a correct query and a number an executive reads.** Five things matter:

**1. One tab is dead right now.** `/open-ro` throws a Postgres `22008` on every realistic date window, including the default view for today's date. 52 of 166 open ROs carry a day-first promise date (`30/09/2026 11:00:00`) that the raw `::timestamp` cast cannot parse under the session's MDY DateStyle. A safe helper for this exact incident already exists in the repo and is used by `/overview`; `/open-ro` was never migrated. Workshop WIP pressure is one of four headline Overview insights — management currently has no view of vehicles stuck in the workshop. **This is a one-import fix.** *(Finding P0-1, verified.)*

**2. "Month Target", "Shortfall" and "Asking Rate" are invented.** The entire target model is `sum(last year) * 1.1` — a bare literal, written four times with four slightly different derivations, rendered as seven equally-weighted KPI tiles and a red dashed "Target" line with no note of provenance. A service manager reading "Monthly Shortfall ₹18.4L" in red believes they are behind an agreed number. Nobody at AM Kia set 10%. Same class of defect as the hardcoded 18.6% Claims Ratio in Insurance. *(P1-D1, verified.)*

**3. A failed query renders as ₹0, not as an error.** Across 8,741 lines there is no `isError` branch on any data panel. When a query rejects, `isLoading` flips false and the dashboard paints fully: Jammu ₹0 / Udhampur ₹0 / Total ₹0, and "Alerts Found **0**" in 3xl bold on the fraud-signal panel. An executive cannot distinguish "the workshop billed nothing" from "the query died" — the same failure mode that under-reported group revenue by 53%. *(P1-D2, verified.)*

**4. Access-map denies are ignored.** The registry defines seven Business Excellence sub-permissions and two shipped branch roles (`branch_customer_ops`, `branch_operations`) grant subsets of them — but **not one of those keys is read anywhere in the app.** All 14 routes check only the parent `kia.business_excellence.view`. An admin who assigns "Customer operations" believes that user sees complaints only; the server serves them RO Billing revenue, advisor leaderboards, the executive dashboard and the full Service Dashboard workbook. Third occurrence of guard-desync in this repo. *(P1-A1, verified.)*

**5. The charts under a headline number don't add up to it.** Overview `kpis.revenue` uses a single-winning-row dedupe; `charts.revenueTrend` / `serviceMix` / `advisorRevenue` use three *independent* max-abs picks over the same job-card key. On the live feed that is ₹31,35,059 vs ₹30,76,246 — ₹58,813 of revenue belonging to no single bill. The mismatch is then baked in: the code overwrites the snapshot total with the KPI value but leaves the service mix on the other rule, so the breakdown provably cannot reconcile to the total sitting beside it. *(P1-C9.)*

---

## 3. Detailed Findings

### P0 — Blocking

#### P0-1. Open RO tab is returning HTTP 500 in production — raw `::timestamp` cast on DD/MM/YYYY promise dates `[verified]`
`app/api/brands/kia/business-excellence/open-ro/route.ts:71` (repeated at `:118-119`)

**What.** `COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,''))::timestamp AS promise_date`. `promise_date_time` is TEXT mixing ISO (`2026-07-31`) and day-first (`23/08/2026 12:00:00`) values; session DateStyle is `ISO, MDY`, so any day > 12 fails. 52 of 166 rows in `kia_open_ro_yearly` carry such a value, all with `status='open'`. Running the route's own KPI query (`:270-280`) and details query (`:353-358`) verbatim against the live DB throws `22008 date/time field value out of range` for every window tested — no-dates, Aug 1–13, Jul 1–31, and Aug 1–13 with dealer JK501. Only an old June-only 3-row window survives. `lib/kia/business-excellence-contract.ts:117-142` ships `kiaOpenRoPromiseDateSql()` documenting this exact incident twice; `overview/route.ts:325` uses it and parses all 165 dates successfully. Substituting the helper makes the identical queries return 23 rows all-time / 12 for Aug 1–13.

**Why.** No open-RO count, no aging buckets, no delayed-RO list, no advisor load. `features/kia/open-ro-section.tsx:251-272` defaults the range to first-of-month → today — exactly the failing window. `:487-496` renders the dead-end "Open RO data is unavailable." card. The "Open RO (Repair Orders)" AI Summary also 500s, because `ai-summary/route.ts:244` fetches this endpoint and `fetchJson` throws on non-ok. **Secondary:** even day ≤ 12 slash values that *do* cast are misread — `03/08/2026` becomes 8 March under MDY while `/overview` reads it as 3 August, so the two endpoints disagree on the same RO's promise date and delay status.

**Fix.** Import `kiaOpenRoPromiseDateSql` and use `${kiaOpenRoPromiseDateSql()} AS promise_date` at `:71`; at `:118-119` compare against the already-derived `promise_date` column in the `enriched` CTE rather than re-casting the text. Add a regression test asserting the base query runs against a row containing `'23/08/2026 12:00:00'`.

---

### P1 — Major

#### Data correctness

**P1-C1. Workshop Core table never subtracts VAS — "Lab − VAS" equals Labour** `[unverified]`
`workshop-performance/route.ts:508`
`fetchCoreAddonSummary` hardcodes `serviceType: 'Others'` (`:509`), which `normalizedServiceKey` can never match against the work-type rows ('Free Service', 'Paid Service', …), so every core row gets `vasAmount = 0` and `labMinusVas = labourAmount` (`:659`), while `buildTotalRow` still sets `lessVas = addonTotals.vasAmount` (`:760`). On screen: Labour = X, Less VAS = V, Lab − VAS = X. The "Lab/RO (ex-VAS)" column is numerically identical to "Lab/RO" — and VAS penetration is one of the targets the section scores against (`EXECUTIVE_TARGETS.workshop.vasPenetrationPct = 18`).
*Fix:* allocate the single VAS/WA/WB total pro-rata on labour before `buildRows`, or drop the phantom 'Others' row and subtract once at total level. Assert `totalRow.labMinusVas === totalRow.labourAmount - totalRow.lessVas`.

**P1-C2. EW/MCP/RSA branch filters include `OR dealer_code IS NULL` — same rows counted under both branches** `[unverified]`
`lib/kia/service-dashboard-metrics.ts:131` (also `:140`, `:149`)
`kia_ew_report` has NULL `dealer_code` on 159 of 197 rows. Over FY26: all rows = 92, filter JK402 = 92, filter JK501 = 57. Udhampur's real EW count is 3; it is shown 57 — a ~19× inflation, and the branches sum to 149 against a true 92. Add-on attachment is a headline KPI on both Overview (`overview/route.ts:1088`) and Workshop Performance (`:882-884`), and `addOnPerJc` (`overview/route.ts:881`) is wrong whenever a dealer filter is applied.
*Fix:* remove the `OR <col> IS NULL` escape from all three. Surface unattributable rows as an explicit "Unattributed" bucket in the all-dealers view only. Separately chase the feed — 81% of EW rows arriving without a dealer code is an ingestion defect.

**P1-C3. Workshop VAS and wheel alignment/balancing ignore the selected start date** `[unverified]`
`lib/kia/service-dashboard-metrics.ts:595`
`fetchWorkshopVasAmountDetailed(startDate, …)` never uses `startDate` as a lower bound — `:595` computes `monthStart = getMonthStart(endDate)` and every query filters from there. `startDate` appears only inside `unavailableReason` strings (`:656, :670, :690`), which therefore misdescribe the window queried. `fetchCanonicalOperationMetrics` (`:699`) takes no `startDate` at all. For a 2026-04-01..08-12 selection the UI can show ₹0 VAS against ₹4,03,087 actually in range; VAS penetration % then divides 12 days of numerator by 5 months of denominator and always reads as a miss against the 18% target.
*Fix:* give the invoice-wise path a real `>= startDate` bound; for the operation-wise path sum resolved period snapshots across every month the range touches. Until then the payload must report the window measured (`vasPeriodStart`/`vasPeriodEnd` already exist) and the tile must be labelled "month to date".

**P1-C4. "30-Day Rework" alert only looks back to the window start — flags 3 of 20 real reworks** `[unverified]`
`performance-intelligence/route.ts:219`
`LAG(bill_date) OVER (PARTITION BY vehicle_key …)` is computed over `base`, which `buildPerformanceWhere` (`:149`) already restricts to the selected range. Any vehicle whose prior visit precedes `startDate` gets `previous_bill_date IS NULL` and can never fire the 0–30 day test. Measured on the default month window: 3 flagged vs 20 real. Rework carries the largest score penalty (−25), so advisor scores and `alertsFound` are inflated in the dealership's favour, worst at the start of every month.
*Fix:* add a `history` CTE starting `startDate - INTERVAL '30 days'`, compute LAG there, then filter `WHERE bill_date >= startDate` in `scored`. Only the base window needs widening.

**P1-C5. "Low Labour/Parts vs average" compares against the selected range and the user's own filtered subset** `[unverified]`
`performance-intelligence/route.ts:215`
`SCORING_RULES` (`:45`, `:57`) tells the user the benchmark is "monthly average for that model and service type" and "the entire workshop's monthly average", and those strings are returned as `rules` (`:452`) and rendered as the formula. The implementation is `AVG(labour_amt) OVER (PARTITION BY model, type)` with **no month partition**, over `dedup` — which `buildPerformanceWhere` has already narrowed. Selecting advisor = X makes "the entire workshop's average" equal advisor X's own average, so ~half their ROs fall below their own mean by construction and the −10/−5 penalties become an artefact of the filter.
*Fix:* add `date_trunc('month', bill_date)` to both PARTITION BY clauses; compute the benchmark CTE from a population filtered only on date and dealer, then join per-bill rows to it.

**P1-C6. AI Summary is fed empty objects, then instructed to quote exact numbers** `[unverified]`
`ai-summary/route.ts:189` (also `:179`)
`compactRoBillingPayload` picks `['advisor','totalRo','totalRevenue',…]` from a leaderboard whose real shape is `{name, load, labour, parts, revenue, averageBilling, contribution}` — **not one key matches**. It picks `['name','td','cy','ly','growth',…]` from `AnalysisRow`, whose shape is `{name, depth, metrics:{td:{cy,ly,growth}, …}}` — only `name` matches. `pickFields` drops undefined keys (`:110`), so the model receives `advisorLeaderboard: [{},{},…]` and `metricTables: {load:[{name:'Free Service'},…]}`. The system prompt then demands "Use exact numbers from the supplied dataset" plus "exactly 4 metricSignals, exactly 3 keyFindings, exactly 3 risks" (`:324, :334`). An LLM given a hard quota and no numbers produces numbers anyway — fabricated boardroom content, in the exact shape this section exists to prevent.
*Fix:* correct both field lists to the real shapes and flatten `metrics` before `pickRows`. Add a guard in `buildReportDataset` that refuses to call Groq when the compacted dataset contains no numeric values.

**P1-C7. Executive "previous score" is a hardcoded 70 rendered as a real prior-period comparison** `[unverified]`
`features/kia/business-excellence-page.tsx:3400` (also `:3086`, `:2968`, `:3284`)
`previousScore: data.comparison?.revenue ? 70 : null`. All four health builders seed the same constant, which flows into `scoreTrendLabel` (`:2840-2843`) and renders "70 previous / +12 improvement" on the executive header. No prior score is ever computed or stored; the presence of LY revenue is used only as a gate, which makes the fabrication look data-driven. (Currently latent behind the dead panel — see P2-D2 — but ships the moment anyone flips the flag.)
*Fix:* recompute the health score from the comparison-period payload the routes already return, or return `null` and print "Previous: insufficient history". Do not ship a constant through a field named `previousScore`.

**P1-C8. Fixed ₹30,00,000 revenue target applied to every date range** `[unverified]`
`lib/business-excellence/executive-targets.ts:3`
`overview.revenue`, `roBilling.revenue`, `workshop.revenue` are all `3000000`; `openRo.maxOpenRo = 25`; `complaints.maxAvgResolutionDays = 3`. `targetCard(...)` divides the period's achieved value by the raw constant with no normalisation and renders "Target Achievement {percent}%" with a red/amber/green status on three headers (`page.tsx:3420, 2972, 3122`). An FY-to-date view reads several hundred percent and turns green; a one-week view reads single digits and turns red. `maxOpenRo = 25` is a stock measure compared against a range-filtered count.
*Fix:* scale flow targets by period using the `workingDayCount` the contract already computes via `getKiaWorkingDayContext`, or make targets per-dealer/per-period configurable in `dashboard_settings` alongside the holiday config. At minimum hide the card when the range is not the period the target was authored for. **Note:** `executive-targets.ts` is itself a file of bare literals with no DB backing — treat it as a placeholder, not a source of truth.

**P1-C9. Labour and parts deduped independently — charts don't reconcile to the KPI cards** `[unverified]`
`overview/route.ts:299-301`
`roBillingBaseSql`'s `base` CTE takes three *independent* `(ARRAY_AGG(x ORDER BY ABS(x) DESC))[1]` picks for labour, parts and total, while `report_date`/`advisor`/`service_category` come from a fourth ordering (`:287-289`). The canonical KPI path takes the whole winning row (`lib/kia/ro-billing-kpis.ts:123-133`). Same split pattern at `ro-billing-analysis/route.ts:761-762, 830-831, 983-985, 1069-1070, 1163-1164` and `workshop-performance/route.ts:267-269, 342-344, 550-551`. On 295 duplicated keys the split rule yields ₹31,35,059 vs ₹30,76,246 — ₹58,813 assembled from rows belonging to no single bill. `overview/route.ts:834-841` then overwrites the snapshot total with the KPI value but leaves `serviceMix` on the other rule.
*Fix:* standardise on the single-winning-row rule already in `ro-billing-kpis.ts` and `workshop-summary.ts` — rank once with `ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ABS(labour_amt + part_amt) DESC, …)` and take `row_rank = 1`, carrying every field from that one row. Add a parity assertion `sum(chart revenue) === kpis.revenue` to `scripts/verify-kia-business-excellence-parity.mjs`.

#### Access control

**P1-A1. Every route checks only the PARENT permission — the 7 sub-permissions are never enforced** `[verified]`
`complaints/route.ts:735` (and 13 more sites)

**What.** `lib/permissions/registry.ts:152-206` defines `kia.business_excellence.{ro_billing, workshop_performance, open_ro, complaints, rsa, ew, mcp}`, expanded to `.view` keys at `:867-877`. A repo-wide grep finds **no reader anywhere** in `app/`, `features/` or `components/` — only the registry itself and `lib/branch-module-access.ts`. All 14 routes and the page guard check the single parent key: complaints:735, open-ro:522, overview:1148, ro-billing-analysis:1437, workshop-performance:916, performance-intelligence:395, freshness:96, workshop-summary:13, ai-summary:476, service-dashboard-export:13/-preview:14/-email:30, rows:9, route.ts:308/355, `[report]/page.tsx:57`. `requireBrandSectionApiAccess` (`lib/auth/brand-access.ts:51-74`) checks exactly the key passed — no ancestor or descendant walk. This is not a dormant registry: `lib/branch-module-access.ts:130-150` ships `branch_customer_ops` (grants only `…business_excellence.complaints`) and `branch_operations` (only `.workshop_performance` + `.open_ro`), and `buildBranchModuleAccessPermissionChanges` (`:181-206`) writes `kia.business_excellence.view=true` alongside child `.view=false`. It is live via `app/api/admin/users/route.ts:133`, and `normalizePermissionChanges` cascades deny downward only, so the child deny never clears the parent grant — it is inert.

**Why.** An admin assigning "Customer operations" believes the user is limited to complaints. That user can load the RO Billing Report, Workshop Performance revenue, Open RO WIP, the Executive Dashboard and download the full Service Dashboard workbook. Third guard-desync occurrence in this repo.

**Two corrections to the original report:** the seven keys do **not** appear in the Admin Access Map — `app/api/admin/access-matrix/route.ts:56-61` filters to `SECTION_ROUTES` and explicitly comments that BE sub-reports are "handled in code". They *do* render on the per-user Access tab (`/api/admin/permissions:95-100`, `features/admin/access-control-panel.tsx:478`). And access comes from the parent grant the preset writes, not from a deny being "converted" to allow.

**Fix.** Map each report to its own key and check it in the serving route: complaints → `.complaints.view`, open-ro → `.open_ro.view`, workshop-performance/-summary → `.workshop_performance.view`, ro-billing-analysis + `sheet=ro_billing_report` + the three service-dashboard routes → `.ro_billing.view`, keeping the parent as the section gate. Mirror in `[report]/page.tsx` and `getBusinessExcellenceReportOptions`. Add the seven keys to `scripts/verify-guard-parity` so a future orphaned registry key fails CI. The access-matrix comment already promises this code exists — for BE it was never written.

**P1-A2. Complaints API ships customer names and mobile numbers unmasked; the UI never renders them** `[unverified]`
`complaints/route.ts:682` (select at `:492-494`, CTE at `:111-113`)
Response maps `cust_name` → `customerName`, `mobile_no` → `mobileNo`, `vin_no` → `vinNo`, up to 150 rows per call (`:525`). `canViewKiaCustomerPii` / `maskKiaPii` are not imported anywhere under this directory. The client never displays them either — grepping `mobileNo`/`Mobile`/`customerName` across the 8,741-line page returns nothing. `lib/kia/pii.ts:7-10` restricts customer phone to MD/Developer/Finance Head/EA/EBA/ED/CEO/VP everywhere else in KIA; here any holder of a broadly-granted `DEFAULT_VISIBLE_SECTION` permission can `curl` the whole complaint register by sliding the date range.
*Fix:* delete the three columns from the SELECT and the response mapping — nothing consumes them. Same treatment for `open-ro/route.ts:237-238` (`regNo`, `customerName`).

**P1-A3. AI summary ships customer names and vehicle registration numbers to Groq** `[unverified]`
`ai-summary/route.ts:342` (fields at `:161`, `:131`, `:194`)
`createAiSummary` POSTs the dataset to `api.groq.com`. `compactComplaintsPayload` includes `customerName`, `compactOpenRoPayload` includes `regNo`, `compactRoBillingPayload` includes `regNumber`. Personal data under DPDP, transferred cross-border, from a codebase that deliberately gates phone/email to eight roles. The system prompt gives no instruction against echoing them, so a name can return inside `keyFindings` and be persisted in the Redis summary cache (`:490`).
*Fix:* drop those three field names from the `pickRows` lists — a board-level narrative loses nothing. Substitute the RO number if a per-vehicle reference is genuinely needed.

#### Performance

**P1-P1. Complaints `latest` CTE dedupes the ENTIRE table with `SELECT *` before any date filter** `[unverified]`
`complaints/route.ts:97`
`SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no,''), id::text)) * FROM kia_call_center_complaints WHERE complaint_date IS NOT NULL` — the range filter appears only downstream in `filtered` (`:173-175`). No index matches the DISTINCT ON sort key (`scripts/business-excellence-relational-indexes.sql:98-108` covers `uploaded_at`, `complaint_date`, `(dealer_code, complaint_date)`, `(status, complaint_date)`). `SELECT *` pulls ~30 text columns including `complaint_remarks`. The CTE is embedded 11× per complaints request and 3× + 1 LY in overview.
*Fix:* push the union of the selected and comparison windows into `latest`'s WHERE before the DISTINCT ON; add `CREATE INDEX CONCURRENTLY … ON kia_call_center_complaints ((COALESCE(NULLIF(complaint_no,''), id::text)), uploaded_at DESC, id DESC)`; replace `SELECT *` with the ~30 columns `enriched` actually projects.

**P1-P2. Open-RO anti-join keys on an unindexed COALESCE over the full billing history** `[unverified]`
`open-ro/route.ts:91` (duplicated at `overview/route.ts:332-340`)
Both sides of the `NOT EXISTS` are functional expressions; the checked-in indexes cover the bare `bill_no` / `ro_no` columns only. The billing side is bounded solely by `rb.bill_date < endDate` — all history. Embedded 8× per open-ro request and 5× per overview.
*Fix:* `CREATE INDEX CONCURRENTLY ro_billing_report_join_key_idx ON ro_billing_report ((COALESCE(NULLIF(ro_no,''), NULLIF(bill_no,''), id::text)))`, copied character-for-character from the query text per the warning in migration 0032. Also bound the billing side to the RO window.

**P1-P3. `fetchLatestBillDate` runs an unindexable full scan BEFORE the cache lookup** `[unverified]`
`overview/route.ts:567`, called at `:1174`
The clamp awaits it *outside* `getCachedData`, so it runs on every request including cache hits. Its comment claims "Cheap: one indexed MAX" — true only when `dealerCode` is null. With a dealer it expands to `UPPER(TRIM(COALESCE(NULLIF(dealer_code,''), …))) IN ('JK402')`, a functional predicate with no matching index — and the page defaults to a dealer (`page.tsx:1515`).
*Fix:* cache the feed max per dealer under its own long-TTL key, and/or add the matching functional index. Fix the comment either way.

**P1-P4. `fetchDeliveredBillingKpis` calls the UNCACHED service-dashboard builder while a cached twin sits three lines away** `[unverified]`
`lib/kia/ro-billing-kpis.ts:89`
Calls `buildServiceDashboardMetrics` (the raw `buildMetrics` alias, `service-dashboard-export.ts:836`) when `getCachedServiceDashboardMetrics` at `:839` wraps the identical call with a shared key. Invoked twice per overview build (`:623`, `:768`). The preview/export path uses the cached variant, so the two compute identical numbers and cache only one.
*Fix:* change `:89` to `await getCachedServiceDashboardMetrics(endDate, dealerCode)`. The key is `(endDate, dealerCode)` — exactly the inputs already passed, so the cross-route hit is free. **Quick win.**

**P1-P5. RSA date filter wrapped in a CASE/regex, making the `invoice_date` index unusable** `[unverified]`
`lib/kia/service-dashboard-metrics.ts:827`
The range predicate is applied to a CASE expression written out three times; `rsa_report_invoice_date_idx` cannot serve it. Runs 2× per overview (CY+LY), 2× per workshop-performance, and again inside the service-dashboard build — 6+ full scans of `rsa_report` per page load, each row matched against two regexes three times.
*Fix:* normalise `invoice_date` to a real `date` column at ingestion and index it; interim, hoist the CASE into a CTE column so it evaluates once. (See also P2-C1 — both regex branches are currently dead.)

**P1-P6. The 8,741-line page is a single client chunk — no code splitting, no memoisation** `[unverified]`
`features/kia/business-excellence-page.tsx:1487`
448 KB of source in one `'use client'` module plus statically-imported sections (711 KB total). No `next/dynamic`, no `React.lazy`, no dynamic `import(`, zero `React.memo`. Every section renders as a plain unmemoised child (`:2448-2504`) while the calendar's day buttons call straight into root-level `setStartDate`/`setEndDate` (`:1507-1508`). The route is `[report]` — exactly one section renders at a time, yet every visitor downloads and hydrates all of them plus the full recharts surface, and each of the two clicks needed to pick a date range re-lays-out every `ResponsiveContainer` in the active section.
*Fix:* `next/dynamic` per section keyed on `activeTab`; `React.memo` the section components (their props are already stable state values); move draft date state into the picker dropdown and lift only `appliedDateFilter`.

#### Accessibility

**P1-Y1. 15 Recharts surfaces are unnamed `role="application"` keyboard stops with no non-visual alternative** `[unverified]`
`features/kia/business-excellence-page.tsx:8468` (+14 more)
Recharts 3.8.1 defaults `accessibilityLayer: true`, and `RootSurface.js:49-60` then sets `tabIndex=0; role='application'`. No chart carries `aria-label`, `title`, `desc`, `role="img"` or an adjacent data table — greps for all of them return 0. `role="application"` suppresses the virtual cursor, so browse-mode reading of the chart region stops working, and a screen-reader user hits 15 consecutive dead stops announcing "application". Series are keyed by stroke colour alone, and `#023468` / `#1D4ED8` are both blues. WCAG 1.1.1, 4.1.2, 1.4.1.
*Fix:* `role="img"` + a descriptive `aria-label` on every chart; add an `sr-only` `<table>` next to each (the data arrays are already computed); give each series a `strokeDasharray` or distinct dot shape.

**P1-Y2. Icon-only close and row-expand buttons have no accessible name and no expanded state** `[unverified]`
`features/kia/business-excellence-page.tsx:1305`, `:7748`, `:5082`
lucide auto-sets `aria-hidden="true"` on its icons, so an icon-only button's accessible name computes to the empty string. The Scoring Rules close control (`:1305`) is announced as bare "button" — combined with the missing Escape handler (P2-Y2) the user is stuck. The RO Billing parent-row disclosure (`:7748`) has no name *and* no `aria-expanded`; open/closed is conveyed purely by a CSS `rotate-180`, so a user cannot tell whether the child rows they are hearing are complete or collapsed. The workshop equivalent (`:5086`) has the label but still no state.
*Fix:* `aria-label="Close scoring rules"` at `:1305`; `aria-label={...}` + `aria-expanded={isExpanded}` at `:7748`; add `aria-expanded` at `:5086`. **Quick win.**

**P1-Y3. Complex multi-level tables carry no `scope`, no `caption`, and use `<td>` for row headers** `[unverified]`
`features/kia/business-excellence-page.tsx:4449` (pattern also at `:4384-4392, :3996-4004, :5490-5501, :7697-7705`)
Two-row headers with `rowSpan`/`colSpan` and zero `scope` attributes — grep returns 0 for `scope=` across all six BE feature files, 0 for `<caption`, and none of the ~15 tables has an `aria-label`. Row-label cells are plain `<td>` (`:7745`). With colspan groups and no scope, header inference breaks down: cell 7 of a row announces a bare number with no indication of whether it is QTD-CY or YTD-LY, and no indication which branch the row belongs to.
*Fix:* `scope="col"` on leaf headers, `scope="colgroup"` on the MTD/QTD/YTD spanners, and convert row-label `<td>` → `<th scope="row">` (`:7745, :4398, :4465, :5079`). Add an `sr-only` `<caption>` naming each table and its date range.

#### Design & integrity

**P1-D1. "Month Target", "Shortfall" and "Asking Rate" are an invented LY × 1.1, shown as hard business figures** `[verified]`
`features/kia/business-excellence-page.tsx:4289`

**What.** `const monthTarget = metricRows.reduce((t, p) => t + p.ly, 0) * 1.1`. That literal is the entire target model. It drives `dailyTarget` (`:4290`), `mtdTarget` (`:4291`), `shortfallTd` (`:4295`), `monthlyShortfall` (`:4298`) and `askingRate` (`:4299`), rendered as seven equally-weighted tiles (built `:4303-4309`, rendered `:4559-4566`) with label and value only — no provenance — plus a red dashed `ReferenceLine` labelled "Target" (`:4521-4526`). The same `* 1.1` recurs at `:6682`, `:6846-6847`, `:6912-6914`, `:6942` with **different derivations**: `:4289` sums LY over the selected-range server trend; `:6912` uses a full prior-year month measured client-side from raw `data`. Same tile label, different basis. Landed in commit 28352883 with no rationale and no comment.

**Why.** A manager reading "Monthly Shortfall ₹18.4L" in red believes the dealership is behind an agreed target. None exists. The same tile can disagree between the Executive Dashboard and the RO Billing view for the identical period.

**Note on the fix.** `lib/business-excellence/executive-targets.ts` is *not* a better source — it is itself bare literals with no DB backing (see P1-C8). Swapping in `3000000` would be strictly worse.
**Fix.** Hoist one exported `LY_GROWTH_TARGET_MULTIPLIER` used by all four sites, label the tiles honestly ("Target — LY +10%"), and render "—" instead of a computed shortfall when no target is configured for the branch/period. Longer term, make targets a configurable per-branch row.

**P1-D2. Every data panel renders confident zeros when its fetch fails** `[verified]`
`features/kia/business-excellence-page.tsx:4332`

**What.** `const isLoading = tableQuery.isLoading || branchTableQuery.isLoading || trendQuery.isLoading || fyQuery.isLoading` — no `isError` term, and `:4336-4340` gate the whole dashboard on it alone. `components/providers/query-provider.tsx:175-186` sets `retry: false` and no `throwOnError`, and there is no `error.tsx` under the BE route, so a single rejection settles permanently into `isError` and cannot reach an error boundary. On failure: `getExecutiveTotalRow(undefined)` → null (`:3796`) → `executivePeriod(null,'td')` → `{cy:0, ly:0, growth:'N/A'}` (`:3801`) → Jammu 0 / Udhampur 0 / Total 0 at `:4400`, and three headline cards print ₹0 (`:4342-4368`). Performance Intelligence is worse: the catch at `:899-904` does `console.error` + `setData(null)`, and `:1052-1055` / `:1070` render "Alerts Found **0**" in 3xl font-black on a fraud-signal panel. Silent catches at `:4858-4859` and `:5895-5896` do not even null the state, so stale prior-filter data persists under a newly selected filter.

**Why.** An executive cannot distinguish "the workshop billed nothing" from "the query died". Realistic triggers: 401 after session expiry, or a Vercel timeout on the 1,844-line ro-billing-analysis route. Milder than the 53% cached-zero incident (React Query caches the *error*, not a zero, and nothing wrong is persisted), but the same trust failure at the presentation layer.

**Correction:** the claim that only one error state exists is inaccurate — `aiSummaryError` renders at `:2318-2320` and the Service Dashboard download alerts at `:1828`. Both are user-initiated actions; no *data panel* distinguishes failure from zero.

**Fix.** Destructure `isError`/`error` from every `useQuery` and render an explicit failure card instead of the zero-filled layout. For the `useState`/`useEffect` fetchers (`:4828-4869`, `:5880-6024`) add an `error` state and branch on it before the empty state. Never let a rejected promise fall through to a rendered metric.

**P1-D3. Columns labelled "MTD" contain the user's custom date range whenever a comparison is set** `[unverified]`
`ro-billing-analysis/route.ts:206`
`mtd: customPeriodWindow || {…}` — when a comparison range is picked, `customPeriodWindow` (`:190-197`) replaces month-to-date with the arbitrary selected span. The UI still prints the literal "MTD" at `page.tsx:3997, 4386, 4451, 5491, 7699`, and the card helper at `:4350` says "in selected MTD window". Meanwhile QTD (`:212-217`) and YTD (`:218-223`) keep calendar definitions — so one row mixes a custom like-for-like comparison with two calendar comparisons under three identical-looking headers.
*Fix:* emit data-driven `periodLabels` from the route (`mtd: 'Selected Range'`) and render those; update the `:4350` helper to echo `currentRangeLabel` (already computed at `:3953`).

**P1-D4. The APIs return `available`/`emptyReason` for exactly this problem and no client reads them** `[unverified]`
`lib/kia/business-excellence-contract.ts:248`
`buildKiaSourceMetadata` produces `{available, emptyReason, rowCount, latestAvailableDate, deduplicationMode, workingDayCount, holidayDates}` and six routes ship it (complaints:581, open-ro:498, overview:1105, workshop-performance:902, performance-intelligence:462, ro-billing-analysis:1523). Grepping all six client files for `emptyReason`, `sourceMeta`, `latestAvailableDate` or `deduplicationMode` returns zero hits. Compounding it, the SQL erases the distinction: `ro-billing-analysis/route.ts:888-895` does `COALESCE(AVG(rating) FILTER (… rating > 0), 0)`, surfaced at `page.tsx:7151` as "Avg Rating **0.0**" — which reads as catastrophic CSI when the truth is the feed carries no ratings. Same for "Pick & Drop 0.0%".
*Fix:* render a per-panel availability chip driven by `source.available`/`source.emptyReason` next to the existing freshness pills (`:2273-2281`). Return NULL rather than 0 when the filtered count is zero, and render `—`.

**P1-D5. Two divergent copies of the service-type classifier can bucket the same work_type differently on two tabs** `[unverified]`
`features/kia/business-excellence-page.tsx:5697` vs `:3713-3717` vs `:4772-4775`
Three lists, three matchers. `convertServerTableRows` uses exact case-insensitive equality on a list containing `'TMA-First Free Service'`; the Executive Dashboard normalises punctuation via `replace(/[^a-z0-9]+/g,' ')` on a list containing `'TMA First Free Service'` and `'Free Services'`; `buildWorkshopDisplayRows` uses substring matching. Whichever spelling the DMS actually emits, one view classifies those ROs as "Others" while the other calls them "Free Services" — different splits for the identical range and branch.
*Fix:* one exported `classifyKiaServiceType(name)`, placed next to `kiaServiceCategoryExpression` in the contract so client and SQL agree; all three sites call it.

**P1-D6. An empty result table tells the user it is still loading, forever** `[unverified]`
`features/kia/business-excellence-page.tsx:5534`
"Revenue summary is loading." is the `colSpan={10}` fallback whenever `activeRevenueRows.length === 0` (`:5531-5537`), but the skeleton guard above is narrower (`:5437` requires `isLoading`). Once the query resolves with zero rows the message renders permanently — and it also appears when the fetch errored, since errors here are only `console.error`'d (`:5896`). The parallel executive panel gets it right (`:4018`: "Data not available.").
*Fix:* split three states — skeleton while loading, "Couldn't load revenue summary" on error, "No billing recorded for this range" on empty success. **Quick win.**

**P1-D7. Every chart colour is an inline SVG attribute, so the theme remap layer cannot reach it** `[unverified]`
`features/kia/business-excellence-page.tsx:4938`
`app/globals.css:608-660` matches Tailwind *class names* only, so it cannot touch Recharts `fill=`/`stroke=` props. The file carries 185 six-digit hex literals: `#023468` ×27, `#D97706` ×16, `#1D4ED8` ×15, `#BE123C` ×15, plus `#64748b` ×14 axis ticks and `#e2e8f0` ×21 grid lines — the last two near-invisible on a dark surface. `lab(53 89.72 88.48)` is inlined 6× and is verbatim the value of `--dashboard-danger-text`.
*Fix:* a `KIA_BE_SERIES` palette read once from CSS variables (a small `useThemeTokens()` hook), passed into `fill`/`stroke`. At minimum route grid/tick/tooltip colours through `--border` / `--muted-foreground`.

**P1-D8. The same rupee metric is formatted with ₹Cr/L in one panel and as a bare integer in another** `[unverified]`
`features/kia/business-excellence-page.tsx:7765`
The RO Billing table uses `formatValue` (`:6026-6031` — `Math.round().toLocaleString('en-IN')`, no symbol, no compaction) even though the selector directly above lets the user switch it to Labour / Parts / Lab per Veh / Part per Veh. The structurally identical Executive table routes the same metrics through `formatCurrency` → "₹1.25L". Four money formatters coexist (`formatCurrency` :550, `formatCurrencyFull` :2688, `formatWorkshopTableMoney` :4671, plus bare `formatValue`). "Month Target 12,412,332" and "Month Target ₹1.24Cr" are the same number on two tabs.
*Fix:* one shared `formatRoMetric(metric, value)` taking `activeAnalysisType`; consolidate the money formatters into a single helper with a `compact` flag.

---

### P2 — Moderate (34)

#### Data correctness
| # | File:line | Issue | Fix |
|---|---|---|---|
| C-a | `service-dashboard-metrics.ts:820` | Both regex branches of the RSA date parser are **dead** — `\d` collapses to `d` in the cooked template literal (confirmed via `pattern_seen_by_pg: "^d{4}-d{2}-d{2}"`, 0/186 hits). Every row falls to `ELSE invoice_date::date`, which resolves `7/3/2026` as July only because DateStyle is MDY. Naively "fixing" the escape re-enables branch 2, which errors (`to_date('7/3/2026','FMMonth/FMDD/YYYY')` → 22007) and would 500 two routes. | One shared helper using POSIX classes `[0-9]` and `FMMM/FMDD/YYYY`; apply at all 6 sites; grep for other `\d` in sql`` templates. |
| C-b | `overview/route.ts:141` (+ `ro-billing-analysis:156`, `workshop-performance:81`, `complaints:241`) | LY comparison builds a non-existent 29 Feb: JS rolls it to 1 March (LY window gains a day); the complaints route concatenates the literal `'2027-02-29'` and Postgres raises 22008 → 500. | Clamp with `Math.min(day, lyDaysInMonth)` as `workshop-summary.ts:150` already does. |
| C-c | `page.tsx:3417` | "Revenue At Risk" = `delayed × (revenue / openRo)` — billed revenue over closed job cards divided by an unrelated open-RO count. `kpis.avgBilling` already holds the correct per-RO figure. | `delayed * numberOrZero(data.kpis?.avgBilling)`. **Quick win.** |
| C-d | `freshness/route.ts:108` | A source whose query throws is dropped from `sources[]` identically to one that has no `uploaded_at` column; `sourceUpdatedAt` is the max over survivors only. A broken feed becomes invisible on the very pill readers use to decide whether to trust the page. | Return an entry per configured source with `status: 'ok'|'unavailable'|'error'`; exclude only `ok` from the max. |
| C-e | `workshop-performance/route.ts:907` | `unsupportedComparisonSources: {ew_report: 'EW has only May 2026 data.'}` is false — the table spans 2025-03-28..2026-08-11 across 18 months. That stale prose is the stated reason `ewCount.growth`/`mcpCount.growth` are hardcoded `null` while `rsaCount` on the adjacent line shows growth. | Derive coverage from MIN/MAX at query time; wire both growths to `lyAuxiliaryCounts` (already fetched at `:829`). |
| C-f | `business-excellence-contract.ts:144` | `kiaOpenRoActiveStateSql()` includes `'close'`/`'closed'` while the route publishes "excludes closed" (`open-ro:494`). Latent today (all 166 rows are 'open'), but any RO closed *without* being billed would age in WIP forever. | Restrict to `('open')`; keep the billed-RO exclusion as a second guard. |
| C-g | `workshop-performance/route.ts:379` | `fetchAddonSummary` hardcodes `serviceType: 'MECH'`, assigning 100% of full-workshop VAS/WA/WB to the MECH row; Accident shows 0% regardless of bodyshop sales. The Grand Total is right, so the two rows don't add to their own total. | Split canonical operation metrics by workshop category, as the advisor path already does (`:410`). |
| C-h | `overview/route.ts:106` | `growth()` returns `+100%` whenever the baseline is ≤ 0 — so 0→5 and 500→1000 both render "+100%", hitting exactly the low-volume metrics (delayedRo, openOver15, ewCount, mcpCount). Siblings do this correctly: `workshop-performance:114-117` returns null, `ro-billing-analysis:279-282` returns 'N/A'. The client already handles null. | Return `null` on a non-positive baseline; collapse to the existing `nullableGrowth`. **Quick win.** |

#### Access control
| # | File:line | Issue | Fix |
|---|---|---|---|
| A-a | `workshop-summary/route.ts:13` `[verified]` | The only GET in the section that omits `request` from `requireBrandSectionApiAccess`, so `enforceDealerScope` never runs (`brand-access.ts:68-71`). A pinned user calling it with no `dealer_code` gets the combined Jammu+Udhampur summary. Blast radius is smaller than first reported — the UI can never emit the request (`page.tsx:1493/1515/1953-1955` force the scoped dealer), it needs a hand-crafted URL from someone already holding the section permission, and it returns aggregate metrics with no PII. The `dealer` alias is **not** an extra bypass: with `request` passed, an absent `dealer_code` fails closed. | Pass `request`. Best: make the parameter non-optional so this becomes a type error. **Quick win.** |
| A-b | `route.ts:228` | `selectedLimit = fetchAll ? 50000 : limit` discards the 100-row cap (`:326`). The projection includes `vehicle_reg_no` and `vin` (`:32, :39`) and the result is cached in Redis (`:331`). No caller sets the flag — it is a discoverable, un-exercised bulk-extraction path for the whole customer-vehicle dataset. (Also a perf defect: multi-MB array in lambda memory + oversized Redis write.) | Delete the branch. If a bulk path is needed, gate it behind `.ro_billing.export`, cap far lower, stream instead of cache, and strip VIN/reg unless the caller passes the PII role check. |
| A-c | `route.ts:358` (+ `rows/route.ts:9-13`) | `POST` checks `.view` then runs two `invalidateCachePattern` calls **before** returning its 405, so the flush is invisible to the caller. A view-only user can loop it to evict the section's heaviest keys and hold them cold with the unthrottled `skipCache=true` on every GET. | Return the 405 first, delete both invalidations — a rejected request must have no side effects. Expose an operator flush as a separate admin-gated, rate-limited route; restrict `skipCache` to super-admin. |
| A-d | `ai-summary/route.ts:476` | Two defects: (a) the guard omits `request`, so a pinned user's request goes downstream unscoped — it fails closed only because the downstream routes still 403, which surfaces as a 500 that masks the real cause; (b) `fetchJson` builds `new URL(path, request.nextUrl.origin)` and forwards the session cookie (`:219-223`). On any deployment where Host/X-Forwarded-Host is not pinned, that is SSRF carrying the caller's cookie. | Pass `request` + an explicit `canAccessDealer` check. Better: call the payload builders directly in-process — that removes the cookie forwarding, the origin dependency and five loopback round-trips at once. |

#### Performance
| # | File:line | Issue | Fix |
|---|---|---|---|
| P-a | `overview/route.ts:590-591` `[verified]` | `includeSecondary` gates 9 of 19 queries but `includeComparison = true` is a hardcoded literal, so 10 — including both `fetchWorkshopSnapshot` calls (~4 round trips each) and all five LY twins — run identically for `chunk=summary` and `chunk=secondary`. The client fetches both sequentially (`business-excellence-overview.tsx:1250, 1262`) and discards every KPI the secondary recomputed (`:1301-1329`). Cache keys include `chunk`, so they provably cannot share. Rate ~1.5×, not 2× — and progressive render *is* delivered; only total-work reduction is not. Mitigated by the 30-min cache, so the doubled DB cost is once per (window, dealer, chunk). | Gate the LY block on `includeSecondary`, or drop the second request and serve `chunk=full` once (the client already merges them). |
| P-b | `ro-billing-analysis/route.ts:1249` | The relational fallback selects 18 columns with **no LIMIT** in either branch, and `:1677` passes `undefined` dates for `view === 'fy'` — returning the entire billing history, then JSON-serialising it into Upstash (`:1680`). Aggregation then happens in JS on data Postgres could have aggregated. The SQL fast paths above (`:1525-1674`) already do it correctly; this is the un-migrated remnant. | Hard LIMIT; refuse to run without a date window; derive the FY range instead of `undefined`. |
| P-c | `workshop-summary/route.ts:9` | No `maxDuration` — every sibling sets 60 (or 30 for freshness). On a cold key the route runs 6 parallel window-function dedupes; the platform default kills it and it surfaces as a bare "Failed to fetch", and because the response caches only *after* the build, it fails identically on every retry. | `export const maxDuration = 60`. **Quick win.** |
| P-d | `workshop-summary:22`, `workshop-performance:160`, `freshness:105`, `route.ts:331`, `route.ts:156` | Five cache keys pin hand-written local versions (`v1`, `v3`, `v7`) instead of `KIA_BUSINESS_EXCELLENCE_CACHE_VERSION` (`contract.ts:13`, currently v42), so a semantics change leaves them serving pre-change numbers for 30 min fresh + 2 h stale. Worst: `shouldUseWorkshopJcSummary` caches the boolean deciding whether to read the materialised view. | Interpolate the shared constant via the existing `kiaBusinessExcellenceCacheKey` helper (`contract.ts:150`). **Quick win.** |
| P-e | `freshness/route.ts:75` | `SELECT MAX(uploaded_at), COUNT(*) FROM "<table>"` with no date bound — six unbounded COUNT scans whose only use is a display pill. Plus the cached-failure defect in C-d above, stored for 30 min / 2 h. | Drop the COUNT (or use `reltuples`); keep the indexed MAX; don't cache a payload where any source failed. |
| P-f | `ai-summary/route.ts:488` | `buildReportDataset` runs *before* the cache is consulted, and the dataset is hashed **into** the cache key — so only the Groq call is cached and the expensive part never is. Up to 5 loopback HTTP calls per click, each a fresh serverless invocation with its own cold start, auth round trip and unbounded fan-out, all inside `maxDuration = 60`. | Key on `(report, startDate, endDate, dealerCode)` and build the dataset *inside* the `getCachedData` factory; replace loopbacks with in-process builder calls. |
| P-g | `performance-intelligence/route.ts:282` | `export=all` removes the LIMIT entirely, aggregates the unbounded set into one `jsonb_agg`, and the GET still wraps it in `getCachedData` (`:468`) with `export=all` in the key — persisting the whole export to Redis for 30 minutes. The paged path is correctly capped at 100. | Bypass the cache when `exportAll`; impose an absolute ceiling (e.g. 20,000) with a truncation flag. |

#### Accessibility
| # | File:line | Issue | Fix |
|---|---|---|---|
| Y-a | `page.tsx:7556` `[verified]` | The RO Billing view switcher is nine bare `<button>`s in a plain `<div>` — no `role="tablist"`/`"tab"`, no `aria-selected`/`aria-pressed`/`aria-current`; the active state is the `app-primary-action` background **colour alone** (globals.css:664-684 changes only colour), so it is also WCAG 1.4.1. Same at `:1986, 4425, 4505, 5461, 7441, 7671, 8447`. Whole-file grep: `role=` → **0**, `aria-*` → **8**. `:1980` puts `aria-label` on a role-less `<div>`, where ARIA prohibits naming — the group name is dead code. The app already ships a Radix `Tabs` used by sibling KIA pages, so this is the outlier, not house style. Buttons *are* reachable and uniquely named; what is lost is orientation, not function. | `role="tablist"`/`"tab"` + `aria-selected` + `aria-controls`/`role="tabpanel"` on the 8 real view buttons; **note the Calendar button at `:7578` opens a modal, not a panel** — it needs `aria-haspopup="dialog"`/`aria-expanded` instead. `aria-pressed` on the filter-chip groups; move group labels onto `role="group"`. |
| Y-b | `page.tsx:7421` `[verified]` | Four full-screen overlays are raw `fixed inset-0` divs — RO Billing Calendar (`:7421`), expanded workshop chart (`:5153`), expanded chart (`:8711`), Scoring Rules (`:1301`) — with no `role="dialog"`, no `aria-modal`, no accessible name, and no Escape/focus handling (grep for `escape|keydown|inert` across three files → 0). Siblings `open-ro-section.tsx:794-797` and `kia-complaints-section.tsx:733-737` set them on structurally identical markup, and this same file uses Radix `Dialog` correctly for the AI summary (`:2284`). **Corrections:** not WCAG 2.1.2 (focus leaks out, it isn't trapped), every overlay does have a working focusable close control, and Escape-to-close is an APG practice not a success criterion. Real failures: 4.1.2 (no role/name), 2.4.3 (focus order continues behind an opaque layer), background not hidden from AT. | Use the Radix `Dialog` already imported at `:9-15`. |
| Y-c | `page.tsx:7766` `[verified]` | Every LY figure on the flagship comparison table is `text-slate-400` (#94a3b8) on `bg-white` — **2.51:1**, below even the 3.0:1 large-text floor, at 13px. Repeated `:7778, :7788, :3970, :4471`, on the 9px/10px column headers `:5490-5501`, and 80 more times in this file (+11/12/8 in three siblings). `text-slate-300` (**1.49:1**) sits on *clickable* calendar days `:297, :7511, :7516, :7976, :7981`. The `.be-management-total-row` override in globals.css only covers total rows; the `.glass-dashboard-content` remap is dark-mode only. **Correction:** growth badges are rendered separately in emerald/red and do pass, so the comparison *signal* stays readable — only the raw prior-year magnitude is dim. (The badge's 'N/A' branch at `:526/528` is slate-400 at 10px and does fail.) | Data cells → `text-slate-600` (7.5:1); muted headers → `text-slate-500` (4.76:1). For clickable out-of-month days use slate-500 plus opacity, not a lighter foreground. |
| Y-d | `page.tsx:2304` | No status messages anywhere: 33 `animate-pulse` skeletons, and applying a date filter (`:2090`) or switching branch (`:1989`) swaps the entire content region silently. Zero `aria-live`, `role="status"`, `aria-busy` or `sr-only` across all six BE files. Error text at `:2319-2321` is injected with no live region. WCAG 4.1.3. | One `<p role="status" aria-live="polite" class="sr-only">` in the report shell, written on each state change; `aria-busy` on the content container. |
| Y-e | `page.tsx:7500` | The RO calendar is a hard `grid-cols-7` at every breakpoint (also `:7958/7965`), inside a `fixed inset-0 p-3` overlay. At 375px each column is ~50px; after padding, ~18px remains for a value like "1,23,456" that needs ~45px at 10px — and the flex rows have no `min-w-0`, no `truncate`, no wrap. 42 cells of collided text on the device a service manager actually uses on the shop floor. WCAG 1.4.10 Reflow. | `grid-cols-1 sm:grid-cols-7`, or hide the CY/LY/Target rows below `sm`. At minimum `min-w-0` + `truncate` + `tabular-nums`. |
| Y-f | `page.tsx:2021` | The primary report switcher is an unnamed Radix `SelectTrigger` (`role="combobox"` does not support name-from-content), the workshop advisor filter (`:5196`) is a native `<select>` with no label association to the `<p>Advisor Filter</p>` beside it, and the FY search (`:8028`) is placeholder-as-label at `placeholder-slate-400` (2.5:1). | `aria-label` on all three; `placeholder-slate-500`. **Quick win.** |
| Y-g | `page.tsx:144` | `AnimatedMetric` runs a 24-frame count-up on a raw `setInterval`, which the global `prefers-reduced-motion` guard (globals.css:2016-2027) cannot touch since it only neutralises CSS durations. Every KPI headline churns through 24 intermediate — i.e. wrong — values on a financial dashboard. | Early-return `setDisplayValue(value)` when `matchMedia('(prefers-reduced-motion: reduce)').matches`. **Quick win.** |
| Y-h | `page.tsx:1093` | Heading structure is h1 → 21 × h3, with a single stray h2 (`:5448`) and one h4. `CardTitle` renders h3, so section and panel titles share a rank and the heading list gives no sense of which chart belongs to which section. | Report title → h2, section titles → h3, panel titles → h4. |
| Y-i | `page.tsx:7748` | Interactive targets down to 24×24px: row-expand toggles (`:7748`, `:5085`), 28px year chips (`:2126`) and maximize control (`executive-table-shell.tsx:78`), ~24px branch/metric chips (`:1991, 4430, 4510`) with only `gap-1`/`gap-1.5` spacing — no spacing exception applies. On touch, mistaps on the branch chips silently reload the dashboard against the wrong branch. | `h-9 w-9` (or a `before:-inset-2` hit-area extension) on icon toggles; `py-2` and `gap-2` on chip rows. |
| Y-j | `page.tsx:3992` | Ten horizontally-scrolling table wrappers (`min-w-[860px]` … `min-w-[1480px]`) are bare `overflow-x-auto` divs — no `tabIndex`, no `role="region"`, no name. A keyboard-only user cannot reach the scroller in browsers that don't auto-focus it, so ~two-thirds of the RO Billing columns are unreachable. | Extract one `<ScrollableTable role="region" tabIndex={0} aria-label=…>` and use it at all ten sites. |

#### Design & integrity
| # | File:line | Issue | Fix |
|---|---|---|---|
| D-a | `page.tsx:5219` | Workshop Performance renders a 20-column `min-w-[1480px]` table, then a 10-column subset of the same rows, and only *then* the eight KPI cards — while the loading skeleton (`:4968-4982`) shows cards first, a layout that never appears. All eight cards are visually identical with the same `<Wrench>` icon, so "Total Revenue" competes at the weight of "MCP Count". | Move the KPI grid above the tables and match the skeleton; promote Total Revenue/Total JC; drop or differentiate the icons. |
| D-b | `page.tsx:2034` | `{false && …}` guards the only "Show Health" toggle, so `BusinessExecutiveDecisionLayer` (`:3483-3618`) and five health builders (`:2944-3468`, ~520 lines) are dead. `setShowAiSummary(true)` occurs only inside `generateAiSummary`, which is only called from a button *inside the already-open dialog* — so the 140-line dialog and the entire 510-line `ai-summary` route are unreachable. The comment at `:2426` claims the panel "is opt-in from the report header", which is false. Landmines for whoever re-enables it: the fabricated `70` (P1-C7) and `closureRate = total > 0 ? … : 100` (`:3277`), which scores an empty payload 100 "EXCELLENT". | Delete both, or restore the entry points **after** fixing `:3086`, `:3400` and `:3277`. Never leave `false &&` as a feature flag. |
| D-c | `app/globals.css:1608` | A `!important` substring layer overrides the component's own styling: `bg-teal-600/700/800` all collapse to one colour, flattening the deliberate MTD/QTD/YTD header banding (`page.tsx:7696-7714`) that was the only visual separator on an 11-column table. The `~=` selector misses opacity variants, so `bg-teal-50` is remapped while `bg-teal-50/60` is not — two different "teal-50"s in adjacent rows. A forced `border-width`/`border-color` on `[class*="rounded"][class*="bg-"]` strips the growth badges' emerald/rose borders. | Give the section real tokens (`--be-header`, `--be-header-alt`, `--be-total-bg`) applied in the component and delete the override block. |
| D-d | `page.tsx:721` + `app/brands/kia/business-excellence/page.tsx:35` | Executive Dashboard access is the literal array `['developer','ceo','md','ea','eba','process_coordinator']` duplicated in two files, plus a post-mount `useEffect` redirect (`:1563-1574`). `[report]/page.tsx:43` validates only the slug, so the page server-renders for a disallowed role before the client bounces them. Not a data leak (the executive view is fed by `ro-billing-analysis`, which every BE viewer may call) — but the rule is written three times, enforced nowhere, and invisible to `/admin`. | Add `kia.business_excellence.executive_dashboard` to the registry (alongside the P1-A1 map), resolve server-side, pass a boolean to the client. |
| D-e | `page.tsx:525` | Three competing growth-badge implementations in one report: `getGrowthBadgeClass` (white fill + saturated outline, used `:5234, 7770`), `ExecutiveGrowthBadge` (filled pill, `:3972, 4407, 4472`) and `growthBadgeClass` (`lab()` colours, `:5522`). `ExecutiveRevenuePerformance` and `ROBillingRevenueSummarySection` are near-identical panels rendered with a slate→teal gradient in one and off-palette `bg-purple-600` in the other (`:5479`). | Keep `ExecutiveGrowthBadge`, delete the other two, and collapse the duplicate panel into one with a row-source prop. |
| D-f | `app/brands/kia/business-excellence/page.tsx:20` | The index page gates on `getBrandAccess('kia')` but never calls `requirePermission(…, 'kia.business_excellence.view')` unlike `[report]/page.tsx:57`, and forwards `dealer_code` with no `canAccessDealer` check. Not exploitable — the redirect target enforces both — but the two sibling pages now disagree on what the gate is, which is exactly how the previous guard-desync incidents started. | Add the same `requirePermission` → `forbidden()` block, and clamp the forwarded dealer. **Quick win.** |

---

### P3 — Minor polish (8, grouped)

Two service-category definitions coexist (`route.ts:77` classifies on `work_type + service_type` while every other consumer uses the contract's `work_type`-only expression — 0 rows differ today, but the data tab and the KPI cards would silently diverge the moment a row arrives with `work_type='NVI', service_type='60K'`); the daily trend emits a hard `ly: 0` past the end of a shorter comparison range instead of `null`, dropping the comparison line to the axis (`ro-billing-analysis:743`); `#055B65` is hardcoded 7× in `page.tsx` + 2× in `executive-table-shell.tsx` and is not in the globals remap list `[verified]` — cosmetic only, affecting one of the two *actually reachable* accents (theme-initializer whitelists only `executive-navy` and `tropical-teal`; the other five accent blocks are dead CSS) and inseparable from 73 other unremapped `teal-*` utilities, so fix the whole teal palette in this section or nothing; raw exception messages leak env-var names and SMTP identity on two routes (`service-dashboard-email:55`, `ai-summary:506`) where every sibling returns a fixed string; `tableExists` memoises a *negative* result for the lambda's lifetime (`workshop-performance:148`) where the overview route deliberately caches only `true`; `recharts` is missing from `optimizePackageImports` (`next.config.ts:6`); the hand-written search magnifier lacks `aria-hidden` and the Performance Intelligence PDF export emits no `lang` and no `scope` (`page.tsx:8035`, `:1012/1030`); and `const loading = false` (`:1501`) makes `BusinessExcellencePageSkeleton` unreachable, alongside a `console.log` at `:2017`, rose-coloured "N/A" placeholders (`:6826-6827`) and a class-name substring hack at `:4563` that neutralises `lab()` colours set 250 lines earlier.

---

## 4. Systemic Patterns

**1. Helper exists, route never adopted it.** The single most common shape in this audit. `kiaOpenRoPromiseDateSql` exists and documents two prior incidents — `/open-ro` still hand-rolls the cast that is 500ing today (P0-1). `getCachedServiceDashboardMetrics` sits three lines below the uncached call (P1-P4). `nullableGrowth` sits five lines below the `+100%` bug (C-h). `kiaActiveServiceCategoryFilter`, `kiaBusinessExcellenceCacheKey`, `workshop-summary.ts`'s leap-year clamp, the Radix `Dialog`, `<Tabs>`, `formatCurrency`, `classifyKiaServiceType`-shaped logic — all present, all bypassed somewhere. **Every one of these is a one-line fix that CI could enforce.**

**2. Client and server disagree on the same number.** Two dedupe rules (P1-C9), two service-category classifiers in SQL vs three in the client (P1-D5, P3), four money formatters (P1-D8), four copies of `* 1.1` (P1-D1), two Executive Dashboard role arrays (D-d), three growth badges (D-e). When a manager finds two figures that disagree, both become untrustworthy.

**3. Zero and missing are the same value.** No `isError` branch anywhere (P1-D2), `COALESCE(AVG(rating), 0)` → "Avg Rating 0.0" (P1-D4), `growth()` → `+100%` on an empty baseline (C-h), freshness dropping failed reads (C-d), the empty table that says "loading" forever (P1-D6). The contract layer **already builds** `available`/`emptyReason`/`latestAvailableDate` for exactly this and no client reads a single field (P1-D4). The honesty signal was built, paid for, and dropped on the floor.

**4. Text-as-date, plus expressions the planner can't index.** `promise_date_time` (P0-1), `invoice_date` (P1-P5, C-a), the `COALESCE` join key (P1-P2), `UPPER(TRIM(COALESCE(...)))` on dealer code (P1-P3). Correctness bugs *and* the section's dominant performance cost share one root: dates and keys arrive as free text and are normalised at query time, per row, per execution. Normalising at ingestion would close both classes at once.

**5. Registry keys nobody reads, guards nobody calls.** Seven sub-permissions defined and shipped in two live branch presets, enforced at zero sites (P1-A1). One route out of fourteen omits `request` and therefore all dealer scoping (A-a). The Executive Dashboard allowlist lives in three client files and no server check (D-d). `scripts/verify-guard-parity` exists and should be failing on every one of these.

**6. Window boundaries applied at the wrong layer.** VAS derives its lower bound from `endDate` (P1-C3), the rework LAG can't see before `startDate` (P1-C4), the "monthly" average has no month partition and inherits the user's own filters (P1-C5), the `latest` CTE dedupes before filtering (P1-P1). Each is a predicate one CTE too early or too late.

**7. The 8,741-line file has outgrown review.** ~1,200 lines of dead UI behind `false &&` with a comment claiming it works (D-b), a global `!important` layer that silently overrides the component's own classes (D-c), zero `role=` attributes and 8 `aria-*` in the whole file, no code splitting, no memoisation, 185 hex literals. Every other pattern above is worse here than in the routes.

---

## 5. What's Working Well

**The data contract is genuinely good.** Trap 1 does not apply — I verified against live data that `dealer_code` carries the real outlet on `ro_billing_report` and `open_ro_yearly` for every month Apr–Aug 2026, so the `COALESCE(dealer_code, main_dealer_code)` order is correct; the July-2026 changeover hit the sales feeds, not service. Trap 2 is handled — `kia_ro_billing_report` is not a cumulative re-ingest (5,551 rows / 5,253 keys, ~5% genuine dupes) and every aggregate dedupes before summing; complaints and open-RO use `DISTINCT ON … ORDER BY uploaded_at DESC` consistently. Trap 3 is handled **and documented at the fixing line** — `previousFinancialYearToDate` (overview:175-182) names the +66% → −45% defect it corrects, `buildPeriodWindows` derives every LY bound from the same anchor as its CY bound, `getFinancialYearStart` cites the 61% overstatement.

**Defensive engineering with receipts.** `kiaOpenRoPromiseDateSql` (contract.ts:117-142) accepts both date shapes and degrades to NULL rather than throwing, with a comment naming the two production incidents that produced it — it parses all 165 promise dates correctly. The materialised-view fast path compares the view's job-card count *and* labour/parts sums to 0.01 against a freshly deduped raw query before trusting it, and refuses the view entirely under a dealer filter; I verified it currently returns `false` for Aug 2026 (122 vs 125), so the section is reading raw data. `fetchDeliveredBillingKpis` and `buildServiceDashboardMetrics` use byte-for-byte the same dedupe, filter and category whitelist, so the Overview headline reconciles with the Service Dashboard export — and the comment at export.ts:405-410 documents the 248 → 252 over-count it removed. `lib/db/index.ts:6-26` and `lib/db/concurrency.ts` carry **dated, measured evidence** for the pool size and fan-out ceiling.

**Security fundamentals hold.** All 14 routes authenticate as their first statement; there is no root `middleware.ts`, so that per-route discipline is the only thing standing between this section and the internet, and it holds. `requireBrandSectionApiAccess` is a well-designed composite returning a `NextResponse` rather than throwing, so a forgotten `if (accessError) return` is caught in review. `getUserDealerScope` **fails closed** via the `DEALER_SCOPE_NONE` sentinel, with a comment explaining why an empty array would have read as unrestricted. Zero SQL injection — every user value is a bound parameter, and every `sql.raw` is over a hardcoded identifier or a value already through `normalizeKiaDealerCode` (which can only return JK402 or JK501). Dates are validated against an anchored regex, numerics are clamped, every user-varying response sets `Cache-Control: private`, and the .xlsx export sets `no-store`. The Service Dashboard workbook is aggregate-only — VIN/reg appear solely in dedupe keys, never in an output column.

**The caching and observability layer is a model.** Three tiers (LRU L1 → Redis → a `:stale` twin for SWR) with single-flight coalescing so a thundering herd on a cold key collapses to one build; `keepAlivePastResponse` pins background refreshes with `after()`, the correct fix for the Vercel freeze-on-response problem. Cache keys are content-hashed over the **complete** input set including dealer and comparison mode, so the classic "wrong branch's numbers from cache" bug is absent. Hot paths push aggregation into Postgres — `performance-intelligence` returns KPIs, alert counts, advisor scores, filter options and paged rows from **one statement**, the pattern the other routes should copy — and `ro-billing-analysis` has SQL fast paths for every common unfiltered view. Every route is instrumented with `createApiTimer` and per-phase labels, so slow phases are measurable in the network panel without adding instrumentation first.

**Accessibility has good bones under the missing ARIA.** Zero divs-as-buttons — all 48 `onClick` handlers trace to a native `<button>` or the `<Button>` wrapper. All ~15 tables use real `<table>/<thead>/<th>` semantics, so they are fixable with attributes rather than a rewrite. The global reduced-motion rule deliberately exempts `.animate-spin` because progress indication is functional. `executive-table-shell.tsx:70-81` is a model icon button (state-dependent `aria-label`, `aria-pressed`, `title`, `aria-hidden` icon), the AI summary dialog is a correct Radix implementation, and `AnalyticsDateRangePicker` is all native buttons with 40px day cells, labelled month nav and a text status line restating the range in words.

**Product craft in the details.** Freshness distinguishes "Checking…" / "Not available" / a timestamp, with per-source chips exposing row counts through the centralised timezone-safe formatter. The Overview's Business Health Score has a real methodology drill-down listing Factor / Weight / Score / Current Signal and printing "No LY comparison" where data is absent — far better provenance than the dead panel in the main file. Loading states are structural skeletons, not spinners. The copy uses vocabulary a KIA service manager actually recognises (Work Type, MECH TOTAL, RO Load, Lab/Veh, TD/MTD/QTD/YTD) with an in-place legend for WA/WB/VAS. And non-obvious past decisions are documented at the point of the code, including why `dealerCode` is deliberately withheld from `RevenueLeakagePanel`.

---

## 6. Prioritized Fix List

### Tier 0 — Today
| # | Fix | Effort | Why first |
|:--:|---|---|---|
| 1 | **P0-1** Import `kiaOpenRoPromiseDateSql` in `open-ro/route.ts:71` and compare the derived column at `:118-119` | **~10 min** | An entire tab and an AI summary path are dead in production right now. Verified drop-in. |

### Tier 1 — This week (wrong numbers on screen)
| # | Fix | Effort | Notes |
|:--:|---|---|---|
| 2 | **P1-D2** Add `isError` branches to every `useQuery` and the two `useEffect` fetchers; never render a metric from a rejected promise | Medium | Stops ₹0 and "Alerts Found 0" masquerading as data. Highest trust impact per line changed. |
| 3 | **P1-D1** Hoist one `LY_GROWTH_TARGET_MULTIPLIER`, relabel the tiles "Target — LY +10%", render "—" where unconfigured | **Quick win** | Removes fabricated business figures the same day. Don't route through `executive-targets.ts` — it's placeholder literals too (P1-C8). |
| 4 | **P1-C9** Standardise every dedupe on the single-winning-row rule; add the `sum(chart) === kpis.revenue` parity assertion | Medium | Makes charts reconcile to the headline. ~9 call sites, one pattern. |
| 5 | **P1-C2** Drop `OR dealer_code IS NULL` from the three add-on filters | **Quick win** | One-line ×3; ends the 19× Udhampur inflation. Then chase the 81%-NULL feed. |
| 6 | **P1-C3 / P1-C4 / P1-C5** Push the correct window boundary into VAS, rework-LAG and the "monthly" averages | Medium | Three separate one-CTE fixes; C-5 also requires making the benchmark population unfiltered. |
| 7 | **P1-C1 / C-g** Fix the VAS allocation so `labMinusVas = labour − lessVas` holds and MECH/Accident each carry their own VAS | Medium | Add the invariant assertion so it can't regress. |
| 8 | **P1-C6** Correct the AI-summary field lists and refuse to call Groq on a dataset with no numeric values | **Quick win** | Stops fabricated executive prose at the source. |

### Tier 2 — This sprint (access & privacy)
| # | Fix | Effort | Notes |
|:--:|---|---|---|
| 9 | **P1-A1** Wire the 7 sub-permissions into their serving routes + `[report]/page.tsx`; add them to `verify-guard-parity` | Medium | Third guard-desync occurrence. The parity script exists — make it fail on orphaned keys. |
| 10 | **P1-A3** Delete `customerName`/`regNo`/`regNumber` from the three `pickRows` lists | **Quick win** | Stops cross-border PII transfer in three line edits. |
| 11 | **P1-A2** Delete `cust_name`/`mobile_no`/`vin_no` from the complaints SELECT and mapping (+ open-ro `:237-238`) | **Quick win** | Nothing consumes them. |
| 12 | **A-a** Pass `request` at `workshop-summary/route.ts:13`; make the parameter non-optional | **Quick win** | The type change prevents the whole class. |
| 13 | **A-b / A-c** Delete the `fetchAll` branch; move the 405 above the two cache invalidations | **Quick win** | Removes a 50k-row VIN extraction path and a view-permission DoS. |
| 14 | **A-d** Replace `ai-summary`'s loopback fetches with in-process builder calls | Medium | Kills the cookie-forwarding SSRF, the Host dependency and five invocations at once — also fixes P-f. |

### Tier 3 — Performance (measurable, low risk)
| # | Fix | Effort | Notes |
|:--:|---|---|---|
| 15 | **P1-P4** One-line swap to `getCachedServiceDashboardMetrics` | **Quick win** | Largest single sub-computation, currently uncached. |
| 16 | **P-c / P-d** Add `maxDuration = 60`; interpolate the shared cache version at five keys | **Quick win** | Two-minute fixes; P-d prevents a stale boolean routing the whole workshop page at an unverified view. |
| 17 | **P1-P1 / P1-P2 / P1-P3 / P1-P5** Push date bounds into `latest`; add the two functional indexes copied verbatim from the query text; cache the per-dealer feed max | Medium | The four heaviest statements in the section. Create indexes CONCURRENTLY per migration 0032's warning. |
| 18 | **P-a** Gate the LY block on `includeSecondary` (or serve `chunk=full` once) | Small | ~1.5× less DB work per cold overview key. |
| 19 | **C-a + P1-P5** Normalise `invoice_date` at ingestion to a real `date` column and index it | Larger | Closes a correctness bug *and* 6 full scans per page load. Do not "fix the backslash" without also fixing the format string — that path 500s. |
| 20 | **P1-P6** `next/dynamic` per section + `React.memo` + local draft date state | Larger | 711 KB → one section's worth; stops full-tree re-render on every calendar click. |

### Tier 4 — Accessibility (bundle into one pass)
| # | Fix | Effort |
|:--:|---|---|
| 21 | **Y-c** Global find-and-replace: `text-slate-400` → `-600` on data, `-500` on headers; `text-slate-300` → `-500` on clickable days | **Quick win**, ~111 sites |
| 22 | **P1-Y2 / Y-f / Y-g** `aria-label` + `aria-expanded` on icon buttons; name the three unlabelled controls; reduced-motion guard on `AnimatedMetric` | **Quick win** |
| 23 | **Y-b** Replace the four hand-rolled overlays with the Radix `Dialog` already imported | Small |
| 24 | **Y-a** Real tab semantics on the eight view buttons (`aria-haspopup="dialog"` on the Calendar button, which is not a tab); `aria-pressed` on the chip groups | Small |
| 25 | **P1-Y3 / Y-j** `scope`/`<th scope="row">`/`sr-only <caption>` on ~15 tables; one `<ScrollableTable>` wrapper for the ten scroll regions | Medium |
| 26 | **P1-Y1 / Y-d / Y-e / Y-h / Y-i** Chart names + `sr-only` data tables; one live region; responsive calendar; heading levels; 36px targets | Medium |

### Tier 5 — Cleanup
27. **D-b** Delete the ~1,200 lines of dead health panel + AI brief, or restore the entry points *after* fixing the fabricated `70` (P1-C7) and the `: 100` default. **28.** **P1-D3 / P1-D8 / P1-D5 / P1-D4** Data-driven period labels; one money formatter; one service-type classifier; render `source.available`/`emptyReason`. **29.** **D-c** Section tokens + delete the `!important` substring block. **30.** **D-a / D-e / D-f** KPI strip above the tables (and match the skeleton); one growth badge; `requirePermission` on the index page. **31.** The P3 polish list as one PR — including the `#055B65`/teal palette pass as a *whole-palette* change or not at all.

**Quick-win subtotal:** items 1, 3, 5, 8, 10, 11, 12, 13, 15, 16, 21, 22 — roughly a day and a half of work that removes the live 500, the fabricated targets, the 19× branch inflation, the PII transfer, two extraction paths, the section's heaviest uncached call, and the worst of the contrast failures.