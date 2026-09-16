-- Migration 0070: Add model_targets jsonb column to kia_sales_commitments
-- Allows storing per-model sales targets (e.g. SONET, NEW SELTOS, CARENS, SYROS, SORENTO, etc.)

ALTER TABLE kia_sales_commitments
ADD COLUMN IF NOT EXISTS model_targets jsonb NOT NULL DEFAULT '{}'::jsonb;
