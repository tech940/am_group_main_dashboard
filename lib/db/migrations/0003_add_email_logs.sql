-- Email delivery log for KIA transactional emails (approved-proforma, quote, …).
-- Additive, non-destructive. Safe to run on production after `npm run db:backup`.

CREATE TABLE IF NOT EXISTS kia_email_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid,
  customer_email text NOT NULL,
  subject       text NOT NULL,
  email_type    text,
  status        text NOT NULL DEFAULT 'pending',
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kia_email_logs_booking_id_idx ON kia_email_logs (booking_id);
CREATE INDEX IF NOT EXISTS kia_email_logs_status_idx ON kia_email_logs (status);
CREATE INDEX IF NOT EXISTS kia_email_logs_created_at_idx ON kia_email_logs (created_at DESC);
