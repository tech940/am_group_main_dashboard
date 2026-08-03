/**
 * Registry of the EXTERNAL data feeds this dashboard reports on.
 *
 * Every table here is loaded from outside this repo — DMS exports, insurance portals, the telephony
 * provider. We do not control their cadence, their column semantics, or whether they re-send rows
 * we already have. That is not a bug to fix once; it is a standing condition to monitor.
 *
 * Three real incidents on 2026-08-01/02 are the reason this file exists, and each maps to one of the
 * signals computed in reader.ts:
 *   - Platinum insurance APPENDED a fresh row per upload as a policy's payment progressed, so 83
 *     policies occupied 113 surplus rows and their premium was counted two or three times
 *     -> `duplicateKey`
 *   - The Hyundai billing feed stopped at 1 Aug while a report window ran to "today", quietly
 *     understating every current-period comparison -> `dateColumn` freshness + gap
 *   - Five ROs carried one work_type in the billing feed and a different one in the open-RO feed,
 *     so the same job landed in different buckets depending on which screen you opened
 *     -> `crossCheck`
 *
 * ⚠️ `kia_ro_billing_report` is a VIEW, not a table. It has no `uploaded_at` of its own worth
 * trusting for load-time, so freshness is measured on the business date only.
 */

export type FeedId = string

export type FeedDefinition = {
  id: FeedId
  label: string
  /** Brand grouping for the UI. 'group' = spans brands. */
  brand: 'kia' | 'hyundai' | 'platinum' | 'group'
  table: string
  /** The BUSINESS date — how current the data is, in the dealership's terms. */
  dateColumn: string
  /** When the row physically landed. Null when the source has no load stamp (e.g. a view). */
  loadedColumn: string | null
  /**
   * Natural key, set ONLY where a repeat has been PROVEN to mean duplication.
   *
   * ⚠️ Most of these feeds have no unique business key and that is normal, not a fault. Measured on
   * 2026-08-02: Hyundai bill_no `B202600102` covers 12 rows spanning 6 different ROs and 6 different
   * VINs — a single invoice for several cars. Flagging bill_no would have reported 4,573 phantom
   * "duplicates" on Hyundai alone. The same is true of r_o_no on the repair-order feeds.
   *
   * A monitoring page that cries wolf gets switched off, so null is the correct and common value
   * here. Today it is set only on the insurance feeds — where re-ingestion genuinely stores one
   * policy several times (verified: 83 Platinum policies in 113 rows) — and on the KIA stock
   * snapshot, where a VIN can only stand in the yard once.
   */
  duplicateKey: string | null
  /** Days without new business data before the feed is considered stale. */
  staleAfterDays: number
  /** Shown in the UI when the feed goes stale — what breaks, in the owner's language. */
  impact: string
}

export const DATA_FEEDS: FeedDefinition[] = [
  // ── KIA ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'kia_ro_billing', label: 'KIA · RO Billing', brand: 'kia',
    table: 'kia_ro_billing_report', dateColumn: 'bill_date', loadedColumn: null,
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Service revenue, RO counts and the Service Dashboard understate.',
  },
  {
    id: 'kia_open_ro', label: 'KIA · Open ROs', brand: 'kia',
    table: 'kia_open_ro_yearly', dateColumn: 'ro_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Work-in-progress and pending-vehicle counts go stale.',
  },
  {
    id: 'kia_stock', label: 'KIA · Stock', brand: 'kia',
    table: 'kia_stock_management', dateColumn: 'uploaded_at', loadedColumn: 'uploaded_at',
    duplicateKey: 'vin_number', staleAfterDays: 2,
    impact: 'Free stock, allotment and ageing are computed off a stale yard.',
  },
  {
    id: 'kia_sales', label: 'KIA · Sales Report', brand: 'kia',
    table: 'kia_sales_report', dateColumn: 'delivery_date', loadedColumn: null,
    duplicateKey: null, staleAfterDays: 3,
    impact: 'Retail, delivery and consultant performance numbers lag.',
  },
  {
    id: 'kia_receipts', label: 'KIA · Receipts', brand: 'kia',
    table: 'kia_receipt_report', dateColumn: 'receipt_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 3,
    impact: 'Booking Payment History collections understate.',
  },
  {
    id: 'kia_insurance', label: 'KIA · Insurance', brand: 'kia',
    table: 'kia_insurance', dateColumn: 'policy_effective_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 7,
    impact: 'Insurance attachment and renewal tracking go stale.',
  },
  {
    id: 'kia_operations', label: 'KIA · Operation Analysis', brand: 'kia',
    table: 'kia_operation_wise_analysis_report', dateColumn: 'uploaded_at', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 7,
    impact: 'VAS / operation-level breakdowns go stale.',
  },

  // ── HYUNDAI ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'hyundai_ro_billing', label: 'Hyundai · RO Billing', brand: 'hyundai',
    table: 'hyundai_ro_billing_report', dateColumn: 'bill_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Business Excellence revenue, load and every YoY comparison understate.',
  },
  {
    id: 'hyundai_open_ro', label: 'Hyundai · Open ROs', brand: 'hyundai',
    table: 'hyundai_open_ro_yearly', dateColumn: 'r_o_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Work-in-progress and pending counts go stale.',
  },
  {
    id: 'hyundai_ro_list', label: 'Hyundai · Repair Orders', brand: 'hyundai',
    table: 'hyundai_repair_order_list', dateColumn: 'r_o_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Repair-order analytics lag.',
  },
  {
    id: 'hyundai_enquiry', label: 'Hyundai · Enquiries', brand: 'hyundai',
    table: 'hyundai_enquiry_report', dateColumn: 'enquiry_date', loadedColumn: null,
    duplicateKey: null, staleAfterDays: 3,
    impact: 'Lead funnel and Call Analysis customer matching degrade.',
  },
  {
    id: 'hyundai_insurance', label: 'Hyundai · Insurance', brand: 'hyundai',
    table: 'hyundai_insurance_policy_summary', dateColumn: 'policy_issue_date', loadedColumn: 'uploaded_at',
    duplicateKey: 'policy_no', staleAfterDays: 7,
    impact: 'Insurance retention, renewals and premium totals go stale.',
  },

  // ── PLATINUM ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'platinum_ro_billing', label: 'Platinum · RO Billing', brand: 'platinum',
    table: 'am_platinum_ro_billing_report', dateColumn: 'bill_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Business Excellence revenue, load and every YoY comparison understate.',
  },
  {
    id: 'platinum_open_ro', label: 'Platinum · Open ROs', brand: 'platinum',
    table: 'am_platinum_open_ro_yearly', dateColumn: 'r_o_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Work-in-progress and pending counts go stale.',
  },
  {
    id: 'platinum_ro_list', label: 'Platinum · Repair Orders', brand: 'platinum',
    table: 'am_platinum_repair_order_list', dateColumn: 'r_o_date', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Repair-order analytics lag.',
  },
  {
    id: 'platinum_insurance', label: 'Platinum · Insurance', brand: 'platinum',
    table: 'am_platinum_insurance_policy_summary', dateColumn: 'policy_issue_date', loadedColumn: 'uploaded_at',
    duplicateKey: 'policy_no', staleAfterDays: 7,
    impact: 'Insurance retention, renewals and premium totals go stale.',
  },
  {
    id: 'platinum_operations', label: 'Platinum · Operation Analysis', brand: 'platinum',
    table: 'am_platinum_operation_wise_analysis_report', dateColumn: 'uploaded_at', loadedColumn: 'uploaded_at',
    duplicateKey: null, staleAfterDays: 7,
    impact: 'VAS / operation-level breakdowns go stale.',
  },

  // ── GROUP ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'callyzer_calls', label: 'Group · Call Logs (Callyzer)', brand: 'group',
    table: 'callyzer_calls', dateColumn: 'call_date', loadedColumn: 'synced_at',
    duplicateKey: null, staleAfterDays: 2,
    impact: 'Call Analysis under-reports volume and missed opportunities.',
  },
]

/**
 * Cross-feed agreement checks. Two feeds describing the SAME job must classify it the same way, or
 * the identical RO lands in different buckets on different screens. Found live on Platinum: five
 * July ROs where the billing feed said "Outreach Camp" (which falls into Others and drops out of
 * every category) while the open-RO feed said Running Repair / Paid Service / Accidental Repair.
 */
export type CrossCheck = {
  id: string
  label: string
  brand: FeedDefinition['brand']
  leftTable: string
  leftKey: string
  leftField: string
  rightTable: string
  rightKey: string
  rightField: string
  /** Business date on the LEFT table used to bound the comparison window. */
  leftDateColumn: string
  /** Business date on the RIGHT table — bounded too, or the join scans that feed's whole history. */
  rightDateColumn: string
  description: string
}

export const CROSS_CHECKS: CrossCheck[] = [
  {
    id: 'kia_worktype', label: 'KIA · work type agrees across billing and open ROs', brand: 'kia',
    leftTable: 'kia_ro_billing_report', leftKey: 'ro_no', leftField: 'work_type',
    rightTable: 'kia_open_ro_yearly', rightKey: 'r_o_no', rightField: 'work_type',
    leftDateColumn: 'bill_date', rightDateColumn: 'ro_date',
    description: 'A job classified differently by the two feeds is counted in different categories on different screens.',
  },
  {
    id: 'hyundai_worktype', label: 'Hyundai · work type agrees across billing and open ROs', brand: 'hyundai',
    leftTable: 'hyundai_ro_billing_report', leftKey: 'r_o_no', leftField: 'work_type',
    rightTable: 'hyundai_open_ro_yearly', rightKey: 'r_o_no', rightField: 'work_type',
    leftDateColumn: 'bill_date', rightDateColumn: 'r_o_date',
    description: 'A job classified differently by the two feeds is counted in different categories on different screens.',
  },
  {
    id: 'platinum_worktype', label: 'Platinum · work type agrees across billing and open ROs', brand: 'platinum',
    leftTable: 'am_platinum_ro_billing_report', leftKey: 'r_o_no', leftField: 'work_type',
    rightTable: 'am_platinum_open_ro_yearly', rightKey: 'r_o_no', rightField: 'work_type',
    leftDateColumn: 'bill_date', rightDateColumn: 'r_o_date',
    description: 'Found live: 5 July ROs billed as "Outreach Camp" but opened as Running Repair / Paid / Accidental.',
  },
]
