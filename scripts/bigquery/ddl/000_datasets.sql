-- BigQuery datasets for AM Group dashboard analytics migration.
-- Replace ${PROJECT_ID} before running: bq query --use_legacy_sql=false < 000_datasets.sql

CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.platinum_facts`
  OPTIONS (description = 'Platinum cron-imported fact tables');
CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.platinum_aggregates`
  OPTIONS (description = 'Platinum pre-aggregated dashboard summaries');
CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.kia_facts`
  OPTIONS (description = 'KIA cron-imported fact tables');
CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.kia_aggregates`
  OPTIONS (description = 'KIA pre-aggregated dashboard summaries');
CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.hyundai_facts`
  OPTIONS (description = 'Hyundai cron-imported fact tables');
CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.hyundai_aggregates`
  OPTIONS (description = 'Hyundai pre-aggregated dashboard summaries');
CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.etl_metadata`
  OPTIONS (description = 'Watermarks, batch runs, parity validation logs');
