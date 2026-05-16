-- Update purchase_order_status enum to include all status values
-- This adds missing enum values if they don't exist

DO $$ 
BEGIN
    -- Add awaiting_grn if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'awaiting_grn' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'awaiting_grn';
    END IF;

    -- Add awaiting_accounts if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'awaiting_accounts' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'awaiting_accounts';
    END IF;

    -- Add ea_approved if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'ea_approved' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'ea_approved';
    END IF;

    -- Add md_approved if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'md_approved' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'md_approved';
    END IF;
END $$;

-- Made with Bob
