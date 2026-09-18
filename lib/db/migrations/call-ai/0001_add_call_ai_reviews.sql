-- ============================================================================================================
-- call-ai/0001 · Call Analysis · AI Call Review (owner request, 2026-09-18)
--
-- Lives in its own folder on purpose: it was written as 0077, then 0078, and both times another agent's migration
-- took the number and overwrote its apply script. Applied on 2026-09-18 (tables unchanged since).
--
-- The MD listened to CRE call recordings one at a time. Each recording is now transcribed (ElevenLabs Scribe; Groq
-- Whisper in testing) and read by an LLM (Claude Opus 5; Groq gpt-oss in testing) that returns a structured verdict: what the customer wanted, how the call
-- ended, what was promised, what must happen next. Phase 1 scope is AM Hyundai only (lib/call-ai/scope.ts).
--
-- The recordings live in the SEPARATE CRE Supabase project, which this app may only READ. Everything the AI
-- produces is therefore stored here, keyed by that project's call_recordings.id. The customer's phone number is
-- NOT stored: `phone_key` is an HMAC of its last ten digits, enough to group repeat callers and nothing more.
--
-- Tables
--   call_ai_reviews   one row per in-scope recording: queue state + transcript + verdict
--   call_ai_state     single row: switches, discovery cursors, rate-limit pause, daily audio counter
--   call_ai_feedback  append-only MD corrections ("this verdict is wrong") — the accuracy measure
--   call_ai_digests   one row per 9 AM email, so a day can never be mailed twice
--
-- ⚠️ Apply with scripts/apply-call-ai-migration.ts (session pooler, port 5432). Never on the 6543 pooler.
-- Rollback: call-ai/0001_rollback_add_call_ai_reviews.sql
-- ============================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.call_ai_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cre_recording_id      uuid NOT NULL,
  cre_call_id           text,
  cre_id                uuid,
  cre_name              text,                                   -- staff name snapshot (not customer data)
  branch_id             uuid,                                   -- resolved: row branch, else the CRE's profile branch
  team_label            text,                                   -- "Hyundai Jammu" / "Special Branch (Hyundai service)"
  scope                 text NOT NULL,                          -- 'hyundai' in phase 1
  call_type             text,
  recorded_at           timestamptz,
  uploaded_at           timestamptz,
  duration_seconds      integer,
  format                text,
  size_bytes            bigint,
  phone_key             text,

  -- queue
  priority              smallint NOT NULL DEFAULT 0,            -- 0 live, 1 backfill
  status                text NOT NULL DEFAULT 'queued',
  skip_reason           text,
  attempts              smallint NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  locked_until          timestamptz,
  lock_token            uuid,
  last_error            text,

  -- speech to text
  stt_model             text,
  stt_language          text,
  segments              jsonb,                                  -- [{s,e,t,f}] start, end, text, low-confidence flag
  stt_quality           jsonb,
  speech_seconds        numeric(8,1),
  billed_audio_seconds  numeric(8,1),
  transcribed_at        timestamptz,

  -- verdict
  llm_model             text,
  prompt_version        text,
  analysis              jsonb,
  analysed_at           timestamptz,
  conversation          text,
  intent                text,
  mood_end              text,
  verdict               text,
  satisfaction          smallint,
  lead_temperature      text,
  is_complaint          boolean,
  needs_attention       boolean NOT NULL DEFAULT false,
  follow_up_due         date,
  headline_en           text,
  summary_en            text,
  customer_wanted       text,

  -- cost
  tokens_in             integer NOT NULL DEFAULT 0,
  tokens_out            integer NOT NULL DEFAULT 0,
  cost_usd              numeric(10,5) NOT NULL DEFAULT 0,

  -- MD correction (latest; the full history is call_ai_feedback)
  override_verdict      text,
  override_by           uuid REFERENCES public.users (id),
  override_by_name      text,
  override_at           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- English-only search: Postgres' default parser splits Devanagari words at vowel signs, so the transcript
  -- is deliberately not indexed. The English fields are what the MD searches ("refund", "delivery late").
  search_en             tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(headline_en, '') || ' ' || coalesce(summary_en, '') || ' ' || coalesce(customer_wanted, ''))
  ) STORED,

  CONSTRAINT call_ai_reviews_recording_key UNIQUE (cre_recording_id),
  CONSTRAINT call_ai_reviews_status        CHECK (status IN ('queued', 'processing', 'done', 'skipped', 'failed')),
  CONSTRAINT call_ai_reviews_priority      CHECK (priority IN (0, 1)),
  CONSTRAINT call_ai_reviews_satisfaction  CHECK (satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5),
  CONSTRAINT call_ai_reviews_lock_pair     CHECK ((status = 'processing') = (lock_token IS NOT NULL)),
  CONSTRAINT call_ai_reviews_text_sizes    CHECK (
    length(coalesce(headline_en, '')) <= 200 AND length(coalesce(summary_en, '')) <= 1200
    AND length(coalesce(customer_wanted, '')) <= 600 AND length(coalesce(last_error, '')) <= 1000
  )
);

-- The claim query: queued work in priority order, and leases that ran out.
CREATE INDEX IF NOT EXISTS call_ai_reviews_queue_idx
  ON public.call_ai_reviews (priority, recorded_at DESC) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS call_ai_reviews_lease_idx
  ON public.call_ai_reviews (locked_until) WHERE status = 'processing';
-- The dashboard.
CREATE INDEX IF NOT EXISTS call_ai_reviews_recorded_idx
  ON public.call_ai_reviews (scope, recorded_at DESC);
CREATE INDEX IF NOT EXISTS call_ai_reviews_attention_idx
  ON public.call_ai_reviews (recorded_at DESC) WHERE needs_attention;
CREATE INDEX IF NOT EXISTS call_ai_reviews_follow_up_idx
  ON public.call_ai_reviews (follow_up_due) WHERE follow_up_due IS NOT NULL;
CREATE INDEX IF NOT EXISTS call_ai_reviews_cre_idx
  ON public.call_ai_reviews (cre_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS call_ai_reviews_phone_key_idx
  ON public.call_ai_reviews (phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS call_ai_reviews_search_idx
  ON public.call_ai_reviews USING gin (search_en);

CREATE TABLE IF NOT EXISTS public.call_ai_state (
  id                    smallint PRIMARY KEY DEFAULT 1,
  enabled               boolean NOT NULL DEFAULT true,
  live_since            timestamptz,                            -- first discovery run; sweeps never reach before it
  discover_cursor_at    text,                                   -- CRE updated_at, kept as the exact string it returned
  discover_cursor_id    uuid,
  delete_cursor_at      text,
  swept_on              date,
  rate_limited_until    timestamptz,
  audio_day             date,
  audio_seconds_day     numeric(10,1) NOT NULL DEFAULT 0,
  last_run_at           timestamptz,
  last_run              jsonb,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_ai_state_singleton CHECK (id = 1)
);
INSERT INTO public.call_ai_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.call_ai_feedback (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id             uuid NOT NULL REFERENCES public.call_ai_reviews (id) ON DELETE CASCADE,
  user_id               uuid REFERENCES public.users (id),
  user_name             text,
  verdict_ok            boolean NOT NULL,
  corrected_verdict     text,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_ai_feedback_note_size CHECK (length(coalesce(note, '')) <= 1000)
);
CREATE INDEX IF NOT EXISTS call_ai_feedback_review_idx ON public.call_ai_feedback (review_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.call_ai_digests (
  digest_date           date PRIMARY KEY,
  status                text NOT NULL,
  recipients            text,
  summary               jsonb,
  sent_at               timestamptz,
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_ai_digests_status CHECK (status IN ('sending', 'sent', 'failed', 'skipped'))
);

ALTER TABLE public.call_ai_reviews  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_ai_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_ai_digests  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_ai_reviews, public.call_ai_state, public.call_ai_feedback, public.call_ai_digests
  FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.call_ai_reviews, public.call_ai_state, public.call_ai_feedback, public.call_ai_digests
  TO service_role;

COMMIT;

-- Verification (scripts/apply-call-ai-migration.ts runs these):
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'call_ai_%' AND relkind = 'r';     -- all true
-- SELECT grantee FROM information_schema.role_table_grants
--  WHERE table_name LIKE 'call_ai_%' AND grantee IN ('anon','authenticated','PUBLIC');                -- ZERO rows
