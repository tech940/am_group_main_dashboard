-- 0052 — a driving licence can carry a photo, and be recorded from the request form.
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- 0051 shipped demo_gate_pass_drivers with a licence NUMBER and expiry but nowhere to put a picture
-- of the licence itself. The request form then refused a driver with no licence on file and offered
-- no way to add one — a dead end, and the kind that gets worked around by typing a colleague's name
-- into the driver field instead. That defeats the whole point of recording who drove.
--
-- ── What this adds ────────────────────────────────────────────────────────────────────────────
--   licence_doc_path  — object path in the PRIVATE 'demo-gate-pass' bucket. Never a public URL:
--                       this is a photograph of a government ID. Read back through a short-lived
--                       signed URL only.
--   licence_name      — the name as printed on the licence, which is not always the name we hold in
--                       `users` (initials, married names, transliteration). The guard checks the
--                       physical card against this, so it must be what the card actually says.
--
-- Both nullable: a licence number alone is still a valid record, and forcing a photo would put the
-- dead end back one step.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

ALTER TABLE public.demo_gate_pass_drivers
  ADD COLUMN IF NOT EXISTS licence_doc_path text,
  ADD COLUMN IF NOT EXISTS licence_name     text;

-- Verify — expect t,t.
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--     WHERE table_name='demo_gate_pass_drivers' AND column_name='licence_doc_path') = 1 AS has_doc_path,
--   (SELECT COUNT(*) FROM information_schema.columns
--     WHERE table_name='demo_gate_pass_drivers' AND column_name='licence_name') = 1 AS has_licence_name;
