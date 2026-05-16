-- Create enums for purchase orders (drop if exists to avoid conflicts)
DO $$ BEGIN
    CREATE TYPE purchase_order_stage AS ENUM ('order_request', 'vendor_information', 'grn', 'account_details');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE purchase_order_status AS ENUM ('draft', 'pending_ea_approval', 'pending_management_approval', 'approved', 'rejected', 'completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_mode AS ENUM ('cash', 'cheque', 'bank_transfer', 'upi', 'credit_card', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create purchase_orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  current_stage purchase_order_stage DEFAULT 'order_request' NOT NULL,
  status purchase_order_status DEFAULT 'draft' NOT NULL,
  
  -- Stage 1: Order Request
  req_type TEXT,
  department TEXT,
  sub_department TEXT,
  specify_other TEXT,
  requested_by TEXT,
  special_instructions TEXT,
  quantity_required TEXT,
  estimate_if_any TEXT,
  
  -- Stage 2: Vendor Information
  vendor_name TEXT,
  quotation_1_url TEXT,
  quotation_2_url TEXT,
  quotation_3_url TEXT,
  
  -- Stage 3: GRN (Goods Receipt Note)
  received_date_time TIMESTAMP,
  handover_to TEXT,
  remarks_if_any TEXT,
  amount DECIMAL(12, 2),
  invoice_1_url TEXT,
  invoice_2_url TEXT,
  invoice_3_url TEXT,
  invoice_4_url TEXT,
  
  -- Stage 4: Account Details
  payment_status TEXT,
  payment_mode payment_mode,
  account_remarks TEXT,
  payment_screenshot_url TEXT,
  
  -- Approvals
  ea_approval TEXT,
  ea_approved_by UUID REFERENCES users(id),
  ea_approved_at TIMESTAMP,
  ea_remarks TEXT,
  
  management_approval TEXT,
  management_approved_by UUID REFERENCES users(id),
  management_approved_at TIMESTAMP,
  management_remarks TEXT,
  
  -- Metadata
  created_by UUID REFERENCES users(id) NOT NULL,
  brand TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP,
  deleted_at TIMESTAMP
);

-- Create indexes for better query performance (skip if exists)
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_number ON purchase_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_current_stage ON purchase_orders(current_stage);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON purchase_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_brand ON purchase_orders(brand);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at DESC);

-- Create function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_purchase_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at (drop if exists first)
DROP TRIGGER IF EXISTS trigger_update_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trigger_update_purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_orders_updated_at();

-- Create function to generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  date_part TEXT;
  sequence_part TEXT;
  next_sequence INTEGER;
BEGIN
  date_part := TO_CHAR(NOW(), 'YYYYMMDD');
  
  -- Get the next sequence number for today
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 13) AS INTEGER)), 0) + 1
  INTO next_sequence
  FROM purchase_orders
  WHERE order_number LIKE 'PO-' || date_part || '-%';
  
  sequence_part := LPAD(next_sequence::TEXT, 3, '0');
  
  RETURN 'PO-' || date_part || '-' || sequence_part;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can insert their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can view their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can update their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can delete their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Admins and managers can view all purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Admins and managers can update all purchase orders" ON purchase_orders;

-- RLS Policies for purchase_orders table

-- Policy 1: Allow authenticated users to insert their own purchase orders
CREATE POLICY "Users can insert their own purchase orders"
ON purchase_orders FOR INSERT
TO authenticated
WITH CHECK (
  created_by IN (
    SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
  )
);

-- Policy 2: Allow authenticated users to view their own purchase orders
CREATE POLICY "Users can view their own purchase orders"
ON purchase_orders FOR SELECT
TO authenticated
USING (
  created_by IN (
    SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
  )
);

-- Policy 3: Allow authenticated users to update their own purchase orders
CREATE POLICY "Users can update their own purchase orders"
ON purchase_orders FOR UPDATE
TO authenticated
USING (
  created_by IN (
    SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
  )
);

-- Policy 4: Allow authenticated users to delete their own purchase orders
CREATE POLICY "Users can delete their own purchase orders"
ON purchase_orders FOR DELETE
TO authenticated
USING (
  created_by IN (
    SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
  )
);

-- Policy 5: Allow admins and managers to view all purchase orders
CREATE POLICY "Admins and managers can view all purchase orders"
ON purchase_orders FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.supabase_id::text = auth.uid()::text
    AND users.role IN ('admin', 'manager')
  )
);

-- Policy 6: Allow admins and managers to update all purchase orders (for approvals)
CREATE POLICY "Admins and managers can update all purchase orders"
ON purchase_orders FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.supabase_id::text = auth.uid()::text
    AND users.role IN ('admin', 'manager')
  )
);

-- Grant permissions
GRANT ALL ON purchase_orders TO authenticated;
GRANT EXECUTE ON FUNCTION generate_order_number() TO authenticated;
GRANT EXECUTE ON FUNCTION update_purchase_orders_updated_at() TO authenticated;

-- Made with Bob
