-- KIA DMS reconciliation: the month is the BOOKING's month (owner, 2026-09-18: "it should only show
-- strictly of the selected month booking"). An August booking that DMS delivered in September belongs
-- to August. event_date stays — it is when DMS moved, and it dates the headline and the age.
--
-- booking_date: our booking's date (metadata.bookingDate, else created_at in IST); for an unmatched
-- DMS record, the DMS booking date. Filled by the next reconciliation run.
--
-- Apply by hand on the SESSION pooler (5432): npx tsx scripts/apply-kia-recon-migration.ts

ALTER TABLE public.kia_dms_recon_items ADD COLUMN IF NOT EXISTS booking_date date;
ALTER TABLE public.kia_dms_recon_items
  ADD COLUMN IF NOT EXISTS booking_month date
  GENERATED ALWAYS AS ((date_trunc('month', booking_date::timestamp))::date) STORED;
CREATE INDEX IF NOT EXISTS kia_dms_recon_items_booking_month_idx ON public.kia_dms_recon_items (booking_month, state);
