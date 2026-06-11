# Platinum Business Excellence: Column Name Audit & Fix Plan

**Status: PLAN MODE — Ready for implementation after schema discovery**
**Scope: Audit every Platinum BE table column name, compare against code expectations, and prepare all fixes**

---

## Why This Plan Exists

The Platinum Business Excellence module references specific column names in 7+ tables. These column names were carried over from KIA's schema (e.g., `report_period_start`, `report_period_end`, `service_advisor`, `total_amt`, `op_part_code`, `op_part_desc`). **If Platinum's actual table columns differ from these KIA-style names, the code silently fails to show data** — returning empty arrays, zero counts, or "source missing" errors without any visible error message.

**There are NO Platinum DDL SQL files in this repository.** The tables are created and populated entirely by the external ETL/cron pipeline. We must query the live database to discover actual column names.

---

## Phase 1: Database Schema Discovery (Run These Queries)

### Query 1A: List all Platinum tables with row counts

```sql
SELECT tablename, n_live_tup AS estimated_rows
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'am_platinum%'
  AND tablename NOT LIKE '%idx%'
ORDER BY tablename;
```

**Expected tables (from code references):**
- `am_platinum_ro_billing_report`
- `am_platinum_repair_order_list`
- `am_platinum_call_center_complaints`
- `am_platinum_operation_wise_analysis_report`
- `am_platinum_operation_wise_analysis_advisor_report`
- `am_platinum_ew_report`
- `am_platinum_mcp_report`
- `am_platinum_rsa_report`
- `am_platinum_trust_package`
- `am_platinum_workshop_performance_jc_summary_v1`

### Query 1B: Full column listing for each critical table

Run this for each of the 7 critical tables:

```sql
-- FOR am_platinum_operation_wise_analysis_report
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_operation_wise_analysis_report'
ORDER BY ordinal_position;

-- FOR am_platinum_operation_wise_analysis_advisor_report
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_operation_wise_analysis_advisor_report'
ORDER BY ordinal_position;

-- FOR am_platinum_ew_report
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_ew_report'
ORDER BY ordinal_position;

-- FOR am_platinum_mcp_report
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_mcp_report'
ORDER BY ordinal_position;

-- FOR am_platinum_rsa_report
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_rsa_report'
ORDER BY ordinal_position;

-- FOR am_platinum_trust_package
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_trust_package'
ORDER BY ordinal_position;

-- FOR am_platinum_workshop_performance_jc_summary_v1
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_workshop_performance_jc_summary_v1'
ORDER BY ordinal_position;
```

### Query 1C: Sample data spot-checks

```sql
-- EW: What department values actually exist?
SELECT DISTINCT LOWER(TRIM(COALESCE(department::text, ''))) AS dept, COUNT(*) AS cnt
FROM am_platinum_ew_report
GROUP BY 1;

-- EW: Does department='service' return any rows?
SELECT COUNT(*) AS service_dept_rows
FROM am_platinum_ew_report
WHERE LOWER(TRIM(COALESCE(department::text, ''))) = 'service';

-- Operation table: What date columns exist? Sample values?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_operation_wise_analysis_report'
  AND data_type LIKE '%date%';

-- Operation table: Sample a few rows to see actual structure
SELECT * FROM am_platinum_operation_wise_analysis_report
LIMIT 3;

-- MCP: Any data at all?
SELECT COUNT(*) AS mcp_total FROM am_platinum_mcp_report;
SELECT * FROM am_platinum_mcp_report LIMIT 3;

-- RSA: Any data at all?
SELECT COUNT(*) AS rsa_total FROM am_platinum_rsa_report;
SELECT * FROM am_platinum_rsa_report LIMIT 3;

-- Advisor operation table: Check if it exists and has rows
SELECT COUNT(*) AS advisor_op_total FROM am_platinum_operation_wise_analysis_advisor_report;
```

---

## Phase 2: Code-vs-Database Column Mapping

After running the queries above, fill in this mapping table. **This is the single source of truth for all fixes.**

### Table: `am_platinum_operation_wise_analysis_report`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `report_period_start` | [run Query 1B] | ? | If missing, use actual date column |
| `report_period_end` | [run Query 1B] | ? | If missing, use actual date column |
| `report_type` | [run Query 1B] | ? | Update if different |
| `op_part_code` | [run Query 1B] | ? | Update if different |
| `op_part_desc` | [run Query 1B] | ? | Update if different |
| `total_amt` | [run Query 1B] | ? | Update if different (e.g., `total_amount`) |
| `source_dealer_code` | [run Query 1B] | ? | Update if different |
| `row_hash` | [run Query 1B] | ? | Code uses this for dedup |
| `uploaded_at` | [run Query 1B] | ? | Need this for freshness |

**Code locations using this table:**
- `lib/platinum/business-excellence-vas.ts:132-206` — VAS amount query
- `app/api/brands/platinum/business-excellence/workshop-performance/route.ts:807-861` — source status check
- `lib/platinum/business-excellence-coverage.ts` — NOT directly used (only EW, Trust, RO Billing, Open RO, Complaints have coverage functions)

### Table: `am_platinum_operation_wise_analysis_advisor_report`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `service_advisor` | [run Query 1B] | ? | Update if different |
| `report_month` | [run Query 1B] | ? | Update if different |
| `report_type` | [run Query 1B] | ? | Update if different |
| `op_part_code` | [run Query 1B] | ? | Update if different |
| `op_part_desc` | [run Query 1B] | ? | Update if different |
| `total_amt` | [run Query 1B] | ? | Update if different |
| `source_dealer_code` | [run Query 1B] | ? | Update if different |

**Code locations using this table:**
- `app/api/brands/platinum/business-excellence/workshop-performance/route.ts:442-527` — `fetchAddonSummary()`
- Same file lines 807-861 — `fetchSourceStatus()`

### Table: `am_platinum_ew_report`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `certi_no` | [run Query 1B] | ? | Dedup key |
| `vin` | [run Query 1B] | ? | Dedup fallback |
| `scheme_desc` | [run Query 1B] | ? | Dedup fallback |
| `reg_date` | [run Query 1B] | ? | Date filter |
| `hml_amt` | [run Query 1B] | ? | Dedup fallback |
| `department` | [run Query 1B] | ? | Filter = 'service' |
| `source_dealer_code` | [run Query 1B] | ? | Dealer filter |
| `uploaded_at` | [run Query 1B] | ? | Dedup ordering |

**Code locations:**
- `overview/route.ts:256-309` — `ewDedupCountSql()`
- `workshop-performance/route.ts:669-728` — `fetchAuxiliaryKpis()` EW branch
- `lib/platinum/business-excellence-coverage.ts:130-148` — `fetchPlatinumEwCoverage()`

### Table: `am_platinum_mcp_report`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `package_purchase_date` | [run Query 1B] | ? | Date filter |
| `department` | [run Query 1B] | ? | Filter = 'service' |
| Any dedup key? | [run Query 1B] | ? | Code doesn't dedup MCP |

**Code locations:**
- `workshop-performance/route.ts:732-738` — MCP count query
- `overview/route.ts:573-577` — MCP count query

### Table: `am_platinum_rsa_report`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `invoice_no` | [run Query 1B] | ? | Dedup key |
| `vin_chasis_no` | [run Query 1B] | ? | Dedup fallback (note: code uses `chasis` not `chassis`) |
| `policy_name` | [run Query 1B] | ? | Dedup fallback |
| `invoice_date` | [run Query 1B] | ? | Date filter |
| `total_amount` | [run Query 1B] | ? | Sum amount |
| `uploaded_at` | [run Query 1B] | ? | Dedup ordering |

**Code locations:**
- `workshop-performance/route.ts:741-793` — RSA dedup + sum query
- `overview/route.ts:311-365` — `rsaDedupKpiSql()`

### Table: `am_platinum_trust_package`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `reg_date` | [run Query 1B] | ? | Date filter for coverage |
| `source_dealer_code` | [run Query 1B] | ? | Dealer filter |
| `uploaded_at` | [run Query 1B] | ? | Freshness |

**Code locations:**
- `app/api/brands/platinum/business-excellence/sot/route.ts` — SOT analysis
- `lib/platinum/business-excellence-coverage.ts:150-168` — `fetchPlatinumSotCoverage()`

### Table: `am_platinum_workshop_performance_jc_summary_v1`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `report_date` | [run Query 1B] | ? | Date range filter |
| `group_type` | [run Query 1B] | ? | Service category |
| `service_type` | [run Query 1B] | ? | Service category |
| `jc_key` | [run Query 1B] | ? | Dedup key |
| `labour_amount` | [run Query 1B] | ? | Amount |
| `part_amount` | [run Query 1B] | ? | Amount |
| `total_amount` | [run Query 1B] | ? | Amount |
| `discount_amount` | [run Query 1B] | ? | Discount |
| `service_advisor` | [run Query 1B] | ? | Advisor filter |

**Code locations:**
- `workshop-performance/route.ts:271-283` — date coverage guard
- Same file: 286-310, 367-383, 555-567, 610-621 — all queries using this MV

### Table: `am_platinum_repair_order_list` (Open RO)

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `r_o_no` | [run Query 1B] | ? | RO number |
| `r_o_date` | [run Query 1B] | ? | RO date |
| `r_o_status` | [run Query 1B] | ? | Status filter = 'open' |
| `reg_no` | [run Query 1B] | ? | Registration |
| `vin` | [run Query 1B] | ? | VIN |
| `model` | [run Query 1B] | ? | Vehicle model |
| `work_type` | [run Query 1B] | ? | Work type |
| `svc_adv` | [run Query 1B] | ? | Service advisor |
| `tech_name` | [run Query 1B] | ? | Technician |
| `source_dealer_code` | [run Query 1B] | ? | Dealer filter |
| `dealer` | [run Query 1B] | ? | Dealer fallback |
| `uploaded_at` | [run Query 1B] | ? | Freshness/dedup |

**Code locations:**
- `app/api/brands/platinum/business-excellence/open-ro/route.ts:44-129` — base SQL
- `app/api/brands/platinum/business-excellence/overview/route.ts:449-498` — Open RO base SQL
- `lib/platinum/business-excellence-coverage.ts:86-107` — coverage check

### Table: `am_platinum_call_center_complaints`

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `complaint_no` | [run Query 1B] | ? | Dedup key |
| `complaint_date` | [run Query 1B] | ? | Primary date |
| `resolving_date` | [run Query 1B] | ? | Fallback date |
| `dealer_resolving_date` | [run Query 1B] | ? | Fallback date |
| `close_date` | [run Query 1B] | ? | Fallback date |
| `status` | [run Query 1B] | ? | Status filter |
| `dealer_name` | [run Query 1B] | ? | Display |
| `dealer_code` | [run Query 1B] | ? | Dealer filter |
| `source_dealer_code` | [run Query 1B] | ? | Dealer filter |
| `vehicle_model` | [run Query 1B] | ? | Display |
| `sr_area` | [run Query 1B] | ? | Signal area |
| `sr_sub_area` | [run Query 1B] | ? | Signal sub-area |
| `dealer_sr_area` | [run Query 1B] | ? | Signal area fallback |
| `dealer_sr_sub_area` | [run Query 1B] | ? | Signal sub-area fallback |
| `pending_days` | [run Query 1B] | ? | Resolution days |
| `pending_reason` | [run Query 1B] | ? | Delay reason |
| `complaint_remarks` | [run Query 1B] | ? | Signal classification |
| `uploaded_at` | [run Query 1B] | ? | Freshness/dedup |

**Code locations:**
- `app/api/brands/platinum/business-excellence/complaints/route.ts`
- `app/api/brands/platinum/business-excellence/overview/route.ts:500-557` — complaints base SQL
- `lib/platinum/business-excellence-coverage.ts:109-128` — coverage check

### Table: `am_platinum_ro_billing_report` (RO Billing — Known Working)

| Code Expects | Actual DB Column | Match? | Action |
|---|---|---|---|
| `bill_date` | [run Query 1B] | ? | Primary date |
| `bill_no` | [run Query 1B] | ? | Bill number |
| `r_o_no` | [run Query 1B] | ? | RO number |
| `work_type` | [run Query 1B] | ? | Work type |
| `service_type` | [run Query 1B] | ? | Service type |
| `service_advisor` | [run Query 1B] | ? | Advisor |
| `technician` | [run Query 1B] | ? | Technician (uses `techniciar` in Platinum!) |
| `model` | [run Query 1B] | ? | Vehicle model |
| `bill_type` | [run Query 1B] | ? | Status filter |
| `labour_amt` | [run Query 1B] | ? | Labour amount |
| `part_amt` | [run Query 1B] | ? | Parts amount |
| `total_amt` | [run Query 1B] | ? | Total amount |
| `dis_amt` | [run Query 1B] | ? | Discount amount |
| `total_disc` | [run Query 1B] | ? | Discount total |
| `labour_disc` | [run Query 1B] | ? | Labour discount |
| `part_disc` | [run Query 1B] | ? | Parts discount |
| `vehicle_reg_no` | [run Query 1B] | ? | Registration |
| `vin` | [run Query 1B] | ? | VIN |
| `dealer_code` | [run Query 1B] | ? | Dealer |
| `main_dealer_code` | [run Query 1B] | ? | Dealer fallback |
| `source_dealer_code` | [run Query 1B] | ? | Dealer primary |
| `uploaded_at` | [run Query 1B] | ? | Freshness |

**NOTE:** In `app/api/brands/platinum/business-excellence/route.ts:102` and Hyundai `route.ts:99`, the projected column list uses `techniciar AS technician` — this is a **known typo** in the column name that works because the query aliases it. But if the actual DB column is spelled `technician`, the query returns NULL for that field.

---

## Phase 3: Implementation Fixes (After Schema Discovery)

Once you fill in the "Actual DB Column" column above, here are the exact files and line ranges to fix:

### Fix Group A: VAS Query Column Names
**File:** `lib/platinum/business-excellence-vas.ts`
**Lines:** 142 (hasColumns check), 153 (SELECT), 189 (SELECT for snapshot meta)

Update the column name list in `hasColumns()` to match actual DB columns.
Update the SELECT expressions to use actual column names.

### Fix Group B: Advisor Addon Summary Column Names
**File:** `app/api/brands/platinum/business-excellence/workshop-performance/route.ts`
**Lines:** 445-455 (hasColumns check), 458-527 (full query)

Update the required column array in `hasColumns()`.
Update all column references in the CTE query.

### Fix Group C: EW Department Filter
**File:** `app/api/brands/platinum/business-excellence/workshop-performance/route.ts` AND `overview/route.ts`

If actual `department` values don't include `'service'`:
- Option C1: Change filter to match actual values
- Option C2: Remove department filter entirely (show all EW)
- Option C3: Add a broader filter: `LOWER(TRIM(COALESCE(department::text, ''))) IN ('service', 'SERVICE', '')`

### Fix Group D: MCP & RSA Hardcoded Unavailable
**File:** `app/api/brands/platinum/business-excellence/workshop-performance/route.ts`
**Lines:** 1179-1182

Remove `am_platinum_mcp_report` and `am_platinum_rsa_report` from `unsupportedComparisonSources` once column names are verified and queries are confirmed working.

### Fix Group E: Materialized View Date Guard
**File:** `app/api/brands/platinum/business-excellence/workshop-performance/route.ts`
**Lines:** 271-283

If the MV `am_platinum_workshop_performance_jc_summary_v1` exists and has recent data but is being skipped:
- Remove `if (dealerCode) return false` to allow dealer-scoped MV usage, OR
- Ensure the MV refresh cron includes dealer-specific partitions, OR
- Accept the raw-table fallback for dealer queries (document as known behavior)

### Fix Group F: RO Billing Technician Column Typo
**File:** `app/api/brands/platinum/business-excellence/route.ts:102`, `hyundai/business-excellence/route.ts:99`

Change `techniciar AS technician` to `technician AS technician` (or whatever the actual column name is).

---

## Phase 4: Quick Win Verification

After applying fixes, verify with these smoke tests:

```sql
-- 1. Confirm Platinum RO Billing has technician data
SELECT bill_date, bill_no, technician, labour_amt, part_amt
FROM am_platinum_ro_billing_report
WHERE bill_date >= CURRENT_DATE - INTERVAL '7 days'
LIMIT 5;

-- 2. Confirm EW service department rows exist
SELECT COUNT(*) FROM am_platinum_ew_report
WHERE LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
  AND reg_date >= CURRENT_DATE - INTERVAL '30 days';

-- 3. Confirm MCP and RSA have recent data
SELECT COUNT(*) FROM am_platinum_mcp_report
WHERE package_purchase_date >= CURRENT_DATE - INTERVAL '30 days';

SELECT COUNT(*) FROM am_platinum_rsa_report
WHERE invoice_date >= CURRENT_DATE - INTERVAL '30 days';

-- 4. Confirm operation table has the expected columns
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'am_platinum_operation_wise_analysis_report'
  AND column_name IN ('report_period_start', 'report_period_end', 'report_month', 'report_type', 'total_amt', 'source_dealer_code');
```

Then reload the Platinum BE pages and check:
- Workshop Performance: VAS amount, WA, WB, EW, MCP, RSA all show non-zero
- Open RO: Shows actual open repair orders
- Overview: Workshop Snapshot shows service mix with JC counts
- RO Billing: Technician column populated
- Freshness: All sources show recent `uploaded_at`

---

## Execution Checklist

- [ ] Run Query 1A: Confirm all 10 tables exist
- [ ] Run Query 1B: Get full column list for all 7 critical tables
- [ ] Run Query 1C: Spot-check EW department values, MCP/RSA row counts, operation table sample
- [ ] Fill in the mapping tables in Phase 2 with actual column names
- [ ] Fix Group A: Update VAS column names in `business-excellence-vas.ts`
- [ ] Fix Group B: Update advisor addon column names in `workshop-performance/route.ts`
- [ ] Fix Group C: Fix EW department filter (both workshop-performance and overview)
- [ ] Fix Group D: Remove MCP/RSA hardcoded unavailable strings
- [ ] Fix Group E: Address MV date guard if needed
- [ ] Fix Group F: Fix `techniciar` typo
- [ ] Run smoke test queries in Phase 4
- [ ] Reload frontend and verify all sections show data
