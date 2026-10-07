// Who has a project open (colleagues on the office network work at the same time). Each open workspace
// checks in every 15 s; kept in memory because it only describes the last half minute.
type Seen = { user: string; at: number };
const g = globalThis as unknown as { gsPresence?: Map<number, Map<string, Seen>> };
const presence = (g.gsPresence ??= new Map());
const TTL = 32_000; // two missed check-ins

export function checkIn(projectId: number, sid: string, user: string) {
  const here = presence.get(projectId) ?? new Map<string, Seen>();
  here.set(sid, { user, at: Date.now() });
  presence.set(projectId, here);
}

export function leave(projectId: number, sid: string) {
  presence.get(projectId)?.delete(sid);
}

/** People with the project open, each once; `except` leaves out yourself (your other tabs too). */
export function whoIsOn(projectId: number, except?: string): string[] {
  const here = presence.get(projectId);
  if (!here) return [];
  const now = Date.now();
  for (const [k, v] of here) if (now - v.at > TTL) here.delete(k);
  return [...new Set([...here.values()].map((v) => v.user))].filter((u) => u !== except);
}
