-- Add structured vendor sections for purchase order vendor information.
-- Safe to run repeatedly.

ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS vendor_details JSONB DEFAULT '[]'::jsonb;

UPDATE purchase_orders
SET vendor_details = CASE
  WHEN vendor_details IS NULL THEN '[]'::jsonb
  WHEN jsonb_typeof(vendor_details) <> 'array' THEN '[]'::jsonb
  ELSE vendor_details
END;

ALTER TABLE purchase_orders
ALTER COLUMN vendor_details SET DEFAULT '[]'::jsonb;
