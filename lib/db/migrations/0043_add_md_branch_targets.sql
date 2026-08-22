-- MD-set monthly targets per brand + branch: sales units, sales revenue, service RO count,
-- service revenue. Backs the MD-only /targets section.
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- There is currently NO target table and no management input anywhere in this product. Every
-- "target" on every dashboard is invented by code:
--   * lib/business-excellence/executive-targets.ts — hardcoded literals whose own header says
--     "PLACEHOLDER LITERALS — NOT TARGETS ANYONE AT AM GROUP SET", and which are period-blind.
--   * features/kia/business-excellence-page.tsx — LY_GROWTH_TARGET_MULTIPLIER = 1.1 ("LY +10%").
--   * lib/brands/sales-stock.ts — cockpit falls back to last month's actual x 1.1, flagged 'auto'.
-- The one real table, kia_sales_targets, is per-CONSULTANT, KIA-only and units-only. This is the
-- branch-grain, cross-brand, four-metric store those surfaces have been missing.
--
-- ── Grain ─────────────────────────────────────────────────────────────────────────────────────
-- One WIDE row per (brand, dealer_code, year, month). Four fixed metrics saved together by one
-- grid, so a tall metric-key table would add a dimension and an enum to drift for no benefit.
--
-- ⚠️ KEYED ON (brand, dealer_code) — NEVER dealer_code alone. Dealer codes are NOT globally unique
-- across brands: N6828 is both a Hyundai Billawar sub-code AND Platinum Poonch's primary code.
--
-- ⚠️ NULL IS NOT ZERO. A NULL metric means the MD entered nothing, which is what lets the existing
-- LY+10% fallback still apply for that month. A 0 is a deliberate target of zero. Do not add
-- DEFAULT 0 to the metric columns — it would erase that distinction.
--
-- Migrations here are applied BY HAND. Run `npm run db:backup` first where possible, and use the
-- direct/session port — DDL does not run through the pgbouncer transaction pooler.

-- ── 1. the table ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS md_branch_targets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'kia' | 'hyundai' | 'platinum' — the brands with both a DMS feed and a reader.
  brand             text    NOT NULL,
  -- A real branch code (JK402, N5211, 'JAMMU'), or the sentinel '__brand__' for a brand-level row.
  -- Hyundai and Platinum sales CANNOT be split per outlet (their feeds file ~99% of deliveries
  -- under one dealer code), so their sales target is stored once against the sentinel.
  -- '__brand__' cannot collide with a real code: KIA/Platinum use JK…/N…, Hyundai uses synthetic
  -- uppercase words. The __…__ form already means "not a real dealer" here (DEALER_SCOPE_NONE).
  dealer_code       text    NOT NULL,
  -- CALENDAR year and month, matching kia_sales_targets and every reader's {year, month} input.
  -- A fiscal year is a VIEW over 12 of these pairs — see lib/fiscal-year.ts.
  year              integer NOT NULL,
  month             integer NOT NULL,
  sales_units       integer,
  sales_revenue     numeric(14,2),
  service_ro_count  integer,
  service_revenue   numeric(14,2),
  note              text,
  updated_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT md_branch_targets_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT md_branch_targets_year_check  CHECK (year BETWEEN 2000 AND 2100),
  -- Targets are goals, never negative. Cheap to assert here as well as in the route.
  CONSTRAINT md_branch_targets_nonneg_check CHECK (
    COALESCE(sales_units, 0) >= 0 AND COALESCE(sales_revenue, 0) >= 0
    AND COALESCE(service_ro_count, 0) >= 0 AND COALESCE(service_revenue, 0) >= 0
  )
);

-- ── 2. one row per branch-month, which is also the upsert conflict target ─────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS md_branch_targets_unique_idx
  ON md_branch_targets (brand, dealer_code, year, month);

-- The grid reads a whole fiscal year for one brand at a time.
CREATE INDEX IF NOT EXISTS md_branch_targets_brand_period_idx
  ON md_branch_targets (brand, year, month);

-- ── 3. lock it away from the public anon role ─────────────────────────────────────────────────
-- Same posture as migration 0038: the Supabase anon key ships in the browser bundle, so any table
-- it can reach is world-readable. These are the MD's commercial targets.
REVOKE ALL ON TABLE md_branch_targets FROM anon;
REVOKE ALL ON TABLE md_branch_targets FROM PUBLIC;
GRANT ALL ON TABLE md_branch_targets TO service_role;

ANALYZE md_branch_targets;

-- Verify — expect 1, 1, 1 and 0.
-- SELECT
--   (to_regclass('public.md_branch_targets') IS NOT NULL)::int                      AS table_created,
--   (SELECT COUNT(*) FROM pg_indexes
--     WHERE tablename='md_branch_targets' AND indexname='md_branch_targets_unique_idx')::int AS unique_idx,
--   (SELECT COUNT(*) FROM pg_indexes
--     WHERE tablename='md_branch_targets' AND indexname='md_branch_targets_brand_period_idx')::int AS period_idx,
--   (SELECT COUNT(*) FROM information_schema.role_table_grants
--     WHERE table_name='md_branch_targets' AND grantee='anon')::int                 AS anon_grants;
