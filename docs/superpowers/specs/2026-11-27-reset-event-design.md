# Reset event: design

Approved November 27, 2026.

## Intent

Organizers wipe test data from the app, so the event starts fresh without running SQL.

## Behavior

- A **Reset event** section at the bottom of the admin dashboard.
- Deletes all votes, guests, guest sessions, claim records, claim failures and admin audit records.
- Sets registration closed, voting `not_started`, guest limit 400.
- Keeps award categories, organizer accounts, and the event name and date.
- The organizer types `RESET` to confirm.
- Refused while registration is open, or voting is open or paused.

## Goals, non-goals, anti-goals

- Goal: one complete, all-or-nothing reset.
- Non-goals: deleting single guests or votes, undo, automatic backups, a date lock.
- Anti-goal: a partial reset, or a reset by anyone who is not an organizer.

## Approaches

1. **One organizer-only database function, `admin_reset_event`** (picked): checks and deletes in
   one transaction.
2. Deletes from app code: can stop halfway, and needs table access the app does not have.
3. Per-guest delete buttons: does not start the event anew.

## Constraints

- The function follows the other admin functions: `security definer`, empty `search_path`,
  `private.require_admin()`, execute granted to `authenticated` only.
- It ships as a new migration. Existing migrations are applied and are not edited.
- Applying it to the hosted project and pushing to GitHub each need approval.
- Update the deployment checklist, section 7, to name the button.

## Accepted risk

After closing, an organizer can still erase real votes, including after December 2. There is no undo.

## Left to the builder

Wording, error messages and test layout.
