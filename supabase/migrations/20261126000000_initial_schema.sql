-- Dinner Awards 2026: initial schema.
-- Security model: no API role can touch a table. All access goes through the
-- functions below. Guest and results functions are for `service_role` (trusted
-- server code); admin functions are for `authenticated` and check `admins`.
-- Raw tokens never reach the database: callers pass SHA-256 hex hashes.

create schema private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Tables ---------------------------------------------------------------------

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.award_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  sort_order smallint not null unique
);

create table public.event_settings (
  id boolean primary key default true check (id),
  event_name text not null,
  event_date date not null,
  registration_open boolean not null default false,
  voting_status text not null default 'not_started'
    check (voting_status in ('not_started', 'open', 'paused', 'closed')),
  max_active_guests integer not null default 400 check (max_active_guests between 1 and 2000),
  updated_at timestamptz not null default now()
);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 80),
  name_key text not null,
  registered_at timestamptz not null default now(),
  -- null when the guest registered themselves; only those count towards the rate limit
  added_by uuid references public.admins (user_id),
  removed_at timestamptz,
  removed_by uuid references public.admins (user_id),
  removal_reason text,
  voted_at timestamptz,
  check (
    (removed_at is null and removed_by is null and removal_reason is null)
    or (removed_at is not null and removed_by is not null and removal_reason is not null)
  )
);
create unique index guests_active_name_key on public.guests (name_key) where removed_at is null;
create index guests_self_registered_at on public.guests (registered_at) where added_by is null;

create table public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests (id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index guest_sessions_guest on public.guest_sessions (guest_id);

create table public.guest_claims (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests (id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz, -- replaced by a newer link, or the guest was removed
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check (used_at is null or used_at <= expires_at)
);
create index guest_claims_guest on public.guest_claims (guest_id);

create table public.claim_failures (
  id bigint generated always as identity primary key,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default now()
);
create index claim_failures_attempted_at on public.claim_failures (attempted_at);
create index claim_failures_token on public.claim_failures (token_hash, attempted_at);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.award_categories (id),
  voter_guest_id uuid not null references public.guests (id),
  nominee_guest_id uuid not null references public.guests (id),
  created_at timestamptz not null default now(),
  unique (voter_guest_id, category_id),
  check (voter_guest_id <> nominee_guest_id)
);
create index votes_category_nominee on public.votes (category_id, nominee_guest_id);
create index votes_nominee on public.votes (nominee_guest_id);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references public.admins (user_id),
  action text not null,
  target_guest_id uuid references public.guests (id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_logs_created_at on public.admin_audit_logs (created_at);

alter table public.admins enable row level security;
alter table public.award_categories enable row level security;
alter table public.event_settings enable row level security;
alter table public.guests enable row level security;
alter table public.guest_sessions enable row level security;
alter table public.guest_claims enable row level security;
alter table public.claim_failures enable row level security;
alter table public.votes enable row level security;
alter table public.admin_audit_logs enable row level security;
-- No policies on purpose: RLS with no policy denies every API role.

revoke all on table
  public.admins, public.award_categories, public.event_settings, public.guests,
  public.guest_sessions, public.guest_claims, public.claim_failures, public.votes,
  public.admin_audit_logs
from public, anon, authenticated, service_role;

revoke all on sequence public.claim_failures_id_seq, public.admin_audit_logs_id_seq
from public, anon, authenticated, service_role;

-- Triggers -------------------------------------------------------------------

-- A voter has either no votes or one per category, checked at commit.
-- Security definer: deferred triggers run as whichever role commits.
create function private.assert_complete_ballot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_voter uuid;
  v_votes bigint;
begin
  foreach v_voter in array
    case tg_op
      when 'INSERT' then array[new.voter_guest_id]
      when 'DELETE' then array[old.voter_guest_id]
      else array[old.voter_guest_id, new.voter_guest_id]
    end
  loop
    select count(*) into v_votes from public.votes v where v.voter_guest_id = v_voter;
    if v_votes <> 0 and v_votes <> (select count(*) from public.award_categories) then
      raise exception 'INCOMPLETE_BALLOT';
    end if;
  end loop;
  return null;
end $$;

create constraint trigger votes_complete_ballot
  after insert or update or delete on public.votes
  deferrable initially deferred
  for each row execute function private.assert_complete_ballot();

-- Internal helpers -----------------------------------------------------------

-- Returns the cleaned display name, or raises INVALID_NAME.
create function private.clean_name(p_name text) returns text
language plpgsql set search_path = '' as $$
declare
  v_name text;
begin
  -- strip invisible and direction-override characters, then collapse whitespace
  v_name := regexp_replace(normalize(p_name, NFC),
    '[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]', '', 'g');
  v_name := regexp_replace(v_name, '\s+', ' ', 'g');
  v_name := btrim(regexp_replace(v_name, '[[:cntrl:]]', '', 'g'));
  if v_name is null or char_length(v_name) not between 2 and 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'INVALID_NAME';
  end if;
  return v_name;
end $$;

create function private.name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select lower(normalize(p_name, NFKC))
$$;

-- Callers must hold the registration lock so the checks cannot race.
create function private.assert_can_activate(p_name_key text) returns void
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.guests g where g.name_key = p_name_key and g.removed_at is null) then
    raise exception 'DUPLICATE_NAME';
  end if;
  if (select count(*) from public.guests g where g.removed_at is null)
     >= (select s.max_active_guests from public.event_settings s)
  then
    raise exception 'GUEST_LIMIT_REACHED';
  end if;
end $$;

create function private.lock_registration() returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtext('dinner_awards.registration')::bigint)
$$;

-- Returns the guest behind a valid session, or raises INVALID_SESSION.
create function private.session_guest(p_token_hash text) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_guest uuid;
begin
  select g.id into v_guest
    from public.guest_sessions s
    join public.guests g on g.id = s.guest_id
   where s.token_hash = p_token_hash
     and s.revoked_at is null
     and s.expires_at > clock_timestamp()
     and g.removed_at is null;
  if v_guest is null then
    raise exception 'INVALID_SESSION';
  end if;
  return v_guest;
end $$;

create function private.new_session(p_guest_id uuid, p_token_hash text, p_now timestamptz)
returns timestamptz
language sql set search_path = '' as $$
  insert into public.guest_sessions (guest_id, token_hash, created_at, expires_at)
  values (p_guest_id, p_token_hash, p_now, p_now + interval '30 days')
  returning expires_at
$$;

create function private.require_admin() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.admins a where a.user_id = v_user) then
    raise exception 'NOT_ADMIN';
  end if;
  return v_user;
end $$;

create function private.audit(p_admin uuid, p_action text, p_guest uuid, p_details jsonb)
returns void
language sql set search_path = '' as $$
  insert into public.admin_audit_logs (admin_user_id, action, target_guest_id, details)
  values (p_admin, p_action, p_guest, p_details)
$$;

-- Locks the guest row and returns it, or raises GUEST_NOT_FOUND.
create function private.lock_guest(p_guest_id uuid) returns public.guests
language plpgsql set search_path = '' as $$
declare
  v_guest public.guests;
begin
  select * into v_guest from public.guests g where g.id = p_guest_id for no key update;
  if not found then
    raise exception 'GUEST_NOT_FOUND';
  end if;
  return v_guest;
end $$;

-- The one answer to every unusable link, so it never shows whether a token exists.
-- A valid link never reaches this, so these limits cannot block a guest. They cap
-- stored records: about 10 a minute per link, 600 overall. No IP address is used.
-- Returns instead of raising, so the recorded failure is not rolled back.
create function private.claim_failed(p_claim_hash text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_answer constant jsonb := jsonb_build_object('ok', false, 'error', 'INVALID_CLAIM');
  v_since timestamptz;
begin
  if p_claim_hash is null or p_claim_hash !~ '^[0-9a-f]{64}$' then
    return v_answer;
  end if;
  v_since := clock_timestamp() - interval '1 minute';
  if (select count(*) from public.claim_failures f
       where f.attempted_at > v_since and f.token_hash = p_claim_hash) >= 10
     or (select count(*) from public.claim_failures f where f.attempted_at > v_since) >= 600
  then
    return v_answer;
  end if;
  delete from public.claim_failures where attempted_at < clock_timestamp() - interval '1 hour';
  insert into public.claim_failures (token_hash, attempted_at)
  values (p_claim_hash, clock_timestamp());
  return v_answer;
end $$;

-- Guest operations (service_role) --------------------------------------------

create function public.register_guest(p_name text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_guest uuid;
  v_now timestamptz;
  v_expires timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN';
  end if;
  perform private.lock_registration();
  if not (select s.registration_open from public.event_settings s for share) then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  v_name := private.clean_name(p_name);
  perform private.assert_can_activate(private.name_key(v_name));
  v_now := clock_timestamp(); -- after the lock, so the window is accurate
  if (select count(*) from public.guests g
       where g.added_by is null and g.registered_at > v_now - interval '1 minute') >= 30
  then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.guests (full_name, name_key, registered_at)
  values (v_name, private.name_key(v_name), v_now)
  returning id into v_guest;
  v_expires := private.new_session(v_guest, p_token_hash, v_now);

  return jsonb_build_object('guest_id', v_guest, 'full_name', v_name, 'expires_at', v_expires);
end $$;

create function public.guest_me(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guest uuid := private.session_guest(p_token_hash);
begin
  return (
    select jsonb_build_object(
             'full_name', g.full_name,
             'has_voted', g.voted_at is not null,
             'voting_status', s.voting_status,
             'registration_open', s.registration_open)
      from public.guests g cross join public.event_settings s
     where g.id = v_guest);
end $$;

-- Everything the ballot screen needs. Lists return one jsonb value: the Data API
-- would cut row sets at 1000.
create function public.ballot_nominees(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guest uuid := private.session_guest(p_token_hash);
begin
  if (select s.voting_status from public.event_settings s) <> 'open' then
    raise exception 'VOTING_NOT_OPEN';
  end if;
  if exists (select 1 from public.guests g where g.id = v_guest and g.voted_at is not null) then
    raise exception 'ALREADY_VOTED';
  end if;
  return jsonb_build_object(
    'categories', (
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'description', c.description)
               order by c.sort_order)
        from public.award_categories c),
    'nominees', (
      select coalesce(
               jsonb_agg(jsonb_build_object('id', g.id, 'full_name', g.full_name)
                         order by g.name_key, g.id),
               '[]'::jsonb)
        from public.guests g
       where g.removed_at is null and g.id <> v_guest));
end $$;

-- p_picks: {"<category id>": "<nominee guest id>", ...} with every category.
create function public.submit_ballot(p_token_hash text, p_picks jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_voter uuid := private.session_guest(p_token_hash);
  v_nominees uuid[];
  v_id uuid;
begin
  if (select s.voting_status from public.event_settings s for share) <> 'open' then
    raise exception 'VOTING_NOT_OPEN';
  end if;

  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'INVALID_BALLOT';
  end if;
  if (select count(*) from jsonb_object_keys(p_picks))
       <> (select count(*) from public.award_categories)
     or exists (
       select 1 from public.award_categories c
        where jsonb_typeof(p_picks -> c.id::text) is distinct from 'string'
           or p_picks ->> c.id::text !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$')
  then
    raise exception 'INVALID_BALLOT';
  end if;

  select array_agg((p_picks ->> c.id::text)::uuid) into v_nominees from public.award_categories c;
  if v_voter = any (v_nominees) then
    raise exception 'SELF_VOTE';
  end if;

  -- Lock every involved guest in id order, so mutual votes cannot deadlock.
  for v_id in select distinct x from unnest(v_nominees || v_voter) as x order by x loop
    if v_id = v_voter then
      perform 1 from public.guests g where g.id = v_id for no key update;
    else
      perform 1 from public.guests g where g.id = v_id for share;
    end if;
  end loop;

  -- Re-check now that nothing involved can change.
  perform private.session_guest(p_token_hash);
  if exists (select 1 from public.guests g where g.id = v_voter and g.voted_at is not null) then
    raise exception 'ALREADY_VOTED';
  end if;
  if exists (
    select 1 from unnest(v_nominees) as n
     where not exists (select 1 from public.guests g where g.id = n and g.removed_at is null))
  then
    raise exception 'INVALID_NOMINEE';
  end if;

  insert into public.votes (category_id, voter_guest_id, nominee_guest_id)
  select c.id, v_voter, (p_picks ->> c.id::text)::uuid from public.award_categories c;
  update public.guests set voted_at = clock_timestamp() where id = v_voter;
end $$;

-- Read-only: safe for GET requests and link previews.
create function public.claim_preview(p_claim_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  select g.full_name into v_name
    from public.guest_claims c
    join public.guests g on g.id = c.guest_id
   where c.token_hash = p_claim_hash
     and c.used_at is null and c.revoked_at is null
     and c.expires_at > clock_timestamp()
     and g.removed_at is null;
  if v_name is null then
    return private.claim_failed(p_claim_hash);
  end if;
  return jsonb_build_object('ok', true, 'full_name', v_name);
end $$;

create function public.claim_guest(p_claim_hash text, p_session_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guest public.guests;
  v_claim uuid;
  v_now timestamptz;
  v_expires timestamptz;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN';
  end if;

  -- Lock order everywhere: guest first, then claim.
  select * into v_guest from public.guests g
   where g.id = (select c.guest_id from public.guest_claims c where c.token_hash = p_claim_hash)
     for no key update;
  v_now := clock_timestamp();
  select c.id into v_claim from public.guest_claims c
   where c.token_hash = p_claim_hash
     and c.used_at is null and c.revoked_at is null
     and c.expires_at > v_now
     for update;
  if v_claim is null or v_guest.id is null or v_guest.removed_at is not null then
    return private.claim_failed(p_claim_hash);
  end if;

  update public.guest_claims set used_at = v_now where id = v_claim;
  update public.guest_sessions set revoked_at = v_now
   where guest_id = v_guest.id and revoked_at is null;
  v_expires := private.new_session(v_guest.id, p_session_hash, v_now);

  return jsonb_build_object('ok', true, 'full_name', v_guest.full_name, 'expires_at', v_expires);
end $$;

-- Results --------------------------------------------------------------------

-- Aggregate totals only. Reached only through public_results(), which gates on status.
create function private.results() returns jsonb
language sql stable set search_path = '' as $$
  with tally as (
    select v.category_id, v.nominee_guest_id, count(*)::integer as total
      from public.votes v
      join public.guests voter on voter.id = v.voter_guest_id and voter.removed_at is null
      join public.guests nominee on nominee.id = v.nominee_guest_id and nominee.removed_at is null
     group by v.category_id, v.nominee_guest_id
  ),
  ranked as (
    select t.*, (rank() over (partition by t.category_id order by t.total desc))::integer as place
      from tally t
  )
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'category_id', c.id,
             'category_name', c.name,
             'category_description', c.description,
             'sort_order', c.sort_order,
             'nominee_name', g.full_name,
             'votes', coalesce(r.total, 0),
             'rank', r.place)
             order by c.sort_order, r.place, g.name_key),
           '[]'::jsonb)
    from public.award_categories c
    left join ranked r on r.category_id = c.id
    left join public.guests g on g.id = r.nominee_guest_id
$$;

-- Server only. The one gate for totals: nobody sees them until voting is closed.
create function public.public_results() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'published', s.voting_status = 'closed',
           'results', case when s.voting_status = 'closed' then private.results()
                           else '[]'::jsonb end)
    from public.event_settings s
$$;

-- Admin operations (authenticated + row in admins) ---------------------------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;

create function public.admin_dashboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (
    select jsonb_build_object(
             'registered', (select count(*) from public.guests),
             'eligible', (select count(*) from public.guests g where g.removed_at is null),
             'ballots_cast', (select count(*) from public.guests g
                               where g.removed_at is null and g.voted_at is not null),
             'registration_open', s.registration_open,
             'voting_status', s.voting_status,
             'max_active_guests', s.max_active_guests)
      from public.event_settings s);
end $$;

create function public.admin_list_guests() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (
    select coalesce(
             jsonb_agg(jsonb_build_object(
               'id', g.id,
               'full_name', g.full_name,
               'registered_at', g.registered_at,
               'has_voted', g.voted_at is not null, -- never the time
               'removed_at', g.removed_at,
               'removal_reason', g.removal_reason)
               order by g.name_key, g.registered_at),
             '[]'::jsonb)
      from public.guests g);
end $$;

-- Same gate as the public: admins cannot match votes to live changes in totals.
create function public.admin_results() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return public.public_results();
end $$;

create function public.admin_add_guest(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_name text;
  v_guest uuid;
begin
  perform private.lock_registration();
  v_name := private.clean_name(p_name);
  perform private.assert_can_activate(private.name_key(v_name));
  insert into public.guests (full_name, name_key, registered_at, added_by)
  values (v_name, private.name_key(v_name), clock_timestamp(), v_admin)
  returning id into v_guest;
  perform private.audit(v_admin, 'guest_added', v_guest, jsonb_build_object('full_name', v_name));
  return v_guest;
end $$;

create function public.admin_issue_claim(p_guest_id uuid, p_token_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_guest public.guests;
  v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN';
  end if;
  v_guest := private.lock_guest(p_guest_id);
  if v_guest.removed_at is not null then
    raise exception 'GUEST_REMOVED';
  end if;
  v_now := clock_timestamp();
  update public.guest_claims set revoked_at = v_now
   where guest_id = p_guest_id and used_at is null and revoked_at is null;
  insert into public.guest_claims (guest_id, token_hash, created_at, expires_at)
  values (p_guest_id, p_token_hash, v_now, v_now + interval '24 hours');
  perform private.audit(v_admin, 'claim_issued', p_guest_id,
    jsonb_build_object('expires_at', v_now + interval '24 hours'));
  return v_now + interval '24 hours';
end $$;

create function public.admin_remove_guest(p_guest_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := btrim(p_reason);
  v_guest public.guests;
begin
  if v_reason is null or char_length(v_reason) not between 1 and 500 then
    raise exception 'REASON_REQUIRED';
  end if;
  v_guest := private.lock_guest(p_guest_id);
  if v_guest.removed_at is not null then
    raise exception 'GUEST_REMOVED';
  end if;
  update public.guests
     set removed_at = clock_timestamp(), removed_by = v_admin, removal_reason = v_reason
   where id = p_guest_id;
  update public.guest_claims set revoked_at = clock_timestamp()
   where guest_id = p_guest_id and used_at is null and revoked_at is null;
  perform private.audit(v_admin, 'guest_removed', p_guest_id, jsonb_build_object('reason', v_reason));
end $$;

create function public.admin_restore_guest(p_guest_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_guest public.guests;
begin
  perform private.lock_registration();
  v_guest := private.lock_guest(p_guest_id);
  if v_guest.removed_at is null then
    raise exception 'GUEST_NOT_REMOVED';
  end if;
  perform private.assert_can_activate(v_guest.name_key);
  update public.guests set removed_at = null, removed_by = null, removal_reason = null
   where id = p_guest_id;
  -- keep the removal history, which the row itself no longer holds
  perform private.audit(v_admin, 'guest_restored', p_guest_id, jsonb_build_object(
    'removed_at', v_guest.removed_at, 'removed_by', v_guest.removed_by,
    'removal_reason', v_guest.removal_reason));
end $$;

-- A null argument leaves that setting unchanged. Closing needs p_confirm_close.
-- Leaving `closed` needs p_confirm_reopen and a reason: results hide again, but
-- anyone who already saw them cannot unsee them.
create function public.admin_update_event_settings(
  p_registration_open boolean default null,
  p_voting_status text default null,
  p_max_active_guests integer default null,
  p_confirm_close boolean default false,
  p_confirm_reopen boolean default false,
  p_reopen_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_old public.event_settings;
  v_new public.event_settings;
  v_closing boolean;
  v_reopening boolean;
  v_reason text := btrim(p_reopen_reason);
begin
  if p_voting_status not in ('not_started', 'open', 'paused', 'closed')
     or p_max_active_guests not between 1 and 2000
  then
    raise exception 'INVALID_SETTINGS';
  end if;
  select * into v_old from public.event_settings for update;
  v_closing := v_old.voting_status <> 'closed' and coalesce(p_voting_status = 'closed', false);
  v_reopening := v_old.voting_status = 'closed' and coalesce(p_voting_status <> 'closed', false);
  if v_closing and p_confirm_close is not true then
    raise exception 'CONFIRM_CLOSE_REQUIRED';
  end if;
  if v_reopening then
    if p_confirm_reopen is not true then
      raise exception 'CONFIRM_REOPEN_REQUIRED';
    end if;
    if v_reason is null or char_length(v_reason) not between 1 and 500 then
      raise exception 'REASON_REQUIRED';
    end if;
  end if;
  update public.event_settings s
     set registration_open = coalesce(p_registration_open, s.registration_open),
         voting_status = coalesce(p_voting_status, s.voting_status),
         max_active_guests = coalesce(p_max_active_guests, s.max_active_guests),
         updated_at = clock_timestamp()
   where s.id
  returning * into v_new;
  perform private.audit(v_admin,
    case when v_closing then 'voting_closed'
         when v_reopening then 'voting_reopened'
         else 'settings_updated' end,
    null,
    jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new))
      || case when v_reopening then jsonb_build_object('reason', v_reason) else '{}'::jsonb end);
  return jsonb_build_object(
    'registration_open', v_new.registration_open,
    'voting_status', v_new.voting_status,
    'max_active_guests', v_new.max_active_guests);
end $$;

-- Function permissions -------------------------------------------------------
-- Postgres and Supabase grant execute broadly by default: revoke, then grant.

revoke all on all functions in schema private from public, anon, authenticated, service_role;

revoke all on function
  public.register_guest(text, text), public.guest_me(text), public.ballot_nominees(text),
  public.submit_ballot(text, jsonb), public.claim_preview(text), public.claim_guest(text, text),
  public.public_results(), public.is_admin(), public.admin_dashboard(), public.admin_list_guests(),
  public.admin_results(), public.admin_add_guest(text), public.admin_issue_claim(uuid, text),
  public.admin_remove_guest(uuid, text), public.admin_restore_guest(uuid),
  public.admin_update_event_settings(boolean, text, integer, boolean, boolean, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.register_guest(text, text), public.guest_me(text), public.ballot_nominees(text),
  public.submit_ballot(text, jsonb), public.claim_preview(text), public.claim_guest(text, text),
  public.public_results()
to service_role;

grant execute on function
  public.is_admin(), public.admin_dashboard(), public.admin_list_guests(),
  public.admin_results(), public.admin_add_guest(text), public.admin_issue_claim(uuid, text),
  public.admin_remove_guest(uuid, text), public.admin_restore_guest(uuid),
  public.admin_update_event_settings(boolean, text, integer, boolean, boolean, text)
to authenticated;
