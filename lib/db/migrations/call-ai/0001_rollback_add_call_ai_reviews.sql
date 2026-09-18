-- Rollback for call-ai/0001_add_call_ai_reviews.sql. Drops every AI transcript and verdict — they can be rebuilt by
-- re-running the pipeline (at Groq cost), the MD's corrections in call_ai_feedback cannot.
BEGIN;
DROP TABLE IF EXISTS public.call_ai_feedback;
DROP TABLE IF EXISTS public.call_ai_digests;
DROP TABLE IF EXISTS public.call_ai_state;
DROP TABLE IF EXISTS public.call_ai_reviews;
COMMIT;
