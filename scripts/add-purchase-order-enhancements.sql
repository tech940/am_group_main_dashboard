-- Purchase Order Workflow Enhancements Migration
-- Date: 2026-05-18
-- Purpose: Add HOLD status, user preferences, rejected_at field, and EA hold timestamps

-- Step 1: Drop existing policies that depend on enums
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename IN ('purchase_orders', 'users')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- Step 2: Temporarily disable RLS
ALTER TABLE IF EXISTS purchase_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;

-- Step 3: Add 'on_hold' to purchase_order_status enum
ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'ea_on_hold';
ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'md_on_hold';

-- Step 4: Add new columns to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS rejected_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS ea_held_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS ea_held_by uuid REFERENCES users(id),
ADD COLUMN IF NOT EXISTS md_held_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS md_held_by uuid REFERENCES users(id),
ADD COLUMN IF NOT EXISTS hold_remarks text;

-- Step 5: Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference_key text NOT NULL,
    preference_value jsonb NOT NULL DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE(user_id, preference_key)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS user_preferences_user_id_idx ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS user_preferences_key_idx ON user_preferences(preference_key);

-- Step 6: Insert default preferences for existing MD and EA users
INSERT INTO user_preferences (user_id, preference_key, preference_value)
SELECT 
    id,
    'purchase_orders_view_mode',
    '{"viewMode": "table", "stickyHeader": false, "hiddenColumns": [], "approvalFilter": "pending", "completedDateStart": "", "completedDateEnd": ""}'::jsonb
FROM users
WHERE role IN ('md', 'ea') AND deleted_at IS NULL
ON CONFLICT (user_id, preference_key) DO NOTHING;

-- Step 7: Re-enable RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Step 8: Create RLS policies for user_preferences
CREATE POLICY "Users can view their own preferences"
    ON user_preferences FOR SELECT
    USING (auth.uid()::text = (SELECT supabase_id FROM users WHERE id = user_preferences.user_id));

CREATE POLICY "Users can insert their own preferences"
    ON user_preferences FOR INSERT
    WITH CHECK (auth.uid()::text = (SELECT supabase_id FROM users WHERE id = user_preferences.user_id));

CREATE POLICY "Users can update their own preferences"
    ON user_preferences FOR UPDATE
    USING (auth.uid()::text = (SELECT supabase_id FROM users WHERE id = user_preferences.user_id));

CREATE POLICY "Users can delete their own preferences"
    ON user_preferences FOR DELETE
    USING (auth.uid()::text = (SELECT supabase_id FROM users WHERE id = user_preferences.user_id));

-- Step 9: Recreate purchase_orders policies
CREATE POLICY "Users can view purchase orders based on role"
    ON purchase_orders FOR SELECT
    USING (
        deleted_at IS NULL AND (
            -- Admin can see all
            EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'admin')
            OR
            -- Purchase managers can see all
            EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'purchase_manager')
            OR
            -- EA can see orders in their stage
            (current_stage = 'ea_approval' AND EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'ea'))
            OR
            -- MD can see orders in their stage
            (current_stage = 'md_approval' AND EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'md'))
            OR
            -- Accounts can see orders in their stage
            (current_stage = 'accounts' AND EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'accounts'))
            OR
            -- Users can see orders they created
            created_by = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
            OR
            -- Users can see orders assigned to them
            assigned_to = (SELECT id FROM users WHERE supabase_id = auth.uid()::text)
        )
    );

CREATE POLICY "Authorized users can insert purchase orders"
    ON purchase_orders FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users 
            WHERE supabase_id = auth.uid()::text 
            AND role IN ('admin', 'purchase_manager', 'manager', 'technician')
        )
    );

CREATE POLICY "Authorized users can update purchase orders"
    ON purchase_orders FOR UPDATE
    USING (
        deleted_at IS NULL AND (
            EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'admin')
            OR
            EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'purchase_manager')
            OR
            (current_stage = 'ea_approval' AND EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'ea'))
            OR
            (current_stage = 'md_approval' AND EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'md'))
            OR
            (current_stage = 'accounts' AND EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'accounts'))
        )
    );

-- Step 10: Recreate users policies
CREATE POLICY "Users can view their own profile"
    ON users FOR SELECT
    USING (supabase_id = auth.uid()::text OR EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'admin'));

CREATE POLICY "Admins can update users"
    ON users FOR UPDATE
    USING (EXISTS (SELECT 1 FROM users WHERE supabase_id = auth.uid()::text AND role = 'admin'));

-- Step 11: Add comments for documentation
COMMENT ON TABLE user_preferences IS 'Stores user-specific preferences for UI customization';
COMMENT ON COLUMN purchase_orders.rejected_at IS 'Timestamp when order was rejected by EA or MD';
COMMENT ON COLUMN purchase_orders.ea_held_at IS 'Timestamp when EA put order on hold';
COMMENT ON COLUMN purchase_orders.md_held_at IS 'Timestamp when MD put order on hold';
COMMENT ON COLUMN purchase_orders.hold_remarks IS 'Remarks when order is put on hold';

-- Migration complete
SELECT 'Purchase Order Enhancements Migration Completed Successfully' AS status;

-- Made with Bob
