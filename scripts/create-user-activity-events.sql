create table if not exists public.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  supabase_id text,
  email text,
  session_id text,
  event_type text not null,
  route_path text,
  route_query text,
  page_title text,
  brand text,
  module text,
  section_key text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists user_activity_events_user_created_idx
  on public.user_activity_events (user_id, created_at desc);

create index if not exists user_activity_events_supabase_created_idx
  on public.user_activity_events (supabase_id, created_at desc);

create index if not exists user_activity_events_email_created_idx
  on public.user_activity_events (email, created_at desc);

create index if not exists user_activity_events_type_created_idx
  on public.user_activity_events (event_type, created_at desc);

create index if not exists user_activity_events_brand_created_idx
  on public.user_activity_events (brand, created_at desc);

create index if not exists user_activity_events_module_created_idx
  on public.user_activity_events (module, created_at desc);

create index if not exists user_activity_events_section_created_idx
  on public.user_activity_events (section_key, created_at desc);

create index if not exists user_activity_events_session_created_idx
  on public.user_activity_events (session_id, created_at desc);

alter table public.user_activity_events enable row level security;

revoke all on public.user_activity_events from anon, authenticated;
