-- Petty Cash module schema, indexes, default categories, grants, and RLS.
-- Run this against Supabase before enabling the UI in production.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'petty_cash_request_status') then
    create type petty_cash_request_status as enum (
      'draft',
      'submitted',
      'ea_pending',
      'ea_approved',
      'ea_on_hold',
      'ea_rejected',
      'md_pending',
      'md_approved',
      'md_on_hold',
      'md_rejected',
      'accounts_pending',
      'accounts_on_hold',
      'approved',
      'rejected',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'petty_cash_expense_status') then
    create type petty_cash_expense_status as enum (
      'pending',
      'ea_approved',
      'ea_rejected',
      'md_approved',
      'md_rejected',
      'accounts_pending',
      'approved',
      'rejected',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'petty_cash_allocation_status') then
    create type petty_cash_allocation_status as enum ('active', 'closed', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'petty_cash_ledger_entry_type') then
    create type petty_cash_ledger_entry_type as enum ('allocation', 'expense', 'adjustment', 'closure');
  end if;
end $$;

alter table if exists notifications add column if not exists entity_type text;
alter table if exists notifications add column if not exists entity_id uuid;
create index if not exists notifications_entity_idx on notifications (entity_type, entity_id);

create table if not exists petty_cash_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists petty_cash_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  branch_id text not null,
  status petty_cash_request_status not null default 'draft',
  current_stage text not null default 'draft',
  requested_by_name text not null,
  requested_by_email text not null,
  department text,
  category_id uuid references petty_cash_categories(id) on delete set null,
  requested_amount numeric(14,2) not null check (requested_amount > 0),
  allocated_amount numeric(14,2) check (allocated_amount is null or allocated_amount > 0),
  purpose text not null,
  request_form jsonb not null default '{}',
  supporting_files jsonb not null default '[]',
  ea_approved_by uuid references users(id),
  ea_approved_at timestamptz,
  ea_remarks text,
  md_approved_by uuid references users(id),
  md_approved_at timestamptz,
  md_remarks text,
  accounts_approved_by uuid references users(id),
  accounts_approved_at timestamptz,
  accounts_remarks text,
  rejected_at timestamptz,
  rejected_by uuid references users(id),
  created_by uuid not null references users(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists petty_cash_allocations (
  id uuid primary key default gen_random_uuid(),
  allocation_number text not null unique,
  request_id uuid not null unique references petty_cash_requests(id) on delete restrict,
  branch_id text not null,
  allocated_to uuid not null references users(id),
  allocated_by uuid not null references users(id),
  allocated_amount numeric(14,2) not null check (allocated_amount > 0),
  spent_amount numeric(14,2) not null default 0 check (spent_amount >= 0),
  status petty_cash_allocation_status not null default 'active',
  notes text,
  allocated_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint petty_cash_allocations_not_overspent check (spent_amount <= allocated_amount)
);

create table if not exists petty_cash_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_number text not null unique,
  allocation_id uuid not null references petty_cash_allocations(id) on delete restrict,
  branch_id text not null,
  status petty_cash_expense_status not null default 'pending',
  current_stage text not null default 'ea_approval',
  expense_date date not null,
  particulars text not null,
  department text,
  category_id uuid references petty_cash_categories(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  vendor_name text,
  received_by text,
  purpose text not null,
  expense_form jsonb not null default '{}',
  bill_files jsonb not null default '[]',
  ea_approved_by uuid references users(id),
  ea_approved_at timestamptz,
  ea_remarks text,
  md_approved_by uuid references users(id),
  md_approved_at timestamptz,
  md_remarks text,
  accounts_approved_by uuid references users(id),
  accounts_approved_at timestamptz,
  accounts_remarks text,
  rejected_at timestamptz,
  rejected_by uuid references users(id),
  created_by uuid not null references users(id),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists petty_cash_expense_attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references petty_cash_expenses(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_url text,
  file_size integer not null check (file_size > 0),
  mime_type text not null,
  uploaded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists petty_cash_approval_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('request', 'expense')),
  request_id uuid references petty_cash_requests(id) on delete cascade,
  expense_id uuid references petty_cash_expenses(id) on delete cascade,
  action text not null,
  stage text not null,
  performed_by uuid not null references users(id),
  user_role text not null,
  remarks text,
  previous_status text,
  new_status text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint petty_cash_history_one_entity check (
    (request_id is not null and expense_id is null)
    or (request_id is null and expense_id is not null)
  )
);

create table if not exists petty_cash_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references petty_cash_allocations(id) on delete restrict,
  request_id uuid references petty_cash_requests(id) on delete set null,
  expense_id uuid references petty_cash_expenses(id) on delete set null,
  branch_id text not null,
  entry_type petty_cash_ledger_entry_type not null,
  amount numeric(14,2) not null,
  balance_after numeric(14,2) not null check (balance_after >= 0),
  description text not null,
  created_by uuid not null references users(id),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists petty_cash_categories_active_idx on petty_cash_categories (is_active, sort_order);
create index if not exists petty_cash_requests_branch_status_created_idx on petty_cash_requests (branch_id, status, created_at desc);
create index if not exists petty_cash_requests_created_by_idx on petty_cash_requests (created_by, created_at desc);
create index if not exists petty_cash_requests_category_idx on petty_cash_requests (category_id);
create index if not exists petty_cash_requests_pending_ea_idx on petty_cash_requests (branch_id, created_at desc) where status = 'ea_pending';
create index if not exists petty_cash_requests_pending_md_idx on petty_cash_requests (branch_id, created_at desc) where status = 'md_pending';
create index if not exists petty_cash_requests_pending_accounts_idx on petty_cash_requests (branch_id, created_at desc) where status = 'accounts_pending';
create index if not exists petty_cash_allocations_branch_status_created_idx on petty_cash_allocations (branch_id, status, created_at desc);
create index if not exists petty_cash_allocations_allocated_to_status_idx on petty_cash_allocations (allocated_to, status);
create unique index if not exists petty_cash_allocations_one_active_idx on petty_cash_allocations (branch_id, allocated_to) where status = 'active';
create index if not exists petty_cash_expenses_branch_status_created_idx on petty_cash_expenses (branch_id, status, created_at desc);
create index if not exists petty_cash_expenses_allocation_status_created_idx on petty_cash_expenses (allocation_id, status, created_at desc);
create index if not exists petty_cash_expenses_created_by_idx on petty_cash_expenses (created_by, created_at desc);
create index if not exists petty_cash_expenses_category_idx on petty_cash_expenses (category_id);
create index if not exists petty_cash_expenses_pending_ea_idx on petty_cash_expenses (branch_id, created_at desc) where status = 'pending';
create index if not exists petty_cash_expenses_pending_md_idx on petty_cash_expenses (branch_id, created_at desc) where status = 'ea_approved';
create index if not exists petty_cash_expenses_pending_accounts_idx on petty_cash_expenses (branch_id, created_at desc) where status = 'accounts_pending';
create index if not exists petty_cash_expense_attachments_expense_idx on petty_cash_expense_attachments (expense_id, created_at desc);
create index if not exists petty_cash_approval_history_request_idx on petty_cash_approval_history (request_id, created_at);
create index if not exists petty_cash_approval_history_expense_idx on petty_cash_approval_history (expense_id, created_at);
create index if not exists petty_cash_approval_history_actor_idx on petty_cash_approval_history (performed_by, created_at desc);
create index if not exists petty_cash_ledger_allocation_created_idx on petty_cash_ledger_entries (allocation_id, created_at desc);
create index if not exists petty_cash_ledger_branch_created_idx on petty_cash_ledger_entries (branch_id, created_at desc);
create unique index if not exists petty_cash_ledger_expense_idx on petty_cash_ledger_entries (expense_id) where expense_id is not null;

insert into petty_cash_categories (name, slug, description, sort_order)
values
  ('Fuel & Travel', 'fuel-travel', 'Fuel, local conveyance, tolls, and travel reimbursements.', 10),
  ('Office Supplies', 'office-supplies', 'Stationery, printing, courier, and office consumables.', 20),
  ('Repairs & Maintenance', 'repairs-maintenance', 'Small repairs, maintenance, and emergency upkeep.', 30),
  ('Customer Hospitality', 'customer-hospitality', 'Tea, snacks, customer hospitality, and showroom support.', 40),
  ('Staff Welfare', 'staff-welfare', 'Staff welfare and small branch support expenses.', 50),
  ('Other', 'other', 'Unclassified petty cash expense.', 999)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'petty-cash',
  'petty-cash',
  true,
  104857600,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table petty_cash_categories enable row level security;
alter table petty_cash_requests enable row level security;
alter table petty_cash_allocations enable row level security;
alter table petty_cash_expenses enable row level security;
alter table petty_cash_expense_attachments enable row level security;
alter table petty_cash_approval_history enable row level security;
alter table petty_cash_ledger_entries enable row level security;

grant select, insert, update on petty_cash_categories to authenticated;
grant select, insert, update on petty_cash_requests to authenticated;
grant select, insert, update on petty_cash_allocations to authenticated;
grant select, insert, update on petty_cash_expenses to authenticated;
grant select, insert on petty_cash_expense_attachments to authenticated;
grant select, insert on petty_cash_approval_history to authenticated;
grant select, insert on petty_cash_ledger_entries to authenticated;

drop policy if exists "petty cash categories readable" on petty_cash_categories;
create policy "petty cash categories readable"
on petty_cash_categories
for select
to authenticated
using (is_active = true);

drop policy if exists "petty cash requests branch read" on petty_cash_requests;
create policy "petty cash requests branch read"
on petty_cash_requests
for select
to authenticated
using (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or u.brand = 'all'
        or u.id = petty_cash_requests.created_by
        or (
          u.role in ('branch_admin', 'ea', 'md', 'accounts')
          and u.brand = petty_cash_requests.branch_id
        )
      )
  )
);

drop policy if exists "petty cash requests branch write" on petty_cash_requests;
create policy "petty cash requests branch write"
on petty_cash_requests
for all
to authenticated
using (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or u.id = petty_cash_requests.created_by
        or (
          u.role in ('branch_admin', 'ea', 'md', 'accounts')
          and u.brand = petty_cash_requests.branch_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or (
          u.role = 'branch_admin'
          and u.id = petty_cash_requests.created_by
          and u.brand = petty_cash_requests.branch_id
        )
      )
  )
);

drop policy if exists "petty cash allocations branch read" on petty_cash_allocations;
create policy "petty cash allocations branch read"
on petty_cash_allocations
for select
to authenticated
using (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or u.brand = 'all'
        or u.id = petty_cash_allocations.allocated_to
        or (
          u.role in ('branch_admin', 'ea', 'md', 'accounts')
          and u.brand = petty_cash_allocations.branch_id
        )
      )
  )
);

drop policy if exists "petty cash expenses branch read" on petty_cash_expenses;
create policy "petty cash expenses branch read"
on petty_cash_expenses
for select
to authenticated
using (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or u.brand = 'all'
        or u.id = petty_cash_expenses.created_by
        or (
          u.role in ('branch_admin', 'ea', 'md', 'accounts')
          and u.brand = petty_cash_expenses.branch_id
        )
      )
  )
);

drop policy if exists "petty cash expenses branch write" on petty_cash_expenses;
create policy "petty cash expenses branch write"
on petty_cash_expenses
for all
to authenticated
using (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or u.id = petty_cash_expenses.created_by
        or (
          u.role in ('branch_admin', 'ea', 'md', 'accounts')
          and u.brand = petty_cash_expenses.branch_id
        )
      )
  )
)
with check (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or (
          u.role = 'branch_admin'
          and u.id = petty_cash_expenses.created_by
          and u.brand = petty_cash_expenses.branch_id
        )
      )
  )
);

drop policy if exists "petty cash dependent rows branch read" on petty_cash_approval_history;
create policy "petty cash dependent rows branch read"
on petty_cash_approval_history
for select
to authenticated
using (
  exists (
    select 1
    from users u
    left join petty_cash_requests r on r.id = petty_cash_approval_history.request_id
    left join petty_cash_expenses e on e.id = petty_cash_approval_history.expense_id
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or u.brand = 'all'
        or u.id = r.created_by
        or u.id = e.created_by
        or (
          u.role in ('branch_admin', 'ea', 'md', 'accounts')
          and u.brand = coalesce(r.branch_id, e.branch_id)
        )
      )
  )
);

drop policy if exists "petty cash ledger branch read" on petty_cash_ledger_entries;
create policy "petty cash ledger branch read"
on petty_cash_ledger_entries
for select
to authenticated
using (
  exists (
    select 1
    from users u
    where u.supabase_id = (select auth.uid())::text
      and u.is_active = true
      and u.deleted_at is null
      and (
        u.role in ('admin', 'developer')
        or u.brand = 'all'
        or (
          u.role in ('branch_admin', 'ea', 'md', 'accounts')
          and u.brand = petty_cash_ledger_entries.branch_id
        )
      )
  )
);
