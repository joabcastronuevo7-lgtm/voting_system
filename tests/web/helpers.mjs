// A local dev server, and a browser without JavaScript: cookies plus plain form posts.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { localKeys } from "../../scripts/local-supabase.mjs";

export const base = "http://localhost:3100";

/** Builds for production against the local stack and returns the command that serves it. */
function productionServer() {
  const keys = localKeys(execSync);
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: keys.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.publishable,
    SUPABASE_SECRET_KEY: keys.secret,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  };
  execSync("npx next build", { env, stdio: "ignore" });
  return [["node_modules/next/dist/bin/next", "start", "-p", "3100"], env];
}

/** Starts the app against the local stack; returns a function that stops it. */
export async function startServer({ production = false } = {}) {
  await assert.rejects(fetch(base), `a server is already running at ${base}`);
  const [args, env] = production
    ? productionServer()
    : [["scripts/dev-local.mjs", "-p", "3100"], process.env];
  const server = spawn(process.execPath, args, { env, stdio: "pipe" });
  let output = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => (output += chunk));
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {}
    assert.ok(i < 120, "dev server did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const stop = () => {
    if (process.platform !== "win32") return server.kill();
    try {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    } catch {
      // taskkill also fails when a child exits while the tree is being stopped. Throwing here
      // would skip the data cleanup; a server left running fails the next start instead.
    }
  };
  /** Everything the server has printed so far. */
  stop.output = () => output;
  return stop;
}

const unescape = (s) =>
  s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

export function browser() {
  const jar = new Map();
  const send = async (path, init = {}) => {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetch(base + path, {
      ...init,
      redirect: "manual",
      headers: { ...init.headers, ...(cookie ? { cookie } : {}) },
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0];
      const at = pair.indexOf("=");
      const value = pair.slice(at + 1);
      if (value && !/max-age=0\b/i.test(line)) jar.set(pair.slice(0, at), value);
      else jar.delete(pair.slice(0, at));
    }
    return {
      status: response.status,
      location: response.headers.get("location"),
      html: (await response.text()).replaceAll("<!-- -->", ""),
    };
  };

  const get = (path) => send(path);

  /**
   * Loads `path`, picks the first form whose markup contains every string in `match`,
   * and posts it with `values`. `from` posts a form taken from an older page load.
   */
  async function post(path, match, values = {}, from) {
    const { html } = from ?? (await get(path));
    const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
      .map(([markup]) => markup)
      .find((markup) => [match].flat().every((text) => markup.includes(text)));
    assert.ok(form, `no form on ${path} containing ${match}`);
    const body = new FormData();
    for (const [input] of form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
      const name = input.match(/\bname="([^"]*)"/)?.[1];
      const value = input.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
      if (name) body.append(unescape(name), unescape(value));
    }
    for (const [name, value] of Object.entries(values)) body.set(name, value);
    // as browsers do: a page with `no-referrer` posts its forms with `Origin: null`
    const hidden = /<meta name="referrer" content="no-referrer"/.test(html);
    return send(path, { method: "POST", body, headers: { origin: hidden ? "null" : base } });
  }

  return { jar, get, post };
}
