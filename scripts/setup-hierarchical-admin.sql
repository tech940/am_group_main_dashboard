-- Hierarchical Admin Console migration.
-- Safe to run repeatedly.

ALTER TYPE role ADD VALUE IF NOT EXISTS 'developer' AFTER 'admin';
ALTER TYPE role ADD VALUE IF NOT EXISTS 'branch_admin' AFTER 'developer';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.users(id),
  target_user_id uuid REFERENCES public.users(id),
  action text NOT NULL,
  branch text,
  before_value jsonb,
  after_value jsonb,
  reason text,
  request_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx
  ON public.admin_audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx
  ON public.admin_audit_logs(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_branch_idx
  ON public.admin_audit_logs(branch, created_at DESC);

-- Legacy global admins retain full authority under the new explicit role.
UPDATE public.users
SET role = 'developer'::role,
    updated_at = now()
WHERE role = 'admin'::role
  AND deleted_at IS NULL;
