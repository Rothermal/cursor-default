-- Teams table
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  se_team_id text,
  name text not null,
  nickname text,
  sport text not null,
  season text,
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;

-- Team members (collaboration)
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'scorer' check (role in ('owner', 'admin', 'scorer')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique(team_id, user_id)
);

alter table public.team_members enable row level security;

-- Auto-add owner as team_member on team creation
create or replace function public.handle_new_team()
returns trigger as $$
begin
  insert into public.team_members (team_id, user_id, role, accepted_at)
  values (new.id, new.owner_id, 'owner', now());
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_team_created on public.teams;
create trigger on_team_created
  after insert on public.teams
  for each row execute function public.handle_new_team();

-- Teams: members can view, owner/admin can update
create policy "teams_select_member" on public.teams
  for select using (
    id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "teams_insert_own" on public.teams
  for insert with check (owner_id = auth.uid());

create policy "teams_update_admin" on public.teams
  for update using (
    id in (select team_id from public.team_members
           where user_id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "teams_delete_owner" on public.teams
  for delete using (owner_id = auth.uid());

-- Team members policies
-- NOTE: avoid self-referencing subqueries against team_members here, which can
-- cause RLS recursion errors.
create policy "team_members_select" on public.team_members
  for select using (
    user_id = auth.uid()
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );

create policy "team_members_insert_admin" on public.team_members
  for insert with check (
    team_id in (select id from public.teams where owner_id = auth.uid())
  );

create policy "team_members_delete_admin" on public.team_members
  for delete using (
    user_id = auth.uid()
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );

-- Players table
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  se_profile_id text,
  first_name text not null,
  last_name text,
  jersey_number text,
  nickname text,
  position text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;

create policy "players_select_member" on public.players
  for select using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "players_insert_admin" on public.players
  for insert with check (
    team_id in (select team_id from public.team_members
                where user_id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "players_update_admin" on public.players
  for update using (
    team_id in (select team_id from public.team_members
                where user_id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "players_delete_admin" on public.players
  for delete using (
    team_id in (select team_id from public.team_members
                where user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Indexes
create index if not exists idx_teams_owner on public.teams(owner_id);
create index if not exists idx_team_members_user on public.team_members(user_id);
create index if not exists idx_team_members_team on public.team_members(team_id);
create index if not exists idx_players_team on public.players(team_id);
