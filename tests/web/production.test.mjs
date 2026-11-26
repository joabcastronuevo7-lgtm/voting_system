// The production build as a phone sees it before, or without, JavaScript: every answer
// must be a whole page whose content is readable straight from the HTML.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { localKeys } from "../../scripts/local-supabase.mjs";
import { count, db, loadCategories, picks, register, reset, server, setVoting } from "../db/helpers.mjs";
import { browser, startServer } from "./helpers.mjs";

const keys = localKeys(execSync);
const auth = createClient(keys.url, keys.secret, { auth: { persistSession: false } }).auth.admin;
const organizer = {
  email: `${randomBytes(6).toString("hex")}@test.invalid`,
  password: randomBytes(18).toString("base64url"),
};
let stop, organizerId;

before(async () => {
  await reset();
  const created = await auth.createUser({ ...organizer, email_confirm: true });
  assert.ifError(created.error);
  organizerId = created.data.user.id;
  await db.query("insert into public.admins (user_id) values ($1)", [organizerId]);
  stop = await startServer({ production: true });
});
beforeEach(reset);
after(async () => {
  stop?.();
  await reset();
  await db.query("delete from public.admins where user_id = $1", [organizerId]);
  await auth.deleteUser(organizerId);
  await db.end();
});

/** What the browser shows without running any script. */
function shown({ status, html }) {
  assert.equal(status, 200);
  assert.match(html, /^<!DOCTYPE html><html/i, "not a whole page");
  assert.doesNotMatch(html, /<div hidden id="S:/, "content waits for a script to appear");
  return html.replace(/<script\b[\s\S]*?<\/script>/g, "");
}
const signedIn = async () => {
  const admin = browser();
  assert.equal((await admin.post("/admin/login", "Sign in", organizer)).status, 303);
  return admin;
};

test("every page is readable without JavaScript", async () => {
  const phone = browser();
  assert.match(shown(await phone.get("/")), /Continue to Voting/);
  await phone.post("/", "Continue to Voting", { name: "Reader Guest" });
  assert.match(shown(await phone.get("/me")), /Hi, Reader Guest/);
  assert.match(shown(await browser().get("/admin/login")), /Organizer sign in/);
  const admin = await signedIn();
  assert.match(shown(await admin.get("/admin")), /Turnout/);
  assert.match(shown(await admin.get("/admin/guests")), /Reader Guest/);
});

test("registration succeeds, and a duplicate name gets a readable error and no access", async () => {
  const owner = browser();
  const done = await owner.post("/", "Continue to Voting", { name: "Real Owner" });
  assert.equal(done.status, 303);
  const stranger = browser();
  const page = shown(await stranger.post("/", "Continue to Voting", { name: "Real Owner" }));
  assert.match(page, /That name is already registered/);
  assert.match(page, /value="Real Owner"/);
  assert.equal(await count("guests"), 1);
  assert.equal(await count("guest_sessions"), 1);
  assert.doesNotMatch(shown(await stranger.get("/")), /Hi, Real Owner/);
});

test("a new claim link is on the returned page, in an opened row", async () => {
  const guest = await register("Moving Guest");
  const admin = await signedIn();
  const page = shown(await admin.post("/admin/guests", [guest.id, "Create claim link"]));
  const link = page.match(/value="http:\/\/localhost:3000(\/claim\/[A-Za-z0-9_-]{43})"/)?.[1];
  assert.ok(link, "the organizer cannot retrieve the link");
  assert.match(page, /<details[^>]*\bopen=""/);
  assert.ok(page.includes(`action="/admin/guests#guest-${guest.id}"`), "no jump to the row");
  assert.equal(await count("guest_claims"), 1);

  const phone = browser();
  const opened = await phone.get(link);
  assert.match(shown(opened), /Are you Moving Guest\?/);
  // a referrer must never carry the path, which holds the token
  assert.match(opened.html, /<meta name="referrer" content="strict-origin"/);
  assert.equal(await count("guest_claims", "used_at is not null"), 0);
  assert.equal((await phone.post(link, "Confirm")).status, 303);
  assert.match(shown(await phone.get("/me")), /Hi, Moving Guest/);
  assert.match(shown(await browser().get(link)), /link cannot be used/);

  // a phone already signed in as someone else also needs one tap only
  const other = browser();
  await other.post("/", "Continue to Voting", { name: "Borrowed Phone" });
  const next = shown(await admin.post("/admin/guests", [guest.id, "Create claim link"]));
  const second = next.match(/value="http:\/\/localhost:3000(\/claim\/[A-Za-z0-9_-]{43})"/)[1];
  assert.equal((await other.post(second, "Confirm")).status, 303);
  assert.match(shown(await other.get("/me")), /Hi, Moving Guest/);
  assert.ok(!stop.output().includes(link.split("/").at(-1)), "claim token in the server output");
});

test("guest and organizer pages follow every change on the next request", async () => {
  const phone = browser();
  await phone.post("/", "Continue to Voting", { name: "Fresh Voter" });
  const nominee = await register("Chosen Nominee");
  const admin = await signedIn();
  const me = async () => shown(await phone.get("/me"));
  const to = async (path) => (await phone.get(path)).location;

  assert.match(await me(), /Voting opens soon/);
  assert.equal(await to("/"), "/me");
  assert.equal(await to("/vote"), "/me");
  assert.equal(await to("/thanks"), "/me");

  await admin.post("/admin", "Open voting");
  assert.match(await me(), /Start voting/);
  assert.match(shown(await phone.get("/vote")), /Award 1 of 3[\s\S]*Chosen Nominee/);
  await admin.post("/admin", "Pause voting");
  assert.match(await me(), /Voting paused/);
  assert.equal(await to("/vote"), "/me");
  await admin.post("/admin", "Resume voting");
  assert.match(shown(await admin.get("/admin")), /Voted<\/dt><dd[^>]*>0</);

  const token = createHash("sha256").update(phone.jar.get("__Host-guest_session")).digest("hex");
  await loadCategories();
  await server("submit_ballot", token, picks(nominee.id));
  assert.match(await me(), /You&#x27;ve voted/);
  assert.equal(await to("/vote"), "/me");
  assert.match(shown(await phone.get("/thanks")), /Your votes have been submitted/);
  assert.match(shown(await admin.get("/admin")), /Voted<\/dt><dd[^>]*>1</);

  // while voting is open, and after it closes, no screen carries a choice or a total
  const categoryNames = (await db.query("select name from public.award_categories")).rows;
  for (const status of ["open", "closed"]) {
    await setVoting(status);
    for (const path of ["/me", "/thanks"]) {
      const { html } = await phone.get(path);
      assert.ok(!html.includes("Chosen Nominee"), `${path} shows a choice while ${status}`);
    }
    for (const path of ["/admin", "/admin/guests"]) {
      const { html } = await admin.get(path);
      assert.doesNotMatch(html, /nominee_|category_|"votes"|"rank"/);
      for (const { name } of categoryNames) assert.ok(!html.includes(name), `${path}: ${name}`);
    }
  }
  assert.match(await me(), /Voting closed/);

  const { rows } = await db.query("select id from public.guests where full_name = 'Fresh Voter'");
  await admin.post("/admin/guests", [rows[0].id, "Remove guest"], { reason: "left" });
  assert.equal(await to("/me"), "/");
});

test("form errors come back as readable pages", async () => {
  const guest = await register("Error Guest");
  const admin = await signedIn();
  for (const [visitor, path, match, values, message] of [
    [browser(), "/", "Continue to Voting", { name: "1" }, /Enter your full name/],
    [browser(), "/admin/login", "Sign in", { ...organizer, password: "x" }, /not correct/],
    [admin, "/admin/guests", "Add guest", { name: "Error Guest" }, /already on the list/],
    [admin, "/admin/guests", [guest.id, "Remove guest"], { reason: " " }, /Enter a reason/],
    [admin, "/admin", "Open voting", {}, /Voting: Open/],
    [admin, "/admin", "Close voting", {}, /Tick the box/],
  ]) {
    assert.match(shown(await visitor.post(path, match, values)), message);
  }
});
