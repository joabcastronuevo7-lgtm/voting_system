# Event readiness notes

Every live step below needs explicit approval first.

## Before JavaScript loads

Registration, claim confirmation and the organizer forms work before, or without,
JavaScript. Two rules keep that true (`tests/web/production.test.mjs` checks them):

- Keep `cacheComponents` off in `next.config.ts`. With it, Next.js 16.4.6 `next start`
  answered such posts with a blank page.
- Keep pages outside `<Suspense>`, so their content does not wait for a script.

On a very slow connection "Start voting" answers with "Opening the ballot…" while the ballot
downloads. Before the page's own script has loaded, the browser's loading indicator is the
only sign. `tests/web/browser.test.mjs` covers early taps; it needs Chrome or Edge.

Still needing JavaScript: choosing and submitting votes, the "Check again" button
(reloading the page works), guest search and filter, and "Copy link" (the link can be
selected by hand).

Claim organizer note: **a claim link is a password for that guest.** Send it privately,
only to that guest.

## Claim links and logs

A claim link carries its secret token in the address (`/claim/<token>`).

Controlled by the application:

- Only the SHA-256 hash of a token is stored. Audit records hold no token.
- Development request logs skip `/claim/` (`next.config.ts`). `next start` logs no requests.
- Application error logs contain database error messages only, never the address or token.
- The claim page's referrer carries the site name only, never the path, and the page asks
  not to be indexed.
- Opening or previewing a link does not use it. Only Confirm does.

Not controllable by the application:

- **Hosting access logs.** The host, and any CDN or proxy, will normally record the request
  path, token included. After choosing a host: check who can read request logs, how long
  they are kept, and whether logs are forwarded elsewhere. Limit access to trusted organizers.
- The guest's browser history, and the app used to send the link (including its link
  preview service) see the full address.

Limits on the damage: a link works once, lasts 24 hours, and creating a new link for the
same guest cancels the older unused one. If a link may have leaked, create a new one.

Removing the token from access logs entirely would mean carrying it after `#` in the
address and reading it with JavaScript. That change has not been made.

## The shared guest QR code (mandatory)

One code for the whole dinner, pointing to the registration page `/`. Never `/admin`,
a claim link, or localhost.

1. Deploy, and confirm `https://YOUR-DOMAIN/` shows the registration form.
2. Set `NEXT_PUBLIC_SITE_URL` to that HTTPS address **before the production build**: the value
   is built into the app, so changing it needs a new build.
3. Sign in as an organizer, open **QR code** (`/admin/qr`), check the address shown under
   the code, and press **Download PNG**.
4. Scan the printed copy with real iPhone and Android phones, register a test guest,
   then remove that guest in `/admin/guests`.
5. Keep the domain unchanged after printing.

## Also before the event

- Create organizer accounts and add them to `public.admins`.
- Turn off public sign-ups in Supabase Auth.
- Check the site, cookies and Copy link over real HTTPS on a physical phone.
