// Registration over real HTTP against a local dev server, including a lost response.
// Forms are posted the way a browser without JavaScript posts them.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { count, db, reset } from "../db/helpers.mjs";
import { base, startServer } from "./helpers.mjs";

const COOKIE = "__Host-guest_session";
const TAKEN = /That name is already registered/;
let stop;

before(async () => {
  stop = await startServer();
});
beforeEach(reset);
after(async () => {
  stop?.();
  await reset();
  await db.end();
});

const get = async (path, cookie) => {
  const response = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  return { response, html: (await response.text()).replaceAll("<!-- -->", "") };
};
const issued = (response) =>
  response.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
const pair = (setCookie) => setCookie?.split(";")[0];

/** Opens the registration page like a new browser: returns its cookie and form fields. */
async function open(cookie) {
  const { response, html } = await get("/", cookie);
  const unescape = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
  const hidden = [...html.matchAll(/<input type="hidden" name="([^"]*)"(?: value="([^"]*)")?/g)];
  return {
    cookie: cookie ?? pair(issued(response)),
    setCookie: issued(response),
    fields: hidden.map(([, name, value = ""]) => [unescape(name), unescape(value)]),
  };
}

async function submit(page, name, cookie = page.cookie) {
  const body = new FormData();
  for (const [key, value] of page.fields) body.append(key, value);
  body.append("name", name);
  const response = await fetch(`${base}/`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: { origin: base, ...(cookie ? { cookie } : {}) },
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    cookie: pair(issued(response)),
    setCookie: issued(response),
    html: await response.text(),
  };
}

const greets = async (cookie, name) => (await get("/me", cookie)).html.includes(`Hi, ${name}`);

test("opening the page issues a locked-down cookie and creates nothing", async () => {
  const page = await open();
  assert.ok(page.setCookie, "no session cookie issued");
  for (const flag of [/; HttpOnly/i, /; Secure/i, /; SameSite=lax/i, /; Path=\//i, /; Expires=/i]) {
    assert.match(page.setCookie, flag);
  }
  assert.doesNotMatch(page.setCookie, /Domain=/i);
  assert.equal((await open(page.cookie)).setCookie, undefined, "an existing cookie was replaced");
  assert.equal(await count("guests"), 0);
  assert.equal(await greets(page.cookie, ""), false);
});

test("a normal registration keeps the same cookie and reaches /me", async () => {
  const page = await open();
  const done = await submit(page, "Normal Guest");
  assert.equal(done.status, 303);
  assert.match(done.location, /\/me/);
  assert.equal(done.cookie, page.cookie);
  for (const flag of [/; HttpOnly/i, /; Secure/i, /; SameSite=lax/i, /; Path=\//i]) {
    assert.match(done.setCookie, flag);
  }
  assert.doesNotMatch(done.setCookie, /Domain=/i);
  const { rows } = await db.query("select expires_at from public.guest_sessions");
  // cookie dates carry whole seconds only
  const seconds = (date) => Math.floor(new Date(date).getTime() / 1000);
  assert.equal(seconds(done.setCookie.match(/Expires=([^;]+)/i)[1]), seconds(rows[0].expires_at));
  assert.equal((await open(page.cookie)).setCookie, undefined, "a registered session was rotated");
  assert.equal(await greets(page.cookie, "Normal Guest"), true);
});

test("a guest whose registration response is lost is recognised afterwards", async () => {
  const page = await open();
  await submit(page, "Dropped Guest"); // response ignored: the browser never saw it

  assert.equal(await greets(page.cookie, "Dropped Guest"), true);
  const retry = await submit(page, "Dropped Guest");
  assert.equal(retry.status, 303);
  assert.match(retry.location, /\/me/);
  assert.equal(await count("guests"), 1);
  assert.equal(await count("guest_sessions"), 1);
});

test("a double tap creates one guest and shows no 'already registered' error", async () => {
  const page = await open();
  const results = await Promise.all([submit(page, "Double Tap"), submit(page, "Double Tap")]);
  assert.ok(results.every((r) => r.status === 303 && !TAKEN.test(r.html)));
  assert.equal(await count("guests"), 1);
});

test("another browser using the same name gets no access", async () => {
  await submit(await open(), "Real Owner");
  const stranger = await open();
  const result = await submit(stranger, "Real Owner");
  assert.match(result.html, TAKEN);
  assert.equal(await greets(stranger.cookie, "Real Owner"), false);
  assert.equal(await count("guest_sessions"), 1);
});

test("a revoked cookie is replaced, and the next tap registers", async () => {
  const page = await open();
  await submit(page, "Old Guest");
  await db.query("update public.guest_sessions set revoked_at = now()");

  const first = await submit(page, "New Person");
  assert.match(first.html, /tap .*Continue to Voting.* again/i);
  assert.ok(first.cookie && first.cookie !== page.cookie);
  assert.equal(await count("guests"), 1);

  assert.equal((await submit(page, "New Person", first.cookie)).status, 303);
  assert.equal(await greets(first.cookie, "New Person"), true);
});

test("without a usable cookie nothing is saved, so no name is left stranded", async () => {
  const page = await open();
  for (const cookie of ["", `${COOKIE}=short`]) {
    const result = await submit(page, "No Cookie", cookie);
    assert.ok(result.cookie, "no replacement cookie issued");
    assert.equal(await count("guests"), 0);
  }
});
