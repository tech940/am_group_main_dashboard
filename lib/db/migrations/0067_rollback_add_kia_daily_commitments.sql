-- 0067 ROLLBACK — KIA daily sales commitments
--
-- ⚠️ DESTROYS DATA. Every daily commitment anyone has typed. These are DECIDED numbers: no feed
-- contains them, nothing re-derives them, and the workbook they replaced will be out of date by the
-- time anyone notices. Export first:
--
--   \copy (SELECT dealer_code, consultant_name, commitment_date, enquiries, test_drives, bookings,
--                 retails, note, created_at, updated_at
--            FROM public.kia_sales_daily_commitments
--           ORDER BY dealer_code, commitment_date, consultant_name)
--     TO 'kia_daily_commitments_0067_backup.csv' WITH CSV HEADER;
--
-- ⚠️ Rolling this back also silently changes the Group Cockpit's KIA sales card: lib/brands/sales-stock.ts
-- reads its monthly target as SUM of this table, and with the table gone it falls back to "last
-- month's actual + 10%", labelled `auto`. That is a safe fallback, not an error — but the card's
-- numbers will move, and somebody should be told rather than left to notice.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

BEGIN;

DROP TABLE IF EXISTS public.kia_sales_daily_commitments;

COMMIT;

-- Verification (run separately):
-- SELECT to_regclass('public.kia_sales_daily_commitments');   -- must be NULL
