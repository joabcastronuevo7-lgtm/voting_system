// Real taps in a real browser on the production build, with scripts held back.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import {
  categories, count, createAuthUser, db, loadCategories, register, reset, setVoting, user,
} from "../db/helpers.mjs";
import { button, hasText, hydrated, launch } from "./chrome.mjs";
import { base, startServer } from "./helpers.mjs";

let stop, chrome, organizer;
before(async () => {
  await reset();
  await loadCategories();
  organizer = await createAuthUser({ admin: true });
  stop = await startServer({ production: true });
  chrome = await launch();
});
beforeEach(reset);
after(async () => {
  await chrome?.close();
  stop?.();
  await reset();
  await db.query("delete from public.admins where user_id = $1", [organizer]);
  await db.query("delete from auth.users where id = $1", [organizer]);
  await db.end();
});

async function registeredPhone(name) {
  const phone = await chrome.phone();
  await phone.goto(base);
  await phone.until(hydrated("form"));
  await phone.evaluate(`document.querySelector("#name").value = ${JSON.stringify(name)}`);
  await phone.tap(button("Continue to Voting"));
  await phone.until(hasText(`Hi, ${name}`));
  return phone;
}
const nominee = (name) =>
  `[...document.querySelectorAll("label.option")].find((l) => l.innerText.trim() === ${JSON.stringify(name)})`;
const enabled = (label) => `${button(label)}?.disabled === false`;

test("a nominee tapped before scripts load is kept, and is the one submitted", async () => {
  const [first, second] = [await register("First Nominee"), await register("Second Nominee")];
  await setVoting("open");
  const phone = await registeredPhone("Early Voter");

  phone.holdScripts();
  await phone.goto(`${base}/vote`);
  await phone.tap(nominee("Second Nominee"));
  assert.equal(await phone.evaluate(hydrated("input[type=radio]")), false);
  assert.equal(await phone.evaluate(`${button("Next")}.disabled`), true);
  phone.releaseScripts();

  await phone.until(enabled("Next"));
  await phone.until(hasText("Selected: Second Nominee"));
  await phone.tap(button("Next"));
  await phone.until(hasText("Award 2 of 3"));
  await phone.tap(nominee("First Nominee"));
  await phone.until(enabled("Next"));
  await phone.tap(button("Next"));
  await phone.until(hasText("Award 3 of 3"));
  await phone.tap(nominee("Second Nominee"));
  await phone.until(enabled("Review"));
  await phone.tap(button("Review"));
  await phone.until(enabled("Submit my votes"));
  await phone.tap(button("Submit my votes"));
  await phone.until(hasText("Your votes have been submitted!"));

  const { rows } = await db.query("select category_id, nominee_guest_id from public.votes");
  assert.deepEqual(
    categories.map((id) => rows.find((v) => v.category_id === id)?.nominee_guest_id),
    [second.id, first.id, second.id],
  );
});

test("the nominee search stays on screen down a long list, and filters it", async () => {
  for (let i = 10; i < 35; i++) await register(`Long List ${i}`);
  await setVoting("open");
  const phone = await registeredPhone("Scrolling Voter");
  await phone.goto(`${base}/vote`);
  await phone.until(hydrated("#search"));

  await phone.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  const { scrolled, top } = await phone.evaluate(
    `({ scrolled: window.scrollY, top: document.querySelector("#search").getBoundingClientRect().top })`,
  );
  assert.ok(scrolled > 400, `list too short to scroll: ${scrolled}`);
  assert.ok(top >= 0 && top < 20, `search box is at ${top}`);
  if (process.env.SHOTS) await phone.screenshot(`${process.env.SHOTS}/search.png`);

  // React ignores a plain value assignment, so use the native setter
  await phone.evaluate(`(() => {
    const box = document.querySelector("#search");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, "list 34");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await phone.until(`document.querySelectorAll("label.option").length === 1`);
});

test("Start voting answers the tap at once on a slow connection, and stays usable", async () => {
  await register("Some Nominee");
  await setVoting("open");
  const phone = await registeredPhone("Waiting Voter");
  await phone.until(hydrated("a.btn"));

  phone.holdScripts();
  await phone.tap(`document.querySelector("a.btn")`);
  await phone.until(hasText("Opening the ballot"));
  assert.equal(await phone.evaluate(`document.querySelector("a.btn").getAttribute("href")`), "/vote");
  assert.equal(await phone.evaluate(`document.querySelector("a.btn[aria-disabled]")`), null);
  phone.releaseScripts();
  await phone.until(hasText("Award 1 of 3"));
});

async function claimLink(name) {
  const guest = await register(name);
  const token = randomBytes(32).toString("base64url");
  await user(organizer, "admin_issue_claim", guest.id, createHash("sha256").update(token).digest("hex"));
  return `${base}/claim/${token}`;
}
const doubleTap = (phone, label) => phone.tap(button(label), 2);
const activeSessions = () => count("guest_sessions", "revoked_at is null");

test("a fresh phone that taps Confirm twice before scripts load is told it worked", async () => {
  const link = await claimLink("Double Tapper");
  const phone = await chrome.phone();
  phone.holdScripts();
  await phone.goto(link);
  await doubleTap(phone, "Confirm");

  // whichever answer arrives last, it names the guest and leads on
  await phone.until(
    `${hasText("You are signed in as Double Tapper")} || ${hasText("Hi, Double Tapper")}`,
  );
  await new Promise((r) => setTimeout(r, 1000));
  if (!(await phone.evaluate(hasText("Hi, Double Tapper")))) {
    assert.ok(await phone.evaluate(hasText("you are all set")), "no explanation");
    await phone.tap(button("Go to my page"));
    await phone.until(hasText("Hi, Double Tapper"));
  }
  assert.equal(await count("guest_claims", "used_at is not null"), 1);
  assert.equal(await activeSessions(), 1);

  const stranger = await chrome.phone();
  await stranger.goto(link);
  await stranger.until(hasText("This link cannot be used"));
});

test("a phone that lost its cookie recovers from a double tap with one more tap", async () => {
  const link = await claimLink("No Cookie");
  const phone = await chrome.phone();
  phone.holdScripts();
  await phone.goto(link);
  await phone.until(`Boolean(${button("Confirm")})`);
  await phone.clearCookies();
  await doubleTap(phone, "Confirm");

  await phone.until(hasText("Please tap Confirm again"));
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(await count("guest_claims", "used_at is not null"), 0);
  await phone.tap(button("Confirm"));
  await phone.until(hasText("Hi, No Cookie"));
});
