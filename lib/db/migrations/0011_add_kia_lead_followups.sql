-- 0011: KIA lead follow-up pipeline. A staff-scheduled "next touch" on a booking/lead so no lead
-- goes cold. NO customer phone is stored here — booking_id links the customer and the number stays
-- server-only (masked everywhere). Idempotent (CREATE ... IF NOT EXISTS). Apply via
-- `npx tsx scripts/apply-migration-0011.ts` (no enum changes, so it just runs this file).

CREATE TABLE IF NOT EXISTS kia_lead_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES kia_bookings(id),
  assigned_to uuid REFERENCES users(id),        -- resolved from the booking consultant when possible
  assigned_name text,                            -- consultant name snapshot (display when no user match)
  assigned_email text,                           -- for the reminder email digest
  dealer_code text,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',        -- 'pending' | 'done' | 'cancelled'
  reason text NOT NULL DEFAULT 'general',        -- 'callback' | 'payment_pending' | 'document_pending' | 'delivery' | 'general'
  priority text NOT NULL DEFAULT 'normal',       -- 'low' | 'normal' | 'high'
  notes text,
  source text NOT NULL DEFAULT 'manual',         -- 'manual' | 'call' | 'callback_request'
  source_call_id uuid REFERENCES kia_call_logs(id),
  outcome text,                                  -- disposition-style result recorded on completion
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz,
  reminder_sent_at timestamptz,                  -- dedupes the "due" in-app reminder
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kia_lead_followups_status_due_idx ON kia_lead_followups (status, due_at);
CREATE INDEX IF NOT EXISTS kia_lead_followups_assigned_idx ON kia_lead_followups (assigned_to, status);
CREATE INDEX IF NOT EXISTS kia_lead_followups_booking_idx ON kia_lead_followups (booking_id);
CREATE INDEX IF NOT EXISTS kia_lead_followups_dealer_idx ON kia_lead_followups (dealer_code);
-- Fast lookup for the reminder scheduler: pending, due, not yet reminded.
CREATE INDEX IF NOT EXISTS kia_lead_followups_reminder_idx ON kia_lead_followups (due_at)
  WHERE status = 'pending' AND reminder_sent_at IS NULL;
