-- KIA DMS reconciliation: bookings whose DMS state has moved on without the Kia Booking workflow.
--
-- A DERIVED table, rebuilt by lib/kia/dms-reconciliation/run.ts from kia_bookings and the three DMS
-- feeds (kia_booking_report, kia_sales_report, kia_receipt_report). The UI reads this, never the
-- feeds: folding 1,500 DMS bookings against every booking takes seconds, a page load must not.
--
-- Rows are PERSISTENT per (subject, exception type) rather than wiped each run, so an exception has a
-- first_seen_at (its age), carries over month to month while open, and records resolved_at when the
-- booking is brought up to date — the history of what was fixed and when.
--
-- No customer phone, PAN or Aadhaar is stored here. PAN is used for matching in memory only.
--
-- Apply by hand on the SESSION pooler (5432): npx tsx scripts/apply-kia-recon-migration.ts

CREATE TABLE IF NOT EXISTS public.kia_dms_recon_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key          text NOT NULL UNIQUE,
  kind              text NOT NULL CHECK (kind IN ('exception', 'review', 'unmatched_dms')),
  exception_type    text NOT NULL CHECK (exception_type IN ('dms_delivered', 'dms_invoiced', 'dms_paid', 'dms_cancelled', 'internal_ahead', 'unmatched_dms')),
  severity          text NOT NULL CHECK (severity IN ('critical', 'high', 'medium')),
  state             text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),

  booking_id        uuid,
  booking_number    text,
  our_status        text,
  our_stage         text,

  dms_booking_no    text,
  dms_customer_id   text,
  dms_dealer        text,
  dms_status        text,
  vin               text,
  invoice_no        text,
  invoice_date      date,
  delivery_date     date,
  dms_received      numeric(14, 2),
  dms_receipt_count integer,
  last_receipt_date date,
  paid_crossed_on   date,

  match_tier        smallint,
  match_label       text,
  match_note        text,
  candidates        jsonb NOT NULL DEFAULT '[]'::jsonb,

  event_date        date NOT NULL,
  event_month       date GENERATED ALWAYS AS ((date_trunc('month', event_date::timestamp))::date) STORED,
  headline          text NOT NULL,
  customer_name     text,
  dealer_code       text,
  model             text,
  variant           text,

  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  CHECK ((state = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK (kind = 'unmatched_dms' OR booking_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS kia_dms_recon_items_month_idx ON public.kia_dms_recon_items (event_month, state);
CREATE INDEX IF NOT EXISTS kia_dms_recon_items_open_idx ON public.kia_dms_recon_items (event_month) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS kia_dms_recon_items_booking_idx ON public.kia_dms_recon_items (booking_id);
CREATE INDEX IF NOT EXISTS kia_dms_recon_items_dms_idx ON public.kia_dms_recon_items (dms_booking_no, dms_customer_id);

CREATE TABLE IF NOT EXISTS public.kia_dms_recon_state (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  watermark     text,
  last_run_at   timestamptz,
  last_run_ms   integer,
  running_since timestamptz,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error    text
);
INSERT INTO public.kia_dms_recon_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- No DDL on the DMS feed tables: they are externally ingested and kia_receipt_report is never to be
-- touched. They are scanned once per background run (~6k rows today); the page reads only this table.

ALTER TABLE public.kia_dms_recon_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kia_dms_recon_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kia_dms_recon_items FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.kia_dms_recon_state FROM anon, authenticated, PUBLIC;
