// img.artbox.kr catalog: login, search by SKU code (or barcode), package size and photo.
// Flow from Documents\Tsagaan gar\gift_bundles.py (catalog_opener / fetch_catalog / fetch_images).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { requireEnv } from "../env";

const BASE = "http://img.artbox.kr";
const UA = "Mozilla/5.0";

export type CatalogHit = {
  code: string;
  found: boolean;
  sizeRaw?: string;
  dims?: [number, number, number]; // mm, longest first
  imgUrl?: string;
  krName?: string;
};

export class ArtboxSession {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private keep(res: Response) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  private async request(url: string, body?: URLSearchParams): Promise<Response> {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "User-Agent": UA,
        Referer: `${BASE}/main/Search.Asp`,
        Cookie: this.cookieHeader(),
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    this.keep(res);
    return res;
  }

  async login(): Promise<void> {
    await this.request(`${BASE}/login.asp`);
    const res = await this.request(
      `${BASE}/Login_P.asp`,
      new URLSearchParams({ LoginID: requireEnv("ARTBOX_IMG_ID"), LoginPW: requireEnv("ARTBOX_IMG_PW") }),
    );
    await res.arrayBuffer();
    if (this.cookies.size === 0) throw new Error("img.artbox.kr login returned no session cookie");
  }

  async search(keyword: string): Promise<string> {
    const res = await this.request(
      `${BASE}/main/Fetch_Search.Asp`,
      new URLSearchParams({ kwd: keyword, arrayYn: "", page: "1", pagesize: "20", sort: "" }),
    );
    return decode(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type"));
  }

  /** Look a code up; falls back to the barcode when the code finds nothing. */
  async lookup(code: string, barcode?: string | null): Promise<CatalogHit> {
    const hit = parseSearch(await this.search(code), code);
    if (hit.found || !barcode) return hit;
    return { ...parseSearch(await this.search(barcode), code, barcode), code };
  }
}

export function decode(buf: Buffer, contentType: string | null): string {
  const cs = /charset=([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  const utf8 = buf.toString("utf8");
  if (cs === "utf-8" || cs === "utf8") return utf8;
  if (cs && cs !== "utf-8") return new TextDecoder(cs === "ks_c_5601-1987" ? "euc-kr" : cs).decode(buf);
  // No header charset: Korean ASP pages are usually EUC-KR; keep UTF-8 when it decodes cleanly.
  return utf8.includes("�") ? new TextDecoder("euc-kr").decode(buf) : utf8;
}

/** Parse "W*H*D" (mm) into dimensions sorted longest first. "미입력" = not entered. */
export function parseDims(raw: string | undefined): [number, number, number] | undefined {
  if (!raw || /미입력/.test(raw)) return undefined;
  const nums = raw.split(/[*xX×]/).map((s) => Number(s.replace(/[^\d.]/g, "")));
  if (nums.length < 2 || nums.some((n) => !Number.isFinite(n) || n <= 0)) return undefined;
  while (nums.length < 3) nums.push(1);
  const d = nums.slice(0, 3).sort((a, b) => b - a);
  return [d[0], d[1], d[2]];
}

/** Find the product_list_item for this code (or barcode) in a Fetch_Search.Asp response. */
export function parseSearch(html: string, code: string, barcode?: string): CatalogHit {
  const items = html.split(/<li[^>]*class=["']product_list_item["']/i).slice(1);
  const want = (s: string) => new RegExp(`god_code=['"]${code}['"]`, "i").test(s) || (!!barcode && new RegExp(`barcode=['"]${barcode}['"]`, "i").test(s));
  const item = items.find(want) ?? (barcode ? items[0] : undefined);
  if (!item) return { code, found: false };
  const sizeRaw = /규격\s*:\s*([^<\n]+)/.exec(item)?.[1]?.trim();
  const krName = /제품명\s*:\s*([^<\n]+)/.exec(item)?.[1]?.trim();
  const img =
    new RegExp(`data-value=["'](http://img\\.artbox\\.kr/goods/\\d+/${code}\\.(?:jpe?g|png))["']`, "i").exec(item)?.[1] ??
    /data-value=["'](http:\/\/img\.artbox\.kr\/goods\/[^"']+\.(?:jpe?g|png))["']/i.exec(item)?.[1];
  return { code, found: true, sizeRaw, dims: parseDims(sizeRaw), imgUrl: img, krName };
}

export const PHOTO_DIR = path.resolve("data/photos");

/** Download a photo as a 320 px JPEG (q82) into data/photos/<code>.jpg; returns the path. */
export async function savePhoto(code: string, url: string): Promise<string> {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const file = path.join(PHOTO_DIR, `${code}.jpg`);
  if (fs.existsSync(file)) return file;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`photo ${code}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const part = file + ".part";
  await sharp(buf).resize(320, 320, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toFile(part);
  fs.renameSync(part, file);
  return file;
}
