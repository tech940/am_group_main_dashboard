-- Supabase security-linter remediation: close the anonymous write/execute surface.
--
-- PLAIN STATEMENTS ONLY - no DO blocks, no dollar quoting.
-- An earlier version used DO $$ ... $$ loops to resolve function signatures from the catalog.
-- That is valid SQL, but a runner that splits a file on ';' shreds a DO block into invalid
-- fragments and the whole migration aborts and rolls back, applying nothing. Every signature
-- below was read from pg_proc on the live database, so nothing can drift the way the first
-- hand-written attempt did (hyundai_normalize_active_dealer_code takes a text argument, not none).
--
-- Every statement is idempotent: REVOKE of an already-revoked privilege, ALTER FUNCTION SET
-- search_path, and DROP POLICY IF EXISTS are all safe to repeat. Re-run this file freely.
--
-- Verified on the live project using the PUBLIC anon key (already shipped to browsers):
--   * anon holds INSERT/UPDATE/DELETE on 174 tables, incl. admin_users, admin_audit_logs,
--     am_finance_audit_logs, approvals_history.
--   * anon reads with NO login: trips (emp_name, EMAIL, LICENSE_NO), consumption_rows 18,632 rows,
--     am_platinum_ro_billing_daily_summary_v1 31,488 rows (advisor, labour amounts).
--   * invoke_app_maintenance(text) is SECURITY DEFINER, reads a secret from vault, and makes a
--     pg_net HTTP call to a CALLER-SUPPLIED path - and anon can execute it.
--
-- Why this is safe for this app: the dashboard never uses PostgREST for its own data. lib/db and
-- lib/analytics/db connect straight to Postgres and bypass RLS and these grants entirely; the
-- browser Supabase client does AUTH and STORAGE only. service_role and the direct Postgres role
-- are untouched by everything here.
--
-- STAGE 2 IS THE ONE RISK: DMS ingestion is EXTERNAL to this repo. If an uploader writes with the
-- anon key instead of service_role, Stage 2 breaks it silently. Verify first, or run Stage 1 alone
-- - Stage 1 is the highest severity and carries no such risk.

-- ============================================================================================
-- STAGE 1 - SECURITY DEFINER functions. Highest severity, zero risk to the app.
-- ============================================================================================
-- PUBLIC as well as anon: Postgres grants EXECUTE to PUBLIC by default and REVOKE FROM anon does
-- NOT remove it. A first pass left 3 of these 9 still anonymously callable for exactly that
-- reason. service_role and postgres are re-granted so server-side and pg_cron callers keep working.

REVOKE EXECUTE ON FUNCTION auto_enable_rls_on_new_tables() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION auto_enable_rls_on_new_tables() TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION claim_automation_job(text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION claim_automation_job(text,text,integer,text) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION enqueue_automation_job(text,text,timestamp with time zone,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION enqueue_automation_job(text,text,timestamp with time zone,text,text) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION finish_automation_job(uuid,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finish_automation_job(uuid,text,text,jsonb,jsonb) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION heartbeat_automation_job(uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION heartbeat_automation_job(uuid,text,integer,text) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION invoke_app_maintenance(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION invoke_app_maintenance(text) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION invoke_automation_enqueue(text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION invoke_automation_enqueue(text,text) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION record_recovered_automation_job(text,text,text,jsonb,jsonb,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION record_recovered_automation_job(text,text,text,jsonb,jsonb,timestamp with time zone) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION touch_automation_worker(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION touch_automation_worker(text,text,text,text) TO service_role, postgres;

-- ============================================================================================
-- STAGE 2 - anon WRITE grants on 174 tables. Verify external ingestion first (see above).
-- ============================================================================================

REVOKE INSERT, UPDATE, DELETE ON public."AM_HYUNDAI_PART_REQUIRMENT_STATUS" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."admin_audit_logs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."admin_users" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."adv_wise_lubricants_vas" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_finance_audit_logs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_hyundai_spare_parts_ppni" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_adv_wise_lubricants_vas" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_call_center_complaints" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_customer_complaint_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_demo_car_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_ew_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_open_ro_yearly" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_operation_identifier_catalog" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_operation_wise_analysis_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_psf_yearly" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_repair_order_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_repair_order_list_n6250_backup_20260619050128" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_ro_billing_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_ro_billing_report_n6250_backup_20260619050128" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_service_appointment" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_service_appointment_resolved_v1" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."am_platinum_trust_package" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."approvals_branches_config" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."approvals_common_data" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."approvals_history" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."auth_activities" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."automation_browser_lease" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."automation_jobs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."automation_report_runs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."automation_service_state" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."automation_workers" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."business_excellence_am_kia_new" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."call_logs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."consumption_rows" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."dashboard_settings" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."delegation_contacts" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."delegation_task_activity" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."delegation_tasks" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."demo_car_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."demo_job_cards" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."demo_vehicle_details" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."demo_vehicle_remarks" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."finance_order_comments" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."finance_order_workflow" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."finance_orders" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."finance_sheet" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."gl_accounts" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hbe_pre_billing_20260624065722" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hbe_pre_operation_20260624065722" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hbe_pre_repair_20260624065722" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_adv_wise_lubricants_vas" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_adv_wise_lubricants_vas_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_call_center_complaints" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_call_center_complaints_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_customer_complaint_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_customer_complaint_list_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_demo_car_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_demo_car_list_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_ew_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_ew_report_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_open_ro_yearly" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_operation_wise_analysis_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_operation_wise_analysis_report_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_psf_yearly" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_psf_yearly_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_repair_order_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_ro_billing_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_ro_billing_report_2008_2020_archive" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_ro_billing_report_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_service_appointment" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_service_appointment_backup_20260624" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_warranty_claim_actions" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_warranty_claim_evidence" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_warranty_claim_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_warranty_claim_ytp" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."hyundai_warranty_dealer_mappings" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."items_row" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_accessories_counter_sales_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_adv_wise_lubricants_vas" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_approval_requests" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_booking_activity" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_booking_discounts" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_booking_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_bookings" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_call_agent_phones" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_call_logs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_callback_requests" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_credentials" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_demo_car_list" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_demo_job_cards" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_email_logs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_enquiry_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_ew_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_finance_activity" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_finance_bank_attempts" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_finance_payout_activity" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_finance_payouts" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_finance_processing" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_finance_remarks" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_insurance" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_lead_followups" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_mcp_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_open_ro_yearly" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_operation_wise_analysis_advisor_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_operation_wise_analysis_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_price_details" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_proformas" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_psf_yearly" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_purchase_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_quotes" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_receipt_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_ro_billing_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_rsa_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_sales_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_sales_targets" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_service_appointment" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_service_dashboard_snapshots" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_stock_local_statuses" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_stock_management" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_stock_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_user_profiles" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_vehicle_allocations" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_vehicle_tracker" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."kia_vehicle_transfers" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_employees" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_fuel_slips" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_price_details" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_proforma_lookup_options" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_proformas" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_trips" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_user_profiles" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."mg_vehicle" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."notifications" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."operation_wise_analysis_advisor_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."operation_wise_analysis_report" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."permission_audit_logs" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."permission_groups" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."petty_cash_allocations" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."petty_cash_approval_history" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."petty_cash_categories" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."petty_cash_expense_attachments" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."petty_cash_expenses" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."petty_cash_ledger_entries" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."petty_cash_requests" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."platinum_test_drive_vehicle" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."platinum_warranty_claim_actions" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."platinum_warranty_claim_evidence" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."platinum_warranty_dealer_mappings" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."purchase_order_approvals" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."purchase_orders" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."role_permissions" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_attachments" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_departments" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_descriptions" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_employees" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_handover_users" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_locations" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_master_data" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_payment_modes" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_transactions" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."scrap_types" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."service_appointment" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."test_drive_employees" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."test_report_sheet" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."transactions_rows" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."trip_purposes" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."trips" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."trust_package" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."user_activity_events" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."user_permissions" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."user_preferences" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."users" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."vendors" FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public."workflow_history" FROM anon;

-- Stop the next new table from inheriting write access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- ============================================================================================
-- STAGE 3 - anon READ on data that is not public. Verified leaking today.
-- ============================================================================================

REVOKE SELECT ON public."trips" FROM anon;
REVOKE SELECT ON public."consumption_rows" FROM anon;
REVOKE SELECT ON public."items_row" FROM anon;
REVOKE SELECT ON public."transactions_rows" FROM anon;
REVOKE SELECT ON public."approvals_history" FROM anon;
REVOKE SELECT ON public."notifications" FROM anon;

-- Materialized views reachable over the Data API, carrying revenue and advisor detail.
REVOKE SELECT ON public."am_platinum_ro_billing_daily_summary_v1" FROM anon, authenticated;
REVOKE SELECT ON public."am_platinum_ro_billing_daily_summary_v2" FROM anon, authenticated;
REVOKE SELECT ON public."am_platinum_open_ro_daily_summary_v1" FROM anon, authenticated;
REVOKE SELECT ON public."am_platinum_complaints_daily_summary_v1" FROM anon, authenticated;
REVOKE SELECT ON public."am_platinum_vas_period_summary_v1" FROM anon, authenticated;
REVOKE SELECT ON public."am_platinum_workshop_performance_jc_summary_v2" FROM anon, authenticated;
REVOKE SELECT ON public."workshop_performance_jc_summary_v1" FROM anon, authenticated;
REVOKE SELECT ON public."workshop_operation_addon_summary_v1" FROM anon, authenticated;

-- ============================================================================================
-- STAGE 4 - the always-true anon RLS policies, read from pg_policies on the live database.
-- ============================================================================================
-- Redundant once the GRANT is gone, but dropped so a future accidental GRANT cannot re-open it.

DROP POLICY IF EXISTS "am_hyundai_employees_anon_all" ON public."am_hyundai_employees";
DROP POLICY IF EXISTS "am_hyundai_trips_anon_all" ON public."am_hyundai_trips";
DROP POLICY IF EXISTS "am_hyundai_vehicle_anon_all" ON public."am_hyundai_vehicle";
DROP POLICY IF EXISTS "approvals_history_anon_all" ON public."approvals_history";
DROP POLICY IF EXISTS "anon_delete" ON public."consumption_rows";
DROP POLICY IF EXISTS "anon_update" ON public."consumption_rows";
DROP POLICY IF EXISTS "anon_delete" ON public."items_row";
DROP POLICY IF EXISTS "anon_update" ON public."items_row";
DROP POLICY IF EXISTS "mg_employees_anon_all" ON public."mg_employees";
DROP POLICY IF EXISTS "mg_trips_anon_all" ON public."mg_trips";
DROP POLICY IF EXISTS "mg_vehicle_anon_all" ON public."mg_vehicle";
DROP POLICY IF EXISTS "platinum_test_drive_vehicle_anon_all" ON public."platinum_test_drive_vehicle";
DROP POLICY IF EXISTS "test_drive_employees_anon_all" ON public."test_drive_employees";
DROP POLICY IF EXISTS "anon_delete" ON public."transactions_rows";
DROP POLICY IF EXISTS "anon_update" ON public."transactions_rows";
DROP POLICY IF EXISTS "trips_anon_all" ON public."trips";
DROP POLICY IF EXISTS "vehicles_anon_all" ON public."vehicles";

-- credentials is not anon-readable today (no grant), but an ALL/USING(true) policy for
-- authenticated means any signed-in user reaches it the moment a SELECT grant is added.
DROP POLICY IF EXISTS "credentials_authenticated_all" ON public.credentials;

-- ============================================================================================
-- STAGE 5 - pin function search_path. Low severity on its own; free to fix.
-- ============================================================================================

ALTER FUNCTION am_platinum_repair_order_safe_hash_trigger() SET search_path = public, pg_temp;
ALTER FUNCTION am_platinum_ro_billing_safe_hash_trigger() SET search_path = public, pg_temp;
ALTER FUNCTION delegation_task_activity_immutable() SET search_path = public, pg_temp;
ALTER FUNCTION hyundai_normalize_active_dealer_code(text) SET search_path = public, pg_temp;
ALTER FUNCTION hyundai_operation_safe_hash_trigger() SET search_path = public, pg_temp;
ALTER FUNCTION hyundai_repair_order_safe_hash_trigger() SET search_path = public, pg_temp;
ALTER FUNCTION hyundai_ro_billing_safe_hash_trigger() SET search_path = public, pg_temp;
ALTER FUNCTION kia_finance_activity_immutable() SET search_path = public, pg_temp;
ALTER FUNCTION kia_finance_payout_activity_immutable() SET search_path = public, pg_temp;
ALTER FUNCTION update_updated_at_column() SET search_path = public, pg_temp;

-- ============================================================================================
-- NOT DONE HERE - needs a decision, not a migration
-- ============================================================================================
-- 1. public.users has an INFINITE RECURSION in its RLS policy: the "Users can view their own
--    profile" SELECT policy references users inside its own qual. Latent only because the app
--    reads users over a direct connection that bypasses RLS.
-- 2. pg_net is installed in public. Moving it breaks the functions above until their search_path
--    is updated - own change.
-- 3. Public bucket documents permits anonymous listing. Root listed EMPTY in testing and anon
--    could not enumerate buckets, so KYC exposure was NOT confirmed - check subfolder prefixes.

-- VERIFY (uncomment and run before/after):
-- SELECT 'anon write grants' c, COUNT(DISTINCT table_name)::text v
--   FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public'
--    AND privilege_type IN ('INSERT','UPDATE','DELETE')
-- UNION ALL SELECT 'anon-exec SECDEF fns', COUNT(*)::text FROM pg_proc p
--   JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef
--    AND has_function_privilege('anon', p.oid,'EXECUTE')
-- UNION ALL SELECT 'always-true anon policies', COUNT(*)::text FROM pg_policies
--   WHERE schemaname='public' AND 'anon' = ANY(roles) AND qual='true';
-- Before: 174 / 9 / 17     After: 0 / 0 / 0
