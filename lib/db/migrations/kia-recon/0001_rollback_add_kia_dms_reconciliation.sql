-- Rollback of kia-recon/0001_add_kia_dms_reconciliation.sql. The tables are derived; nothing is lost
-- that a re-run cannot rebuild, except the first-seen / resolved history.
DROP TABLE IF EXISTS public.kia_dms_recon_items;
DROP TABLE IF EXISTS public.kia_dms_recon_state;
