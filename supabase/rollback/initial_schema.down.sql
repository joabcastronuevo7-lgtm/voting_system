-- DESTRUCTIVE: deletes every guest, session, claim, vote, setting and audit record.
-- Auth users are not touched. Back up first.
-- Migration history is not changed. If the Supabase CLI applied the migrations, afterwards run:
--   supabase migration repair --status reverted 20261126000000 20261126000001 20261127000000
-- To confirm, run this in the same query, above the script:
--   set dinner_awards.confirm_rollback = 'on';

-- One transaction: a refusal or any error leaves everything in place, even in tools
-- that keep running statements after an error.
begin;

do $$
begin
  if current_setting('dinner_awards.confirm_rollback', true) is distinct from 'on' then
    raise exception 'Rollback refused: set dinner_awards.confirm_rollback = ''on'' to confirm data loss';
  end if;
end $$;

drop function if exists
  public.register_guest(text, text), public.guest_me(text), public.ballot_nominees(text),
  public.submit_ballot(text, jsonb), public.claim_preview(text), public.claim_guest(text, text),
  public.public_results(), public.is_admin(), public.admin_dashboard(), public.admin_list_guests(),
  public.admin_results(), public.admin_add_guest(text), public.admin_issue_claim(uuid, text),
  public.admin_remove_guest(uuid, text), public.admin_restore_guest(uuid),
  public.admin_update_event_settings(boolean, text, integer, boolean, boolean, text),
  public.admin_reset_event(text);

-- private.lock_guest returns the guests row type, so the schema goes before the tables.
drop schema if exists private cascade; -- also drops the triggers that use it

drop table if exists
  public.admin_audit_logs, public.votes, public.claim_failures, public.guest_claims,
  public.guest_sessions, public.guests, public.event_settings, public.award_categories,
  public.admins;

commit;
