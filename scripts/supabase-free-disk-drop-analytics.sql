-- DO NOT RUN until BigQuery backfill + parity validation pass (see docs/bigquery-migration-deploy.md).
-- Supabase analytics tables remain the source of truth until then.
--
-- This file is kept for reference only. DROP statements are commented out.
--
-- If disk relief is needed before BQ cutover, prefer:
--   npm run db:backup-drop-analytics -- --backup-only
-- and keep all tables in Supabase.

-- DROP TABLE IF EXISTS public.adv_wise_lubricants_vas CASCADE;
-- DROP TABLE IF EXISTS public.hyundai_psf_yearly CASCADE;
-- DROP TABLE IF EXISTS public.hyundai_operation_wise_analysis_report CASCADE;
-- VACUUM FULL;

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
