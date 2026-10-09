// Everything an export needs for one version, plus the Mongolian wording shared by Excel / HTML / PDF.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { ensurePhotos } from "../catalog";
import type { Batch, Check, Rules } from "../engine/types";
import type { FinanceRow } from "../projects";

export const SITE_MN: Record<string, string> = { WH: "Төв агуулах", CEN: "Century салбар", ENC: "Encanto салбар", SILK: "Silkroad салбар" };
export const ROLE_MN: Record<string, string> = { hero: "Онцлох", filler: "Нэмэлт", bonus: "Бонус", team: "Багийн" };

export async function loadExport(projectId: number, number: number) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { snapshot: true } });
  const version = await prisma.version.findUniqueOrThrow({
    where: { projectId_number: { projectId, number } },
    include: { sets: { include: { items: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } } },
  });
  const rules = version.rules as unknown as Rules;
  const batches = version.recipes as unknown as Batch[];
  const checks = (version.checks as unknown as Check[] | null) ?? [];
  const finance = version.finance as unknown as { rows: FinanceRow[]; total: FinanceRow } | null;
  // every product gets its photo (missing ones are looked up on img.artbox.kr once and cached)
  await ensurePhotos(version.sets.flatMap((s) => s.items.map((i) => ({ code: i.code, barcode: i.barcode }))));
  return { project, version, rules, batches, checks, finance, sets: version.sets };
}
export type ExportData = Awaited<ReturnType<typeof loadExport>>;

export function exportDir(d: ExportData): string {
  const dir = path.resolve("exports", d.project.slug, `V${d.version.number}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function baseName(d: ExportData): string {
  const safe = d.project.name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, "_").slice(0, 60);
  return `${safe}_V${d.version.number}`;
}

export const money = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

export function recipeMn(batches: Batch[], batchLabel: string | null, key: string | null): { name: string; pitch?: string } {
  for (const b of batches) {
    if (batchLabel && b.label !== batchLabel && b.key !== batchLabel) continue;
    const r = b.recipes.find((x) => x.key === key);
    if (r) return { name: r.nameMn ?? r.name, pitch: r.pitchMn ?? r.pitch };
  }
  return { name: key ?? "" };
}

/** The rules in plain Mongolian lines for the «Дүрэм» sheet and the method section. */
export function rulesMn(rules: Rules, batches: Batch[]): string[] {
  const lines: string[] = [];
  for (const b of batches) {
    lines.push(`${b.label}: багц бүрийн барааны үнийн дүн ${money(b.target)}₮ ± ${money(b.tolerance)}₮${b.hardRange ? ` (${money(b.hardRange[0])}–${money(b.hardRange[1])}₮ дотор)` : ""}${b.sellPrice ? `, борлуулах үнэ ${money(b.sellPrice)}₮` : ""}; ${b.recipes.length} жор, ${b.recipes.reduce((a, r) => a + r.boxes, 0)} багц.`);
  }
  if (rules.hero.enabled) lines.push(`Багц бүрт нэг онцлох бараа: 7 хоногийн борлуулалтаар эхний ${Math.round(rules.hero.topShare * 100)}%-д орсон их зарагддаг бараа${rules.hero.distinct ? ", багц бүрт өөр" : ""}.`);
  if (rules.filler.coverQuantile > 0) lines.push(`Нэмэлт бараа нь удаан эргэлттэй: нөөцийн хүрэлцээ (долоо хоног) медианаас дээш${rules.filler.minUnits ? `, ≥ ${rules.filler.minUnits} ширхэг үлдэгдэлтэй` : ""}, сүүлийн ${rules.filler.newArrivalDays} хоногт ирсэн шинэ бараа биш.`);
  lines.push(rules.reuse.maxUsesPerSku === 1 ? "Нэг SKU зөвхөн нэг багцад." : `Нэг SKU ≤ ${rules.reuse.maxUsesPerSku} багцад.`);
  if (rules.reuse.maxShared !== undefined) lines.push(`Дурын хоёр багц ≤ ${rules.reuse.maxShared} ижил бараатай; ижил хоёр багц байхгүй.`);
  lines.push(`Нэг барааны өнгө, дүрийн хувилбар нэг жорт давтагдахгүй; нэг шугам ≤ ${rules.reuse.maxFamilyUses} багцад.`);
  lines.push(`Багц доторх холимог: эцсийн ангиллаас ≤ ${rules.mix.leaf}, дэд ангиллаас ≤ ${rules.mix.sub}${rules.mix.top ? `, үндсэн ангиллаас ≤ ${rules.mix.top}` : ""}${rules.mix.minTopCats ? `, ≥ ${rules.mix.minTopCats} үндсэн ангилал` : ""}.`);
  lines.push(`Нөөц: ${rules.stock.sites.map((s) => SITE_MN[s] ?? s).join(", ")}${rules.stock.oneSitePerSet ? "; багц бүр нэг байршлаас" : ""}${rules.stock.allocate ? "; бараа байршлаар нөөцлөгдсөн" : "; нөөцлөөгүй"}.`);
  if (rules.packaging.enabled) lines.push(`Багц бүр ууттай таарна: ${rules.packaging.bags.map((b) => `${b.w}×${b.h} мм`).join(", ")} (хэмжээ img.artbox.kr-аас).`);
  lines.push(`Барааны үнэ ${money(rules.itemPrice[0])}–${money(rules.itemPrice[1])}₮.`);
  const ex = [...rules.exclusions.topCategories, ...rules.exclusions.categ.map((x) => x.label), ...rules.exclusions.name.map((x) => x.label), ...rules.exclusions.brand.map((x) => x.label), ...rules.exclusions.codes.map((c) => `${c.code} (${c.reason})`)];
  lines.push(`Хасагдсан: ${ex.join("; ")}.`);
  for (const s of rules.segmentExcludes) lines.push(`${s.segment}: ${s.label}.`);
  return lines;
}
