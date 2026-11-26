# Admin panel and claim links: design

Approved on 2026-11-26.

## Intent

Organizers run the dinner (December 2, 2026) from a small panel on their phones. Guests keep the existing flow.

## Goals

- Admin sign-in and authorization.
- Dashboard: registered, eligible and voted counts, turnout, event status.
- Guest management: Voted / Not voted, add, remove, restore.
- Registration open and close. Voting open, pause, resume, close, reopen.
- Individual claim links so a guest can move to another browser, with explicit confirmation.

## Non-goals

- Results page, guest limit setting, admin signup.
- QR codes for claim links. A copyable URL is enough.
- New migrations or dependencies.

## Must never happen

- Any screen shows an individual ballot choice.
- Any aggregate result is shown before voting closes.
- Guest pages stop being mobile-first.

## Shared guest QR code (mandatory)

One QR code for the whole dinner, pointing to the public registration page `/`.
It is generated once, after deployment, from the final production HTTPS URL (never localhost).
No application code or project dependency is needed. Generate it with a one-off tool at
deployment (ask before downloading one), then scan the printed copy with a real phone.

## Approaches

1. Server components and server actions calling the existing `admin_*` functions as the signed-in
   admin. **Chosen:** auth cookie stays HttpOnly and the database enforces admin rights.
2. Browser Supabase client: breaks the HttpOnly cookie.
3. Secret key for admin work: bypasses `auth.uid()`, so the admin functions reject it.

## Pages

| Page | Content |
|---|---|
| `/admin/login` | Email and password through Supabase Auth |
| `/admin` | Counts and turnout, registration and voting controls. Closing needs a confirmation; reopening needs a confirmation and a reason. |
| `/admin/guests` | Search, filter, add, remove (reason required), restore, create claim link |
| `/claim/<token>` | Guest sees the name and taps Confirm |

## Decisions

- Admin accounts are created in Supabase and added to `public.admins` by hand.
- A claim link is shown once, lasts 24 hours and works once. A newer link replaces an older one.
- Claiming uses the token the browser already holds (as registration does), so a lost response
  does not strand the guest.

## Accepted risk

An organizer can open a claim link for a guest who has not voted, then vote as that guest.
Link creation is recorded in the audit log. Give admin access only to trusted organizers.

## Before the event (outside this change)

Apply to the live project only with explicit approval: create admin users, turn off public
sign-ups in Supabase Auth, set `NEXT_PUBLIC_SITE_URL` to the production HTTPS URL.
