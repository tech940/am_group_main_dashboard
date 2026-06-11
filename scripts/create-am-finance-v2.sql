create sequence if not exists public.finance_sheet_id_seq;

select setval(
  'public.finance_sheet_id_seq',
  greatest(coalesce((select max(id) from public.finance_sheet), 0), 1),
  coalesce((select max(id) from public.finance_sheet), 0) > 0
);

alter sequence public.finance_sheet_id_seq owned by public.finance_sheet.id;

alter table public.finance_sheet
  alter column id set default nextval('public.finance_sheet_id_seq'::regclass);

create table if not exists public.am_finance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  finance_sheet_id bigint not null references public.finance_sheet(id) on delete cascade,
  action text not null,
  field_name text,
  old_value text,
  new_value text,
  performed_by uuid references public.users(id),
  performed_by_name text,
  user_role text not null,
  module text not null default 'am_finance',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists am_finance_audit_finance_sheet_idx
  on public.am_finance_audit_logs(finance_sheet_id, created_at desc);

create index if not exists am_finance_audit_actor_idx
  on public.am_finance_audit_logs(performed_by, created_at desc);

create index if not exists am_finance_audit_action_idx
  on public.am_finance_audit_logs(action);
