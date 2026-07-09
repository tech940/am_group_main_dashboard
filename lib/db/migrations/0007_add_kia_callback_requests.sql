-- Customer callback requests raised from the "Request a Callback" button in the KIA proforma email.
-- Additive, non-destructive. Stores NO customer phone/email — only basic details.
-- Safe to run on production after `npm run db:backup`.

CREATE TABLE IF NOT EXISTS kia_callback_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES kia_bookings (id),
  customer_name  text NOT NULL,
  preferred_time text,
  note           text,
  status         text NOT NULL DEFAULT 'pending',
  source         text NOT NULL DEFAULT 'proforma_email',
  contacted_by   uuid REFERENCES users (id),
  contacted_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kia_callback_requests_booking_idx ON kia_callback_requests (booking_id);
CREATE INDEX IF NOT EXISTS kia_callback_requests_status_idx ON kia_callback_requests (status);
