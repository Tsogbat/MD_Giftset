// Environment access. Next.js loads .env itself; scripts run with tsx load it here.
import fs from "node:fs";

let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  if (fs.existsSync(".env")) {
    try {
      process.loadEnvFile(".env");
    } catch {
      /* ignore malformed lines; Next reports them */
    }
  }
}

export function env(name: string): string | undefined {
  load();
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

const SECRET_NAMES = ["DB_PASS", "ARTBOX_IMG_PW", "LAN_PASSWORD", "CLAUDE_CODE_OAUTH_TOKEN"];

/** Remove secret values from text that may reach logs or the UI. */
export function redact(text: string): string {
  let out = text;
  for (const n of SECRET_NAMES) {
    const v = env(n);
    if (v && v.length >= 4) out = out.split(v).join(`<${n}>`);
  }
  return out.replace(/sk-ant-[a-z]+\d*-[A-Za-z0-9_-]+/g, "<token>");
}
