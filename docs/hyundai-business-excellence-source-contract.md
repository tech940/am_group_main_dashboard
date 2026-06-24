# AM Hyundai Business Excellence Source Contract

Updated: 24 Jun 2026

## Canonical business rules

- Dealer groups:
  - Jammu: `N5203`, `N5216`
  - Akhnoor: `N5701`, `N6844`
  - Kathua: `N5804`, `N6845`
  - RS Pura: `N6815`, `N6846`
  - Vijaypur: `N6819`, `N6847`
  - Billawar: `N6826`, `N6828`, `N6848`
- Legacy filter values `UDHAMPUR` and `HYUNDAI_UDHAMPUR` normalize to canonical `BILLAWAR` for bookmark compatibility.
- `N5217` and `N6849` are deliberately unmapped. They must be reported as source diagnostics if imported, not silently assigned to Billawar.
- Legacy `ACTIVE` rows belong to Jammu only when no better dealer column is available.
- RO Billing excludes `bill_type` values containing `cancel`.
- Invoice identity is canonical dealer + `bill_date` + `bill_no`, falling back to `r_o_no` and `id`.
- Load identity is canonical dealer + `r_o_no`, falling back to `bill_no` and `id`.
- Duplicate invoice rows are ranked by absolute `labour_amt + part_amt`, then latest `uploaded_at` and `id`.
- Dashboard revenue is `labour_amt + part_amt`. `total_amt` is reconciliation-only.
- Operation Wise is monthly/snapshot data. Its coverage is `report_period_start` through `report_period_end`; it is never presented as daily data.
- VAS/WA/WB rows are deduplicated by dealer, report period, and `row_hash`. Because Hyundai Operation Wise is a monthly snapshot without transaction dates, requests resolve to an exact period end when present or otherwise the latest uploaded snapshot in that selected month; APIs always display the actual source coverage.
- WA/WB counts are `SUM(total_count)`. VAS/WA/WB amounts are `SUM(total_amt)`.
- Complaint business date is `COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)`.

## Source mapping

| Source | Date basis | Dealer basis | Identity/dedup | Metrics |
|---|---|---|---|---|
| `hyundai_ro_billing_report` | `bill_date`; intake may use `r_o_date` | `source_dealer_code`, then `dealer_code`, then `main_dealer_code` | Canonical invoice and RO identities above | Load, labour, parts, discount, advisor/model/work-type reporting |
| `hyundai_repair_order_list` | `r_o_date` | Verified `dealer` column | Latest row per dealer/RO using `uploaded_at`, `id` | Open RO, aging, pending mechanical/bodyshop |
| `hyundai_operation_wise_analysis_report` | `report_period_start`, `report_period_end` | `source_dealer_code`, then `dealer_code` | Latest `row_hash` per dealer/period | VAS, WA, WB |
| `hyundai_adv_wise_lubricants_vas` | Source invoice/report date after schema verification | `source_dealer_code`, then `dealer_code` | Source business key/`row_hash` | Advisor attribution only; never replaces source-level Operation Wise totals |
| `hyundai_ew_report` | `reg_date` | `dlr_no` | Certificate number, then VIN/scheme/date fallback | EW count |
| `am_hyundai_rsa_report` | `invoice_date` | Dealer-scoped only if a verified dealer field exists | RSA invoice/certificate business key | RSA count and amount |
| `am_hyundai_mcp_report` | `package_purchase_date` | Dealer-scoped only if a verified dealer field exists | Package/certificate business key | MCP count |
| `hyundai_call_center_complaints` | Complaint business-date fallback above | `source_dealer_code`, then `dealer_code` | Latest complaint number/`id` | Complaint status, aging, resolution and trend |
| `am_hyundai_workshop_performance_jc_summary_v1` | `report_date` | Use only when its dealer/date coverage matches the request | Precomputed `jc_key` | Optional acceleration for all-location Workshop Performance |

## Coverage and availability

- The 15 Jun 2026 audit found RO Billing and Repair Order history beginning in 2021, but branch uploads were uneven by dealer and date.
- Operation Wise and PSF were previously removed from Supabase and preserved in local backups; APIs now treat a missing or old-schema Operation Wise table as unavailable rather than returning fabricated zeroes.
- The live 01-21 Jun 2026 Operation Wise snapshot is available for all six locations. Billawar (`N6848`) reconciles to VAS `Rs 66,996.61`, WA `38 / Rs 14,807.39`, and WB `149 / Rs 14,266.12`. Diagnostic metadata preserves the full unclassified-row count but returns only a 25-code sample.
- RSA/MCP branch attribution is unavailable when their source does not expose a verified dealer field.
- Hyundai SOT remains unavailable. MCP must not be presented as SOT.
- Run `node scripts/audit-hyundai-business-excellence.js` after imports to refresh the detailed schema/sample audit in `scratch/hyundai-business-excellence-source-audit.json`.
