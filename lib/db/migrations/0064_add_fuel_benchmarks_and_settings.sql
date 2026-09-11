-- 0064 — Expected mileage, tank capacity and every threshold, as configuration rather than code.
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432. DDL must not run on the pgbouncer pooler (6543).
-- ⚠️ Requires 0063.
--
-- ── Why this exists ─────────────────────────────────────────────────────────────────────────
-- The screen this replaces called cars "High Burn" against thresholds of 10 and 6 km/L that were typed
-- into a source file — nobody set them, nobody could change them, and no car was measured against its own
-- expectation. The owner's decision (2026-09-11): MD, GM and admin set expected mileage and tank capacity
-- through the `fuel_management.edit` permission. So none of it lives in code:
-- lib/fuel-management/engine.ts contains no expected mileage at all, and the verifier asserts that.
--
-- Three tables, because they answer three different questions:
--   fuel_benchmarks            — what should THIS vehicle (or model) do?
--   fuel_intelligence_settings — how far off is far enough to say something?
--   fuel_config_events         — who changed either, and from what?

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. What a vehicle is expected to do.
--
-- Resolved most-specific-first by lib/fuel-management/engine.ts resolveBenchmark(): this VIN, then model +
-- variant, then model. No match returns NULL and the vehicle reads "No benchmark" — never a guessed figure.
-- ⚠️ energy_type AND unit are both part of every lookup. A diesel benchmark must never judge a petrol car,
-- and a km/L figure must never be compared against km/kWh.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_benchmarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL CHECK (scope IN ('vehicle', 'model_variant', 'model')),
  -- Set for scope 'vehicle'. The 17-character VIN — the only durable vehicle identity in this system.
  vin         text,
  -- Set for 'model' and 'model_variant'. Matched case-insensitively after trimming.
  model       text,
  variant     text,
  energy_type text NOT NULL CHECK (energy_type IN ('petrol', 'diesel', 'cng', 'ev', 'hybrid')),
  unit        text NOT NULL CHECK (unit IN ('L', 'kg', 'kWh')),
  -- km per unit. NULL is allowed and meaningful: a row may configure ONLY a tank capacity, which still
  -- powers the "more than the tank holds" check without claiming to know the expected mileage.
  expected_efficiency numeric(6, 2) CHECK (expected_efficiency IS NULL OR expected_efficiency > 0),
  tank_capacity       numeric(6, 2) CHECK (tank_capacity IS NULL OR tank_capacity > 0),
  notes        text,
  set_by       uuid REFERENCES public.users (id),
  set_by_name  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- A row that configures neither figure is an empty row pretending to be a benchmark.
  CONSTRAINT fuel_benchmarks_has_a_figure
    CHECK (expected_efficiency IS NOT NULL OR tank_capacity IS NOT NULL),
  -- Each scope needs exactly the keys it is looked up by, and no others.
  CONSTRAINT fuel_benchmarks_scope_keys CHECK (
    (scope = 'vehicle'       AND vin IS NOT NULL AND model IS NULL     AND variant IS NULL) OR
    (scope = 'model_variant' AND vin IS NULL     AND model IS NOT NULL AND variant IS NOT NULL) OR
    (scope = 'model'         AND vin IS NULL     AND model IS NOT NULL AND variant IS NULL)
  )
);

-- ⚠️ One benchmark per thing per energy, or resolveBenchmark() silently picks whichever row came back
-- first and the same car reads differently on two screens. Case-folded, because "Creta" and "CRETA" are
-- one model.
CREATE UNIQUE INDEX IF NOT EXISTS fuel_benchmarks_vehicle_key
  ON public.fuel_benchmarks (upper(btrim(vin)), energy_type, unit) WHERE scope = 'vehicle';
CREATE UNIQUE INDEX IF NOT EXISTS fuel_benchmarks_model_variant_key
  ON public.fuel_benchmarks (upper(btrim(model)), upper(btrim(variant)), energy_type, unit) WHERE scope = 'model_variant';
CREATE UNIQUE INDEX IF NOT EXISTS fuel_benchmarks_model_key
  ON public.fuel_benchmarks (upper(btrim(model)), energy_type, unit) WHERE scope = 'model';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. The thresholds every rule uses.
--
-- Key/value rather than a column per setting, so adding a rule later is a row, not a migration. Values are
-- numeric: distances in km, percentages as whole numbers, counts as counts. A key absent here falls back
-- to DEFAULT_FUEL_SETTINGS in the engine, so the module works before anyone opens the settings screen —
-- and the engine stays the single definition of what each threshold MEANS.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_intelligence_settings (
  key             text PRIMARY KEY,
  value           numeric(12, 4) NOT NULL,
  updated_by      uuid REFERENCES public.users (id),
  updated_by_name text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ Intentionally NOT seeded. An empty table means "nobody has set these yet", and the engine's defaults
-- apply. Seeding would make the engine's defaults and this table two places one number lives, and the
-- first time they drifted the screen and the code would disagree about what "20% below" means.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Who changed an expectation, and what it was before.
--
-- Expected mileage decides which vehicles are called underperforming. Changing one silently re-labels a
-- fleet, so every change is recorded. APPEND-ONLY, enforced rather than intended — same as 0060.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_config_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target       text NOT NULL CHECK (target IN ('benchmark', 'setting')),
  action       text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  -- What was changed: a benchmark id, or a settings key.
  target_key   text NOT NULL,
  -- A readable description of the thing, so the row still reads after the benchmark is deleted.
  target_label text,
  previous_value jsonb,
  new_value      jsonb,
  actor_id     uuid REFERENCES public.users (id),
  actor_name   text NOT NULL,
  actor_role   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fuel_config_events_target_idx
  ON public.fuel_config_events (target, target_key, created_at DESC);

-- An audit row that can be edited is not an audit row. search_path pinned per the Supabase security linter.
CREATE OR REPLACE FUNCTION public.fuel_config_events_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'fuel_config_events is append-only (% refused)', TG_OP;
END;
$$;

CREATE OR REPLACE TRIGGER fuel_config_events_append_only
  BEFORE UPDATE OR DELETE ON public.fuel_config_events
  FOR EACH ROW EXECUTE FUNCTION public.fuel_config_events_append_only();

CREATE OR REPLACE TRIGGER fuel_config_events_no_truncate
  BEFORE TRUNCATE ON public.fuel_config_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.fuel_config_events_append_only();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RLS lockdown, as 0060 and 0062. The app connects as `postgres` (owner, BYPASSRLS) and is unaffected.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_benchmarks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_intelligence_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_config_events          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fuel_benchmarks            FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.fuel_intelligence_settings FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.fuel_config_events         FROM anon, authenticated, PUBLIC;

GRANT ALL ON public.fuel_benchmarks            TO service_role;
GRANT ALL ON public.fuel_intelligence_settings TO service_role;
GRANT ALL ON public.fuel_config_events         TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('fuel_benchmarks','fuel_intelligence_settings','fuel_config_events')
--    AND relkind = 'r';                                                                     -- 3 rows, all true
-- SELECT grantee, table_name FROM information_schema.role_table_grants
--  WHERE table_name IN ('fuel_benchmarks','fuel_intelligence_settings','fuel_config_events')
--    AND grantee IN ('anon','authenticated','PUBLIC');                                      -- ZERO rows
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE 'fuel_config_events_%';                   -- 2 rows
-- SELECT count(*) FROM public.fuel_intelligence_settings;                                   -- 0 (engine defaults apply)
