// Runs the app against the LOCAL Supabase stack. Keys are read from the running stack
// and passed to this process only: nothing is written to disk, and these values take
// priority over .env.local, so local testing never reaches the live project.
import { execSync, spawn } from "node:child_process";
import { localKeys } from "./local-supabase.mjs";

const keys = localKeys(execSync);
spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: keys.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.publishable,
    SUPABASE_SECRET_KEY: keys.secret,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}).on("exit", (code) => process.exit(code ?? 0));
