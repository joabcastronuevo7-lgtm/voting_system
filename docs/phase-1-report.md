# Phase 1 final report: database foundation

## Current project state (updated 2026-11-27)

Everything below this section is the November 26 record of phase 1. Where they differ, this
section and `deployment-checklist.md` are current.

| Area | State |
|---|---|
| Application | Guest registration and voting, organizer panel, claim links and winners presentation are built. This includes the close and reopen confirmations that phase 1 left for later. |
| Database | The two phase 1 migrations are unchanged by the later work. **Not applied to the hosted project.** |
| Real Data API calls and organizer sign-in | Covered by local tests. Not tried on a hosted project. |
| Hosted project | Read on November 27, nothing changed: no tables, no migrations, Postgres 17. |
| Git | Branch `master`, no remote. The application commit was prepared on November 27. If `git log --oneline` shows only the starter commit, it is not committed yet. |
| Backups | Procedure written. Local restore rehearsed in a rolled-back transaction. **Hosted recovery unproven.** Backups link voters to their ballots and must be encrypted and access-restricted. |
| Deployment | Not deployed. Real devices and projector untested. |

---

Date of the report below: 2026-11-26.

## Operational confirmation (as of November 26)

No live migration, live database change, admin account creation, deployment, push or commit
occurred. All database work ran on the local database at `127.0.0.1`. The folder has no linked
project, no git remote, no `.env.local` and only the starter commit. The live project was never
inspected.

## Latest direction applied

| Topic | Behavior now |
|---|---|
| Closing voting | Needs `p_confirm_close`. Audited as `voting_closed` with admin and time. |
| Reopening | Allowed. Needs `p_confirm_reopen` and a reason (1 to 500 characters). Audited as `voting_reopened`. Results hide at once. |
| Claim limits | About 10 recorded failures a minute per link and 600 overall. A valid link is never blocked. Every unusable link gets the same `INVALID_CLAIM`. No IP address or forwarding header is used. |
| Simplified | Removed the token-row guard trigger, the irreversible-closure trigger, the shared 30-attempt block, the claim lock and duplicate tests. |
| Category ids | Standard generated UUIDs (the text-id addition was dropped). |

**Phase 4 must build:** a close confirmation, and a separate reopen dialog with a reason field that
warns: results already seen cannot be made confidential again. The database enforces the flags;
the dialogs do not exist yet.

## What the claim limits do and do not do

A wrong or used link is rejected with or without a limit, and a correct link always works. The
limits only cap how many failure records are stored (they are approximate during a burst, because
the lock was removed). They do not stop request flooding; that belongs at the hosting edge.

## Database functions

Server key (`service_role`) only:

| Function | Behavior |
|---|---|
| `register_guest(name, session_hash)` | Needs registration open, valid unique name, under the guest limit, under 30 a minute. Creates guest and 30 day session. |
| `guest_me(session_hash)` | Own name, voted flag, voting status, registration flag. |
| `ballot_nominees(session_hash)` | Other active guests, only while open and not yet voted. |
| `submit_ballot(session_hash, picks)` | Exactly one nominee per category, no self-vote, only active nominees, one ballot. All or nothing. |
| `claim_preview(claim_hash)` | Guest name for a valid link. Does not consume it. |
| `claim_guest(claim_hash, session_hash)` | Consumes the link, revokes older sessions, issues a new one. |
| `public_results()` | `{published:false, results:[]}` unless voting is `closed`; then totals and ranks. |

Signed-in admin only (each checks the `admins` table):

| Function | Behavior |
|---|---|
| `is_admin()` | True or false. |
| `admin_dashboard()` | Registered, eligible, ballots cast, settings. |
| `admin_list_guests()` | Names, registration time, voted flag (no time), removal details. |
| `admin_results()` | Same answer as `public_results()`. |
| `admin_add_guest(name)` | Adds a guest within name and limit rules. |
| `admin_issue_claim(guest_id, claim_hash)` | 24 hour single-use link; cancels older unused ones. |
| `admin_remove_guest(guest_id, reason)` | Soft removal with reason; cancels unused links. |
| `admin_restore_guest(guest_id)` | Refuses duplicate name or full event. |
| `admin_update_event_settings(registration, status, limit, confirm_close, confirm_reopen, reason)` | Null leaves a setting unchanged. |

Twelve helpers in the `private` schema are not callable by any API role; each is used by a function
or trigger above.

## Inspection

- Row level security on 9 of 9 tables, no policies, no table access for any API role.
- `anon` can execute nothing. Server and admin functions do not overlap.
- Audit actions: `guest_added`, `claim_issued`, `guest_removed`, `guest_restored`,
  `settings_updated`, `voting_closed`, `voting_reopened`. No API role can read or change the log.
  Token hashes are not logged. Changes made directly in the database are not audited.
- Rollback leaves no functions, relations or `private` schema (tested). It deletes all event data,
  needs explicit confirmation and does not edit migration history: after a CLI apply, run
  `supabase migration repair --status reverted 20261126000000 20261126000001`.
- Found and fixed: invisible characters written literally in the name-cleaning pattern are now
  visible escapes.

## Final migration and rollback review

- **Fixed, serious:** run without confirmation through `psql`, the rollback reported a refusal and
  then deleted all nine tables, because `psql` continues after an error. The script is now one
  transaction. A test runs it through `psql` and checks nothing is deleted; it failed before the fix.
- Running both migrations a second time on an applied database produced "already exists" errors;
  afterwards there were still 9 tables, 3 categories and 0 `verify.sql` problems.
- The migrations themselves have no explicit transaction. Apply them with the Supabase CLI or the
  SQL editor, not plain `psql`.
- Four SQL files contain only ASCII characters. Lint has no warnings.
- Not done yet: backups, recovery procedure and rehearsal.

## Verification

| Check | Result |
|---|---|
| `npm run test:db`, local Supabase Postgres 17.12 | 74 pass, 0 fail, 5 runs in a row |
| Guards deliberately broken one at a time | 23 of 23 caught (before the rollback fix and pattern cleanup, which change no rule) |
| `supabase db reset`, `verify.sql` | clean, 0 problems |
| `supabase db lint`, `supabase db advisors` | no issues |
| `npm run lint`, `tsc --noEmit`, `npm run build` | pass |
| `npm audit` | 0 vulnerabilities |

## Differences from the specification

1. Functions take SHA-256 hashes, not raw tokens.
2. Lists and results are single JSON values (avoids the 1000 row API default).
3. Registration starts closed.
4. Extra `claim_failures` table, `guests.added_by`, `guests.removal_reason`,
   `guest_claims.revoked_at`.
5. New claim links cancel old ones; removal keeps sessions so restoration signs the guest back in.
6. The guest limit also applies to manual addition and restoration.
7. One person may be chosen in several categories.
8. Privacy: the admin sees voted or not voted only; nobody sees totals until `closed`.
9. Closing and reopening need confirmations; reopening needs a reason.
10. Extra functions (accepted), nominee list only while open (accepted), results only through the
    server (accepted).

## Changed files

Modified: `.gitignore`, `package.json`, `package-lock.json`. New: `.env.example`,
`docs/phase-1-report.md`, `lib/contracts.ts`, `lib/supabase/` (3 files), `supabase/` (config,
ignore file, 2 migrations, rollback, `verify.sql`), `tests/db/` (2 files).

## Remaining limitations (as of November 26; see current state above)

- Real Data API calls and real admin sign-in are untested; roles were simulated inside Postgres.
- The live project's identity, version and existing objects are unchecked.
- Backups and a rehearsed recovery plan do not exist yet (before the event).
- An admin can reopen, so totals seen earlier can be compared with later ones.
- Removing a voter after closing changes totals by their ballot.
- One abuser can use up the registration limit or fill the guest limit; close registration if so.
- Look-alike letters pass the duplicate name check.
- The OneDrive folder would sync `.env.local`.

## Live apply, only after your approval

Superseded: follow `deployment-checklist.md`.

1. You move `voting-app` outside OneDrive, create `.env.local`, and turn off public sign-ups.
2. We confirm the project reference and apply method.
3. I apply both migrations and run `supabase/verify.sql`.
4. You create the admin user, then run the insert at the end of the seed file.
