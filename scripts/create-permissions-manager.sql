-- Access Control / Permissions Manager
-- Run with: psql "$DATABASE_URL" -f scripts/create-permissions-manager.sql

create extension if not exists pgcrypto;

create table if not exists public.permission_groups (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  parent_key text,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.permissions
  add column if not exists group_key text,
  add column if not exists label text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'permissions_group_key_permission_groups_key_fk'
  ) then
    alter table public.permissions
      add constraint permissions_group_key_permission_groups_key_fk
      foreign key (group_key) references public.permission_groups(key) on delete cascade;
  end if;
end $$;

alter table public.role_permissions
  add column if not exists allowed boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  allowed boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_permissions_user_permission_unique unique (user_id, permission_id)
);

create table if not exists public.permission_audit_logs (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.users(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  changed_by uuid references public.users(id),
  old_value boolean,
  new_value boolean,
  source text not null default 'manual',
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists permission_groups_key_idx on public.permission_groups(key);
create index if not exists permission_groups_parent_idx on public.permission_groups(parent_key);
create unique index if not exists permissions_name_idx on public.permissions(name);
create unique index if not exists permissions_group_action_idx on public.permissions(group_key, action);
create index if not exists permissions_resource_idx on public.permissions(resource);
create unique index if not exists role_permissions_role_permission_idx on public.role_permissions(role, permission_id);
create index if not exists role_permissions_role_idx on public.role_permissions(role);
create index if not exists user_permissions_user_idx on public.user_permissions(user_id);
create index if not exists permission_audit_target_idx on public.permission_audit_logs(target_user_id, created_at desc);
create index if not exists permission_audit_permission_idx on public.permission_audit_logs(permission_id);

insert into public.permission_groups (key, name, parent_key, description, sort_order)
values
  ('kia', 'KIA', null, 'AM KIA analytics and workshop modules.', 10),
  ('kia.service', 'Service', 'kia', 'AM KIA service department modules.', 19),
  ('kia.business_excellence', 'Business Excellence', 'kia.service', 'Executive Business Excellence dashboards and reports.', 20),
  ('kia.business_excellence.ro_billing', 'RO Billing', 'kia.business_excellence', 'RO Billing Report tables, KPIs, and trends.', 21),
  ('kia.business_excellence.workshop_performance', 'Workshop Performance', 'kia.business_excellence', 'Workshop performance KPIs and service type tables.', 22),
  ('kia.business_excellence.open_ro', 'Open RO', 'kia.business_excellence', 'Open repair order aging and WIP controls.', 23),
  ('kia.business_excellence.complaints', 'Complaints', 'kia.business_excellence', 'Complaint analytics and customer complaint register.', 24),
  ('kia.business_excellence.rsa', 'RSA', 'kia.business_excellence', 'RSA add-on analytics.', 25),
  ('kia.business_excellence.ew', 'EW', 'kia.business_excellence', 'Extended warranty analytics.', 26),
  ('kia.business_excellence.mcp', 'MCP', 'kia.business_excellence', 'MCP analytics.', 27),
  ('kia.demo_job_cards', 'Demo Job Cards', 'kia.service', 'Demo vehicle aging, alerts, and job card analytics.', 30),
  ('kia.demo_cars_list', 'Demo Cars List', 'kia.service', 'Active test-drive demo stock list and vehicle remarks tracking.', 31),
  ('purchase_orders', 'Purchase Orders', null, 'Purchase order workflow and approvals.', 40),
  ('finance_orders', 'Finance Orders', null, 'Finance order workflow and approvals.', 50),
  ('reports', 'Reports', null, 'Shared operational reports and exports.', 60),
  ('user_management', 'User Management', null, 'User creation and account management.', 70),
  ('access_control', 'Access Control', null, 'Admin permission center and user access overrides.', 80),
  ('dashboard_settings', 'Dashboard Settings', null, 'Application settings and dashboard preferences.', 90)
on conflict (key) do update set
  name = excluded.name,
  parent_key = excluded.parent_key,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

with permission_seed(group_key, action, label, description, sort_order) as (
  values
    ('kia', 'view', 'KIA: View', 'View access for KIA.', 100),
    ('kia.service', 'view', 'Service: View', 'View access for Service.', 190),
    ('kia.business_excellence', 'view', 'Business Excellence: View', 'View access for Business Excellence.', 200),
    ('kia.business_excellence.ro_billing', 'view', 'RO Billing: View', 'View access for RO Billing.', 210),
    ('kia.business_excellence.workshop_performance', 'view', 'Workshop Performance: View', 'View access for Workshop Performance.', 220),
    ('kia.business_excellence.open_ro', 'view', 'Open RO: View', 'View access for Open RO.', 230),
    ('kia.business_excellence.complaints', 'view', 'Complaints: View', 'View access for Complaints.', 240),
    ('kia.business_excellence.rsa', 'view', 'RSA: View', 'View access for RSA.', 250),
    ('kia.business_excellence.ew', 'view', 'EW: View', 'View access for EW.', 260),
    ('kia.business_excellence.mcp', 'view', 'MCP: View', 'View access for MCP.', 270),
    ('kia.demo_job_cards', 'view', 'Demo Job Cards: View', 'View access for Demo Job Cards.', 300),
    ('kia.demo_cars_list', 'view', 'Demo Cars List: View', 'View access for Demo Cars List.', 310),
    ('kia.demo_cars_list', 'edit', 'Demo Cars List: Edit', 'Edit access for Demo Cars List.', 311),
    ('purchase_orders', 'view', 'Purchase Orders: View', 'View access for Purchase Orders.', 400),
    ('purchase_orders', 'create', 'Purchase Orders: Create', 'Create access for Purchase Orders.', 401),
    ('purchase_orders', 'edit', 'Purchase Orders: Edit', 'Edit access for Purchase Orders.', 402),
    ('purchase_orders', 'delete', 'Purchase Orders: Delete', 'Delete access for Purchase Orders.', 403),
    ('purchase_orders', 'approve', 'Purchase Orders: Approve', 'Approve access for Purchase Orders.', 404),
    ('finance_orders', 'view', 'Finance Orders: View', 'View access for Finance Orders.', 500),
    ('finance_orders', 'create', 'Finance Orders: Create', 'Create access for Finance Orders.', 501),
    ('finance_orders', 'edit', 'Finance Orders: Edit', 'Edit access for Finance Orders.', 502),
    ('finance_orders', 'delete', 'Finance Orders: Delete', 'Delete access for Finance Orders.', 503),
    ('finance_orders', 'approve', 'Finance Orders: Approve', 'Approve access for Finance Orders.', 504),
    ('reports', 'view', 'Reports: View', 'View access for Reports.', 600),
    ('reports', 'create', 'Reports: Create', 'Create access for Reports.', 601),
    ('reports', 'edit', 'Reports: Edit', 'Edit access for Reports.', 602),
    ('reports', 'delete', 'Reports: Delete', 'Delete access for Reports.', 603),
    ('user_management', 'view', 'User Management: View', 'View access for User Management.', 700),
    ('user_management', 'create', 'User Management: Create', 'Create access for User Management.', 701),
    ('user_management', 'edit', 'User Management: Edit', 'Edit access for User Management.', 702),
    ('user_management', 'delete', 'User Management: Delete', 'Delete access for User Management.', 703),
    ('access_control', 'view', 'Access Control: View', 'View access for Access Control.', 800),
    ('access_control', 'edit', 'Access Control: Edit', 'Edit access for Access Control.', 801),
    ('dashboard_settings', 'view', 'Dashboard Settings: View', 'View access for Dashboard Settings.', 900),
    ('dashboard_settings', 'edit', 'Dashboard Settings: Edit', 'Edit access for Dashboard Settings.', 901)
)
insert into public.permissions (name, group_key, label, description, resource, action, sort_order, is_active)
select group_key || '.' || action, group_key, label, description, group_key, action, sort_order, true
from permission_seed
on conflict (name) do update set
  group_key = excluded.group_key,
  label = excluded.label,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.role_permissions(role, permission_id, allowed)
select 'admin'::role, id, true
from public.permissions
on conflict (role, permission_id) do update set allowed = true, updated_at = now();
