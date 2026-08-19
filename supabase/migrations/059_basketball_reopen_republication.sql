-- BKE-4C4: Basketball publication history and reopen over the private event-platform transaction.

create or replace function public.get_basketball_canonical_publication_history(
  p_game_id uuid
)
returns table (
  publication_id uuid,
  publication_number integer,
  primary_recorded_by uuid,
  primary_display_name text,
  finalized_by uuid,
  finalized_by_display_name text,
  finalized_at timestamptz,
  invalidated_by uuid,
  invalidated_by_display_name text,
  invalidated_at timestamptz,
  invalidation_reason text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_event_game('basketball', p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;
  if not exists (
    select 1
    from public.games game
    where game.id = p_game_id
      and game.sport_id = 'basketball'
  ) then
    raise exception 'Basketball game not found';
  end if;

  return query
  select
    publication.id,
    publication.publication_number,
    publication.primary_recorded_by,
    coalesce(nullif(trim(primary_profile.display_name), ''), 'StatKeeper user')::text,
    publication.finalized_by,
    coalesce(nullif(trim(finalizer_profile.display_name), ''), 'StatKeeper user')::text,
    publication.finalized_at,
    publication.invalidated_by,
    case when publication.invalidated_by is null then null
      else coalesce(nullif(trim(invalidator_profile.display_name), ''), 'StatKeeper user')
    end::text,
    publication.invalidated_at,
    publication.invalidation_reason,
    publication.invalidated_at is null
  from public.game_event_canonical_publications publication
  left join public.profiles primary_profile
    on primary_profile.id = publication.primary_recorded_by
  left join public.profiles finalizer_profile
    on finalizer_profile.id = publication.finalized_by
  left join public.profiles invalidator_profile
    on invalidator_profile.id = publication.invalidated_by
  where publication.game_id = p_game_id
    and publication.sport_id = 'basketball'
  order by publication.publication_number desc;
end;
$$;

create or replace function public.reopen_basketball_event_game(
  p_game_id uuid,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.reopen_event_game('basketball', p_game_id, p_reason);
$$;

revoke all on function public.reopen_event_game(text, uuid, text) from public;
revoke all on function public.get_basketball_canonical_publication_history(uuid) from public;
revoke all on function public.reopen_basketball_event_game(uuid, text) from public;
grant execute on function public.get_basketball_canonical_publication_history(uuid)
  to authenticated;
grant execute on function public.reopen_basketball_event_game(uuid, text) to authenticated;

comment on function public.get_basketball_canonical_publication_history(uuid) is
  'Manager-only Basketball canonical publication and invalidation metadata in newest-first order.';
comment on function public.reopen_basketball_event_game(uuid, text) is
  'Reason-required Basketball reopen wrapper preserving append-only canonical publication history.';
