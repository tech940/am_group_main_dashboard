-- Add actualAmount column to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS actual_amount NUMERIC(12, 2);

-- Add comment
COMMENT ON COLUMN purchase_orders.actual_amount IS 'Actual amount paid in accounts stage';

-- Made with Bob
