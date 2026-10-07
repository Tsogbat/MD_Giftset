// Writes only from the app's own pages. On the office network the gateway's session cookie is SameSite=Lax,
// and on this PC the app has no sign-in at all, so without this check any other website open in a browser
// could post to /api and change projects. Browsers say where a request comes from (Sec-Fetch-Site, Origin);
// scripts and the agent's tools send neither and are not affected.
import { NextResponse, type NextRequest } from "next/server";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(req: NextRequest) {
  if (SAFE.has(req.method)) return NextResponse.next();
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return forbidden();
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      return forbidden();
    }
    if (host !== req.headers.get("host")) return forbidden();
  } else if (origin === "null") {
    return forbidden();
  }
  return NextResponse.next();
}

const forbidden = () => new NextResponse("Forbidden: requests from other sites cannot change data here.", { status: 403 });

export const config = { matcher: "/api/:path*" };
