// Single source of truth for WHICH data feeds back each brand's Sales & Stock reporting, and the
// per-brand valuation knobs that differ. This is the CONTRACT for going multi-brand: today only KIA
// has an actual data feed (the tables are loaded by an external DMS import cron — this app only reads
// them; see docs/multi-brand-sales-stock-readiness.md). The other brands are DECLARED here with the
// table names they SHOULD export to, so the moment those feeds land, activating a brand is a config
// change (flip `available`, provide/verify a reader) rather than a code hunt.
//
// NOTE: this file is intentionally free of `server-only` — it is pure data (table names + numbers)
// safe to import from client label helpers too. The readers that actually query the DB live under
// lib/kia/* (KIA) and dispatch through lib/brands/sales-stock.ts.

export type BrandSalesStockTables = {
  enquiry: string
  booking: string
  sales: string
  accessories: string
  stock: string
  purchase: string
}

export type BrandSalesStockSource = {
  brand: string
  label: string
  // Does a live data feed exist for this brand (are these tables populated by the external cron)?
  available: boolean
  // Is there a reader in this repo that can turn the feed into numbers? Only KIA today — a new brand
  // needs its reader validated (dealer normalization + the valuation profile below) before it flips on.
  readerImplemented: boolean
  tables: BrandSalesStockTables
  calcProfile: {
    // Approx landed-value uplift applied to ex-factory basic_price for stock valuation (KIA ≈ 1.36 =
    // ~36% GST/cess). Per-brand because tax/cess differs; MUST be validated per brand before use.
    stockValueUpliftFactor: number
  }
}

// Per-brand DMS table naming. KIA ships bare kia_* names; the multi-brand SERVICE feeds already use
// hyundai_ / am_platinum_ prefixes (see lib/analytics/table-map.ts), so sales/stock should follow the
// same convention. These non-KIA names are the REQUESTED export targets, not live tables yet.
function tablesFor(prefix: string): BrandSalesStockTables {
  return {
    enquiry: `${prefix}enquiry_report`,
    booking: `${prefix}booking_report`,
    sales: `${prefix}sales_report`,
    accessories: `${prefix}accessories_counter_sales_report`,
    stock: `${prefix}stock_management`,
    purchase: `${prefix}purchase_report`,
  }
}

export const BRAND_SALES_STOCK_SOURCES: Record<string, BrandSalesStockSource> = {
  kia: {
    brand: 'kia',
    label: 'AM KIA',
    available: true,
    readerImplemented: true,
    // KIA uses bare kia_* names (its own DMS export naming).
    tables: {
      enquiry: 'kia_enquiry_report',
      booking: 'kia_booking_report',
      sales: 'kia_sales_report',
      accessories: 'kia_accessories_counter_sales_report',
      stock: 'kia_stock_management',
      purchase: 'kia_purchase_report',
    },
    calcProfile: { stockValueUpliftFactor: 1.36 },
  },
  hyundai: {
    brand: 'hyundai',
    label: 'AM Hyundai',
    /*
     * ⚠️ available stays TRUE and readerImplemented goes FALSE — the distinction matters.
     *
     * 4 of the 6 declared tables exist and are large (231,236 / 2,553 / 25,043 / 11,372 rows). What
     * is missing is (a) hyundai_stock_management, which does not exist as a table at all, and (b) a
     * cockpit-shaped reader: lib/kia has sales-performance.ts and stock-report.ts, lib/hyundai has
     * neither, and the dispatcher hard-gates on `src.brand === 'kia'`.
     *
     * Both were flipped to true with no reader added, so the cockpit rendered permanently-blank
     * Hyundai and Platinum cards. Setting `available: false` would have been the easy revert, but it
     * encodes Hyundai identically to MG — which has ZERO tables — and the next person reading it
     * would re-request a DMS export that already lands daily.
     */
    available: true,
    readerImplemented: false,
    tables: tablesFor('hyundai_'),
    calcProfile: { stockValueUpliftFactor: 1.36 },
  },
  platinum: {
    brand: 'platinum',
    label: 'AM Platinum',
    // Same as Hyundai above: the feeds exist, the cockpit-shaped reader does not.
    available: true,
    readerImplemented: false,
    tables: tablesFor('am_platinum_'),
    calcProfile: { stockValueUpliftFactor: 1.36 },
  },
  mg: {
    brand: 'mg',
    label: 'AM MG',
    available: false,
    readerImplemented: false,
    tables: tablesFor('mg_'),
    calcProfile: { stockValueUpliftFactor: 1.36 },
  },
}

export function getSalesStockSource(brand: string): BrandSalesStockSource | null {
  return BRAND_SALES_STOCK_SOURCES[String(brand || '').trim().toLowerCase()] || null
}

// Every brand DECLARED here (regardless of data availability) — for the readiness/wiring surface.
export function declaredSalesStockBrands(): BrandSalesStockSource[] {
  return Object.values(BRAND_SALES_STOCK_SOURCES)
}

// Brands that can actually produce numbers today: a live feed AND a reader. Currently just KIA. The
// cockpit and any brand rollup iterate THIS list, so a new brand appears automatically once it flips.
export function availableSalesStockBrands(): BrandSalesStockSource[] {
  return Object.values(BRAND_SALES_STOCK_SOURCES).filter((s) => s.available && s.readerImplemented)
}
