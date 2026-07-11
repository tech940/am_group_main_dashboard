-- KIA Call Center: masked click-to-call. Call agents dial customers WITHOUT ever seeing the number.
-- The customer's phone is NEVER stored here — it's looked up server-side from the booking only at
-- call time and handed to the telephony provider. Additive, non-destructive.
--
-- NOTE: the `call_agent` role enum value is added by scripts/apply-migration-0010.ts (an
-- `ALTER TYPE role ADD VALUE` cannot run inside the same transaction block as the tables below).
-- Safe to run on production after `npm run db:backup`.

-- The phone the system rings to connect an agent (the AGENT's own number, not the customer's).
CREATE TABLE IF NOT EXISTS kia_call_agent_phones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  agent_phone  text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per call attempt. NO customer phone number is stored (booking_id links the customer;
-- the number is derived server-side only and never persisted/exposed).
CREATE TABLE IF NOT EXISTS kia_call_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid REFERENCES kia_bookings (id),
  callback_request_id  uuid REFERENCES kia_callback_requests (id),
  agent_id             uuid NOT NULL REFERENCES users (id),
  provider             text NOT NULL DEFAULT 'simulation',
  provider_call_id     text,
  status               text NOT NULL DEFAULT 'initiated', -- initiated|ringing|connected|completed|failed|no_answer
  duration_sec         integer NOT NULL DEFAULT 0,
  disposition          text,   -- agent outcome: interested|not_interested|callback_later|no_answer|wrong_number|done
  notes                text,
  started_at           timestamptz NOT NULL DEFAULT now(),
  connected_at         timestamptz,
  ended_at             timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kia_call_logs_agent_idx ON kia_call_logs (agent_id, created_at);
CREATE INDEX IF NOT EXISTS kia_call_logs_booking_idx ON kia_call_logs (booking_id);
CREATE INDEX IF NOT EXISTS kia_call_logs_provider_call_idx ON kia_call_logs (provider_call_id);
