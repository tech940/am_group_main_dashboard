-- 0064 ROLLBACK — remove the benchmark, settings and config-audit tables.
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432.
--
-- ⚠️⚠️ DESTROYS DATA ⚠️⚠️
-- Every expected mileage and tank capacity MD, GM or admin has set is destroyed, along with the record of
-- who set them. None of it exists anywhere else — the engine deliberately contains no expected mileage, so
-- after this every vehicle reads "No benchmark" until someone re-enters all of it by hand.
-- fuel_config_events is append-only by trigger; DROP TABLE removes the trigger with it, which is why the
-- export below matters more here than anywhere else.
--
-- EXPORT FIRST, and check each file is non-empty before continuing:
--
--   \copy (SELECT * FROM public.fuel_benchmarks ORDER BY created_at)
--     TO 'fuel_benchmarks_0064_backup.csv' WITH CSV HEADER;
--   \copy (SELECT * FROM public.fuel_intelligence_settings ORDER BY key)
--     TO 'fuel_intelligence_settings_0064_backup.csv' WITH CSV HEADER;
--   \copy (SELECT * FROM public.fuel_config_events ORDER BY created_at)
--     TO 'fuel_config_events_0064_backup.csv' WITH CSV HEADER;

BEGIN;

DROP TRIGGER IF EXISTS fuel_config_events_append_only ON public.fuel_config_events;
DROP TRIGGER IF EXISTS fuel_config_events_no_truncate ON public.fuel_config_events;

DROP TABLE IF EXISTS public.fuel_config_events;
DROP TABLE IF EXISTS public.fuel_intelligence_settings;
DROP TABLE IF EXISTS public.fuel_benchmarks;

DROP FUNCTION IF EXISTS public.fuel_config_events_append_only();

COMMIT;

-- Verification (run separately):
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN ('fuel_benchmarks','fuel_intelligence_settings','fuel_config_events');  -- 0
