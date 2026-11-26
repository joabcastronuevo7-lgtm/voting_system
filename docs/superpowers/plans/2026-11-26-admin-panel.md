# Admin Panel and Claim Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers can run the event, and a guest can move to a new browser with a claim link.

**Architecture:** Server components and server actions. Admin work runs through `createAdminClient()` calling existing `admin_*` functions; claim work runs through `createSecretClient()`.

**Tech Stack:** Next.js 16.4.6 (cacheComponents), @supabase/ssr, node:test.

**Spec:** `docs/superpowers/specs/2026-11-26-admin-panel-design.md`

## Global Constraints

- No new migrations, no new dependencies.
- No individual ballot choices; no aggregate results anywhere in this change.
- No live database changes, deployment, push or commit (so no commit steps).
- Mobile-first; reuse the classes in `app/globals.css`.
- Request data is read inside `<Suspense>`, as the guest pages do.

## Review Focus

1. A stale dashboard on a second phone sends "Pause" after voting closed: rejected, stays closed.
2. A link preview or reload opens a claim link: the link stays unused.
3. The claim response is lost: the same browser is already signed in.
4. A signed-in non-admin posts to admin pages: nothing changes.
5. An expired admin access token: refreshed by the proxy, not a sudden sign-out.

## Tasks

All tests live in `tests/web/admin.test.mjs`, sharing server and form helpers in
`tests/web/helpers.mjs` (moved out of `registration.test.mjs`). Run with `npm run test:web`;
each test must fail before its code exists and pass after.

### Task 1: Sign-in and authorization
- [ ] Tests: signed-out `/admin` and `/admin/guests` redirect to `/admin/login`; wrong password shows an error; non-admin is refused and holds no session; admin reaches `/admin`; sign-out ends access.
- [ ] `lib/admin.ts`: `requireAdmin(): Promise<SupabaseClient>` redirects unless `auth.getUser()` succeeds and `is_admin()` is true.
- [ ] `app/admin/actions.ts`: `signIn`, `signOut`. `app/admin/login/page.tsx` and `login-form.tsx`.
- [ ] `proxy.ts`: add `/admin/:path*`; refresh the Supabase auth cookie there. Guest token logic unchanged.

### Task 2: Dashboard and controls
- [ ] Tests: counts shown; registration opens and closes; open, pause, resume; close without the checkbox is rejected; reopen needs checkbox and reason; stale "Pause" after close is rejected.
- [ ] `app/admin/page.tsx` (`admin_dashboard`), `app/admin/controls.tsx`, action `updateSettings` (`admin_update_event_settings`), `app/admin/nav.tsx`.

### Task 3: Guest management
- [ ] Tests: list shows Voted / Not voted and no nominee data; add; duplicate name error; remove needs a reason; restore; claim link is a `${NEXT_PUBLIC_SITE_URL}/claim/<43 chars>` URL; non-admin post changes nothing.
- [ ] `app/admin/guests/page.tsx`, `guest-list.tsx`, actions `addGuest`, `removeGuest`, `restoreGuest`, `issueClaim` (token from `newToken()`, only `hashToken(token)` stored).

### Task 4: Claim page
- [ ] Tests: GET leaves the link unused; confirm signs the browser in and revokes the old session; reuse fails; lost response leaves the browser signed in; a browser signed in as someone else gets a new token and can confirm on the second tap; junk token shows the invalid message.
- [ ] `app/claim/[token]/page.tsx`, `confirm-form.tsx`, `actions.ts` (`claim`), `proxy.ts` matcher `/claim/:path*`. `referrer: "no-referrer"`, `robots: noindex`.

### Task 5: Verify
- [ ] `npm run test:db`, `test:api`, `test:web`, `lint`, `npx tsc --noEmit`, `npm run build`.
- [ ] Walk through login, dashboard, guests and claim at phone width in the browser.
