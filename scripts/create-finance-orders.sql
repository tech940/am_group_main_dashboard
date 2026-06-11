CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  ALTER TYPE role ADD VALUE IF NOT EXISTS 'ceo';
  ALTER TYPE role ADD VALUE IF NOT EXISTS 'finance_head';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE finance_order_stage AS ENUM ('finance_head_submission', 'accounts_verification', 'ea_approval', 'md_approval', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE finance_order_stage ADD VALUE IF NOT EXISTS 'accounts_verification';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE finance_order_status AS ENUM (
    'draft',
    'awaiting_accounts_verification',
    'accounts_verified',
    'accounts_denied',
    'accounts_on_hold',
    'awaiting_ea_approval',
    'ea_approved',
    'ea_denied',
    'ea_on_hold',
    'awaiting_md_approval',
    'md_approved',
    'md_denied',
    'md_on_hold',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE finance_order_status ADD VALUE IF NOT EXISTS 'awaiting_accounts_verification';
  ALTER TYPE finance_order_status ADD VALUE IF NOT EXISTS 'accounts_verified';
  ALTER TYPE finance_order_status ADD VALUE IF NOT EXISTS 'accounts_denied';
  ALTER TYPE finance_order_status ADD VALUE IF NOT EXISTS 'accounts_on_hold';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS finance_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  current_stage finance_order_stage NOT NULL DEFAULT 'finance_head_submission',
  status finance_order_status NOT NULL DEFAULT 'draft',
  total_payout_received numeric(14, 2) NOT NULL,
  invoice_number text NOT NULL,
  payment_received_date timestamptz NOT NULL,
  dse_payout numeric(14, 2) NOT NULL,
  hyp_bank_name text NOT NULL,
  dse_name text NOT NULL,
  dealer text NOT NULL,
  accounts_verification_status text,
  accounts_verified_by uuid REFERENCES users(id),
  accounts_verified_at timestamptz,
  accounts_verification_remarks text,
  accounts_held_at timestamptz,
  accounts_held_by uuid REFERENCES users(id),
  ea_approval_status text,
  ea_approved_by uuid REFERENCES users(id),
  ea_approved_at timestamptz,
  ea_approval_remarks text,
  ea_held_at timestamptz,
  ea_held_by uuid REFERENCES users(id),
  md_approval_status text,
  md_approved_by uuid REFERENCES users(id),
  md_approved_at timestamptz,
  md_approval_remarks text,
  md_held_at timestamptz,
  md_held_by uuid REFERENCES users(id),
  hold_remarks text,
  created_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE finance_orders
  ADD COLUMN IF NOT EXISTS accounts_verification_status text,
  ADD COLUMN IF NOT EXISTS accounts_verified_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS accounts_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS accounts_verification_remarks text,
  ADD COLUMN IF NOT EXISTS accounts_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS accounts_held_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS finance_orders_status_idx ON finance_orders(status);
CREATE INDEX IF NOT EXISTS finance_orders_created_by_idx ON finance_orders(created_by);
CREATE INDEX IF NOT EXISTS finance_orders_invoice_idx ON finance_orders(invoice_number);
CREATE INDEX IF NOT EXISTS finance_orders_created_at_idx ON finance_orders(created_at);

CREATE TABLE IF NOT EXISTS finance_order_workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_order_id uuid NOT NULL REFERENCES finance_orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  stage text NOT NULL,
  performed_by uuid NOT NULL REFERENCES users(id),
  user_role text NOT NULL,
  remarks text,
  previous_status text,
  new_status text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_order_workflow_order_idx ON finance_order_workflow(finance_order_id);
CREATE INDEX IF NOT EXISTS finance_order_workflow_created_idx ON finance_order_workflow(created_at);

CREATE TABLE IF NOT EXISTS finance_order_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_order_id uuid NOT NULL REFERENCES finance_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  comment text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS finance_order_comments_order_idx ON finance_order_comments(finance_order_id);
