// Drives an installed Chrome or Edge, headless, over the DevTools protocol. No dependency:
// Node supplies WebSocket. Set BROWSER_PATH if the browser lives somewhere else.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path && existsSync(path));

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launch() {
  assert.ok(executable, "no Chrome or Edge found: set BROWSER_PATH");
  const profile = mkdtempSync(join(tmpdir(), "voting-browser-"));
  const child = spawn(executable, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    `--user-data-dir=${profile}`,
  ]);
  const address = await new Promise((resolve, reject) => {
    let log = "";
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const found = log.match(/DevTools listening on (ws:\S+)/);
      if (found) resolve(found[1]);
    });
    child.on("exit", () => reject(new Error(`browser did not start:\n${log}`)));
  });

  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const waiting = new Map();
  const listeners = new Map();
  let id = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method) return listeners.get(message.sessionId)?.(message);
    const { resolve, reject } = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      // never hang a test run on a reply that does not come
      const timer = setTimeout(() => reject(new Error(`no reply to ${method}`)), 15000);
      timer.unref();
      waiting.set(request, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      socket.send(JSON.stringify({ id: request, method, params, sessionId }));
    });

  /** A new device with its own cookies: a small touch screen unless told otherwise. */
  async function phone(screen = { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }) {
    const { browserContextId } = await send("Target.createBrowserContext");
    const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);

    let holding = false;
    const held = [];
    const resume = (requestId) =>
      // a request abandoned by a navigation can no longer be continued
      call("Fetch.continueRequest", { requestId }).catch(() => {});
    listeners.set(sessionId, ({ method, params }) => {
      if (method !== "Fetch.requestPaused") return;
      if (holding) held.push(params.requestId);
      else resume(params.requestId);
    });
    await call("Fetch.enable", {
      patterns: [{ urlPattern: "*.js" }, { urlPattern: "*/vote?_rsc*" }],
    });
    const resize = (size) => call("Emulation.setDeviceMetricsOverride", size);
    await resize(screen);

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text);
      return result.value;
    };
    /** Waits until the expression is truthy, across page loads. */
    async function until(expression) {
      for (let i = 0; i < 300; i++) {
        if (await evaluate(expression).catch(() => false)) return;
        await pause(50);
      }
      const text = await evaluate("document.body?.innerText").catch(() => "");
      assert.fail(`never true: ${expression}\npage shows: ${text}`);
    }
    /** Real mouse clicks on the middle of the element the expression returns. */
    async function tap(element, times = 1) {
      await until(`Boolean(${element})`);
      const { x, y } = await evaluate(`(() => {
        const target = ${element};
        target.scrollIntoView({ block: "center" });
        const box = target.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()`);
      const events = [];
      for (let clickCount = 1; clickCount <= times; clickCount++) {
        for (const type of ["mousePressed", "mouseReleased"]) {
          events.push(call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount }));
        }
      }
      // the browser may never answer for an event whose page a click has already left
      await Promise.race([Promise.all(events), pause(1000)]);
    }

    return {
      goto: (url) => call("Page.navigate", { url }),
      evaluate,
      until,
      tap,
      resize,
      /** One key, as a presentation clicker or keyboard sends it. */
      async press(key, code = key, keyCode = 0) {
        for (const type of ["keyDown", "keyUp"]) {
          await call("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode });
        }
      },
      async screenshot(path) {
        const { data } = await call("Page.captureScreenshot", { format: "png" });
        writeFileSync(path, Buffer.from(data, "base64"));
      },
      clearCookies: () => call("Network.clearBrowserCookies"),
      /** Slow Wi-Fi: scripts (and the ballot's data) wait until releaseScripts(). */
      holdScripts: () => (holding = true),
      releaseScripts() {
        holding = false;
        held.splice(0).forEach(resume);
      },
    };
  }

  async function close() {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await send("Browser.close").catch(() => child.kill());
    await Promise.race([exited, pause(5000)]);
    socket.close();
    // the browser can hold its files a moment longer; a leftover temp folder is harmless
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  return { phone, close };
}

/** Page expressions shared by the tests. */
export const hasText = (text) => `document.body?.innerText.includes(${JSON.stringify(text)})`;
export const button = (label) =>
  `[...document.querySelectorAll("button, a")].find((e) => e.innerText.trim() === ${JSON.stringify(label)})`;
/** True once React has taken over the element. */
export const hydrated = (selector) =>
  `Object.keys(document.querySelector(${JSON.stringify(selector)}) ?? {}).some((k) => k.startsWith("__react"))`;
