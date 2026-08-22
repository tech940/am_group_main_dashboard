-- Complete rollback for 0043_add_md_branch_targets.sql.
--
-- 0043 is entirely ADDITIVE: it creates one NEW table and two indexes on it, and touches no existing
-- table, column or row. So the only failure modes are "the table exists" or "it does not", and the
-- statements below return the schema to exactly its prior shape.
--
-- ⚠️ Unlike a schema-only rollback, this one DESTROYS DATA — any targets the MD has already entered
-- are gone. Export them first if the table has been in use:
--     COPY (SELECT * FROM md_branch_targets) TO STDOUT WITH CSV HEADER;
--
-- Run against the direct/session port — DDL does not run through the pgbouncer transaction pooler.

DROP INDEX IF EXISTS md_branch_targets_brand_period_idx;
DROP INDEX IF EXISTS md_branch_targets_unique_idx;

DROP TABLE IF EXISTS md_branch_targets;

-- Verify the rollback landed — expect 0.
-- SELECT (to_regclass('public.md_branch_targets') IS NOT NULL)::int AS table_remaining;
