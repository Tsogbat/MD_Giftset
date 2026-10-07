// Serves cached product photos from data/photos only (?w=<px> for a smaller copy).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PHOTO_DIR } from "@/lib/artbox/client";

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  if (parts?.length !== 2 || parts[0] !== "photos" || !/^[\w-]+\.jpg$/i.test(parts[1])) return new Response("Not found", { status: 404 });
  const file = path.join(PHOTO_DIR, parts[1].toLowerCase());
  if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const w = Number(new URL(req.url).searchParams.get("w"));
  const body = Number.isInteger(w) && w >= 32 && w < 320 ? await sharp(file).resize(w, w, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer() : fs.readFileSync(file);
  return new Response(new Uint8Array(body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
