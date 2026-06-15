-- Hyundai fact tables.

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.ro_billing` (
  id INT64,
  row_hash STRING,
  dealer_code STRING,
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

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.repair_order_list` (
  id INT64,
  row_hash STRING,
  dealer_code STRING,
  r_o_no STRING,
  r_o_date DATE,
  r_o_status STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY r_o_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.call_center_complaints` (
  id INT64,
  row_hash STRING,
  complaint_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY complaint_date
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.operation_wise_analysis` (
  id INT64,
  row_hash STRING,
  report_period_start DATE,
  report_period_end DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY report_period_start
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.ew_report` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.rsa_report` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.mcp_report` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.warranty_claim_list` (
  id INT64,
  row_hash STRING,
  dealer_code STRING,
  claim_date DATE,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY claim_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_facts.warranty_claim_ytp` (
  id INT64,
  row_hash STRING,
  uploaded_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(uploaded_at)
CLUSTER BY row_hash;
