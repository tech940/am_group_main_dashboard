-- ============================================================================
-- PostgreSQL / Supabase optimization follow-ups — audit 2026-07-20
-- ============================================================================
-- Companion to docs/postgres-supabase-optimization-audit-2026-07-20.md
--
-- These are the ONLY genuine index gaps found after reconciling every application
-- WHERE/ORDER BY/JOIN against the existing indexes (schema.ts inline `index()` +
-- lib/db/migrations/*.sql + scripts/apply-migration-*.ts + the ~15 scripts/*.sql
-- perf files). The app is already heavily indexed; this list is deliberately short.
--
-- HOW TO RUN: paste into the Supabase SQL Editor during low traffic, OR run each
-- statement with a direct (session-mode, port 5432) connection. CREATE INDEX
-- CONCURRENTLY CANNOT run inside a transaction block — run statements one-by-one,
-- not wrapped in BEGIN/COMMIT. All are IF NOT EXISTS + CONCURRENTLY (no table locks).
--
-- BEFORE running section A, run section 0 to confirm what is ACTUALLY applied on
-- the live DB (repo scripts are applied manually, so drift is likely).
-- ============================================================================


-- ============================================================================
-- 0. VERIFY-FIRST (run these SELECTs; apply nothing yet)
-- ============================================================================
-- 0a. Full index inventory actually present on the live DB — diff this against the
--     repo (schema.ts + migrations + scripts). Anything the repo defines but this
--     omits is UNAPPLIED DDL and is the real risk (esp. the BE report-table indexes
--     from scripts/dashboard-performance-optimization.sql and
--     scripts/business-excellence-relational-indexes.sql).
--   SELECT tablename, indexname, indexdef
--     FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;

-- 0b. Confirm the heavy BE report tables are indexed on their date columns (if any of
--     these return 0 rows, that scan-per-request table is doing SEQ SCANS — fix that
--     FIRST, it dwarfs everything below):
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE schemaname='public'
--      AND tablename IN ('ro_billing_report','open_ro_yearly','kia_call_center_complaints',
--                        'ew_report','mcp_report','rsa_report','psf_yearly',
--                        'hyundai_ro_billing_report','am_platinum_ro_billing_report')
--    ORDER BY tablename, indexname;

-- 0c. Seq-scan hotspots since last stats reset — the empirical "which tables lack a
--     useful index" list. High seq_tup_read with seq_scan >> idx_scan = investigate.
--   SELECT relname, seq_scan, idx_scan, n_live_tup, seq_tup_read
--     FROM pg_stat_user_tables
--    WHERE schemaname='public'
--    ORDER BY seq_tup_read DESC LIMIT 40;


-- ============================================================================
-- A. Confirmed missing indexes (safe, additive)
-- ============================================================================

-- A1. [WITHDRAWN 2026-07-20] petty_cash_allocations(request_id) is ALREADY indexed —
--   schema.ts defines `uniqueIndex('petty_cash_allocations_request_idx').on(requestId)`
--   (an earlier grep missed uniqueIndex() vs index()). Do NOT create it. The petty-cash
--   approval-queue N+1 (report §3.2) is a ROUND-TRIP-count problem, not a missing index —
--   fix it in code (batch the per-row lookups), no DDL needed.

-- A2. kia_bookings default list sort (newest-updated first, non-deleted).
--   getKiaBookingsList orders by updated_at DESC (default) / created_at with a
--   deleted_at IS NULL filter; no index covers updated_at. Low impact at ~50 rows,
--   real once the table grows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_bookings_active_updated_idx
  ON public.kia_bookings (updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_bookings_active_created_idx
  ON public.kia_bookings (created_at DESC)
  WHERE deleted_at IS NULL;

-- A3. kia_finance_processing(updated_at) — getKiaFinanceProcessingList orders by
--   updated_at DESC; table only has PK + unique(proforma_id).
CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_finance_processing_updated_idx
  ON public.kia_finance_processing (updated_at DESC);

-- A4. kia_proformas(approval_status, proforma_date DESC) — the finance approval queue
--   filters approval_status='MANAGER_APPROVED' then orders by proforma_date DESC.
--   Two single-column indexes exist; a composite avoids the post-filter sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_proformas_approval_date_idx
  ON public.kia_proformas (approval_status, proforma_date DESC)
  WHERE deleted_at IS NULL;

-- A5. [WITHDRAWN 2026-07-20] finance_orders(order_number) is ALREADY indexed — the
--   column is declared `text('order_number').unique().notNull()` in schema.ts, which
--   creates a unique index. So the createKiaBookingFinanceDraft lookup is an index scan,
--   and ON CONFLICT DO NOTHING has a real unique to conflict on (no duplicate-order bug).
--   Do NOT create it.


-- ============================================================================
-- B. Optional — cron sweep VIN matching (lower priority; hourly job, not user path)
-- ============================================================================
-- The KIA maintenance sweeps (markKiaSoldAllocations / startKiaArrivedAllocationCountdowns
-- / markKiaTransferMissing in lib/kia/bookings.ts) match kia_stock_management by
-- upper(trim(vin_number)) via EXISTS subqueries — a functional match no plain index
-- serves. Only worth adding if the hourly maintenance job shows up slow; kia_stock_management
-- is the external DMS feed table (analyticsDb), so confirm it is a plain table first.
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_stock_management_vin_norm_idx
--     ON public.kia_stock_management (upper(trim(vin_number)));
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_vehicle_allocations_vin_norm_active_idx
--     ON public.kia_vehicle_allocations (upper(trim(vin_number))) WHERE released_at IS NULL;


-- ============================================================================
-- C. Post-apply verification
-- ============================================================================
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname='public' AND indexname IN (
--      'kia_bookings_active_updated_idx','kia_bookings_active_created_idx',
--      'kia_finance_processing_updated_idx','kia_proformas_approval_date_idx'
--    ) ORDER BY indexname;
--
-- Then re-run an EXPLAIN (ANALYZE, BUFFERS) on the affected queries, e.g.:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM kia_bookings WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 15;
--   -- expect: Index Scan using kia_bookings_active_updated_idx (was Seq Scan + Sort)
