-- RTN-1: saved opponents and editable opponent labels on existing games.
-- Games keep their own opponent_name / opponent_nickname snapshot; nothing here
-- links a game to a saved opponent, so history changes only on explicit edits.

-- Set by set_game_opponent_labels. Once set, only that RPC may change the
-- game's opponent labels: the creator's binding re-sends its local header on
-- every sync, which would otherwise undo a rename made by an admin or on
-- another device.
alter table public.games add column if not exists opponent_labels_edited_at timestamptz;

create table if not exists public.opponent_teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  sport_id text not null,
  name text not null,
  nickname text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint opponent_teams_sport_id_check
    check (sport_id in ('basketball', 'soccer', 'hockey', 'baseball', 'football')),
  constraint opponent_teams_name_length_check
    check (name = trim(name) and char_length(name) between 1 and 100),
  constraint opponent_teams_nickname_length_check
    check (nickname is null or (nickname = trim(nickname) and char_length(nickname) between 1 and 100))
);

create unique index if not exists opponent_teams_owner_sport_name_key
  on public.opponent_teams (owner_id, sport_id, lower(name))
  where archived_at is null;

alter table public.opponent_teams enable row level security;

drop policy if exists "opponent_teams_select_own" on public.opponent_teams;
create policy "opponent_teams_select_own" on public.opponent_teams
  for select using (owner_id = (select auth.uid()));

drop policy if exists "opponent_teams_insert_own" on public.opponent_teams;
create policy "opponent_teams_insert_own" on public.opponent_teams
  for insert with check (owner_id = (select auth.uid()));

drop policy if exists "opponent_teams_update_own" on public.opponent_teams;
create policy "opponent_teams_update_own" on public.opponent_teams
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "opponent_teams_delete_own" on public.opponent_teams;
create policy "opponent_teams_delete_own" on public.opponent_teams
  for delete using (owner_id = (select auth.uid()));

create or replace function public.touch_opponent_teams_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.owner_id := old.owner_id;
  return new;
end;
$$;

drop trigger if exists touch_opponent_teams_updated_at on public.opponent_teams;
create trigger touch_opponent_teams_updated_at
  before update on public.opponent_teams
  for each row execute function public.touch_opponent_teams_updated_at();

grant select, insert, update, delete on public.opponent_teams to authenticated;

-- Same body as migration 055, plus the opponent-label allowance and lock at the top.
create or replace function public.enforce_game_identity_and_final_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- RTN-1: set_game_opponent_labels may relabel the opponent on any game,
    -- final included. Only the two label columns (and updated_at) may differ.
    if coalesce(current_setting('statkeeper.opponent_label_game_id', true), '') = old.id::text
       and (to_jsonb(new) - 'opponent_name' - 'opponent_nickname' - 'opponent_labels_edited_at' - 'updated_at')
         = (to_jsonb(old) - 'opponent_name' - 'opponent_nickname' - 'opponent_labels_edited_at' - 'updated_at') then
      return new;
    end if;
    -- After a relabel, ordinary writes keep the relabeled opponent (no error, so a
    -- sync from an older device copy still succeeds for everything else).
    if old.opponent_labels_edited_at is not null then
      new.opponent_name := old.opponent_name;
      new.opponent_nickname := old.opponent_nickname;
      new.opponent_labels_edited_at := old.opponent_labels_edited_at;
    end if;
    if old.status = 'final' then
      if not (
        public.requires_canonical_event_finalization(old.sport_id, old.id)
        and new.status = 'in_progress'
        and not exists (
          select 1
          from public.game_event_canonical_publications publication
          where publication.game_id = old.id
            and publication.sport_id = old.sport_id
            and publication.invalidated_at is null
        )
      ) then
        raise exception 'Final games are immutable; use correction/admin actions';
      end if;
    end if;
    if public.requires_canonical_event_finalization(old.sport_id, old.id)
       and old.status <> 'final'
       and new.status = 'final'
       and not exists (
         select 1
         from public.game_event_canonical_publications publication
         where publication.game_id = old.id
           and publication.sport_id = old.sport_id
           and publication.invalidated_at is null
       ) then
      raise exception '% games must use canonical finalization', initcap(old.sport_id);
    end if;
    if new.team_id is distinct from old.team_id
       or new.season_id is distinct from old.season_id
       or new.created_by is distinct from old.created_by
       or new.cloud_scope is distinct from old.cloud_scope
       or new.client_local_game_id is distinct from old.client_local_game_id
       or new.sport_id is distinct from old.sport_id then
      raise exception 'Game scope, team, season, sport, local binding, and creator cannot be changed';
    end if;
    if old.status = 'in_progress' and new.status = 'scheduled' then
      raise exception 'An in-progress game cannot return to scheduled';
    end if;
  end if;
  if new.home_team_player_id is not null
     and not exists (
       select 1
       from public.players player
       where player.id = new.home_team_player_id
         and player.is_team_placeholder
     ) then
    raise exception 'Home team stat player must be a placeholder';
  end if;
  if new.opp_team_player_id is not null
     and not exists (
       select 1
       from public.players player
       where player.id = new.opp_team_player_id
         and player.is_team_placeholder
     ) then
    raise exception 'Opponent team stat player must be a placeholder';
  end if;
  if new.home_team_player_id is not null
     and new.home_team_player_id = new.opp_team_player_id then
    raise exception 'Home and opponent team stat players must differ';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_game_identity_and_final_state() from public;

-- Game headers are creator-owned (053); team owners/admins may also relabel.
create or replace function public.set_game_opponent_labels(
  p_game_id uuid,
  p_opponent_name text,
  p_opponent_nickname text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game public.games%rowtype;
  v_name text := trim(coalesce(p_opponent_name, ''));
  v_nickname text := nullif(trim(coalesce(p_opponent_nickname, '')), '');
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'Opponent name must be 1 to 100 characters';
  end if;
  if v_nickname is not null and char_length(v_nickname) > 100 then
    raise exception 'Opponent nickname must be at most 100 characters';
  end if;
  select * into v_game from public.games game where game.id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  -- Fail closed: current_team_role is NULL for non-members, and NOT NULL is not true.
  if (
    v_game.created_by = v_user_id
    or (v_game.team_id is not null and public.current_team_role(v_game.team_id) in ('owner', 'admin'))
  ) is not true then
    raise exception 'Only the game creator or a team owner/admin can rename the opponent';
  end if;
  perform set_config('statkeeper.opponent_label_game_id', p_game_id::text, true);
  update public.games
  set opponent_name = v_name, opponent_nickname = v_nickname, opponent_labels_edited_at = now()
  where id = p_game_id;
  perform set_config('statkeeper.opponent_label_game_id', '', true);
end;
$$;

revoke all on function public.set_game_opponent_labels(uuid, text, text) from public;
grant execute on function public.set_game_opponent_labels(uuid, text, text) to authenticated;

comment on table public.opponent_teams is
  'RTN-1 saved opponents: per account and sport, reused across teams and seasons.';
comment on function public.set_game_opponent_labels(uuid, text, text) is
  'RTN-1: relabel one game''s opponent (final games included) without touching any other column.';
