-- Complete rollback for 0052_add_gate_pass_licence_doc.sql.
--
-- ⚠️ DESTROYS DATA: every stored licence photo POINTER and every licence name. Export first:
--     COPY (SELECT user_id, licence_name, licence_doc_path FROM demo_gate_pass_drivers
--           WHERE licence_doc_path IS NOT NULL OR licence_name IS NOT NULL)
--       TO STDOUT WITH CSV HEADER;
--
-- ⚠️ This does NOT delete the licence images themselves. They live in the private Supabase bucket
-- 'demo-gate-pass' under drivers/<user_id>/. Dropping the column orphans them with no index back,
-- so export the paths above first and remove the objects deliberately if that is what you want.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

ALTER TABLE public.demo_gate_pass_drivers
  DROP COLUMN IF EXISTS licence_doc_path,
  DROP COLUMN IF EXISTS licence_name;

-- Verify — expect 0,0.
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--     WHERE table_name='demo_gate_pass_drivers' AND column_name='licence_doc_path') AS doc_path_remaining,
--   (SELECT COUNT(*) FROM information_schema.columns
--     WHERE table_name='demo_gate_pass_drivers' AND column_name='licence_name') AS licence_name_remaining;
