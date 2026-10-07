// img.artbox.kr facts per SKU (package size + photo), cached in CatalogItem and data/photos.
// Seeded once from the earlier projects' caches (Tsagaan gar\catalog.csv, Redbox\img, Tsagaan gar\img).
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db";
import { ArtboxSession, parseDims, savePhoto, PHOTO_DIR } from "./artbox/client";

export type CatalogFacts = { code: string; found: boolean; dims?: [number, number, number]; imgUrl?: string | null; krName?: string | null; photo?: string | null };

export function photoPath(code: string): string | null {
  const f = path.join(PHOTO_DIR, `${code}.jpg`);
  return fs.existsSync(f) ? f : null;
}

export function photoUrl(code: string): string {
  return `/media/photos/${code}.jpg`;
}

/** Look up codes that aren't cached yet (6 at a time, like the Python scripts). */
export async function ensureCatalog(items: Array<{ code: string; barcode?: string | null }>, onProgress?: (done: number, total: number) => void): Promise<Map<string, CatalogFacts>> {
  const codes = [...new Set(items.map((i) => i.code))];
  const known = await prisma.catalogItem.findMany({ where: { code: { in: codes } } });
  const have = new Set(known.map((k) => k.code));
  const missing = items.filter((i, idx) => !have.has(i.code) && items.findIndex((j) => j.code === i.code) === idx);
  if (missing.length) {
    const session = new ArtboxSession();
    await session.login();
    let done = 0;
    const queue = [...missing];
    const worker = async () => {
      for (let it = queue.shift(); it; it = queue.shift()) {
        try {
          const hit = await session.lookup(it.code, it.barcode);
          await prisma.catalogItem.upsert({
            where: { code: it.code },
            create: { code: it.code, found: hit.found, sizeRaw: hit.sizeRaw ?? null, dim1: hit.dims?.[0], dim2: hit.dims?.[1], dim3: hit.dims?.[2], imgUrl: hit.imgUrl ?? null, krName: hit.krName ?? null },
            update: { found: hit.found, sizeRaw: hit.sizeRaw ?? null, dim1: hit.dims?.[0] ?? null, dim2: hit.dims?.[1] ?? null, dim3: hit.dims?.[2] ?? null, imgUrl: hit.imgUrl ?? null, krName: hit.krName ?? null, fetchedAt: new Date() },
          });
        } catch {
          /* network hiccup: stays missing and is retried next time */
        }
        onProgress?.(++done, missing.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
  const all = await prisma.catalogItem.findMany({ where: { code: { in: codes } } });
  return new Map(
    all.map((c) => [
      c.code,
      { code: c.code, found: c.found, dims: c.dim1 && c.dim2 && c.dim3 ? ([c.dim1, c.dim2, c.dim3] as [number, number, number]) : undefined, imgUrl: c.imgUrl, krName: c.krName, photo: photoPath(c.code) },
    ]),
  );
}

/** Make sure a 320 px photo exists for every code that has a catalog image. */
export async function ensurePhotos(items: Array<{ code: string; barcode?: string | null }>, onProgress?: (done: number, total: number) => void): Promise<number> {
  const facts = await ensureCatalog(items.filter((i) => !photoPath(i.code)));
  const todo = [...facts.values()].filter((f) => f.imgUrl && !photoPath(f.code));
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        await savePhoto(f.code, f.imgUrl!);
      } catch {
        /* retried next time */
      }
      onProgress?.(++done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return todo.length;
}

/** One-time import of the Red Box / Tsagaan gar caches. Safe to run again. */
export async function seedFromOldProjects(dirs: { catalogCsv?: string; photoDirs: string[] }): Promise<{ catalog: number; photos: number }> {
  let catalog = 0;
  if (dirs.catalogCsv && fs.existsSync(dirs.catalogCsv)) {
    const lines = fs.readFileSync(dirs.catalogCsv, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    const header = lines.shift()!.split(",");
    const col = (n: string) => header.indexOf(n);
    for (const line of lines) {
      const cells = splitCsv(line);
      const code = cells[col("code8")];
      if (!code) continue;
      const sizeRaw = cells[col("size_raw")] || null;
      const dims = parseDims(sizeRaw ?? undefined);
      await prisma.catalogItem.upsert({
        where: { code },
        create: { code, found: cells[col("found")] === "1", sizeRaw, dim1: dims?.[0], dim2: dims?.[1], dim3: dims?.[2], imgUrl: cells[col("img_url")] || null, krName: cells[col("kr_name")] || null },
        update: {},
      });
      catalog++;
    }
  }
  let photos = 0;
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  for (const dir of dirs.photoDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{8}\.jpg$/i.test(f)) continue;
      const dest = path.join(PHOTO_DIR, f.toLowerCase());
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(dir, f), dest);
        photos++;
      }
    }
  }
  return { catalog, photos };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
