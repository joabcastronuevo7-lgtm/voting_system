-- Organizer-only reset of all event data. Categories, organizers, event name and date stay.
-- It deletes the audit log too, so no record of the reset remains.

create function public.admin_reset_event(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.event_settings;
begin
  perform private.require_admin();
  if p_confirm is distinct from 'RESET' then
    raise exception 'CONFIRM_RESET_REQUIRED';
  end if;
  -- Locks the settings row, which registration and ballots also lock or wait on.
  select * into v_old from public.event_settings for update;
  if v_old.registration_open or v_old.voting_status in ('open', 'paused') then
    raise exception 'RESET_BLOCKED';
  end if;
  truncate public.votes, public.guest_sessions, public.guest_claims, public.claim_failures,
           public.admin_audit_logs, public.guests;
  update public.event_settings s
     set registration_open = false, voting_status = 'not_started', max_active_guests = 400,
         updated_at = clock_timestamp()
   where s.id;
end $$;

revoke all on function public.admin_reset_event(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_reset_event(text) to authenticated;
