# Multi-brand Sales & Stock — readiness spec

Status: **plumbing ready, data pending.** The app can present vehicle **Sales** and **Stock** for any
brand, but today only **KIA** has the underlying data. This doc records exactly what's needed to light
up another brand (Hyundai, Platinum, MG, …), and the checklist to wire it once data exists.

## The one hard blocker: source data does not exist yet

Sales/stock figures come from DMS-export tables that an **external import cron loads into Postgres**
(every ~75 min, 9AM–6PM IST). **This app only reads them — it has no upload UI, parser, or ingestion
code.** For KIA those tables are `kia_sales_report`, `kia_stock_management`, etc. For every other brand
they **do not exist anywhere** (not live, dormant, in BigQuery, or in migrations).

So "add Hyundai sales/stock" is **not** a wiring task first — it is a **data task**: the business must
start exporting each brand's DMS feeds into Postgres, using the naming + freshness contract below.
Until then, the brand stays `available: false` in the registry and simply doesn't appear.

## What each new brand must export

Mirror KIA's feed. For a brand, the external cron must create + load these tables (names follow the
existing service-data prefix convention — KIA bare, Hyundai `hyundai_`, Platinum `am_platinum_`, MG
`mg_`), matching the KIA column shapes the readers expect:

| Purpose        | KIA table                              | New-brand table (e.g. Hyundai)     | Key columns the reader needs |
|----------------|----------------------------------------|------------------------------------|------------------------------|
| Enquiries      | `kia_enquiry_report`                   | `hyundai_enquiry_report`           | `enquiry_date`, `dealer_code`, `model`, `source`, `consultant_name`, `enquiry_status` |
| Bookings (DMS) | `kia_booking_report`                   | `hyundai_booking_report`           | `booking_date`, `dealer_code`, `model`, `status`, `amount_received` |
| Sales/retail   | `kia_sales_report`                     | `hyundai_sales_report`             | `delivery_date`, `booking_date`, `invoice_no`, `dealer_code`, `consultant_name`, `model`, `variant`, `ex_showroom_price`, `vin_number` |
| Accessories    | `kia_accessories_counter_sales_report` | `hyundai_accessories_counter_sales_report` | `csr_date`, `dealer_code`, `model`, taxable/tax amounts |
| Stock          | `kia_stock_management`                  | `hyundai_stock_management`         | `vin_number`, `basic_price`, `kin_invoice_amt`, dealer, stock status, stock age inputs |
| Purchase/GRN   | `kia_purchase_report`                  | `hyundai_purchase_report`          | `vin_no`, `grn_date`, `retail_date`, `basic_price` |

The exact per-brand table names are already declared (as the requested targets) in
`lib/brands/sales-stock-sources.ts`. Each table must also carry the ingestion watermark the rest of
the app relies on:

- **`uploaded_at`** — set by the loader; drives the "data as of" freshness ribbons.
- **`row_hash`** — full normalized-row SHA-256 upsert key (a DB trigger recomputes it), per the
  existing `docs/hyundai-cron-ingestion-contract.md` protocol used for service data.

## Activation checklist (once a brand's feeds are live)

1. **Registry** — in `lib/brands/sales-stock-sources.ts`, flip the brand to `available: true` and
   `readerImplemented: true`, and confirm its `tables` + `calcProfile.stockValueUpliftFactor`.
2. **Reader** — the KIA readers currently inline KIA table names in raw SQL. Either (a) generalize
   `lib/kia/sales-report.ts`, `sales-performance.ts`, `stock-report.ts` to take the registry table
   names for the brand, or (b) add the brand's `case` in `lib/brands/sales-stock.ts`
   (`getBrandSalesSnapshot` / `getBrandStockSnapshot`). Validate the **stock valuation** (`basic_price
   * upliftFactor`) and **dealer normalization** for that brand — these are KIA-specific today.
3. **Cockpit** — nothing to change: it iterates `availableSalesStockBrands()`, so the brand's sales
   & stock cards + KPI totals appear automatically.
4. **Per-brand report pages (optional)** — to give the brand its own Sales Report / Stock Report
   sections like KIA:
   - `lib/permissions/registry.ts`: add `<brand>.sales_report` / `<brand>.stock_report`
     `PERMISSION_GROUPS` (under the existing `<brand>.sales` parent), `SECTION_ROUTES`
     (`/brands/<brand>/sales-report` etc.), and add the keys to `DEFAULT_VISIBLE_SECTIONS`.
   - **Sensitive gating (do this):** add the new keys to `SENSITIVE_REPORT_SECTIONS` so they inherit
     KIA's deny-by-default-to-all-but-MD/Developer/EBA treatment (`applySensitiveReportDefaults`
     applies automatically), and add them to the `md` + `eba` role templates. Otherwise, once on the
     default-visible allowlist, they'd be visible to every brand user — unlike KIA.
   - `components/layout/sidebar.tsx`: add Sales Report / Stock Report submenus to the brand's Sales
     section (`brandNavigation`). Visibility auto-gates off the route→permission map.
   - Add the route folders (`app/brands/<brand>/{sales-report,stock-report}/page.tsx` + client) or
     extend the brand `[...module]` router, each guarding `<brand>.sales_report.view` /
     `<brand>.stock_report.view`.
   - Keep `scripts/verify-nav-map.ts` in sync (add the new hrefs to its `CURRENT` snapshot).

## What is already in place (this effort)

- `lib/brands/sales-stock-sources.ts` — the brand registry (tables + `available` + `calcProfile`),
  the single source of truth. KIA active; Hyundai/Platinum/MG declared, inactive.
- `lib/brands/sales-stock.ts` — the brand-parameterized read API (`getBrandSalesSnapshot` /
  `getBrandStockSnapshot`) that the cockpit consumes; KIA dispatches to the existing readers, others
  return an `available: false` snapshot.
- `lib/kia/sales-report.ts` + `sales-performance.ts` now source their table names from the registry.
- The Group Cockpit iterates `availableSalesStockBrands()` — brand-loop ready.

No empty brand pages were created: an inactive brand contributes nothing until its data + reader land.
