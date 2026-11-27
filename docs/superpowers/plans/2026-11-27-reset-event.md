# Reset event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Organizers reset the event from the dashboard.

**Architecture:** A new migration adds `public.admin_reset_event`. A dashboard form calls it through the existing `run()` action helper.

**Tech Stack:** Postgres (Supabase), Next.js server actions, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-27-reset-event-design.md`

## Global Constraints

- Existing migrations are not edited.
- `security definer`, empty `search_path`, `private.require_admin()`, execute to `authenticated` only.
- No push and no hosted migration without approval.

## Review Focus

- Wrong confirmation word: nothing deleted.
- Registration open, or voting open or paused: nothing deleted.
- Non-organizer: refused.

### Task 1: Database function

**Files:** create `supabase/migrations/20261127000000_reset_event.sql`; modify `tests/db/database.test.mjs`.

**Produces:** `public.admin_reset_event(p_confirm text) returns void`. Errors: `CONFIRM_RESET_REQUIRED`, `RESET_BLOCKED`.

- [ ] Add failing tests: the three refusals keep all rows; success empties six tables and restores settings.
- [ ] Run `npm run test:db`; expect failure.
- [ ] Write the migration; run again; expect pass.

### Task 2: Dashboard

**Files:** modify `app/admin/actions.ts`, `app/admin/controls.tsx`, `tests/web/admin.test.mjs`, `docs/deployment-checklist.md`.

**Produces:** `resetEvent(_: AdminState, form: FormData)`; form field `confirm`.

- [ ] Add a web test: an organizer posts "Reset event" with `RESET` and the guest list empties.
- [ ] Add the action and the section; run `npm run test:web`, `npm run lint`, `npx tsc --noEmit`.
- [ ] Update checklist section 7.
