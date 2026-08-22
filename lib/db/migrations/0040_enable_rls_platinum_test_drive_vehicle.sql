-- Fix Supabase Security Linter: Enable RLS on public.platinum_test_drive_vehicle
-- Resolves:
-- 1. policy_exists_rls_disabled (table has policies but RLS is disabled)
-- 2. rls_disabled_in_public (table is in public schema with RLS disabled)

ALTER TABLE IF EXISTS public.platinum_test_drive_vehicle ENABLE ROW LEVEL SECURITY;
