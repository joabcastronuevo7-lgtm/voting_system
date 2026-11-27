-- Read-only security check. Safe on the live database. Zero rows means pass.
with
roles(role) as (values ('anon'), ('authenticated'), ('service_role')),
tables(name) as (values
  ('public.admins'), ('public.award_categories'), ('public.event_settings'), ('public.guests'),
  ('public.guest_sessions'), ('public.guest_claims'), ('public.claim_failures'), ('public.votes'),
  ('public.admin_audit_logs')),
functions(signature, allowed) as (values
  ('public.register_guest(text,text)', 'service_role'),
  ('public.guest_me(text)', 'service_role'),
  ('public.ballot_nominees(text)', 'service_role'),
  ('public.submit_ballot(text,jsonb)', 'service_role'),
  ('public.claim_preview(text)', 'service_role'),
  ('public.claim_guest(text,text)', 'service_role'),
  ('public.public_results()', 'service_role'),
  ('public.is_admin()', 'authenticated'),
  ('public.admin_dashboard()', 'authenticated'),
  ('public.admin_list_guests()', 'authenticated'),
  ('public.admin_results()', 'authenticated'),
  ('public.admin_add_guest(text)', 'authenticated'),
  ('public.admin_issue_claim(uuid,text)', 'authenticated'),
  ('public.admin_remove_guest(uuid,text)', 'authenticated'),
  ('public.admin_restore_guest(uuid)', 'authenticated'),
  ('public.admin_update_event_settings(boolean,text,integer,boolean,boolean,text)', 'authenticated'),
  ('public.admin_reset_event(text)', 'authenticated')),
expected_categories(name, description) as (values
  ('Spotlight Stealer Award', 'presence and charisma.'),
  ('The Eyes-On-Me Award', 'confidence, and captivating personality.'),
  ('Fashion Icon Award', 'exceptional style, elegance, and outstanding fashion sense.'))

select 'missing table ' || name as problem from tables where to_regclass(name) is null
union all
select 'row level security off: ' || t.name
  from tables t join pg_class c on c.oid = to_regclass(t.name) where not c.relrowsecurity
union all
select format('%s has direct access to %s', r.role, t.name)
  from tables t cross join roles r
 where has_table_privilege(r.role, to_regclass(t.name),
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege(r.role, to_regclass(t.name), 'SELECT,INSERT,UPDATE,REFERENCES')
union all
select format('unexpected policy %s on %s', p.policyname, p.tablename)
  from pg_policies p join tables t on t.name = p.schemaname || '.' || p.tablename
union all
select 'missing function ' || signature from functions where to_regprocedure(signature) is null
union all
select format('%s execute on %s should be %s', r.role, f.signature, r.role = f.allowed)
  from functions f cross join roles r
 where has_function_privilege(r.role, to_regprocedure(f.signature), 'EXECUTE')
       <> (r.role = f.allowed)
union all
select r.role || ' can use schema private'
  from roles r where has_schema_privilege(r.role, to_regnamespace('private'), 'USAGE')
union all
select 'security definer without fixed search_path: ' || p.oid::regprocedure
  from pg_proc p
 where p.prosecdef
   and (p.pronamespace = to_regnamespace('private')
        or p.oid in (select to_regprocedure(signature) from functions))
   and not exists (select 1 from unnest(p.proconfig) as c where c = 'search_path=""')
union all
select 'category missing or reworded: ' || e.name
  from expected_categories e
 where not exists (select 1 from public.award_categories a
                    where a.name = e.name and a.description = e.description)
union all
select 'unexpected category: ' || a.name
  from public.award_categories a
 where a.name not in (select name from expected_categories);
