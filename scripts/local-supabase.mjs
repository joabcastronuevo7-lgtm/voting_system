export function localKeys(execSync) {
  const out = execSync("npx supabase status -o json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(out.slice(out.indexOf("{")));
  const keys = {
    url: status.API_URL,
    publishable: status.PUBLISHABLE_KEY,
    secret: status.SECRET_KEY,
  };
  if (!Object.values(keys).every(Boolean) || !/\/\/(127\.0\.0\.1|localhost):/.test(keys.url)) {
    throw new Error("Local Supabase API is not running. Start it with: npx supabase start");
  }
  return keys;
}
