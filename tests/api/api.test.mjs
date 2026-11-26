// The same rules through the real local Supabase API: keys, Auth sign-in and permissions.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { localKeys } from "../../scripts/local-supabase.mjs";
import { db, newHash, reset, setVoting } from "../db/helpers.mjs";

const keys = localKeys(execSync);
const client = (key) => createClient(keys.url, key, { auth: { persistSession: false } });
const server = client(keys.secret);
const anon = client(keys.publishable);

const users = [];
async function signIn({ admin }) {
  const email = `${randomBytes(6).toString("hex")}@test.invalid`;
  const password = randomBytes(18).toString("base64url");
  const created = await server.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  users.push(created.data.user.id);
  if (admin) await db.query("insert into public.admins (user_id) values ($1)", [users.at(-1)]);
  const signedIn = client(keys.publishable);
  assert.ifError((await signedIn.auth.signInWithPassword({ email, password })).error);
  return signedIn;
}
const ok = async (request) => {
  const { data, error } = await request;
  assert.ifError(error);
  return data;
};
const fails = async (request, expected) => {
  const { error } = await request;
  assert.ok(error, "expected an error");
  assert.match(`${error.code} ${error.message}`, expected);
};
const register = async (name) => {
  const hash = newHash();
  const guest = await ok(server.rpc("register_guest", { p_name: name, p_token_hash: hash }));
  return { hash, id: guest.guest_id };
};

before(reset);
after(async () => {
  await reset();
  await db.query("delete from public.admins where user_id = any($1)", [users]);
  for (const id of users) await server.auth.admin.deleteUser(id);
  await db.end();
});

test("guest registers, votes once and sees published results only after closing", async () => {
  const voter = await register("Api Voter");
  const nominee = await register("Api Nominee");
  await setVoting("open");
  const ballot = await ok(server.rpc("ballot_nominees", { p_token_hash: voter.hash }));
  const picks = Object.fromEntries(ballot.categories.map((c) => [c.id, nominee.id]));
  const submit = () => server.rpc("submit_ballot", { p_token_hash: voter.hash, p_picks: picks });
  await ok(submit());
  await fails(submit(), /ALREADY_VOTED/);
  assert.equal((await ok(server.rpc("guest_me", { p_token_hash: voter.hash }))).has_voted, true);
  assert.equal((await ok(server.rpc("public_results"))).published, false);
});

test("the browser key reaches no function and no table", async () => {
  await fails(anon.rpc("register_guest", { p_name: "Anon Try", p_token_hash: newHash() }), /42501/);
  await fails(anon.rpc("public_results"), /42501/);
  await fails(anon.rpc("admin_dashboard"), /42501/);
  await fails(anon.from("votes").select("*"), /42501/);
  await fails(server.from("votes").select("*"), /42501/);
});

test("a signed-in admin can manage the event and close voting", async () => {
  const admin = await signIn({ admin: true });
  assert.equal(await ok(admin.rpc("is_admin")), true);
  const id = await ok(admin.rpc("admin_add_guest", { p_name: "Added By Admin" }));
  await ok(admin.rpc("admin_remove_guest", { p_guest_id: id, p_reason: "api test" }));
  await ok(admin.rpc("admin_restore_guest", { p_guest_id: id }));
  await ok(admin.rpc("admin_update_event_settings", {
    p_voting_status: "closed",
    p_confirm_close: true,
  }));
  assert.equal((await ok(admin.rpc("admin_results"))).published, true);
  await ok(admin.rpc("admin_update_event_settings", {
    p_voting_status: "open",
    p_confirm_reopen: true,
    p_reopen_reason: "api test",
  }));
  assert.equal((await ok(admin.rpc("admin_results"))).published, false);
  assert.equal((await ok(admin.rpc("admin_list_guests"))).length >= 1, true);
});

test("signed-in non-admins and the server key cannot use admin functions", async () => {
  const outsider = await signIn({ admin: false });
  await fails(outsider.rpc("admin_dashboard"), /NOT_ADMIN/);
  await fails(outsider.rpc("public_results"), /42501/);
  await fails(server.rpc("admin_dashboard"), /42501/);
});
