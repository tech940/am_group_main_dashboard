-- 0072 ROLLBACK — removes the AM Tata H Promise tables.
--
-- ⚠️ DESTROYS DATA. Every H Promise vehicle, booking, file record, history row, name list, rate and exchange
--    bonus goes with it. The uploaded files themselves stay in the private `tata-h-promise` storage bucket and
--    must be removed separately. Export first, from a session on port 5432:
--
--   \copy (SELECT * FROM public.tata_h_promise_vehicles)         TO 'tata_h_promise_vehicles.csv'         CSV HEADER
--   \copy (SELECT * FROM public.tata_h_promise_bookings)         TO 'tata_h_promise_bookings.csv'         CSV HEADER
--   \copy (SELECT * FROM public.tata_h_promise_files)            TO 'tata_h_promise_files.csv'            CSV HEADER
--   \copy (SELECT * FROM public.tata_h_promise_events)           TO 'tata_h_promise_events.csv'           CSV HEADER
--   \copy (SELECT * FROM public.tata_h_promise_options)          TO 'tata_h_promise_options.csv'          CSV HEADER
--   \copy (SELECT * FROM public.tata_h_promise_settings)         TO 'tata_h_promise_settings.csv'         CSV HEADER
--   \copy (SELECT * FROM public.tata_h_promise_exchange_bonuses) TO 'tata_h_promise_exchange_bonuses.csv' CSV HEADER
--
-- ⚠️ APPLY BY HAND ON PORT 5432, never the pooler on 6543.

BEGIN;

-- Dependants first: events and files reference vehicles and bookings.
DROP TABLE IF EXISTS public.tata_h_promise_events;
DROP TABLE IF EXISTS public.tata_h_promise_files;
DROP TABLE IF EXISTS public.tata_h_promise_bookings;
DROP TABLE IF EXISTS public.tata_h_promise_vehicles;
DROP TABLE IF EXISTS public.tata_h_promise_options;
DROP TABLE IF EXISTS public.tata_h_promise_settings;
DROP TABLE IF EXISTS public.tata_h_promise_exchange_bonuses;

DROP FUNCTION IF EXISTS public.tata_h_promise_price_lock();
DROP FUNCTION IF EXISTS public.tata_h_promise_events_append_only();

COMMIT;

-- Verification:
-- SELECT relname FROM pg_class WHERE relname LIKE 'tata_h_promise_%';   -- ZERO rows
