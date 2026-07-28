-- SOC-6E1: authenticated, read-only handshake for the complete Soccer cloud contract.
-- This migration adds no product data and grants no operational authority.

create or replace function public.get_soccer_release_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  if not public.has_active_app_access() then
    raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE';
  end if;

  return jsonb_build_object(
    'contractVersion', 1,
    'migration', 49,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'aggregateSourceVersion', 1,
    'settingsSchemaVersion', 1
  );
end;
$$;

revoke all on function public.get_soccer_release_capabilities() from public;
grant execute on function public.get_soccer_release_capabilities() to authenticated;

notify pgrst, 'reload schema';
