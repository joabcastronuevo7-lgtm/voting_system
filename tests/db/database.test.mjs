import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  as, categories, count, createAuthUser, db, loadCategories, migrate, newHash, picks, readSql, register, reset, rollback,
  server, serverValue, setVoting, user, userValue,
} from "./helpers.mjs";

const rejects = (promise, code) => assert.rejects(promise, { message: code });
const denied = (promise) => assert.rejects(promise, { code: "42501" });
const outcomes = async (promises) => {
  const settled = await Promise.allSettled(promises);
  return {
    ok: settled.filter((r) => r.status === "fulfilled").length,
    errors: settled.filter((r) => r.status === "rejected").map((r) => r.reason.message),
  };
};

let adminId;
let outsiderId;

before(async () => {
  await rollback();
  await migrate();
  await loadCategories();
  adminId = await createAuthUser({ admin: true });
  outsiderId = await createAuthUser({ admin: false });
});
beforeEach(reset);
after(async () => {
  await db.query("delete from public.admins").catch(() => {});
  await db.query("delete from auth.users where email like '%@test.invalid'").catch(() => {});
  await db.end();
});

describe("seed and security configuration", () => {
  test("seeds exactly the approved categories", async () => {
    const { rows } = await db.query(
      "select name, description from public.award_categories order by sort_order",
    );
    assert.deepEqual(rows, [
      { name: "Spotlight Stealer Award", description: "presence and charisma." },
      { name: "The Eyes-On-Me Award", description: "confidence, and captivating personality." },
      {
        name: "Fashion Icon Award",
        description: "exceptional style, elegance, and outstanding fashion sense.",
      },
    ]);
  });

  test("seed can run twice without duplicating rows", async () => {
    await db.query(readSql("migrations/20261126000001_seed.sql"));
    assert.equal(await count("award_categories"), 3);
    assert.equal(await count("event_settings"), 1);
  });

  test("verification script reports no problems", async () => {
    assert.deepEqual((await db.query(readSql("verify.sql"))).rows, []);
  });

  const tables = [
    "admins", "award_categories", "event_settings", "guests", "guest_sessions", "guest_claims",
    "votes", "admin_audit_logs", "claim_failures",
  ];
  for (const role of ["anon", "authenticated", "service_role"]) {
    test(`${role} cannot read or write any table directly`, async () => {
      for (const table of tables) {
        await denied(as(role, adminId, `select * from public.${table}`));
        await denied(as(role, adminId, `delete from public.${table}`));
      }
    });
  }

  test("public schema holds exactly the approved functions", async () => {
    const { rows } = await db.query(
      "select proname from pg_proc where pronamespace = 'public'::regnamespace order by proname",
    );
    assert.deepEqual(rows.map((r) => r.proname), [
      "admin_add_guest", "admin_dashboard", "admin_issue_claim", "admin_list_guests",
      "admin_remove_guest", "admin_restore_guest", "admin_results", "admin_update_event_settings",
      "ballot_nominees", "claim_guest", "claim_preview", "guest_me", "is_admin",
      "public_results", "register_guest", "submit_ballot",
    ]);
  });

  test("anon cannot execute any application function", async () => {
    await denied(as("anon", null, "select public.public_results()"));
    await denied(as("anon", null, "select public.register_guest('A B', $1)", [newHash()]));
    await denied(as("anon", null, "select public.admin_dashboard()"));
  });

  test("a signed-in user cannot call guest or results functions", async () => {
    await denied(userValue(adminId, "register_guest", "A B", newHash()));
    await denied(user(adminId, "public_results"));
  });

  test("the secret-key role cannot call admin functions", async () => {
    await denied(server("admin_dashboard"));
    await denied(server("admin_add_guest", "Sneaky Guest"));
    await denied(server("admin_results"));
    await denied(as("anon", null, "select public.admin_results()"));
  });
});

describe("registration", () => {
  test("creates a guest with a normalized name and a 30 day session", async () => {
    const guest = await register("  Maria \t  Clara  ");
    assert.equal(guest.name, "Maria Clara");
    const { rows } = await db.query(
      `select g.name_key, s.token_hash, s.expires_at - s.created_at = interval '30 days' as thirty
         from public.guests g join public.guest_sessions s on s.guest_id = g.id`,
    );
    assert.deepEqual(rows, [{ name_key: "maria clara", token_hash: guest.token, thirty: true }]);
  });

  test("works while voting has not started", async () => {
    const guest = await register("Early Bird");
    assert.equal((await serverValue("guest_me", guest.token)).voting_status, "not_started");
  });

  test("rejects invalid names", async () => {
    for (const name of ["", "   ", "A", "1234", "x".repeat(81), "\u200b\u200b"]) {
      await rejects(register(name), "INVALID_NAME");
    }
  });

  test("accepts non-English letters", async () => {
    assert.equal((await register("Niño Peña")).name, "Niño Peña");
  });

  test("rejects a duplicate active name ignoring case, spacing and invisible characters", async () => {
    await register("Juan Cruz");
    await rejects(register("  juan    CRUZ "), "DUPLICATE_NAME");
    await rejects(register("Juan​ Cruz"), "DUPLICATE_NAME");
  });

  test("does not merge similar names", async () => {
    await register("Juan Cruz");
    await register("Juan A. Cruz");
    assert.equal(await count("guests"), 2);
  });

  test("rejects when registration is closed", async () => {
    await db.query("update public.event_settings set registration_open = false");
    await rejects(register("Late Guest"), "REGISTRATION_CLOSED");
  });

  test("rejects a malformed token hash", async () => {
    await rejects(server("register_guest", "Valid Name", "raw-token"), "INVALID_TOKEN");
    assert.equal(await count("guests"), 0);
  });

  test("never exceeds the guest limit under concurrency", async () => {
    await db.query("update public.event_settings set max_active_guests = 5");
    const result = await outcomes(Array.from({ length: 20 }, (_, i) => register(`Cap Guest ${i}`)));
    assert.equal(result.ok, 5);
    assert.deepEqual([...new Set(result.errors)], ["GUEST_LIMIT_REACHED"]);
  });

  test("allows exactly 30 registrations per minute under concurrency", async () => {
    const result = await outcomes(Array.from({ length: 50 }, (_, i) => register(`Rush Guest ${i}`)));
    assert.equal(result.ok, 30);
    assert.deepEqual([...new Set(result.errors)], ["RATE_LIMITED"]);
    await db.query("update public.guests set registered_at = registered_at - interval '61 seconds'");
    await register("After The Window");
  });

  test("admin-added guests do not use the registration rate limit", async () => {
    for (let i = 0; i < 30; i++) await userValue(adminId, "admin_add_guest", `Manual ${i}x`);
    await register("Self Registered");
  });

  test("creates one guest when the same name arrives concurrently", async () => {
    const result = await outcomes(Array.from({ length: 10 }, () => register("Same Name")));
    assert.equal(result.ok, 1);
    assert.deepEqual([...new Set(result.errors)], ["DUPLICATE_NAME"]);
  });
});

describe("guest session", () => {
  test("returns the guest's own state without ids or tokens", async () => {
    const guest = await register("Session Owner");
    assert.deepEqual(await serverValue("guest_me", guest.token), {
      full_name: "Session Owner",
      has_voted: false,
      voting_status: "not_started",
      registration_open: true,
    });
  });

  test("rejects unknown, revoked, expired and removed-guest sessions", async () => {
    await rejects(serverValue("guest_me", newHash()), "INVALID_SESSION");

    const revoked = await register("Revoked Guest");
    await db.query("update public.guest_sessions set revoked_at = now() where token_hash = $1", [revoked.token]);
    await rejects(serverValue("guest_me", revoked.token), "INVALID_SESSION");

    const owner = await register("Expired Guest");
    const expired = newHash();
    await db.query(
      `insert into public.guest_sessions (guest_id, token_hash, created_at, expires_at)
       values ($1, $2, now() - interval '31 days', now() - interval '1 day')`,
      [owner.id, expired],
    );
    await rejects(serverValue("guest_me", expired), "INVALID_SESSION");

    const removed = await register("Removed Guest");
    await userValue(adminId, "admin_remove_guest", removed.id, "test");
    await rejects(serverValue("guest_me", removed.token), "INVALID_SESSION");
  });

  test("a session cannot be created for longer than 30 days", async () => {
    const guest = await register("Fixed Expiry");
    await assert.rejects(
      db.query(
        `insert into public.guest_sessions (guest_id, token_hash, expires_at)
         values ($1, $2, now() + interval '31 days')`,
        [guest.id, newHash()],
      ),
      { code: "23514" },
    );
  });
});

describe("voting", () => {
  let voter, ana, ben;
  beforeEach(async () => {
    voter = await register("Vera Voter");
    ana = await register("Ana Nominee");
    ben = await register("Ben Nominee");
    await setVoting("open");
  });

  const vote = (who, ballot) => server("submit_ballot", who.token, ballot);
  const nothingSaved = async () => {
    assert.equal(await count("votes"), 0);
    assert.equal(await count("guests", "voted_at is not null"), 0);
  };

  test("lists other active guests alphabetically", async () => {
    const gone = await register("Cara Gone");
    await userValue(adminId, "admin_remove_guest", gone.id, "test");
    const { categories: shown, nominees } = await serverValue("ballot_nominees", voter.token);
    assert.deepEqual(nominees.map((g) => g.full_name), ["Ana Nominee", "Ben Nominee"]);
    assert.deepEqual(shown.map((c) => c.id), categories);
    assert.deepEqual(Object.keys(shown[0]).sort(), ["description", "id", "name"]);
    assert.equal(shown[0].name, "Spotlight Stealer Award");
  });

  // The Data API caps row sets at 1000, below the 2000 guest maximum.
  test("returns long lists as one value, so none are cut off", async () => {
    await db.query(
      "insert into public.guests (full_name, name_key) select 'Bulk ' || n, 'bulk ' || n from generate_series(1, 1100) n",
    );
    for (const rows of [
      await server("ballot_nominees", voter.token),
      await user(adminId, "admin_list_guests"),
      await user(adminId, "admin_results"),
      await server("public_results"),
    ]) assert.equal(rows.length, 1);
    assert.equal((await serverValue("ballot_nominees", voter.token)).nominees.length, 1102);
  });

  test("saves a complete ballot and marks the guest as voted", async () => {
    await vote(voter, picks(ana.id, ben.id, ana.id));
    assert.equal(await count("votes"), 3);
    assert.equal((await serverValue("guest_me", voter.token)).has_voted, true);
  });

  for (const status of ["not_started", "paused", "closed"]) {
    test(`rejects ballots and nominee list when voting is ${status}`, async () => {
      await setVoting(status);
      await rejects(vote(voter, picks(ana.id)), "VOTING_NOT_OPEN");
      await rejects(serverValue("ballot_nominees", voter.token), "VOTING_NOT_OPEN");
      await nothingSaved();
    });
  }

  test("rejects a missing, extra, unknown or malformed selection", async () => {
    const full = picks(ana.id);
    const [first, second, third] = categories;
    const missing = { [first]: ana.id, [second]: ana.id };
    for (const bad of [
      missing,
      { ...full, extra: ana.id },
      { ...missing, [crypto.randomUUID()]: ana.id },
      { ...full, [third]: null },
      { ...full, [third]: "Ana Nominee" },
      {},
    ]) {
      await rejects(vote(voter, bad), "INVALID_BALLOT");
    }
    await rejects(vote(voter, null), "INVALID_BALLOT");
    await nothingSaved();
  });

  test("rejects self-voting and saves nothing", async () => {
    await rejects(vote(voter, picks(ana.id, ben.id, voter.id)), "SELF_VOTE");
    await nothingSaved();
  });

  test("the database itself rejects a self vote", async () => {
    await assert.rejects(
      db.query(
        `insert into public.votes (category_id, voter_guest_id, nominee_guest_id)
         values ($2, $1, $1)`,
        [voter.id, categories[2]],
      ),
      { code: "23514" },
    );
  });

  test("the database itself rejects a partial ballot", async () => {
    await assert.rejects(
      db.query(
        `insert into public.votes (category_id, voter_guest_id, nominee_guest_id)
         values ($3, $1, $2)`,
        [voter.id, ana.id, categories[2]],
      ),
      { message: "INCOMPLETE_BALLOT" },
    );
    assert.equal(await count("votes"), 0);
  });

  test("rolls back everything when one nominee is removed or unknown", async () => {
    await userValue(adminId, "admin_remove_guest", ben.id, "test");
    await rejects(vote(voter, picks(ana.id, ana.id, ben.id)), "INVALID_NOMINEE");
    await rejects(vote(voter, picks(ana.id, ana.id, crypto.randomUUID())), "INVALID_NOMINEE");
    await nothingSaved();
  });

  test("rejects a removed voter", async () => {
    await userValue(adminId, "admin_remove_guest", voter.id, "test");
    await rejects(vote(voter, picks(ana.id)), "INVALID_SESSION");
    await nothingSaved();
  });

  test("rejects a second ballot", async () => {
    await vote(voter, picks(ana.id));
    await rejects(vote(voter, picks(ben.id)), "ALREADY_VOTED");
    await rejects(serverValue("ballot_nominees", voter.token), "ALREADY_VOTED");
    assert.equal(await count("votes"), 3);
  });

  test("saves one ballot when the same guest submits concurrently", async () => {
    const result = await outcomes(
      Array.from({ length: 20 }, (_, i) => vote(voter, picks(i % 2 ? ana.id : ben.id))),
    );
    assert.equal(result.ok, 1);
    assert.deepEqual([...new Set(result.errors)], ["ALREADY_VOTED"]);
    assert.equal(await count("votes"), 3);
  });

  test("does not deadlock when guests vote for each other at once", async () => {
    await db.query("update public.guests set registered_at = now() - interval '2 minutes'");
    const crowd = [voter, ana, ben];
    for (let i = 0; i < 27; i++) crowd.push(await register(`Crowd ${i}x`));
    const result = await outcomes(
      crowd.map((who, i) =>
        vote(who, picks(
          crowd[(i + 1) % crowd.length].id,
          crowd[(i + crowd.length - 1) % crowd.length].id,
          crowd[(i + 7) % crowd.length].id,
        )),
      ),
    );
    assert.deepEqual(result.errors, []);
    assert.equal(await count("votes"), 90);
  });

  test("stays consistent when a nominee is removed during submissions", async () => {
    const result = await outcomes([
      vote(voter, picks(ana.id)),
      userValue(adminId, "admin_remove_guest", ana.id, "race"),
    ]);
    assert.ok(result.errors.every((e) => e === "INVALID_NOMINEE"), result.errors.join());
    assert.ok([0, 3].includes(await count("votes")));
  });
});

describe("claim links", () => {
  const addWithClaim = async (name = "Claimed Guest") => {
    const id = await userValue(adminId, "admin_add_guest", name);
    const claim = newHash();
    await userValue(adminId, "admin_issue_claim", id, claim);
    return { id, claim };
  };
  const invalid = { ok: false, error: "INVALID_CLAIM" };

  test("preview shows the name without consuming the link", async () => {
    const { claim } = await addWithClaim();
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(await serverValue("claim_preview", claim), { ok: true, full_name: "Claimed Guest" });
    }
    assert.equal(await count("guest_claims", "used_at is not null"), 0);
  });

  test("lasts 24 hours", async () => {
    await addWithClaim();
    assert.equal(await count("guest_claims", "expires_at - created_at = interval '24 hours'"), 1);
  });

  test("claiming issues a session and revokes earlier ones", async () => {
    const guest = await register("Lost Phone");
    const claim = newHash();
    await userValue(adminId, "admin_issue_claim", guest.id, claim);
    const session = newHash();
    const result = await serverValue("claim_guest", claim, session);
    assert.equal(result.ok, true);
    assert.equal(result.full_name, "Lost Phone");
    assert.ok(result.expires_at);
    await rejects(serverValue("guest_me", guest.token), "INVALID_SESSION");
    assert.equal((await serverValue("guest_me", session)).full_name, "Lost Phone");
  });

  test("cannot be reused, even concurrently", async () => {
    const { claim } = await addWithClaim();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => serverValue("claim_guest", claim, newHash())),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await count("guest_sessions"), 1);
    assert.deepEqual(await serverValue("claim_preview", claim), invalid);
  });

  test("rejects unknown, expired, replaced and removed-guest links", async () => {
    assert.deepEqual(await serverValue("claim_guest", newHash(), newHash()), invalid);

    const { id } = await addWithClaim("Expiring Guest");
    const expired = newHash();
    await db.query(
      `insert into public.guest_claims (guest_id, token_hash, created_at, expires_at)
       values ($1, $2, now() - interval '25 hours', now() - interval '1 hour')`,
      [id, expired],
    );
    assert.deepEqual(await serverValue("claim_guest", expired, newHash()), invalid);

    const first = await addWithClaim("Replaced Guest");
    await userValue(adminId, "admin_issue_claim", first.id, newHash());
    assert.deepEqual(await serverValue("claim_guest", first.claim, newHash()), invalid);

    const gone = await addWithClaim("Removed Before Claim");
    await userValue(adminId, "admin_remove_guest", gone.id, "test");
    assert.deepEqual(await serverValue("claim_guest", gone.claim, newHash()), invalid);
    assert.equal(await count("guest_sessions"), 0);
  });

  const failures = (where) => count("claim_failures", where);
  const attempt = (hash) => serverValue("claim_guest", hash, newHash());
  const preview = (hash) => serverValue("claim_preview", hash);

  test("every failure looks the same, whether or not the link ever existed", async () => {
    const used = await addWithClaim("Used Link");
    await attempt(used.claim);
    for (const hash of [used.claim, newHash(), "not-a-hash", null]) {
      for (let i = 0; i < 12; i++) {
        assert.deepEqual(await preview(hash), invalid);
        assert.deepEqual(await attempt(hash), invalid);
      }
    }
    assert.equal(await failures("token_hash !~ '^[0-9a-f]{64}$'"), 0);
  });

  test("records at most 10 failures a minute for one link, apart from other links", async () => {
    const bad = newHash();
    for (let i = 0; i < 15; i++) await attempt(bad);
    assert.equal(await failures(), 10);
    await attempt(newHash());
    assert.equal(await failures(), 11);
  });

  test("the overall limit caps records and never blocks a valid link", async () => {
    await db.query(
      `insert into public.claim_failures (token_hash)
       select encode(sha256(convert_to(n::text, 'UTF8')), 'hex') from generate_series(1, 600) n`,
    );
    await attempt(newHash());
    assert.equal(await failures(), 600);
    const { claim } = await addWithClaim();
    assert.equal((await preview(claim)).ok, true);
    assert.equal((await attempt(claim)).ok, true);
  });

  test("legitimate claims all succeed at once during bad attempts", async () => {
    const links = [];
    for (let i = 0; i < 40; i++) links.push(await addWithClaim(`Arriving ${i}x`));
    const bad = Array.from({ length: 100 }, () => attempt(newHash()));
    const good = links.map((link) => attempt(link.claim));
    assert.ok((await Promise.all(good)).every((r) => r.ok));
    assert.ok((await Promise.all(bad)).every((r) => r.error === "INVALID_CLAIM"));
  });
});

describe("admin", () => {
  const adminCalls = (id) => [
    ["admin_dashboard"],
    ["admin_list_guests"],
    ["admin_results"],
    ["admin_add_guest", "Nope Guest"],
    ["admin_issue_claim", id, newHash()],
    ["admin_remove_guest", id, "nope"],
    ["admin_restore_guest", id],
    ["admin_update_event_settings", true, "open", 10],
  ];

  test("rejects signed-in non-admins and anonymous identities", async () => {
    const guest = await register("Target Guest");
    for (const who of [outsiderId, null]) {
      for (const [name, ...args] of adminCalls(guest.id)) {
        await rejects(user(who, name, ...args), "NOT_ADMIN");
      }
    }
    assert.equal(await userValue(outsiderId, "is_admin"), false);
    assert.equal(await userValue(adminId, "is_admin"), true);
    assert.equal(await count("admin_audit_logs"), 0);
  });

  test("dashboard counts registered, eligible and ballots", async () => {
    const a = await register("Dash One");
    const b = await register("Dash Two");
    const c = await register("Dash Three");
    await setVoting("open");
    await server("submit_ballot", a.token, picks(b.id));
    await userValue(adminId, "admin_remove_guest", c.id, "test");
    assert.deepEqual(await userValue(adminId, "admin_dashboard"), {
      registered: 3, eligible: 2, ballots_cast: 1,
      registration_open: true, voting_status: "open", max_active_guests: 400,
    });
  });

  test("guest list shows voted or not voted, never when or for whom", async () => {
    const voter = await register("Has Voted");
    const other = await register("Not Yet");
    await setVoting("open");
    await server("submit_ballot", voter.token, picks(other.id));
    const list = await userValue(adminId, "admin_list_guests");
    assert.deepEqual(Object.keys(list[0]).sort(), [
      "full_name", "has_voted", "id", "registered_at", "removal_reason", "removed_at",
    ]);
    assert.deepEqual(list.map((g) => [g.full_name, g.has_voted]), [
      ["Has Voted", true], ["Not Yet", false],
    ]);
    const { rows } = await db.query("select voted_at from public.guests where id = $1", [voter.id]);
    assert.ok(rows[0].voted_at, "voted_at is still kept internally");
  });

  test("add guest enforces name rules and the limit", async () => {
    await userValue(adminId, "admin_add_guest", "Manual Guest");
    await rejects(userValue(adminId, "admin_add_guest", "manual guest"), "DUPLICATE_NAME");
    await rejects(userValue(adminId, "admin_add_guest", "1"), "INVALID_NAME");
    await db.query("update public.event_settings set max_active_guests = 1");
    await rejects(userValue(adminId, "admin_add_guest", "Over Limit"), "GUEST_LIMIT_REACHED");
  });

  test("removal needs a reason and records who removed", async () => {
    const guest = await register("To Remove");
    await rejects(userValue(adminId, "admin_remove_guest", guest.id, "  "), "REASON_REQUIRED");
    await userValue(adminId, "admin_remove_guest", guest.id, "duplicate entry");
    assert.equal(await count("guests", `removed_by = '${adminId}' and removal_reason = 'duplicate entry'`), 1);
    await rejects(userValue(adminId, "admin_remove_guest", guest.id, "again"), "GUEST_REMOVED");
    await rejects(userValue(adminId, "admin_issue_claim", guest.id, newHash()), "GUEST_REMOVED");
    await rejects(userValue(adminId, "admin_remove_guest", crypto.randomUUID(), "x"), "GUEST_NOT_FOUND");
  });

  test("restore refuses a duplicate name conflict, then works once resolved", async () => {
    const original = await register("Twin Name");
    await userValue(adminId, "admin_remove_guest", original.id, "test");
    const second = await register("Twin Name");
    await rejects(userValue(adminId, "admin_restore_guest", original.id), "DUPLICATE_NAME");
    await userValue(adminId, "admin_remove_guest", second.id, "test");
    await userValue(adminId, "admin_restore_guest", original.id);
    await rejects(userValue(adminId, "admin_restore_guest", original.id), "GUEST_NOT_REMOVED");
    assert.equal((await serverValue("guest_me", original.token)).full_name, "Twin Name");
  });

  test("updates settings partially and validates them", async () => {
    await userValue(adminId, "admin_update_event_settings", false, null, null);
    const result = await userValue(adminId, "admin_update_event_settings", null, "open", 2000);
    assert.deepEqual(result, { registration_open: false, voting_status: "open", max_active_guests: 2000 });
    for (const args of [[null, "finished", null], [null, null, 0], [null, null, 2001]]) {
      await rejects(userValue(adminId, "admin_update_event_settings", ...args), "INVALID_SETTINGS");
    }
  });

  test("audit log records every admin action without token hashes", async () => {
    const id = await userValue(adminId, "admin_add_guest", "Audited Guest");
    const claim = newHash();
    await userValue(adminId, "admin_issue_claim", id, claim);
    await userValue(adminId, "admin_remove_guest", id, "audit");
    await userValue(adminId, "admin_restore_guest", id);
    await userValue(adminId, "admin_update_event_settings", false, null, null);
    const { rows } = await db.query(
      "select action, admin_user_id, details::text from public.admin_audit_logs order by id",
    );
    assert.deepEqual(rows.map((r) => r.action), [
      "guest_added", "claim_issued", "guest_removed", "guest_restored", "settings_updated",
    ]);
    assert.ok(rows.every((r) => r.admin_user_id === adminId && !r.details.includes(claim)));
  });
});

describe("closing and reopening voting", () => {
  const settings = (...args) => userValue(adminId, "admin_update_event_settings", ...args);
  const close = () => settings(null, "closed", null, true);
  const reopen = (status = "open", reason = "closed by mistake") =>
    settings(null, status, null, false, true, reason);
  const status = async () =>
    (await db.query("select voting_status from public.event_settings")).rows[0].voting_status;
  const audit = async () =>
    (await db.query(
      "select action, admin_user_id, details ->> 'reason' as reason from public.admin_audit_logs order by id",
    )).rows;

  test("closing needs explicit confirmation", async () => {
    await setVoting("open");
    await rejects(settings(null, "closed", null), "CONFIRM_CLOSE_REQUIRED");
    await rejects(settings(null, "closed", null, null), "CONFIRM_CLOSE_REQUIRED");
    assert.equal(await status(), "open");
    assert.deepEqual(await audit(), []);
  });

  test("reopening needs its own confirmation and a reason", async () => {
    await close();
    await rejects(settings(null, "open", null), "CONFIRM_REOPEN_REQUIRED");
    await rejects(settings(null, "paused", null, true), "CONFIRM_REOPEN_REQUIRED");
    await rejects(reopen("open", null), "REASON_REQUIRED");
    await rejects(reopen("open", "   "), "REASON_REQUIRED");
    await rejects(reopen("open", "x".repeat(501)), "REASON_REQUIRED");
    assert.equal(await status(), "closed");
  });

  test("records who closed and reopened, with the reason, and hides results again", async () => {
    await setVoting("open");
    await close();
    assert.equal((await serverValue("public_results")).published, true);
    await reopen("open", "  closed by mistake  ");
    assert.deepEqual(await serverValue("public_results"), { published: false, results: [] });
    assert.deepEqual(await userValue(adminId, "admin_results"), { published: false, results: [] });
    assert.deepEqual(await audit(), [
      { action: "voting_closed", admin_user_id: adminId, reason: null },
      { action: "voting_reopened", admin_user_id: adminId, reason: "closed by mistake" },
    ]);
  });

  test("guests can vote again after reopening", async () => {
    const voter = await register("Late Voter");
    const other = await register("Late Nominee");
    await close();
    await rejects(server("submit_ballot", voter.token, picks(other.id)), "VOTING_NOT_OPEN");
    await reopen();
    await server("submit_ballot", voter.token, picks(other.id));
    assert.equal(await count("votes"), 3);
  });

  test("other settings stay editable while closed", async () => {
    await close();
    await settings(false, null, 500);
    await settings(null, "closed", null);
    assert.equal(await status(), "closed");
    assert.equal(await count("admin_audit_logs", "action = 'voting_closed'"), 1);
  });

  test("accepts no ballot after closing, and published totals match saved votes", async () => {
    const crowd = [];
    for (let i = 0; i < 20; i++) crowd.push(await register(`Closer ${i}x`));
    await setVoting("open");
    const ballots = crowd.map((who, i) =>
      server("submit_ballot", who.token, picks(crowd[(i + 1) % crowd.length].id)));
    const result = await outcomes([...ballots.slice(0, 10), close(), ...ballots.slice(10)]);
    assert.ok(result.errors.every((e) => e === "VOTING_NOT_OPEN"), result.errors.join());
    const published = await serverValue("public_results");
    assert.equal(published.results.reduce((sum, r) => sum + r.votes, 0), await count("votes"));
  });
});

describe("results", () => {
  const hidden = { published: false, results: [] };

  const castTwoBallots = async () => {
    const v1 = await register("Voter One");
    const v2 = await register("Voter Two");
    const a = await register("Alpha Star");
    const b = await register("Beta Star");
    await setVoting("open");
    await server("submit_ballot", v1.token, picks(a.id, a.id, b.id));
    await server("submit_ballot", v2.token, picks(a.id, b.id, a.id));
    return { v1, v2, a, b };
  };
  const category = async (position) =>
    (await serverValue("public_results")).results
      .filter((r) => r.category_id === categories[position])
      .map((r) => [r.nominee_name, r.votes, r.rank]);

  for (const status of ["not_started", "open", "paused"]) {
    test(`are hidden from the public and the admin while voting is ${status}`, async () => {
      await castTwoBallots();
      await setVoting(status);
      assert.deepEqual(await serverValue("public_results"), hidden);
      assert.deepEqual(await userValue(adminId, "admin_results"), hidden);
    });
  }

  test("are published to both when voting closes", async () => {
    await castTwoBallots();
    await userValue(adminId, "admin_update_event_settings", null, "closed", null, true);
    const published = await serverValue("public_results");
    assert.equal(published.published, true);
    assert.equal(published.results.find((r) => r.nominee_name === "Alpha Star").votes, 2);
    assert.deepEqual(await userValue(adminId, "admin_results"), published);
    const guests = await userValue(adminId, "admin_list_guests");
    assert.deepEqual(guests.map((g) => g.has_voted), [false, false, true, true]);
    assert.doesNotMatch(JSON.stringify(guests), /Spotlight|nominee|voted_at/);
  });

  test("admin still sees turnout and voted status while open, but no award data", async () => {
    const { a } = await castTwoBallots();
    const dashboard = await userValue(adminId, "admin_dashboard");
    const guests = await userValue(adminId, "admin_list_guests");
    assert.equal(dashboard.ballots_cast, 2);
    assert.equal(dashboard.eligible, 4);
    assert.deepEqual(guests.map((g) => g.has_voted), [false, false, true, true]);
    const seen = JSON.stringify([dashboard, guests, await userValue(adminId, "admin_results")]);
    assert.doesNotMatch(seen, /Spotlight|Eyes-On-Me|Fashion|nominee|"votes"|"rank"/);
    assert.equal(guests.find((g) => g.id === a.id).has_voted, false);
  });

  test("show every category even with no votes", async () => {
    await setVoting("closed");
    const { results } = await serverValue("public_results");
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.nominee_name === null && r.votes === 0 && r.rank === null));
  });

  test("hold only aggregate fields, rank ties, and follow removal and restoration", async () => {
    const { v1, v2, a } = await castTwoBallots();
    await setVoting("closed");

    assert.deepEqual(Object.keys((await serverValue("public_results")).results[0]).sort(), [
      "category_description", "category_id", "category_name", "nominee_name", "rank",
      "sort_order", "votes",
    ]);
    assert.deepEqual(await category(0), [["Alpha Star", 2, 1]]);
    assert.deepEqual(await category(1), [["Alpha Star", 1, 1], ["Beta Star", 1, 1]]);

    await userValue(adminId, "admin_remove_guest", v2.id, "test");
    assert.deepEqual(await category(0), [["Alpha Star", 1, 1]]);
    await userValue(adminId, "admin_remove_guest", a.id, "test");
    assert.deepEqual(await category(0), [[null, 0, null]]);
    assert.equal((await serverValue("guest_me", v1.token)).has_voted, true);

    await userValue(adminId, "admin_restore_guest", a.id);
    await userValue(adminId, "admin_restore_guest", v2.id);
    assert.deepEqual(await category(0), [["Alpha Star", 2, 1]]);
  });
});

describe("complete event workflow", () => {
  test("runs from closed registration to published results using only app calls", async () => {
    const settings = (...args) => userValue(adminId, "admin_update_event_settings", ...args);
    await settings(false, "not_started", null);
    await rejects(register("Too Early"), "REGISTRATION_CLOSED");
    await settings(true, null, null);

    const ana = await register("Ana Reyes");
    const ben = await register("Ben Santos");
    assert.equal((await serverValue("guest_me", ana.token)).voting_status, "not_started");

    // manual guest joins through a claim link
    const caraId = await userValue(adminId, "admin_add_guest", "Cara Lim");
    const claim = newHash();
    await userValue(adminId, "admin_issue_claim", caraId, claim);
    assert.equal((await serverValue("claim_preview", claim)).full_name, "Cara Lim");
    const cara = newHash();
    assert.equal((await serverValue("claim_guest", claim, cara)).ok, true);

    await settings(false, "open", null);
    const { nominees } = await serverValue("ballot_nominees", cara);
    assert.deepEqual(nominees.map((n) => n.full_name), ["Ana Reyes", "Ben Santos"]);
    await server("submit_ballot", ana.token, picks(ben.id, caraId, ben.id));
    await server("submit_ballot", ben.token, picks(ana.id, caraId, ana.id));
    await settings(null, "paused", null);
    await rejects(server("submit_ballot", cara, picks(ana.id)), "VOTING_NOT_OPEN");
    await settings(null, "open", null);
    await server("submit_ballot", cara, picks(ben.id, ana.id, ana.id));
    assert.equal((await serverValue("guest_me", cara)).has_voted, true);
    assert.equal((await serverValue("public_results")).published, false);

    await settings(null, "closed", null, true);
    const winners = (await serverValue("public_results")).results
      .filter((r) => r.rank === 1)
      .map((r) => [r.category_name, r.nominee_name, r.votes]);
    assert.deepEqual(winners, [
      ["Spotlight Stealer Award", "Ben Santos", 2],
      ["The Eyes-On-Me Award", "Cara Lim", 2],
      ["Fashion Icon Award", "Ana Reyes", 2],
    ]);
    assert.equal((await userValue(adminId, "admin_dashboard")).ballots_cast, 3);
  });
});

// Last: destroys the schema.
describe("rollback", () => {
  // psql keeps running after an error, so the refusal must abort the whole script.
  test("deletes nothing when run unconfirmed through psql", async () => {
    const run = spawnSync(
      "docker",
      ["exec", "-i", "supabase_db_voting-app", "psql", "-U", "postgres", "-d", "postgres"],
      { input: readSql("rollback/initial_schema.down.sql"), encoding: "utf8" },
    );
    assert.match(run.stderr, /Rollback refused/);
    const { rows } = await db.query(
      "select to_regclass('public.votes')::text as votes, to_regnamespace('private')::text as private",
    );
    assert.deepEqual(rows[0], { votes: "votes", private: "private" });
  });

  test("refuses to run without confirmation, then removes everything", async () => {
    await assert.rejects(db.query(readSql("rollback/initial_schema.down.sql")), /confirm_rollback/);
    assert.equal(await count("award_categories"), 3);
    await db.query("delete from public.admins");
    await rollback();
    const { rows } = await db.query(
      `select to_regnamespace('private') as private,
              (select count(*)::int from pg_proc
                where pronamespace = 'public'::regnamespace) as functions,
              (select count(*)::int from pg_class
                where relnamespace = 'public'::regnamespace) as relations`,
    );
    assert.deepEqual(rows[0], { private: null, functions: 0, relations: 0 });
    await migrate();
  });
});
