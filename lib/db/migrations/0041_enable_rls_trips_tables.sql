-- Fix Supabase Security Linter: Enable RLS on trips tables
-- Resolves:
-- 1. policy_exists_rls_disabled on am_hyundai_trips, mg_trips, trips
-- 2. rls_disabled_in_public on am_hyundai_trips, mg_trips, trips

ALTER TABLE IF EXISTS public.am_hyundai_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.mg_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trips ENABLE ROW LEVEL SECURITY;
