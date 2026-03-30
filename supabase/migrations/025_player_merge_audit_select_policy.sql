-- Allow users to read their own player merge audit rows (Admin / support UI).
-- Inserts remain via merge_players_execute (SECURITY DEFINER).

DROP POLICY IF EXISTS "player_merge_audit_no_select" ON public.player_merge_audit;

CREATE POLICY "player_merge_audit_select_own" ON public.player_merge_audit
  FOR SELECT USING (merged_by = (SELECT auth.uid()));

COMMENT ON POLICY "player_merge_audit_select_own" ON public.player_merge_audit IS
  'Users can list merges they performed (DESIGN_PLAYER_MERGE phase 4).';
