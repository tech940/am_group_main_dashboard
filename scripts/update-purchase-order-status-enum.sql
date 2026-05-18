-- Update purchase_order_status enum to include all workflow status values.
-- PostgreSQL enum labels can only be appended, so this script is intentionally
-- idempotent and safe to run against older workflow databases.

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'awaiting_grn' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'awaiting_grn';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'awaiting_accounts' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'awaiting_accounts';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'ea_approved' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'ea_approved';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'md_approved' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'md_approved';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'ea_denied'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'ea_denied';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'md_denied'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'md_denied';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'on_hold'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'on_hold';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'ea_on_hold'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'ea_on_hold';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'md_on_hold'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'md_on_hold';
    END IF;
END $$;

-- Made with Bob
