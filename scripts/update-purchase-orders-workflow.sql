-- ============================================================================
-- Purchase Orders Workflow Redesign Migration
-- ============================================================================
-- This script updates the purchase orders system to support the new workflow:
-- Stage 1: Initial Submission (Any User)
-- Stage 2: Vendor Information (Purchase Manager)
-- Stage 3: EA & MD Approvals (Separate)
-- Stage 4: GRN (Purchase Manager)
-- Stage 5: Accounts Department (Accounts)
-- ============================================================================

-- Step 0: Drop ALL policies from all tables before altering enums
-- ============================================================================
-- This is critical because policies can depend on enum columns (role, current_stage, status)

-- Disable RLS temporarily to drop all policies
ALTER TABLE purchase_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_approvals DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;

-- Drop ALL purchase_orders policies (depend on role, current_stage, status)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'purchase_orders')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON purchase_orders';
    END LOOP;
END $$;

-- Drop ALL workflow_history policies
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'workflow_history')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON workflow_history';
    END LOOP;
END $$;

-- Drop ALL purchase_order_approvals policies
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'purchase_order_approvals')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON purchase_order_approvals';
    END LOOP;
END $$;

-- Drop ALL role_permissions policies
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'role_permissions')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON role_permissions';
    END LOOP;
END $$;

-- Step 1: Update role enum to include new roles
-- ============================================================================
DO $$ BEGIN
    -- Drop the old enum and create new one with all roles
    ALTER TYPE role RENAME TO role_old;
    
    CREATE TYPE role AS ENUM (
        'admin',
        'purchase_manager',
        'ea',
        'md',
        'accounts',
        'manager',
        'technician',
        'viewer'
    );
    
    -- Update users table
    ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN role TYPE role USING role::text::role;
    ALTER TABLE users ALTER COLUMN role SET DEFAULT 'viewer'::role;
    
    -- Update role_permissions table
    ALTER TABLE role_permissions ALTER COLUMN role TYPE role USING role::text::role;
    
    -- Drop old enum
    DROP TYPE role_old;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Step 2: Update purchase order stages enum
-- ============================================================================
DO $$ BEGIN
    ALTER TYPE purchase_order_stage RENAME TO purchase_order_stage_old;
    
    CREATE TYPE purchase_order_stage AS ENUM (
        'initial_submission',
        'vendor_information',
        'ea_approval',
        'md_approval',
        'grn',
        'accounts'
    );
    
    -- Drop default first
    ALTER TABLE purchase_orders ALTER COLUMN current_stage DROP DEFAULT;
    
    -- Update column type
    ALTER TABLE purchase_orders
    ALTER COLUMN current_stage TYPE purchase_order_stage
    USING
        CASE current_stage::text
            WHEN 'order_request' THEN 'initial_submission'::purchase_order_stage
            WHEN 'vendor_information' THEN 'vendor_information'::purchase_order_stage
            WHEN 'grn' THEN 'grn'::purchase_order_stage
            WHEN 'account_details' THEN 'accounts'::purchase_order_stage
            ELSE 'initial_submission'::purchase_order_stage
        END;
    
    -- Set new default
    ALTER TABLE purchase_orders ALTER COLUMN current_stage SET DEFAULT 'initial_submission'::purchase_order_stage;
    
    DROP TYPE purchase_order_stage_old;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Step 3: Update purchase order status enum
-- ============================================================================
DO $$ BEGIN
    ALTER TYPE purchase_order_status RENAME TO purchase_order_status_old;
    
    CREATE TYPE purchase_order_status AS ENUM (
        'submitted',
        'vendor_info_pending',
        'awaiting_ea_approval',
        'ea_approved',
        'ea_denied',
        'awaiting_md_approval',
        'md_approved',
        'md_denied',
        'awaiting_grn',
        'awaiting_accounts',
        'completed',
        'cancelled',
        'on_hold',
        'ea_on_hold',
        'md_on_hold'
    );
    
    -- Drop default first
    ALTER TABLE purchase_orders ALTER COLUMN status DROP DEFAULT;
    
    -- Update column type
    ALTER TABLE purchase_orders
    ALTER COLUMN status TYPE purchase_order_status
    USING
        CASE status::text
            WHEN 'draft' THEN 'submitted'::purchase_order_status
            WHEN 'pending_ea_approval' THEN 'awaiting_ea_approval'::purchase_order_status
            WHEN 'pending_management_approval' THEN 'awaiting_md_approval'::purchase_order_status
            WHEN 'approved' THEN 'awaiting_grn'::purchase_order_status
            WHEN 'ea_approved' THEN 'awaiting_md_approval'::purchase_order_status
            WHEN 'md_approved' THEN 'awaiting_grn'::purchase_order_status
            WHEN 'rejected' THEN
                CASE
                    WHEN current_stage::text = 'md_approval' THEN 'md_denied'::purchase_order_status
                    ELSE 'ea_denied'::purchase_order_status
                END
            WHEN 'denied' THEN
                CASE
                    WHEN current_stage::text = 'md_approval' THEN 'md_denied'::purchase_order_status
                    ELSE 'ea_denied'::purchase_order_status
                END
            WHEN 'grn_pending' THEN 'awaiting_grn'::purchase_order_status
            WHEN 'accounts_pending' THEN 'awaiting_accounts'::purchase_order_status
            WHEN 'on_hold' THEN
                CASE
                    WHEN current_stage::text = 'md_approval' THEN 'md_on_hold'::purchase_order_status
                    WHEN current_stage::text = 'ea_approval' THEN 'ea_on_hold'::purchase_order_status
                    ELSE 'on_hold'::purchase_order_status
                END
            WHEN 'ea_on_hold' THEN 'ea_on_hold'::purchase_order_status
            WHEN 'md_on_hold' THEN 'md_on_hold'::purchase_order_status
            WHEN 'completed' THEN 'completed'::purchase_order_status
            WHEN 'cancelled' THEN 'cancelled'::purchase_order_status
            ELSE 'submitted'::purchase_order_status
        END;
    
    -- Set new default
    ALTER TABLE purchase_orders ALTER COLUMN status SET DEFAULT 'submitted'::purchase_order_status;
    
    DROP TYPE purchase_order_status_old;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Step 4: Add new columns to purchase_orders table
-- ============================================================================
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS images_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS supporting_images JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS vendor_images JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS vendor_details JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS grn_images JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS accounts_images JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS ea_approval_status TEXT,
ADD COLUMN IF NOT EXISTS ea_approval_remarks TEXT,
ADD COLUMN IF NOT EXISTS md_approval_status TEXT,
ADD COLUMN IF NOT EXISTS md_approval_remarks TEXT,
ADD COLUMN IF NOT EXISTS md_approved_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS md_approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS workflow_locked BOOLEAN DEFAULT false;

-- Step 5: Create workflow_history table for audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
    action TEXT NOT NULL,
    stage TEXT NOT NULL,
    performed_by UUID REFERENCES users(id) NOT NULL,
    user_role TEXT NOT NULL,
    remarks TEXT,
    previous_status TEXT,
    new_status TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_workflow_history_purchase_order 
ON workflow_history(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_workflow_history_created_at 
ON workflow_history(created_at DESC);

-- Step 6: Create approvals table for tracking EA and MD approvals
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_order_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
    approver_role TEXT NOT NULL, -- 'ea' or 'md'
    approver_id UUID REFERENCES users(id) NOT NULL,
    status TEXT NOT NULL, -- 'pending', 'approved', 'denied'
    remarks TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_approvals_purchase_order 
ON purchase_order_approvals(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_approvals_status 
ON purchase_order_approvals(status);

-- Step 7: Update RLS policies for new roles
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can insert their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can view their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can update their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can delete their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Admins and managers can view all purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Admins and managers can update all purchase orders" ON purchase_orders;

-- Policy 1: Any authenticated user can create initial submission
CREATE POLICY "Users can create initial submissions"
ON purchase_orders FOR INSERT
TO authenticated
WITH CHECK (
    current_stage = 'initial_submission' AND
    created_by IN (
        SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
    )
);

-- Policy 2: Users can view their own orders
CREATE POLICY "Users can view their own orders"
ON purchase_orders FOR SELECT
TO authenticated
USING (
    created_by IN (
        SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
    )
);

-- Policy 3: Purchase Managers can view and update vendor & GRN stages
CREATE POLICY "Purchase Managers can manage vendor and GRN"
ON purchase_orders FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.supabase_id::text = auth.uid()::text
        AND users.role = 'purchase_manager'
    )
);

-- Policy 4: EA can view and approve
CREATE POLICY "EA can view and approve"
ON purchase_orders FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.supabase_id::text = auth.uid()::text
        AND users.role = 'ea'
    )
);

-- Policy 5: MD can view and approve
CREATE POLICY "MD can view and approve"
ON purchase_orders FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.supabase_id::text = auth.uid()::text
        AND users.role = 'md'
    )
);

-- Policy 6: Accounts can view and process accounts stage
CREATE POLICY "Accounts can manage accounts stage"
ON purchase_orders FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.supabase_id::text = auth.uid()::text
        AND users.role = 'accounts'
    )
);

-- Policy 7: Admin can do everything
CREATE POLICY "Admin has full access"
ON purchase_orders FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.supabase_id::text = auth.uid()::text
        AND users.role = 'admin'
    )
);

-- Step 8: RLS policies for workflow_history
-- ============================================================================
ALTER TABLE workflow_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workflow history of their orders"
ON workflow_history FOR SELECT
TO authenticated
USING (
    purchase_order_id IN (
        SELECT id FROM purchase_orders
        WHERE created_by IN (
            SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
        )
    )
);

CREATE POLICY "Authorized users can view all workflow history"
ON workflow_history FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.supabase_id::text = auth.uid()::text
        AND users.role IN ('admin', 'purchase_manager', 'ea', 'md', 'accounts')
    )
);

CREATE POLICY "System can insert workflow history"
ON workflow_history FOR INSERT
TO authenticated
WITH CHECK (true);

-- Step 9: RLS policies for approvals
-- ============================================================================
ALTER TABLE purchase_order_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view approvals of their orders"
ON purchase_order_approvals FOR SELECT
TO authenticated
USING (
    purchase_order_id IN (
        SELECT id FROM purchase_orders
        WHERE created_by IN (
            SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
        )
    )
);

CREATE POLICY "Authorized users can view all approvals"
ON purchase_order_approvals FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.supabase_id::text = auth.uid()::text
        AND users.role IN ('admin', 'purchase_manager', 'ea', 'md', 'accounts')
    )
);

CREATE POLICY "Approvers can manage their approvals"
ON purchase_order_approvals FOR ALL
TO authenticated
USING (
    approver_id IN (
        SELECT id FROM users WHERE supabase_id::text = auth.uid()::text
    )
);

-- Step 10: Create helper functions
-- ============================================================================

-- Function to log workflow actions
CREATE OR REPLACE FUNCTION log_workflow_action(
    p_purchase_order_id UUID,
    p_action TEXT,
    p_stage TEXT,
    p_performed_by UUID,
    p_user_role TEXT,
    p_remarks TEXT DEFAULT NULL,
    p_previous_status TEXT DEFAULT NULL,
    p_new_status TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_history_id UUID;
BEGIN
    INSERT INTO workflow_history (
        purchase_order_id,
        action,
        stage,
        performed_by,
        user_role,
        remarks,
        previous_status,
        new_status,
        metadata
    ) VALUES (
        p_purchase_order_id,
        p_action,
        p_stage,
        p_performed_by,
        p_user_role,
        p_remarks,
        p_previous_status,
        p_new_status,
        p_metadata
    ) RETURNING id INTO v_history_id;
    
    RETURN v_history_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION log_workflow_action TO authenticated;

-- Step 11: Update existing data (if any)
-- ============================================================================

-- Update existing orders to new status
UPDATE purchase_orders
SET 
    current_stage = 'initial_submission',
    status = 'submitted'
WHERE current_stage IS NULL OR status IS NULL;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verify the changes
SELECT 'Migration completed successfully!' as message;

-- Show new roles
SELECT unnest(enum_range(NULL::role)) as available_roles;

-- Show new stages
SELECT unnest(enum_range(NULL::purchase_order_stage)) as workflow_stages;

-- Show new statuses
SELECT unnest(enum_range(NULL::purchase_order_status)) as workflow_statuses;

-- Made with Bob
