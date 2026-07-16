-- Run after migration 039. Replace the placeholder with an existing account email.
-- This script is intentionally manual so app-admin authority cannot be claimed publicly.

do $$
declare
  v_email text := 'REPLACE_WITH_YOUR_EMAIL';
  v_user_id uuid;
begin
  if v_email = 'REPLACE_WITH_YOUR_EMAIL' then
    raise exception 'Replace REPLACE_WITH_YOUR_EMAIL before running this script';
  end if;

  select p.id into v_user_id
  from public.profiles p
  where lower(p.email) = lower(v_email);

  if v_user_id is null then
    raise exception 'No profile found for %', v_email;
  end if;

  update public.account_access
  set status = 'active', app_role = 'app_admin', updated_at = now()
  where user_id = v_user_id;

  if not found then
    raise exception 'No account access row found for %', v_email;
  end if;
end;
$$;
