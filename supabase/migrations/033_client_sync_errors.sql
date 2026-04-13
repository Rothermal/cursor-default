-- Client-reported cloud sync failures (e.g. errors before any game row exists).

create table if not exists public.client_sync_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  message text not null,
  context jsonb not null default '{}'::jsonb
);

create index if not exists idx_client_sync_errors_user_created
  on public.client_sync_errors (user_id, created_at desc);

comment on table public.client_sync_errors is
  'Best-effort inserts from the app when syncGameSnapshotToCloud fails (non-network).';

alter table public.client_sync_errors enable row level security;

create policy "client_sync_errors_select_own" on public.client_sync_errors
  for select using (user_id = auth.uid());

create policy "client_sync_errors_insert_own" on public.client_sync_errors
  for insert with check (user_id = auth.uid());
