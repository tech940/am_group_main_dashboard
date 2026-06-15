/** Shared Postgres → BigQuery table map for Node scripts (keep in sync with lib/analytics/table-map.ts). */
module.exports.POSTGRES_TO_BIGQUERY_TABLE = {
  am_platinum_ro_billing_report: 'platinum_facts.ro_billing',
  am_platinum_repair_order_list: 'platinum_facts.repair_order_list',
  am_platinum_call_center_complaints: 'platinum_facts.call_center_complaints',
  am_platinum_operation_wise_analysis_report: 'platinum_facts.operation_wise_analysis',
  am_platinum_ew_report: 'platinum_facts.ew_report',
  am_platinum_trust_package: 'platinum_facts.trust_package',
  am_platinum_service_appointment: 'platinum_facts.service_appointment',
  ro_billing_report: 'kia_facts.ro_billing',
  operation_wise_analysis_report: 'kia_facts.operation_wise_analysis',
  open_ro_yearly: 'kia_facts.open_ro_yearly',
  kia_call_center_complaints: 'kia_facts.call_center_complaints',
  hyundai_ro_billing_report: 'hyundai_facts.ro_billing',
  hyundai_repair_order_list: 'hyundai_facts.repair_order_list',
  hyundai_call_center_complaints: 'hyundai_facts.call_center_complaints',
  hyundai_warranty_claim_list: 'hyundai_facts.warranty_claim_list',
}

module.exports.SYNC_TABLE_ORDER = Object.keys(module.exports.POSTGRES_TO_BIGQUERY_TABLE)
