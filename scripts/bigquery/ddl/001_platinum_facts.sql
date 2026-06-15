-- Platinum fact tables (mirror am_platinum_* Supabase tables).
-- Partition: primary business date column. Cluster: resolved_dealer_code.

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_facts.ro_billing` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  resolved_dealer_code STRING,
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
CLUSTER BY resolved_dealer_code, work_type;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_facts.repair_order_list` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  resolved_dealer_code STRING,
  dealer STRING,
  r_o_no STRING,
  r_o_date DATE,
  r_o_status STRING,
  svc_adv STRING,
  work_type STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY r_o_date
CLUSTER BY resolved_dealer_code, work_type;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_facts.call_center_complaints` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  resolved_dealer_code STRING,
  complaint_no STRING,
  complaint_date DATE,
  resolving_date DATE,
  close_date DATE,
  status_group STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY complaint_date
CLUSTER BY resolved_dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_facts.operation_wise_analysis` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  resolved_dealer_code STRING,
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
CLUSTER BY resolved_dealer_code, report_period_end;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_facts.ew_report` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  resolved_dealer_code STRING,
  report_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY report_date
CLUSTER BY resolved_dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_facts.trust_package` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  resolved_dealer_code STRING,
  reg_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY reg_date
CLUSTER BY resolved_dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_facts.service_appointment` (
  id INT64,
  row_hash STRING,
  source_dealer_code STRING,
  resolved_dealer_code STRING,
  appointment_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY appointment_date
CLUSTER BY resolved_dealer_code;
