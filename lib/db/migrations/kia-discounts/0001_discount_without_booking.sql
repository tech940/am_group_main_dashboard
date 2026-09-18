-- KIA discount requests without a booking here (owner, 2026-09-18).
--
-- A discount was only ever raised against a kia_bookings row. Some customers bought through the DMS and
-- were never booked in this app (e.g. Divinder Kour, DMS B202600920), yet a discount still has to go
-- through GSM/SM -> CEO -> MD -> Accounts. The owner chose NOT to create a booking for them: the request
-- stands on its DMS record instead, identified by the DMS customer id + booking no (the same key the
-- DMS reconciliation uses — booking numbers alone repeat across JK402/JK501).
--
-- Every row still has to point at SOMETHING: a booking here, or a DMS customer.
--
-- Apply by hand on the SESSION pooler (5432): npx tsx scripts/apply-kia-discount-migration.ts

ALTER TABLE public.kia_booking_discounts ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE public.kia_booking_discounts ADD COLUMN IF NOT EXISTS dms_customer_id text;
ALTER TABLE public.kia_booking_discounts ADD COLUMN IF NOT EXISTS dms_booking_no text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kia_booking_discounts_subject_chk') THEN
    ALTER TABLE public.kia_booking_discounts
      ADD CONSTRAINT kia_booking_discounts_subject_chk CHECK (booking_id IS NOT NULL OR dms_customer_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS kia_booking_discounts_dms_customer_idx ON public.kia_booking_discounts (dms_customer_id)
  WHERE dms_customer_id IS NOT NULL;
