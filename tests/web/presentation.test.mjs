// The winners screen on the production build: who may see it, what it holds, and how it
// behaves on a projector. Set SHOTS to a folder to save screenshots.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { winners } from "../../lib/winners.ts";
import { localKeys } from "../../scripts/local-supabase.mjs";
import {
  db, loadCategories, picks, register, reset, server, setVoting,
} from "../db/helpers.mjs";
import { button, hasText, hydrated, launch } from "./chrome.mjs";
import { base, browser, startServer } from "./helpers.mjs";

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

let stop, chrome, organizer, outsider;
before(async () => {
  await reset();
  await loadCategories();
  organizer = await account({ admin: true });
  outsider = await account({ admin: false });
  stop = await startServer({ production: true });
  chrome = await launch();
});
beforeEach(reset);
after(async () => {
  await chrome?.close();
  stop?.();
  await reset();
  await db.query("delete from public.admins where user_id = any($1)", [users]);
  for (const id of users) await auth.deleteUser(id);
  await db.end();
});

const PAGE = "/admin/presentation";
const signedIn = async () => {
  const admin = browser();
  assert.equal((await admin.post("/admin/login", "Sign in", organizer)).status, 303);
  return admin;
};
/** Registers the names and casts one full ballot per row of choices. */
async function election(nominees, ballots) {
  const people = {};
  for (const name of nominees) people[name] = await register(name);
  await setVoting("open");
  for (const [i, choices] of ballots.entries()) {
    const voter = await register(`Secret Voter ${i + 1}`);
    await server("submit_ballot", voter.token, picks(...choices.map((n) => people[n].id)));
  }
  await setVoting("closed");
  return people;
}
// Ana wins the first award, Ben and Cara tie the second, Dee wins the third.
const standard = () =>
  election(
    ["Ana Winner", "Ben Tied", "Cara Tied", "Dee Winner", "Eli Runnerup", "Fay Runnerup"],
    [
      ["Ana Winner", "Ben Tied", "Dee Winner"],
      ["Ana Winner", "Cara Tied", "Dee Winner"],
      ["Eli Runnerup", "Ben Tied", "Dee Winner"],
      ["Ana Winner", "Cara Tied", "Fay Runnerup"],
    ],
  );
const WINNERS = ["Ana Winner", "Ben Tied", "Cara Tied", "Dee Winner"];
const OTHERS = ["Eli Runnerup", "Fay Runnerup", "Secret Voter"];

test("only rank one reaches the screen, every tie included", () => {
  const row = (category_id, nominee_name, votes, rank) => ({
    category_id, category_name: category_id, category_description: "", sort_order: 1,
    nominee_name, votes, rank,
  });
  assert.deepEqual(
    winners([
      row("a", "One", 3, 1),
      row("a", "Two", 1, 2),
      row("b", "Three", 2, 1),
      row("b", "Four", 2, 1),
      row("c", null, 0, null),
    ]).map((award) => [award.name, award.votes, award.winners]),
    [["a", 3, ["One"]], ["b", 2, ["Three", "Four"]], ["c", 0, []]],
  );
});

test("signed-out visitors, guests and non-admins get the login page and no names", async () => {
  await standard();
  const guest = browser();
  await setVoting("closed");
  await db.query("update public.event_settings set registration_open = true");
  await guest.post("/", "Continue to Voting", { name: "Curious Guest" });
  const nonAdmin = browser();
  const client = createServerClient(keys.url, keys.publishable, {
    cookies: {
      getAll: () => [],
      setAll: (list) => list.forEach(({ name, value }) => value && nonAdmin.jar.set(name, value)),
    },
  });
  assert.ifError((await client.auth.signInWithPassword(outsider)).error);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(nonAdmin.jar.size > 0);

  for (const visitor of [browser(), guest, nonAdmin]) {
    const page = await visitor.get(PAGE);
    assert.equal(page.status, 307);
    assert.equal(page.location, "/admin/login");
    for (const name of [...WINNERS, ...OTHERS]) assert.ok(!page.html.includes(name), name);
  }
});

test("the screen is locked until voting closes, and again after a reopen", async () => {
  await standard();
  const admin = await signedIn();
  for (const status of ["not_started", "open", "paused"]) {
    await setVoting(status);
    const { html } = await admin.get(PAGE);
    assert.match(html, /Results are locked until voting closes/);
    assert.doesNotMatch(html, /Start presentation/);
    for (const name of [...WINNERS, ...OTHERS]) assert.ok(!html.includes(name), `${status} ${name}`);
    assert.doesNotMatch((await admin.get("/admin")).html, /href="\/admin\/presentation"/);
  }
  await setVoting("closed");
  assert.match((await admin.get(PAGE)).html, /Start presentation/);
  assert.match((await admin.get("/admin")).html, /href="\/admin\/presentation"/);
  await setVoting("open");
  assert.match((await admin.get(PAGE)).html, /Results are locked/);
});

test("a closed vote sends the winners only, and warns before starting", async () => {
  await standard();
  const { html } = await (await signedIn()).get(PAGE);
  for (const name of WINNERS) assert.ok(html.includes(name), name);
  for (const name of OTHERS) assert.ok(!html.includes(name), name);
  assert.match(html, /do not reopen voting or change guests/);
});

// A real browser ------------------------------------------------------------

const HD = { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false };
const SMALL = { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false };

async function projector(size = HD) {
  const screen = await chrome.phone(size);
  await screen.goto(`${base}/admin/login`);
  await screen.until(hydrated("form"));
  await screen.evaluate(`
    document.querySelector("#email").value = ${JSON.stringify(organizer.email)};
    document.querySelector("#password").value = ${JSON.stringify(organizer.password)};`);
  await screen.tap(button("Sign in"));
  await screen.until(hasText("Turnout"));
  await screen.goto(`${base}${PAGE}`);
  await screen.until(`${hydrated(".stage button")}`);
  return screen;
}
// textContent, because capitals applied by the stylesheet change what innerText reports
const onStage = (text) =>
  `document.querySelector(".stage")?.textContent.includes(${JSON.stringify(text)})`;
const visible = (screen) => screen.evaluate("document.querySelector('.stage').textContent");
async function shows(screen, present, absent) {
  await screen.until(present.map(onStage).join(" && "));
  const text = await visible(screen);
  for (const name of absent) assert.ok(!text.includes(name), `${name} is showing too early`);
}
async function fits(screen, size, label) {
  for (const viewport of [HD, SMALL]) {
    await screen.resize(viewport);
    await new Promise((r) => setTimeout(r, 700)); // the fade
    const over = await screen.evaluate(`(() => {
      const body = document.querySelector(".stage-body");
      const bar = document.querySelector(".stage-controls").getBoundingClientRect();
      return [body.scrollHeight - body.clientHeight, body.scrollWidth - body.clientWidth,
              Math.round(bar.bottom - innerHeight)];
    })()`);
    assert.ok(over.every((px) => px <= 1), `${label} at ${viewport.height}p overflows by ${over}`);
    if (process.env.SHOTS) {
      await screen.screenshot(`${process.env.SHOTS}/${label}-${viewport.height}.png`);
    }
  }
  await screen.resize(size);
}

test("the organizer starts, reveals one award at a time, goes back and shows all", async () => {
  await standard();
  const screen = await projector();
  const names = ["Ana Winner", "Ben Tied", "Dee Winner"];
  await shows(screen, ["Start presentation", "do not reopen voting"], names);
  await fits(screen, HD, "start");

  // a clicker cannot start the show by accident
  await screen.press("PageDown", "PageDown", 34);
  await screen.press("ArrowRight", "ArrowRight", 39);
  await shows(screen, ["Start presentation"], names);

  await screen.tap(button("Start presentation"));
  await shows(screen, ["Spotlight Stealer Award", "Ana Winner", "3 votes"], ["Ben Tied", "Dee Winner"]);
  await fits(screen, HD, "award");
  await screen.press("ArrowRight", "ArrowRight", 39);
  await shows(screen, ["Ben Tied", "Cara Tied", "Winners · Tie", "2 votes each"], ["Ana Winner", "Dee Winner"]);
  await fits(screen, HD, "tie");
  await screen.press("ArrowLeft", "ArrowLeft", 37);
  await shows(screen, ["Ana Winner"], ["Ben Tied", "Dee Winner"]);
  await screen.press("PageDown", "PageDown", 34);
  await shows(screen, ["Ben Tied"], ["Ana Winner", "Dee Winner"]);
  await screen.tap(button("Next"));
  await shows(screen, ["Dee Winner"], ["Ana Winner", "Ben Tied"]);
  await screen.tap(button("Back"));
  await shows(screen, ["Ben Tied"], ["Dee Winner"]);
  await screen.tap(button("Show all"));
  await shows(screen, [...WINNERS, "A night to celebrate"], OTHERS);
  await fits(screen, HD, "all");

  // loaded once: a reopen does not reach an open screen, a reload does
  await setVoting("open");
  await shows(screen, WINNERS, []);
  await screen.goto(`${base}${PAGE}`);
  await screen.until(hasText("Results are locked until voting closes"));
});

test("long names and a many-way tie fit both projector sizes", async () => {
  const long = (first) => `${first} ${"Maximiliana Villanueva-Macaraeg ".repeat(3)}`.slice(0, 80).trim();
  const tied = ["Abigail", "Benedicto", "Corazon", "Dionisio", "Esperanza", "Fernando"].map(long);
  await election(tied, tied.map((name, i) => [tied[0], name, tied[(i < 3 ? 0 : 1)]]));
  const screen = await projector(SMALL);
  await screen.tap(button("Start presentation"));
  await screen.until(hasText(tied[0]));
  await fits(screen, SMALL, "long-name");
  await screen.tap(button("Next"));
  await screen.until(tied.map(hasText).join(" && "));
  await fits(screen, SMALL, "six-way-tie");
  await screen.tap(button("Show all"));
  await screen.until(onStage("A night to celebrate"));
  await fits(screen, SMALL, "all-long");
});

test("a removed nominee's votes are left out, and an empty award says so", async () => {
  const people = await standard();
  const admin = await signedIn();
  await admin.post("/admin/guests", [people["Ana Winner"].id, "Remove guest"], { reason: "test" });
  const after = (await admin.get(PAGE)).html;
  assert.ok(after.includes("Eli Runnerup") && !after.includes("Ana Winner"));

  await reset();
  await setVoting("closed");
  const screen = await projector(SMALL);
  await screen.tap(button("Start presentation"));
  await screen.tap(button("Show all"));
  await screen.until(
    `document.querySelector(".stage").textContent.split("No votes recorded").length === 4`,
  );
  await fits(screen, SMALL, "no-votes");
});
