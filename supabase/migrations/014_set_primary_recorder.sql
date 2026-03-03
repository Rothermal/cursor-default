-- RPC: team owner/admin sets the primary recorder for a player in a game.
-- Client cannot update other users' checkout rows (RLS), so this runs as definer.

create or replace function public.set_primary_recorder(
  p_game_id uuid,
  p_player_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Caller must be team owner or admin for this game's team
  if not (
    exists (
      select 1 from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = p_game_id
        and tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  ) then
    raise exception 'Not authorized to set primary recorder for this game';
  end if;

  -- Clear primary for all checkouts for this (game, player)
  update public.player_checkouts
  set is_primary = false
  where game_id = p_game_id and player_id = p_player_id;

  -- Set the chosen user as primary (row must exist)
  update public.player_checkouts
  set is_primary = true
  where game_id = p_game_id and player_id = p_player_id and user_id = p_user_id;

  if not found then
    raise exception 'No checkout found for this player and user';
  end if;
end;
$$;
