// Who is working. On the office network the LAN gateway sets x-gs-user from its signed session
// (a browser cannot send it itself); on this PC it falls back to DEFAULT_USER or "This PC".
import { headers } from "next/headers";
import { env } from "./env";

export async function currentUser(): Promise<string> {
  const h = await headers();
  const v = h.get("x-gs-user");
  if (v) {
    try {
      return decodeURIComponent(v).slice(0, 40);
    } catch {
      /* fall through */
    }
  }
  return env("DEFAULT_USER") ?? "This PC";
}

/** True when the request came through the office-network gateway (it signs people in). */
export async function viaLan(): Promise<boolean> {
  return (await headers()).get("x-gs-lan") === "1";
}
