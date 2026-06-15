-- KIA fact tables (mirror Supabase public tables without am_ prefix).

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.ro_billing` (
  id INT64,
  row_hash STRING,
  dealer_code STRING,
  main_dealer_code STRING,
  bill_no STRING,
  r_o_no STRING,
  bill_date DATE,
  bill_type STRING,
  work_type STRING,
  labour_amt NUMERIC,
  part_amt NUMERIC,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY bill_date
CLUSTER BY dealer_code, work_type;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.operation_wise_analysis` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  report_type STRING,
  report_period_start DATE,
  report_period_end DATE,
  op_part_code STRING,
  op_part_desc STRING,
  total_amt NUMERIC,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY report_period_start
CLUSTER BY source_dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.operation_wise_analysis_advisor` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  report_period_start DATE,
  report_period_end DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY report_period_start
CLUSTER BY source_dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.open_ro_yearly` (
  id INT64,
  row_hash STRING,
  dealer_code STRING,
  r_o_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY r_o_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.call_center_complaints` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  complaint_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY complaint_date
CLUSTER BY source_dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.ew_report` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.mcp_report` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.rsa_report` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.adv_wise_lubricants_vas` (
  id INT64,
  row_hash STRING,
  gst_invoice_date DATE,
  ro_close_date DATE,
  taxable_amount NUMERIC,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY gst_invoice_date
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.service_appointment` (
  id INT64,
  row_hash STRING,
  dealer_code STRING,
  appointment_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY appointment_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.demo_job_cards` (
  id INT64,
  row_hash STRING,
  vin STRING,
  reg_no STRING,
  ro_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY ro_date
CLUSTER BY vin;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_facts.demo_car_list` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;
