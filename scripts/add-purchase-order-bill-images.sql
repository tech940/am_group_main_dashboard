-- Add separate bill image storage for purchase order vendor information.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS bill_images JSONB DEFAULT '[]'::jsonb;

UPDATE purchase_orders
SET bill_images = '[]'::jsonb
WHERE bill_images IS NULL;

COMMENT ON COLUMN purchase_orders.bill_images IS 'Bill images/documents uploaded separately from vendor quotation images.';
