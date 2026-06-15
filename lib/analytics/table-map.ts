/**
 * Maps Supabase public table names to BigQuery fully-qualified table names.
 * Used by sync scripts and the BigQuery analytics provider.
 */
export const POSTGRES_TO_BIGQUERY_TABLE: Record<string, string> = {
  am_platinum_ro_billing_report: 'platinum_facts.ro_billing',
  am_platinum_repair_order_list: 'platinum_facts.repair_order_list',
  am_platinum_call_center_complaints: 'platinum_facts.call_center_complaints',
  am_platinum_operation_wise_analysis_report: 'platinum_facts.operation_wise_analysis',
  am_platinum_ew_report: 'platinum_facts.ew_report',
  am_platinum_trust_package: 'platinum_facts.trust_package',
  am_platinum_service_appointment: 'platinum_facts.service_appointment',
  am_platinum_ro_billing_daily_summary_v1: 'platinum_aggregates.ro_billing_daily_summary',
  am_platinum_ro_billing_daily_summary_v2: 'platinum_aggregates.ro_billing_daily_summary',
  am_platinum_workshop_performance_jc_summary_v2: 'platinum_aggregates.workshop_performance_jc_summary',
  am_platinum_vas_period_summary_v1: 'platinum_aggregates.vas_period_summary',
  am_platinum_open_ro_daily_summary_v1: 'platinum_aggregates.open_ro_daily_summary',
  am_platinum_complaints_daily_summary_v1: 'platinum_aggregates.complaints_daily_summary',
  ro_billing_report: 'kia_facts.ro_billing',
  operation_wise_analysis_report: 'kia_facts.operation_wise_analysis',
  operation_wise_analysis_advisor_report: 'kia_facts.operation_wise_analysis_advisor',
  open_ro_yearly: 'kia_facts.open_ro_yearly',
  kia_call_center_complaints: 'kia_facts.call_center_complaints',
  ew_report: 'kia_facts.ew_report',
  mcp_report: 'kia_facts.mcp_report',
  rsa_report: 'kia_facts.rsa_report',
  adv_wise_lubricants_vas: 'kia_facts.adv_wise_lubricants_vas',
  service_appointment: 'kia_facts.service_appointment',
  demo_job_cards: 'kia_facts.demo_job_cards',
  demo_car_list: 'kia_facts.demo_car_list',
  ro_billing_daily_summary_v2: 'kia_aggregates.ro_billing_daily_summary',
  workshop_performance_jc_summary_v1: 'kia_aggregates.workshop_performance_jc_summary',
  workshop_operation_addon_summary_v1: 'kia_aggregates.workshop_operation_addon_summary',
  hyundai_ro_billing_report: 'hyundai_facts.ro_billing',
  hyundai_repair_order_list: 'hyundai_facts.repair_order_list',
  hyundai_call_center_complaints: 'hyundai_facts.call_center_complaints',
  hyundai_operation_wise_analysis_report: 'hyundai_facts.operation_wise_analysis',
  hyundai_ew_report: 'hyundai_facts.ew_report',
  am_hyundai_rsa_report: 'hyundai_facts.rsa_report',
  am_hyundai_mcp_report: 'hyundai_facts.mcp_report',
  hyundai_warranty_claim_list: 'hyundai_facts.warranty_claim_list',
  hyundai_warranty_claim_ytp: 'hyundai_facts.warranty_claim_ytp',
  am_hyundai_workshop_performance_jc_summary_v1: 'hyundai_aggregates.workshop_performance_jc_summary',
}

export function resolveBigQueryTable(projectId: string, postgresTable: string) {
  const mapped = POSTGRES_TO_BIGQUERY_TABLE[postgresTable]
  if (!mapped) return null
  return `\`${projectId}.${mapped}\``
}

export const SYNC_TABLE_ORDER = [
  'am_platinum_ro_billing_report',
  'am_platinum_repair_order_list',
  'am_platinum_call_center_complaints',
  'am_platinum_operation_wise_analysis_report',
  'am_platinum_ew_report',
  'am_platinum_trust_package',
  'am_platinum_service_appointment',
  'ro_billing_report',
  'operation_wise_analysis_report',
  'open_ro_yearly',
  'kia_call_center_complaints',
  'hyundai_ro_billing_report',
  'hyundai_repair_order_list',
  'hyundai_call_center_complaints',
  'hyundai_warranty_claim_list',
] as const
