# Business Excellence: Report → Database Table Mapping

## Project Overview

This is a **Next.js multi-brand dealer management dashboard** (KIA, Platinum, Hyundai/HMIL) backed by PostgreSQL. The Business Excellence module reads from **relational SQL tables populated by an external cron/import pipeline** (not embedded in this repo). Upload-based spreadsheets are disabled; data lands via external ETL.

The **app-side schedulers** in this repo only handle:
- Materialized view refresh (`refresh-dashboard-materialized-views-scheduler.js`)
- Service dashboard email dispatch (`send-service-dashboard-email-scheduler.js`)
- Database backup (`backup-database-scheduler.js`)

---

## KIA — Report → Table

| Report / Feature | Database Table(s) | Key File(s) |
|---|---|---|
| RO Billing Report | `ro_billing_report` | `app/api/brands/kia/business-excellence/route.ts:43` |
| RO Billing Analysis | `ro_billing_report` | `app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts` |
| Workshop Performance | `ro_billing_report`, `operation_wise_analysis_report`, `operation_wise_analysis_advisor_report` | `app/api/brands/kia/business-excellence/workshop-performance/route.ts` |
| Open RO (Repair Orders) | `open_ro_yearly` | `app/api/brands/kia/business-excellence/open-ro/route.ts` |
| Overview | `ro_billing_report` | `app/api/brands/kia/business-excellence/overview/route.ts` |
| Performance Intelligence | `ro_billing_report` | `app/api/brands/kia/business-excellence/performance-intelligence/route.ts` |
| AI Summary | `ro_billing_report` | `app/api/brands/kia/business-excellence/ai-summary/route.ts` |
| Complaints | `kia_call_center_complaints` | `app/api/brands/kia/business-excellence/complaints/route.ts` |
| Service Dashboard Email | `ro_billing_report` | `lib/reports/service-dashboard-email.ts` |
| Workshop VAS | `operation_wise_analysis_report` | `lib/kia/service-dashboard-export.ts` |

**KIA Freshness Source Map** (`app/api/brands/kia/business-excellence/freshness/route.ts:16-36`):
| Report Key | Table(s) |
|---|---|
| `executive_dashboard` | `ro_billing_report` |
| `business_excellence_overview` | `ro_billing_report`, `open_ro_yearly`, `kia_call_center_complaints`, `operation_wise_analysis_report`, `operation_wise_analysis_advisor_report` |
| `ro_billing_report` | `ro_billing_report` |
| `workshop_performance` | `ro_billing_report`, `operation_wise_analysis_report`, `operation_wise_analysis_advisor_report`, `rsa_report`, `ew_report`, `mcp_report` |
| `open_ro_repair_orders` | `open_ro_yearly` |
| `kia_complaints` | `kia_call_center_complaints` |

**KIA Proforma Import (manual/scheduled XLSX import):**
| Source Sheet | Database Table |
|---|---|
| Proforma Data | `kia_proformas` |
| Price Details | `kia_price_details` |
| Filter / Lookup Options | `kia_proforma_lookup_options` |
| Derived from Proforma + Lookup | `kia_user_profiles` |

---

## HYUNDAI (HMIL) — Report → Table

| Report / Feature | Database Table(s) | Key File(s) |
|---|---|---|
| RO Billing Report | `hyundai_ro_billing_report` | `app/api/brands/hyundai/business-excellence/route.ts:44` |
| RO Billing Analysis | `hyundai_ro_billing_report` | `app/api/brands/hyundai/business-excellence/ro-billing-analysis/route.ts` |
| Workshop Performance | `hyundai_ro_billing_report`, `hyundai_operation_wise_analysis_report`, `hyundai_ew_report` | `app/api/brands/hyundai/business-excellence/workshop-performance/route.ts` |
| Open RO (Repair Orders) | `hyundai_repair_order_list` | `app/api/brands/hyundai/business-excellence/open-ro/route.ts` |
| Overview | `hyundai_ro_billing_report` | `app/api/brands/hyundai/business-excellence/overview/route.ts` |
| Performance Intelligence | `hyundai_ro_billing_report` | `app/api/brands/hyundai/business-excellence/performance-intelligence/route.ts` |
| AI Summary | `hyundai_ro_billing_report` | `app/api/brands/hyundai/business-excellence/ai-summary/route.ts` |
| Complaints | `hyundai_call_center_complaints` | `app/api/brands/hyundai/business-excellence/complaints/route.ts` |

**Hyundai Freshness Source Map** (`app/api/brands/hyundai/business-excellence/freshness/route.ts:16-33`):
| Report Key | Table(s) |
|---|---|
| `executive_dashboard` | `hyundai_ro_billing_report` |
| `business_excellence_overview` | `hyundai_ro_billing_report`, `hyundai_repair_order_list`, `hyundai_call_center_complaints`, `hyundai_operation_wise_analysis_report`, `hyundai_ew_report` |
| `hyundai_ro_billing_report` | `hyundai_ro_billing_report` |
| `workshop_performance` | `hyundai_ro_billing_report`, `hyundai_operation_wise_analysis_report`, `hyundai_ew_report` |
| `open_ro_repair_orders` | `hyundai_repair_order_list` |
| `hyundai_complaints` | `hyundai_call_center_complaints` |

---

## PLATINUM — Report → Table

| Report / Feature | Database Table(s) | Key File(s) |
|---|---|---|
| RO Billing Report | `am_platinum_ro_billing_report` | `app/api/brands/platinum/business-excellence/route.ts:44` |
| RO Billing Analysis | `am_platinum_ro_billing_report` | `app/api/brands/platinum/business-excellence/ro-billing-analysis/route.ts` |
| RO Billing Audit | `am_platinum_ro_billing_report` | `lib/platinum/ro-billing-audit.ts` |
| Workshop Performance | `am_platinum_ro_billing_report`, `am_platinum_operation_wise_analysis_report`, `am_platinum_operation_wise_analysis_advisor_report`, `am_platinum_rsa_report`, `am_platinum_ew_report`, `am_platinum_mcp_report` | `app/api/brands/platinum/business-excellence/workshop-performance/route.ts` |
| Workshop VAS Amount | `am_platinum_operation_wise_analysis_report` | `lib/platinum/business-excellence-vas.ts:132` |
| Open RO (Repair Orders) | `am_platinum_repair_order_list` | `app/api/brands/platinum/business-excellence/open-ro/route.ts` |
| Complaints | `am_platinum_call_center_complaints` | `app/api/brands/platinum/business-excellence/complaints/route.ts` |
| Overview | `am_platinum_ro_billing_report`, `am_platinum_repair_order_list`, `am_platinum_call_center_complaints`, `am_platinum_operation_wise_analysis_report`, `am_platinum_operation_wise_analysis_advisor_report` | `app/api/brands/platinum/business-excellence/overview/route.ts` |
| Performance Intelligence | `am_platinum_ro_billing_report` | `app/api/brands/platinum/business-excellence/performance-intelligence/route.ts` |
| SOT / Package Analysis | `am_platinum_trust_package` | `app/api/brands/platinum/business-excellence/sot/route.ts` |
| AI Summary | `am_platinum_ro_billing_report` | `app/api/brands/platinum/business-excellence/ai-summary/route.ts` |

**Platinum Freshness Source Map** (`app/api/brands/platinum/business-excellence/freshness/route.ts:16-37`):
| Report Key | Table(s) |
|---|---|
| `executive_dashboard` | `am_platinum_ro_billing_report` |
| `business_excellence_overview` | `am_platinum_ro_billing_report`, `am_platinum_repair_order_list`, `am_platinum_call_center_complaints`, `am_platinum_operation_wise_analysis_report`, `am_platinum_operation_wise_analysis_advisor_report` |
| `am_platinum_ro_billing_report` | `am_platinum_ro_billing_report` |
| `workshop_performance` | `am_platinum_ro_billing_report`, `am_platinum_operation_wise_analysis_report`, `am_platinum_operation_wise_analysis_advisor_report`, `am_platinum_rsa_report`, `am_platinum_ew_report`, `am_platinum_mcp_report` |
| `open_ro_repair_orders` | `am_platinum_repair_order_list` |
| `Platinum_complaints` | `am_platinum_call_center_complaints` |
| `sot_analysis` | `am_platinum_trust_package` |

---

## Key Architectural Insight

The tables `hyundai_ro_billing_report`, `hyundai_repair_order_list`, `hyundai_call_center_complaints`, `hyundai_operation_wise_analysis_report`, `hyundai_ew_report`, `open_ro_yearly`, `kia_call_center_complaints`, `am_platinum_ro_billing_report`, `am_platinum_repair_order_list`, `am_platinum_call_center_complaints`, `am_platinum_operation_wise_analysis_report`, `am_platinum_operation_wise_analysis_advisor_report`, `am_platinum_rsa_report`, `am_platinum_ew_report`, `am_platinum_mcp_report`, `am_platinum_trust_package`, `operation_wise_analysis_report`, `operation_wise_analysis_advisor_report`, `rsa_report`, `ew_report`, `mcp_report`, and `open_ro_yearly` are **not defined in the Drizzle ORM schema** (`lib/db/schema.ts`). They exist in the database but are populated by an **external cron/import pipeline** (likely a scheduled external job or data feed). The application code only **reads** from these tables.

The index SQL files that reference these tables:
- `scripts/dashboard-performance-optimization.sql` — indexes on `ro_billing_report` and materialized views
- `scripts/business-excellence-relational-indexes.sql` — indexes on `ro_billing_report`
- `scripts/create-demo-vehicle-remarks.sql` — index on `ro_billing_report`
