-- Complete rollback for 0051_add_demo_gate_passes.sql.
--
-- 0051 creates three NEW tables and their indexes — no existing table, column or row is touched,
-- so these statements return the schema to exactly its prior shape.
--
-- ⚠️ DESTROYS DATA: every demo car gate pass, its full audit trail, and every stored driving
-- licence. Export first if in use:
--     COPY (SELECT * FROM demo_gate_passes)       TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM demo_gate_pass_events)  TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM demo_gate_pass_drivers) TO STDOUT WITH CSV HEADER;
--
-- ⚠️ This does NOT delete the gate photos and signatures themselves. Those live in the private
-- Supabase storage bucket 'demo-gate-pass' and are referenced by the *_path / *_photo_paths
-- columns above. Export the rows first, or the objects are orphaned with no index back to them.
--
-- Nothing outside this module reads these tables, and the separate application that owns
-- kia_trips / kia_vehicle / kia_employees is entirely unaffected — it was never touched by 0051.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

DROP TABLE IF EXISTS public.demo_gate_pass_events;
DROP TABLE IF EXISTS public.demo_gate_pass_drivers;
DROP TABLE IF EXISTS public.demo_gate_passes;

-- Verify — all three 0.
-- SELECT
--   (to_regclass('public.demo_gate_passes')       IS NOT NULL)::int AS passes_remaining,
--   (to_regclass('public.demo_gate_pass_events')  IS NOT NULL)::int AS events_remaining,
--   (to_regclass('public.demo_gate_pass_drivers') IS NOT NULL)::int AS drivers_remaining;
