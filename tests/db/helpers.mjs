// Runs against the LOCAL Supabase database only (`npx supabase db start`).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

// Fixed local address on purpose: these tests destroy data, so no env override.
const connectionString = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const db = new pg.Pool({ connectionString, max: 60 });

const root = new URL("../../supabase/", import.meta.url);
export const readSql = (path) => readFileSync(new URL(path, root), "utf8");

export const rollback = () =>
  db.query(
    `set dinner_awards.confirm_rollback = 'on';\n${readSql("rollback/initial_schema.down.sql")}\nreset dinner_awards.confirm_rollback;`,
  );

export async function migrate() {
  for (const file of readdirSync(new URL("migrations/", root)).sort()) {
    await db.query(readSql(`migrations/${file}`));
  }
}

/** Run one query in a transaction as a Supabase API role, optionally as a signed-in user. */
export async function as(role, userId, text, values = []) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${client.escapeIdentifier(role)}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    const result = await client.query(text, values);
    await client.query("commit");
    return result.rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const call = (name, args) =>
  `select * from public.${name}(${args.map((_, i) => `$${i + 1}`).join(", ")})`;

/** Server-side guest call (secret key). */
export const server = (name, ...args) => as("service_role", null, call(name, args), args);
export const serverValue = async (name, ...args) => (await server(name, ...args))[0]?.[name];

/** Signed-in user call (publishable key plus user JWT). */
export const user = (userId, name, ...args) => as("authenticated", userId, call(name, args), args);
export const userValue = async (userId, name, ...args) =>
  (await user(userId, name, ...args))[0]?.[name];

export const newHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");

export async function createAuthUser({ admin }) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.invalid`]);
  if (admin) await db.query("insert into public.admins (user_id) values ($1)", [id]);
  return id;
}

export async function reset() {
  await db.query(`
    truncate public.votes, public.guest_sessions, public.guest_claims, public.claim_failures,
             public.admin_audit_logs, public.guests;
    update public.event_settings
       set registration_open = true, voting_status = 'not_started', max_active_guests = 400;
  `);
}

export async function register(name) {
  const token = newHash();
  const result = await serverValue("register_guest", name, token);
  return { id: result.guest_id, token, expiresAt: result.expires_at, name: result.full_name };
}

export const setVoting = (status) =>
  db.query("update public.event_settings set voting_status = $1", [status]);

/** Category ids in display order, filled by loadCategories(). */
export const categories = [];

export async function loadCategories() {
  const { rows } = await db.query("select id from public.award_categories order by sort_order");
  categories.splice(0, categories.length, ...rows.map((r) => r.id));
}

export const picks = (a, b = a, c = a) =>
  Object.fromEntries([a, b, c].map((nominee, i) => [categories[i], nominee]));

export const count = async (table, where = "true") =>
  Number((await db.query(`select count(*) from public.${table} where ${where}`)).rows[0].count);
