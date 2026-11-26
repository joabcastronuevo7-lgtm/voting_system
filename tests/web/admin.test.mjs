// The admin panel and claim links over real HTTP, against a local dev server.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { localKeys } from "../../scripts/local-supabase.mjs";
import { count, db, loadCategories, picks, register, reset, server, setVoting } from "../db/helpers.mjs";
import { browser, startServer } from "./helpers.mjs";

const keys = localKeys(execSync);
const auth = createClient(keys.url, keys.secret, { auth: { persistSession: false } }).auth.admin;
const users = [];
async function account({ admin }) {
  const email = `${randomBytes(6).toString("hex")}@test.invalid`;
  const password = randomBytes(18).toString("base64url");
  const created = await auth.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  users.push(created.data.user.id);
  if (admin) await db.query("insert into public.admins (user_id) values ($1)", [users.at(-1)]);
  return { email, password };
}

let stop, organizer, outsider;
before(async () => {
  await reset();
  await loadCategories();
  organizer = await account({ admin: true });
  outsider = await account({ admin: false });
  stop = await startServer();
});
beforeEach(reset);
after(async () => {
  stop?.();
  await reset();
  await db.query("delete from public.admins where user_id = any($1)", [users]);
  for (const id of users) await auth.deleteUser(id);
  await db.end();
});

const signedIn = async () => {
  const admin = browser();
  const result = await admin.post("/admin/login", "Sign in", organizer);
  assert.equal(result.status, 303);
  return admin;
};
/** A real Supabase session for a non-admin, which the login page would never keep. */
async function signedInOutsider() {
  const visitor = browser();
  const client = createServerClient(keys.url, keys.publishable, {
    cookies: {
      getAll: () => [],
      setAll: (list) => list.forEach(({ name, value }) => value && visitor.jar.set(name, value)),
    },
  });
  assert.ifError((await client.auth.signInWithPassword(outsider)).error);
  await new Promise((r) => setTimeout(r, 100)); // cookies are written after the sign-in event
  assert.ok(visitor.jar.size > 0, "no session cookie for the non-admin");
  return visitor;
}
const setting = async () =>
  (await db.query("select registration_open, voting_status from public.event_settings")).rows[0];
const toLogin = /\/admin\/login/;
const sentToLogin = (page) => toLogin.test(page.location ?? page.html);

// Sign-in --------------------------------------------------------------------

test("signed-out visitors are sent to the login page and see no data", async () => {
  await register("Secret Guest");
  for (const path of ["/admin", "/admin/guests"]) {
    const page = await browser().get(path);
    assert.ok(sentToLogin(page), `${path} did not redirect`);
    assert.doesNotMatch(page.html, /Secret Guest|Turnout/);
  }
});

test("wrong passwords and non-admins are refused and hold no session", async () => {
  for (const [credentials, message] of [
    [{ ...organizer, password: "wrong-password" }, /Email or password is not correct/],
    [outsider, /not an organizer/],
  ]) {
    const visitor = browser();
    const result = await visitor.post("/admin/login", "Sign in", credentials);
    assert.match(result.html, message);
    assert.ok(sentToLogin(await visitor.get("/admin")));
  }
});

test("an organizer reaches the dashboard, and signing out ends access", async () => {
  const admin = await signedIn();
  assert.match((await admin.get("/admin")).html, /Turnout/);
  await admin.post("/admin", "Sign out");
  assert.ok(sentToLogin(await admin.get("/admin")));
});

test("an expired access token is refreshed instead of signing the organizer out", async () => {
  const admin = await signedIn();
  const [name, value] = [...admin.jar].find(([n]) => /^sb-.*auth-token$/.test(n));
  const session = JSON.parse(Buffer.from(value.replace(/^base64-/, ""), "base64url").toString());
  const expired = `base64-${Buffer.from(JSON.stringify({ ...session, expires_at: 1 })).toString("base64url")}`;
  admin.jar.set(name, expired);
  assert.match((await admin.get("/admin")).html, /Turnout/);
  assert.notEqual(admin.jar.get(name), expired, "no refreshed cookie");
});

// Dashboard and controls ------------------------------------------------------

test("the dashboard shows participation counts but no award data", async () => {
  const [voter, nominee] = [await register("Count Voter"), await register("Count Nominee")];
  await setVoting("open");
  await server("submit_ballot", voter.token, picks(nominee.id));
  const { html } = await (await signedIn()).get("/admin");
  assert.match(html, /Registered<\/dt><dd[^>]*>2</);
  assert.match(html, /Voted<\/dt><dd[^>]*>1</);
  assert.match(html, /Turnout<\/dt><dd[^>]*>50%/);
  assert.doesNotMatch(html, /Count Nominee/);
});

test("registration and voting controls change the event, with confirmations", async () => {
  const admin = await signedIn();
  await admin.post("/admin", "Close registration");
  assert.equal((await setting()).registration_open, false);
  await admin.post("/admin", "Open registration");
  assert.equal((await setting()).registration_open, true);

  await admin.post("/admin", "Open voting");
  await admin.post("/admin", "Pause voting");
  assert.equal((await setting()).voting_status, "paused");
  await admin.post("/admin", "Resume voting");
  assert.equal((await setting()).voting_status, "open");

  const unconfirmed = await admin.post("/admin", "Close voting");
  assert.match(unconfirmed.html, /Tick the box/);
  assert.equal((await setting()).voting_status, "open");
  await admin.post("/admin", "Close voting", { confirm_close: "on" });
  assert.equal((await setting()).voting_status, "closed");

  await admin.post("/admin", "Reopen voting", { reason: "test" });
  await admin.post("/admin", "Reopen voting", { confirm_reopen: "on", reason: "  " });
  assert.equal((await setting()).voting_status, "closed");
  await admin.post("/admin", "Reopen voting", { confirm_reopen: "on", reason: "late table" });
  assert.equal((await setting()).voting_status, "open");
});

test("a stale 'Pause voting' tap cannot reopen closed voting", async () => {
  await setVoting("open");
  const admin = await signedIn();
  const stale = await admin.get("/admin");
  await setVoting("closed");
  await admin.post("/admin", "Pause voting", {}, stale);
  assert.equal((await setting()).voting_status, "closed");
});

// Guest management ------------------------------------------------------------

test("the guest list shows who voted, never for whom", async () => {
  const [voter, nominee] = [await register("List Voter"), await register("List Nominee")];
  await setVoting("open");
  await server("submit_ballot", voter.token, picks(nominee.id));
  const { html } = await (await signedIn()).get("/admin/guests");
  const row = (name) => html.match(/<li\b[\s\S]*?<\/li>/g).find((li) => li.includes(name));
  assert.match(row("List Voter"), />Voted</);
  assert.match(row("List Nominee"), />Not voted</);
  assert.doesNotMatch(html, /nominee_guest_id|nominee_name/);
});

test("an organizer can add, remove and restore a guest", async () => {
  const admin = await signedIn();
  await admin.post("/admin/guests", "Add guest", { name: "Walk In" });
  assert.equal(await count("guests", "removed_at is null"), 1);
  const duplicate = await admin.post("/admin/guests", "Add guest", { name: "walk in" });
  assert.match(duplicate.html, /already on the list/);

  const { id } = (await db.query("select id from public.guests")).rows[0];
  const noReason = await admin.post("/admin/guests", [id, "Remove guest"], { reason: " " });
  assert.match(noReason.html, /Enter a reason/);
  await admin.post("/admin/guests", [id, "Remove guest"], { reason: "left early" });
  assert.equal(await count("guests", "removed_at is null"), 0);
  await admin.post("/admin/guests", [id, "Restore guest"]);
  assert.equal(await count("guests", "removed_at is null"), 1);
});

test("a form saved from an admin page does nothing for a signed-out visitor", async () => {
  const admin = await signedIn();
  const page = await admin.get("/admin/guests");
  const result = await browser().post("/admin/guests", "Add guest", { name: "Intruder" }, page);
  assert.ok(sentToLogin(result));
  assert.equal(await count("guests"), 0);
});

// Claim links -----------------------------------------------------------------

/** Registers a guest and has an organizer create their claim link; returns its path. */
async function claimPath(name = "Moving Guest") {
  const guest = await register(name);
  const admin = await signedIn();
  const result = await admin.post("/admin/guests", [guest.id, "Create claim link"]);
  const link = result.html.match(/http:\/\/localhost:3000(\/claim\/[A-Za-z0-9_-]{43})"/);
  assert.ok(link, "no claim link shown");
  return { path: link[1], guest };
}
const used = () => count("guest_claims", "used_at is not null");
const greets = async (visitor, name) => (await visitor.get("/me")).html.includes(`Hi, ${name}`);

test("opening a claim link changes nothing; confirming moves the guest", async () => {
  const { path } = await claimPath();
  const phone = browser();
  await phone.get(path);
  assert.match((await phone.get(path)).html, /Moving Guest/);
  assert.equal(await used(), 0);

  const done = await phone.post(path, "Confirm");
  assert.equal(done.status, 303);
  assert.equal(await greets(phone, "Moving Guest"), true);
  assert.equal(await count("guest_sessions", "revoked_at is null"), 1);
  assert.equal(await count("guest_sessions", "revoked_at is not null"), 1);

  assert.match((await browser().get(path)).html, /link cannot be used/);
  // the same browser, for example after a lost response, is told it is signed in
  assert.match((await phone.get(path)).html, /signed in as[\s\S]*Moving Guest/);
});

test("a lost claim response leaves the browser signed in", async () => {
  const { path } = await claimPath();
  const phone = browser();
  await phone.get(path);
  const before = new Map(phone.jar);
  await phone.post(path, "Confirm");
  phone.jar.clear();
  for (const [name, value] of before) phone.jar.set(name, value);
  assert.equal(await greets(phone, "Moving Guest"), true);
});

/** A phone already holding a session for another guest. */
async function borrowedPhone() {
  const phone = browser();
  await phone.post("/", "Continue to Voting", { name: "Borrowed Phone" });
  return phone;
}

test("a phone signed in as someone else is warned, then switches on one tap", async () => {
  const { path } = await claimPath();
  const phone = await borrowedPhone();

  assert.match((await phone.get(path)).html, /signed in as[\s\S]*Borrowed Phone/);
  assert.equal(await used(), 0);
  assert.equal((await phone.post(path, "Confirm")).status, 303);
  assert.equal(await greets(phone, "Moving Guest"), true);
  assert.equal(await used(), 1);
});

test("a phone that was signed out by an earlier move comes back on one tap", async () => {
  const guest = await register("Moving Guest");
  const admin = await signedIn();
  const issue = async () =>
    (await admin.post("/admin/guests", [guest.id, "Create claim link"])).html.match(
      /(\/claim\/[A-Za-z0-9_-]{43})"/,
    )[1];
  const [first, second] = [browser(), browser()];
  for (const phone of [first, second, first]) {
    const path = await issue();
    await phone.get(path);
    assert.equal((await phone.post(path, "Confirm")).status, 303);
    assert.equal(await greets(phone, "Moving Guest"), true);
  }
  assert.equal(await greets(second, "Moving Guest"), false);
  assert.equal(await count("guest_sessions", "revoked_at is null"), 1);
});

test("a double tap on a signed-in phone ends signed in as the claimed guest", async () => {
  const { path } = await claimPath();
  const phone = await borrowedPhone();
  const page = await phone.get(path);
  const before = new Map(phone.jar);
  const tap = () => {
    const copy = browser();
    for (const [name, value] of before) copy.jar.set(name, value);
    return copy.post(path, "Confirm", {}, page).then((result) => ({ result, copy }));
  };
  for (const { result, copy } of await Promise.all([tap(), tap()])) {
    assert.equal(result.status, 303);
    assert.equal(await greets(copy, "Moving Guest"), true);
  }
  assert.equal(await count("guest_claims", "used_at is not null"), 1);
});

test("a lost response on a signed-in phone is recovered from the same link", async () => {
  const { path } = await claimPath();
  const phone = await borrowedPhone();
  await phone.get(path);
  const before = new Map(phone.jar);
  await phone.post(path, "Confirm");
  phone.jar.clear(); // the reply never arrived
  for (const [name, value] of before) phone.jar.set(name, value);

  assert.match((await phone.get(path)).html, /Are you Moving Guest\?/);
  assert.equal((await phone.post(path, "Confirm")).status, 303);
  assert.equal(await greets(phone, "Moving Guest"), true);
  // no other phone can use the spent link, signed in or not
  const stranger = browser();
  await stranger.post("/", "Continue to Voting", { name: "Stranger" });
  assert.match((await stranger.get(path)).html, /link cannot be used/);
});

test("claim tokens are stored only as hashes and never written to the logs", async () => {
  const { path } = await claimPath();
  const token = path.split("/").at(-1);
  const phone = browser();
  await phone.get(path);
  await phone.post(path, "Confirm");
  await phone.get(path);

  const claim = (await db.query("select * from public.guest_claims")).rows[0];
  assert.equal(claim.token_hash, createHash("sha256").update(token).digest("hex"));
  const audit = (await db.query("select * from public.admin_audit_logs")).rows;
  assert.ok(!JSON.stringify([claim, audit]).includes(token));

  await new Promise((r) => setTimeout(r, 1000)); // let the server flush its logs
  assert.match(stop.output(), /GET \/me/, "server output was not captured");
  const logFile = ".next/dev/logs/next-development.log";
  const logs = stop.output() + (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
  assert.ok(!logs.includes(token), "claim token found in the server logs");});

test("signed-out visitors and non-admins cannot invoke any admin action", async () => {
  const guest = await register("Protected Guest");
  const removed = await register("Removed Guest");
  await setVoting("open");
  const admin = await signedIn();
  await admin.post("/admin/guests", [removed.id, "Remove guest"], { reason: "setup" });
  const dashboard = await admin.get("/admin");
  const guests = await admin.get("/admin/guests");
  const state = async () =>
    JSON.stringify([
      await setting(),
      (await db.query("select id, full_name, removed_at from public.guests order by id")).rows,
      await count("guest_claims"),
    ]);
  const unchanged = await state();

  // every admin form, posted to its own page and to a public page
  const attempts = [
    ["/admin", dashboard, "Close registration"],
    ["/admin", dashboard, "Pause voting"],
    ["/admin", dashboard, "Close voting", { confirm_close: "on" }],
    ["/admin/guests", guests, "Add guest", { name: "Intruder" }],
    ["/admin/guests", guests, [guest.id, "Remove guest"], { reason: "intruder" }],
    ["/admin/guests", guests, [removed.id, "Restore guest"]],
    ["/admin/guests", guests, [guest.id, "Create claim link"]],
  ];
  for (const visitor of [browser(), await signedInOutsider()]) {
    for (const [path, page, match, values] of attempts) {
      for (const target of [path, "/"]) {
        const result = await visitor.post(target, match, values, page);
        assert.doesNotMatch(result.html, /\/claim\/[A-Za-z0-9_-]{43}/);
        assert.equal(await state(), unchanged, `${match} at ${target} changed data`);
      }
    }
  }
  // control: the same saved form does work for the organizer
  await admin.post("/admin", "Close registration", {}, dashboard);
  assert.equal((await setting()).registration_open, false);
});

test("a junk claim link shows the same message and offers no button", async () => {
  for (const token of ["junk", "A".repeat(43)]) {
    const { html } = await browser().get(`/claim/${token}`);
    assert.match(html, /link cannot be used/);
    assert.doesNotMatch(html, /<button[^>]*>Confirm/);
  }
});
