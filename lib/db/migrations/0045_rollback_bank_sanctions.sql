-- Complete rollback for 0045_add_bank_sanctions.sql.
--
-- 0045 creates two NEW tables and their indexes — no existing table, column or row is touched, so
-- these statements return the schema to exactly its prior shape.
--
-- ⚠️ DESTROYS DATA: every bank sanction record AND its full history. Export first if in use:
--     COPY (SELECT * FROM bank_sanction_limits)  TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM bank_sanction_history) TO STDOUT WITH CSV HEADER;
--
-- Run against the direct/session port.

DROP TABLE IF EXISTS bank_sanction_history;
DROP TABLE IF EXISTS bank_sanction_limits;

-- Verify — both 0.
-- SELECT (to_regclass('public.bank_sanction_limits') IS NOT NULL)::int  AS limits_remaining,
--        (to_regclass('public.bank_sanction_history') IS NOT NULL)::int AS history_remaining;
