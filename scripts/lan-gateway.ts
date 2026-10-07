// Office-network gateway for Gift Set Studio (user 2026-10-07: colleagues at HQ use it from their PCs with a
// shared password and their own name). The app itself stays on 127.0.0.1:3200 (this PC only). This gateway
// listens on the PC's network address(es), e.g. http://HQ-SJ07:3200, asks once for LAN_PASSWORD (.env), then
// forwards to the app. Sessions are signed cookies (30 days) carrying the person's name; the signing key
// lives in data/lan-secret. The name reaches the app as x-gs-user (agent turns, answers, versions and
// uploads record it); a browser cannot send that header itself.
//   npm run lan
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { env } from "../src/lib/env";

const UPSTREAM = { host: "127.0.0.1", port: Number(env("PORT") ?? 3200) };
const PORT = Number(env("LAN_PORT") ?? 3200);
const COOKIE = "gs_lan";
const DAYS = 30;
const LOG = path.resolve("data/logs/lan-gateway.log");

const password = env("LAN_PASSWORD") ?? "";
if (password.length < 4) {
  console.error("Set LAN_PASSWORD (at least 4 characters) in .env, then run `npm run lan` again.");
  process.exit(1);
}
const secretFile = path.resolve("data/lan-secret");
fs.mkdirSync(path.dirname(secretFile), { recursive: true });
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
// the key changes when the password changes, so changing the password signs everyone out
const key = crypto.createHash("sha256").update(fs.readFileSync(secretFile, "utf8").trim() + "\0" + password).digest();

const mac = (s: string) => crypto.createHmac("sha256", key).update(s).digest("base64url");
// "<exp>.<name, base64url>.<mac>"
const sign = (exp: number, name: string) => {
  const n = Buffer.from(name).toString("base64url");
  return `${exp}.${n}.${mac(`${exp}.${n}`)}`;
};
function session(cookieHeader: string | undefined): { name: string } | null {
  const m = (cookieHeader ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || Number(parts[0]) < Date.now()) return null;
  const name = Buffer.from(parts[1], "base64url").toString("utf8");
  const want = Buffer.from(sign(Number(parts[0]), name)), got = Buffer.from(m[1]);
  if (!name || want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return { name };
}
const cleanName = (s: string | null) => (s ?? "").replace(/[\u0000-\u001f<>"]/g, "").trim().slice(0, 40);
const passwordOk = (p: string) => {
  const a = crypto.createHash("sha256").update(p).digest(), b = crypto.createHash("sha256").update(password).digest();
  return crypto.timingSafeEqual(a, b);
};

// failed logins per address: 10 in 10 minutes locks that address for 10 minutes
const fails = new Map<string, number[]>();
const recentFails = (ip: string) => (fails.get(ip) ?? []).filter((t) => t > Date.now() - 10 * 60_000);
const locked = (ip: string) => recentFails(ip).length >= 10;

function log(line: string) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

const PUBLIC = new Set(["/icon.svg", "/favicon.ico"]);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function loginPage(next: string, message = "", opts: { name?: string; signedIn?: boolean } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gift Set Studio · sign in</title><link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f5f2;font-family:"Segoe UI",system-ui,sans-serif;color:#1d1d1f}
form{background:#fff;border:1px solid #e4e2dc;border-radius:10px;padding:28px 30px;width:320px;box-shadow:0 2px 10px rgba(0,0,0,.05)}
h1{font-size:20px;margin:10px 0 4px}p{color:#6b6b70;font-size:13px;margin:0 0 16px}input{width:100%;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid #c9c7c0;border-radius:8px}
button{margin-top:12px;width:100%;font:inherit;padding:8px;border:0;border-radius:8px;background:#c8102e;color:#fff;cursor:pointer}.err{color:#b3261e;font-weight:600}</style></head>
<body><form method="post" action="/__login"><img src="/icon.svg" width="40" height="40" alt=""><h1>Gift Set Studio</h1><p>ARTBOX Mongolia · office network (${esc(os.hostname())})</p>
${message ? `<p class="err">${esc(message)}</p>` : ""}<input type="hidden" name="next" value="${esc(next)}">
<input name="name" placeholder="Your name (shown on your answers and versions)" value="${esc(opts.name ?? "")}" maxlength="40" required ${opts.signedIn || !opts.name ? "autofocus" : ""}>
${opts.signedIn ? "" : `<input type="password" name="password" placeholder="Password" required style="margin-top:8px" ${opts.name ? "autofocus" : ""}>`}
<button type="submit">${opts.signedIn ? "Continue" : "Sign in"}</button></form></body></html>`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 10_000) req.destroy();
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

/** Headers for the app: local host, origin and referer (so the dev server treats it as same-origin). */
function upstreamHeaders(req: http.IncomingMessage, ip: string) {
  const h: http.OutgoingHttpHeaders = { ...req.headers };
  const local = `${UPSTREAM.host}:${UPSTREAM.port}`;
  h.host = local;
  for (const k of ["origin", "referer"] as const) {
    const v = req.headers[k];
    if (typeof v === "string") h[k] = v.replace(/^https?:\/\/[^/]+/, `http://${local}`);
  }
  h["x-forwarded-for"] = ip;
  h["x-gs-lan"] = "1";
  // who is working: only the gateway sets it, from the signed session
  delete h["x-gs-user"];
  const who = session(req.headers.cookie)?.name;
  if (who) h["x-gs-user"] = encodeURIComponent(who);
  if (typeof h.cookie === "string") {
    const rest = h.cookie.split(/;\s*/).filter((c) => c && !c.startsWith(`${COOKIE}=`)).join("; ");
    if (rest) h.cookie = rest;
    else delete h.cookie;
  }
  return h;
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    log(`error ${req.method} ${req.url}: ${(e as Error).message}`);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Gateway error");
  });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const ip = (req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  const url = new URL(req.url ?? "/", "http://lan");
  if (url.pathname === "/__login") {
    if (req.method === "POST") {
      if (locked(ip)) {
        res.writeHead(429, { "content-type": "text/html; charset=utf-8" }).end(loginPage("/", "Too many attempts. Try again in 10 minutes."));
        return;
      }
      const form = new URLSearchParams(await readBody(req));
      const want = form.get("next") ?? "/";
      const next = want.startsWith("/") && !want.startsWith("//") && !want.startsWith("/\\") ? want : "/";
      const name = cleanName(form.get("name"));
      const signedIn = !!session(req.headers.cookie);
      if (!name) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(loginPage(next, "Enter your name.", { signedIn }));
        return;
      }
      // the password, or an existing session that only changes its name
      if (signedIn || passwordOk(form.get("password") ?? "")) {
        const exp = Date.now() + DAYS * 86_400_000;
        log(`${ip} signed in as ${name}`);
        res.writeHead(303, { location: next, "set-cookie": `${COOKIE}=${sign(exp, name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86_400}` }).end();
      } else {
        fails.set(ip, [...recentFails(ip), Date.now()]);
        log(`${ip} wrong password`);
        await new Promise((r) => setTimeout(r, 800));
        res.writeHead(401, { "content-type": "text/html; charset=utf-8" }).end(loginPage(next, "Wrong password.", { name }));
      }
      return;
    }
    const cur = session(req.headers.cookie);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(loginPage(url.searchParams.get("next") ?? "/", "", { name: cur?.name ?? "", signedIn: !!cur }));
    return;
  }
  if (url.pathname === "/__logout") {
    res.writeHead(303, { location: "/__login", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` }).end();
    return;
  }
  if (!PUBLIC.has(url.pathname) && !session(req.headers.cookie)) {
    const html = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
    if (html) res.writeHead(302, { location: `/__login?next=${encodeURIComponent(url.pathname + url.search)}` }).end();
    else res.writeHead(401, { "content-type": "text/plain" }).end("Sign in at /__login");
    return;
  }
  const up = http.request({ ...UPSTREAM, method: req.method, path: req.url, headers: upstreamHeaders(req, ip) }, (r) => {
    const headers = { ...r.headers };
    const loc = headers.location;
    if (typeof loc === "string") headers.location = loc.replace(new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${UPSTREAM.port}`), "");
    res.writeHead(r.statusCode ?? 502, headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Gift Set Studio is not running on ${os.hostname()} right now (start it with "Start Gift Set Studio.cmd").`);
  });
  req.pipe(up);
}

// websockets (the dev server's live reload) for signed-in browsers
server.on("upgrade", (req, socket, head) => {
  if (!session(req.headers.cookie)) return socket.destroy();
  const ip = (req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  const up = net.connect(UPSTREAM.port, UPSTREAM.host, () => {
    const h = upstreamHeaders(req, ip);
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(h).flatMap(([k, v]) => (v === undefined ? [] : Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`])), "", ""];
    up.write(lines.join("\r\n"));
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

// every non-loopback IPv4 address of this PC (the app keeps 127.0.0.1 for itself)
const addresses = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);
if (!addresses.length) {
  console.error("No network address found.");
  process.exit(1);
}
for (const a of addresses) {
  const s = a === addresses[0] ? server : http.createServer((req, res) => server.emit("request", req, res));
  if (s !== server) s.on("upgrade", (req, socket, head) => server.emit("upgrade", req, socket, head));
  s.listen(PORT, a, () => console.log(`Gift Set Studio on the office network: http://${os.hostname()}:${PORT} (${a}:${PORT}) → app at http://${UPSTREAM.host}:${UPSTREAM.port}`));
}
log(`gateway started on ${addresses.join(", ")}:${PORT}`);
