-- Call Analysis: local store for the Callyzer call log.
--
-- WHY A TABLE INSTEAD OF CALLING THEIR API PER VIEW:
-- Callyzer's /call-log/history takes ~2.7s per 100-row page and rejects concurrent requests (a
-- parallel burst of 8 returned seven 429s — the limit is on CONCURRENCY, not spacing). Paging the
-- account's ~1.9k-call history therefore costs ~54s serially, which is why an on-demand fetch left
-- the page spinning. Syncing into Postgres makes every view a local indexed read (milliseconds),
-- and as a side effect keeps history beyond Callyzer's 180-day query ceiling.

CREATE TABLE IF NOT EXISTS callyzer_calls (
  id            text PRIMARY KEY,               -- Callyzer's own unique call id
  client_name   text,
  client_number text,
  duration      integer NOT NULL DEFAULT 0,     -- seconds
  call_type     text,                           -- Incoming | Outgoing | Missed | Rejected
  call_date     date,
  call_time     text,                           -- HH:mm:ss in the account's timezone
  note          text,
  recording_url text,
  emp_name      text,
  emp_number    text,
  emp_tags      text[] NOT NULL DEFAULT '{}',
  crm_status    text,
  call_method   text,
  call_mode     text,
  synced_at     timestamptz,                    -- when Callyzer received it from the handset
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Every dashboard query filters by date first, then narrows by agent or client.
CREATE INDEX IF NOT EXISTS callyzer_calls_call_date_idx     ON callyzer_calls (call_date DESC);
CREATE INDEX IF NOT EXISTS callyzer_calls_emp_number_idx    ON callyzer_calls (emp_number);
CREATE INDEX IF NOT EXISTS callyzer_calls_client_number_idx ON callyzer_calls (client_number);
CREATE INDEX IF NOT EXISTS callyzer_calls_call_type_idx     ON callyzer_calls (call_type);
-- Delta syncs resume from MAX(synced_at); keep that lookup off a seq scan.
CREATE INDEX IF NOT EXISTS callyzer_calls_synced_at_idx     ON callyzer_calls (synced_at DESC);

-- Bookkeeping for the sync job so it can resume and be observed.
CREATE TABLE IF NOT EXISTS callyzer_sync_state (
  id              integer PRIMARY KEY DEFAULT 1,
  last_synced_at  timestamptz,
  last_run_at     timestamptz,
  last_run_status text,
  last_run_detail text,
  total_calls     integer NOT NULL DEFAULT 0,
  CONSTRAINT callyzer_sync_state_singleton CHECK (id = 1)
);

INSERT INTO callyzer_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
