-- Approved categories and initial settings. Safe to run again: existing rows are kept.
-- Registration starts closed; the admin opens it.

insert into public.award_categories (name, description, sort_order) values
  ('Spotlight Stealer Award', 'presence and charisma.', 1),
  ('The Eyes-On-Me Award', 'confidence, and captivating personality.', 2),
  ('Fashion Icon Award', 'exceptional style, elegance, and outstanding fashion sense.', 3)
on conflict do nothing;

insert into public.event_settings (id, event_name, event_date)
values (true, 'Dinner Awards 2026', date '2026-12-02')
on conflict (id) do nothing;

-- First administrator (run by hand, after creating the user in Supabase Auth):
--   insert into public.admins (user_id)
--   select id from auth.users where email = '<admin email>';
