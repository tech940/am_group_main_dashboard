-- Add missing denial labels used by the purchase order approval workflow.
-- Safe to run repeatedly.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumlabel = 'ea_denied'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'ea_denied';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumlabel = 'md_denied'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'purchase_order_status')
    ) THEN
        ALTER TYPE purchase_order_status ADD VALUE 'md_denied';
    END IF;
END $$;
