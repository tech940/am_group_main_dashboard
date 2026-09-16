-- Rollback Migration 0070: Remove model_targets column from kia_sales_commitments

ALTER TABLE kia_sales_commitments
DROP COLUMN IF EXISTS model_targets;
