# Final deployment checklist: Dinner Awards, December 2, 2026

The application is ready locally. It is **not** proven in production. Steps marked
**APPROVE** change something live, or the Git history, and need explicit approval each time.

## Status on November 27, 2026

| Area | Status |
|---|---|
| Application | Built; local automated tests pass |
| Git | Branch `master`, no remote. Application committed locally as `8dab8a2`. |
| Hosted Supabase project `voting system` (`pssvsfhiybjgjbjtcsoa`) | Folder linked. **Both migrations applied.** `verify.sql`: zero rows. 9 tables, 3 categories, 1 Auth user, 1 organizer, 0 guests, 0 votes, registration closed, voting `not_started`, guest limit 400. Data API reachable; the public key is refused by the functions. App not tried against it. |
| Sign-ups | Off, verified from the project's public Auth settings (`disable_signup: true`), email provider on, anonymous sign-ins off. |
| Backup restore | Rehearsed locally inside a rolled-back transaction. **Hosted recovery unproven.** |
| Deployment, real devices, projector | Not started |

Commands run in `voting-app`. They use Supabase CLI 3.4.0, where `--remote` targets the
linked project and the default is the local stack.

## 0. Decide first

- [ ] Registration is limited to **30 new guests per minute** for everyone together. A full
      400-guest room needs at least 14 minutes. Open registration early, tell guests, or
      decide to change the limit (needs a migration).
- [ ] Gala design pass: still open.
- [ ] Choose the host and the domain. The domain cannot change after the QR code is printed.

## 1. Local gate

- [ ] `npx supabase start` (Docker running).
- [ ] `npm run test:db`, `npm run test:api`, `npm run test:web` (needs Chrome or Edge).
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm audit`.
- [x] Application committed locally (`8dab8a2`). The only copy is still this folder.
- [ ] Keep a second copy: a private Git remote (**APPROVE** before any push), needed anyway if
      the host deploys from Git. Never commit `.env` files or backups.

## 2. Hosted Supabase project

- [x] Confirm it is the intended new project and that it is empty.
- [x] Postgres major version is 17, as in `supabase/config.jsonc`.
- [ ] Check the plan: whether idle projects are paused, and what backups it includes.
- [ ] **Never run `supabase config push`.** `supabase/config.jsonc` describes the local stack;
      pushing it would send local Auth settings, with sign-ups enabled, to the hosted project.
- [x] `npx supabase login` and `npx supabase link`.
- [x] Both migrations applied on November 27 and listed as applied. Do not push seeds with
      `--include-seed`: the seed is already a migration.
- [x] `supabase/verify.sql` returned **zero rows**.
- [x] The Data API is on and reaches the `public` functions.
- [x] The one existing Auth user was confirmed by the owner and added as organizer.
- [x] Auth: "Allow new users to sign up" turned off and saved; email provider on. Verify again
      before the event: `https://pssvsfhiybjgjbjtcsoa.supabase.co/auth/v1/settings`, called
      with the publishable key, reports `"disable_signup": true`.
- [ ] Only if more organizers are needed, **APPROVE** creating their accounts in Auth with long
      unique passwords and "Auto Confirm" (you do this), then for each one:
      `insert into public.admins (user_id) select id from auth.users where email = '<admin email>';`
- [ ] `select count(*) from public.admins;` matches the number of organizers.

## 3. Backup and recovery

> **A database backup shows how every guest voted.** `data.sql` links each voter to their
> chosen nominees, although no screen in the application does. **Every backup must be
> encrypted and access-restricted.**

`data.sql` holds:

- guest names, and each ballot linked to its voter;
- guest session and claim token hashes, and the admin audit log;
- Auth users with email addresses and **password hashes**, identities and Auth audit logs;
- expected, but not seen in the local test: Auth sessions and refresh tokens, which can give
  access to an organizer sign-in.

`schema.sql` holds the `public` and `private` schemas, not the Auth tables.

Rules:

- Never put a backup in Git, this OneDrive folder or any synced, shared or public location.
- Name who may hold backups (as few people as possible) and the date they will be destroyed.
- Keep the archive password separate from the archive. Without it the backup is lost.

### Take a backup

Commands for 7-Zip (installed on this laptop). Not yet tried with these files. The plain
files exist unencrypted until deleted, so do all steps in one sitting.

- [ ] Create `C:\dinner-backup`; confirm only your Windows account can open it and no sync
      tool covers it.
- [ ] `npx supabase db dump --remote -f C:\dinner-backup\schema.sql`
- [ ] `npx supabase db dump --remote --data-only --use-copy -f C:\dinner-backup\data.sql`
- [ ] Confirm `data.sql` holds all `public` tables and `auth.users`.
- [ ] Encrypt, including file names (it asks for the password):
      `& "C:\Program Files\7-Zip\7z.exe" a -mhe=on -p C:\dinner-backup\<date-time>.7z C:\dinner-backup\schema.sql C:\dinner-backup\data.sql`
- [ ] Test the archive: `& "C:\Program Files\7-Zip\7z.exe" t C:\dinner-backup\<date-time>.7z`
- [ ] Only after the test passes, delete `schema.sql` and `data.sql` and empty the Recycle Bin
      if they went there.
- [ ] Schedule backups: before opening registration, before opening voting, and
      immediately after closing it.

### Restore: what is proven

On November 27, local sample data was dumped, the tables were emptied, the dump was loaded
and the transaction rolled back. All 13 checked `public` and Auth tables matched row for row.

**Not proven:** restoring into a fresh installation or a hosted project, restoring
`schema.sql`, signing in after a restore, and a dump taken from the hosted project.

The load succeeded only as the local `supabase_admin` role. As `postgres` it failed with
"permission denied" on a storage table, which the test had tried to empty. Hosted projects
do not give you `supabase_admin`.

- [ ] **Open risk: prove hosted recovery.** Test whether `postgres` can restore when only the
      `public` and Auth tables are emptied and loaded. Use a disposable target, never the live
      project, and treat its copy of the data as a backup. Write down the commands that work.
- [ ] The seeded categories get new random ids on every install and votes refer to them, so a
      restore must replace the seeded rows, in one transaction that stops on the first error.
- [ ] Verify: row counts match, an organizer can sign in, the dashboard shows the same totals.
- [ ] `supabase/rollback/initial_schema.down.sql` **deletes everything**. It is not a
      recovery step.

## 4. Deploy on Vercel

Vercel's screen names may differ slightly. Nothing here has been tried on Vercel, and no
Linux build has been run; the lockfile does list the Linux build packages.

### Source

- [ ] **APPROVE** Create a **private** Git repository and add it as the remote.
- [ ] **APPROVE** Commit any pending changes, then push `master`.
- [ ] Check the plan's usage terms: free hosting plans may be limited to non-commercial use.

### Project settings

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root directory | repository root |
| Install, build and output commands | defaults |
| Node.js version | 24.x (tested locally on 24.11.1) |
| Function region | Tokyo (`hnd1`), next to the database. Check it: the default is elsewhere. |

No `vercel.json` is needed. Keep `cacheComponents` off.

### Environment variables

Add all four **before the first build**, for the **Production** environment only. Preview
builds would otherwise write to the live event database.

| Name | Value | Mark as sensitive |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pssvsfhiybjgjbjtcsoa.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase, project settings, API keys: the **publishable** key (`sb_publishable_…`) | no |
| `SUPABASE_SECRET_KEY` | Same page: the **secret** key (`sb_secret_…`) | **yes** |
| `NEXT_PUBLIC_SITE_URL` | The production address, `https://<domain>`, no trailing slash | no |

- Enter the secret key yourself, directly in Vercel. Never in chat, Git, a `NEXT_PUBLIC_`
  name or this OneDrive folder.
- The `NEXT_PUBLIC_` values are built into the app: after changing one, redeploy.
- Choose the project name or domain first, so that the site address is known. After the
  first deploy, confirm it matches; if not, correct it and redeploy.
- Claim links use `NEXT_PUBLIC_SITE_URL`. The QR code uses the same final address.

### Deploy

- [x] Sign-ups confirmed off (section 2).
- [ ] **APPROVE** Deploy. Importing a repository in Vercel normally deploys at once, so fill
      in the variables on that screen before pressing **Deploy**.
- [ ] Confirm the production address opens without a Vercel login, for guests and reviewers.
- [ ] Later pushes to the production branch deploy automatically: do not push during the event.
- [ ] Limit who can read the project's logs and check retention: claim link paths appear in
      them (see `event-readiness.md`).
- [ ] Reviewers use the live event database. Use test names, and reset before the event
      (section 7).

## 5. Check the live site

Use test names only.

- [ ] `https://` address shows the registration form; `/admin` redirects to sign-in.
- [ ] Cookie `__Host-guest_session` is `Secure`, `HttpOnly`, `SameSite=Lax`.
- [ ] On a real iPhone and a real Android phone, on mobile data and weak Wi-Fi:
      register, reload, try a duplicate name.
- [ ] Tap early, before the page finishes loading, on registration and on a nominee.
- [ ] Organizer on a phone: sign in, add, remove, restore, create a claim link, **Copy link**.
- [ ] Open the link in another browser: opening does not use it, Confirm moves the guest,
      the old browser is signed out, the link then fails.
- [ ] Open, pause, resume, vote, close. No totals or choices visible before closing.
- [ ] Take an encrypted backup of this test data and try the restore on it (section 3).

## 6. Shared QR code

- [ ] Follow "The shared guest QR code" in `event-readiness.md`: final production `/` only.
- [ ] Scan the printed copy with both phones.

## 7. Rehearsal, then reset

- [ ] Full run with several people registering at once, including the rate limit message.
- [ ] Decide who opens and closes registration and voting, and who issues claim links.
- [ ] Prepare a fallback for a venue network failure.
- [ ] Back up. Then **APPROVE** clearing rehearsal data in the SQL editor. This permanently
      deletes every guest, session, claim, vote and audit record:

```sql
begin;
truncate public.votes, public.guest_sessions, public.guest_claims, public.claim_failures,
         public.admin_audit_logs, public.guests;
update public.event_settings
   set registration_open = false, voting_status = 'not_started', max_active_guests = 400;
commit;
```

- [ ] Confirm the dashboard shows 0 guests, registration closed, voting not started.
- [ ] After this reset, never run it again once real guests register.

## Event day

- [ ] Backup. Open registration. Watch the guest count against the limit of 400.
- [ ] Open voting; pause if something is wrong.
- [ ] Close voting once (it needs confirmation). Back up immediately.
- [ ] Check the results on the winners screen, then press **Start presentation**.

## Winners presentation

> **Once the presentation begins, do not reopen voting and do not add, remove or restore
> guests.** The winners are loaded once. An open screen cannot take them back, and removing
> a guest changes who wins.

Corrections are possible only **before** the presentation begins: make the change, close
voting again if it was reopened, reload the screen and check every winner.

Rehearse on the real laptop and projector:

- [ ] Use a separate browser profile for the projector. It needs an organizer sign-in, and
      that sign-in can reach the dashboard. Sign out afterwards.
- [ ] Open the screen: dashboard, **Open winners presentation** (shown only while closed),
      or `/admin/presentation`. Then **Full screen**.
- [ ] Check the order: holding screen, **Start presentation**, one award at a time, all three.
- [ ] Test the clicker or keys: arrows, Page Up/Down, Space. Nothing moves before Start.
- [ ] Try every other clicker button. Some send F5, which reloads to the holding screen and
      needs the network, or Esc, which leaves full screen. Tape over or avoid those.
- [ ] Load the screen before the program starts reveals: after loading, reveals need no
      network. A reload does need it, and returns to the holding screen.
- [ ] Stop the laptop from sleeping or showing notifications.
- [ ] Agree on how a tie is announced. Every tied name is shown. A very large tie may need
      scrolling.
