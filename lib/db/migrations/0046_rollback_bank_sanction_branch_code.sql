-- Complete rollback for 0046_add_bank_sanction_branch_code.sql.
--
-- 0046 only ADDS a column and its index, then seeds values into that new column. Dropping the column
-- takes the seeded values with it and returns the table to its 0045 shape. No other table, column or
-- row is touched, so nothing else needs undoing.
--
-- ⚠️ After this runs, /bank-sanctions has no brand scoping: every user who can open the section sees
-- every facility again. Roll the application code back at the same time.

DROP INDEX IF EXISTS bank_sanction_limits_branch_code_idx;
ALTER TABLE bank_sanction_limits DROP COLUMN IF EXISTS branch_code;

-- Verify — expect 0.
-- SELECT COUNT(*)::int AS branch_code_remaining FROM information_schema.columns
--  WHERE table_name = 'bank_sanction_limits' AND column_name = 'branch_code';
