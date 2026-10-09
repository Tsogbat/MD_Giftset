// Excel export in Mongolian, sheet layout after RedBox_V3.xlsx / TsagaanGar_bundles.xlsx.
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { photoPath } from "../catalog";
import { baseName, exportDir, recipeMn, ROLE_MN, rulesMn, SITE_MN, type ExportData } from "./data";

const MONEY = "#,##0";

function sheet(wb: ExcelJS.Workbook, name: string, columns: Array<{ header: string; key: string; width?: number; money?: boolean; pct?: boolean }>) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(10, c.header.length + 2), style: c.money ? { numFmt: MONEY } : c.pct ? { numFmt: "0.0%" } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  return ws;
}

export async function writeXlsx(d: ExportData): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Gift Set Studio";
  wb.created = new Date();
  const recipeName = (s: ExportData["sets"][number]) => recipeMn(d.batches, s.tier, s.recipeKey).name || s.recipe || "";

  // Бүх багц
  const all = sheet(wb, "Бүх багц", [
    { header: "Багц", key: "code", width: 14 },
    { header: "Түвшин", key: "tier", width: 16 },
    { header: "Жор", key: "recipe", width: 26 },
    { header: "Эх сурвалж", key: "source", width: 12 },
    { header: "Байршил", key: "site", width: 16 },
    { header: "Барааны тоо", key: "n", width: 12 },
    { header: "Нийт үнэ ₮", key: "total", money: true, width: 14 },
    { header: "Буулгасан өртөг ₮", key: "landed", money: true, width: 16 },
    { header: "Уут", key: "bag", width: 8 },
  ]);
  for (const s of d.sets)
    all.addRow({
      code: s.code,
      tier: s.tier,
      recipe: recipeName(s),
      source: s.source === "team" ? "Баг (өгсөн ёсоор)" : "Систем",
      site: s.site ? (SITE_MN[s.site] ?? s.site) : "",
      n: s.items.length,
      total: s.total,
      landed: Math.round(s.items.reduce((a, i) => a + (i.landedCost ?? 0), 0)),
      bag: s.bag ?? "",
    });

  // Жорууд
  const rec = sheet(wb, "Жорууд", [
    { header: "Түвшин", key: "tier", width: 16 },
    { header: "Жор", key: "key", width: 8 },
    { header: "Нэр", key: "name", width: 24 },
    { header: "Тайлбар", key: "pitch", width: 50 },
    { header: "Багцын тоо", key: "boxes", width: 10 },
    { header: "Үүрэг", key: "role", width: 10 },
    { header: "Слот", key: "slot", width: 28 },
    { header: "Ангилал (MIS)", key: "kinds", width: 60 },
    { header: "Үнээс ₮", key: "lo", money: true },
    { header: "Үнэ хүртэл ₮", key: "hi", money: true },
  ]);
  for (const b of d.batches)
    for (const r of b.recipes) {
      const slots = [...(r.hero ? [{ role: "Онцлох", s: r.hero }] : []), ...r.slots.map((s) => ({ role: "Нэмэлт", s }))];
      slots.forEach(({ role, s }, i) =>
        rec.addRow({ tier: i ? "" : b.label, key: i ? "" : r.key, name: i ? "" : (r.nameMn ?? r.name), pitch: i ? "" : (r.pitchMn ?? r.pitch ?? ""), boxes: i ? null : r.boxes, role, slot: s.labelMn ?? s.label, kinds: s.kinds.join("\n"), lo: s.band[0], hi: s.band[1] }),
      );
    }
  rec.getColumn("kinds").alignment = { wrapText: true, vertical: "top" };
  rec.getColumn("pitch").alignment = { wrapText: true, vertical: "top" };

  // Багцууд (with photos)
  const items = sheet(wb, "Багцууд", [
    { header: "Зураг", key: "img", width: 10 },
    { header: "Багц", key: "set", width: 14 },
    { header: "Түвшин", key: "tier", width: 14 },
    { header: "Жор", key: "recipe", width: 22 },
    { header: "#", key: "n", width: 4 },
    { header: "Үүрэг", key: "role", width: 10 },
    { header: "Слот", key: "slot", width: 22 },
    { header: "Код", key: "code", width: 11 },
    { header: "Баркод", key: "barcode", width: 15 },
    { header: "Нэр", key: "name", width: 44 },
    { header: "Брэнд", key: "brand", width: 12 },
    { header: "Ангилал", key: "categ", width: 50 },
    { header: "Үнэ ₮", key: "price", money: true, width: 10 },
    { header: "Буулгасан өртөг ₮", key: "landed", money: true, width: 14 },
    { header: "7 хоногийн борлуулалт", key: "weekly", width: 12 },
    { header: "Нөөцийн хүрэлцээ (7 хоног)", key: "cover", width: 13 },
    { header: "Хэмжээ мм", key: "dims", width: 13 },
    { header: "Байршил", key: "site", width: 14 },
    { header: "Бин", key: "bin", width: 18 },
    { header: "Тэмдэглэл", key: "note", width: 24 },
  ]);
  const thumbs = new Map<string, number>();
  const thumbFor = async (code: string) => {
    if (thumbs.has(code)) return thumbs.get(code)!;
    const f = photoPath(code);
    if (!f) return -1;
    const buf = await sharp(f).resize(64, 64, { fit: "contain", background: "#ffffff" }).jpeg({ quality: 78 }).toBuffer();
    const id = wb.addImage({ buffer: buf as unknown as ExcelJS.Buffer, extension: "jpeg" });
    thumbs.set(code, id);
    return id;
  };
  for (const s of d.sets) {
    for (const [n, i] of s.items.entries()) {
      const row = items.addRow({
        set: s.code,
        tier: s.tier,
        recipe: recipeName(s),
        n: n + 1,
        role: ROLE_MN[i.role] ?? i.role,
        slot: i.slot,
        code: i.code,
        barcode: i.barcode,
        name: i.name,
        brand: i.brand,
        categ: i.categ,
        price: i.price,
        landed: i.landedCost == null ? null : Math.round(i.landedCost),
        weekly: i.weekly == null ? null : Math.round(i.weekly * 100) / 100,
        cover: i.cover == null ? null : Math.round(i.cover * 10) / 10,
        dims: i.dims,
        site: i.site ? (SITE_MN[i.site] ?? i.site) : "",
        bin: i.bin,
        note: i.note,
      });
      row.height = 50;
      const img = await thumbFor(i.code);
      if (img >= 0) items.addImage(img, { tl: { col: 0.1, row: row.number - 1 + 0.08 }, ext: { width: 60, height: 60 } });
    }
  }

  // Цуглуулах жагсаалт (pick list by site and bin)
  const pick = new Map<string, { site: string; bin: string; code: string; name: string; qty: number; sets: string[] }>();
  for (const s of d.sets)
    for (const i of s.items) {
      const k = `${i.site ?? ""}|${i.bin ?? ""}|${i.code}`;
      const p = pick.get(k) ?? { site: i.site ?? "", bin: i.bin ?? "", code: i.code, name: i.name, qty: 0, sets: [] };
      p.qty += i.qty;
      p.sets.push(s.code);
      pick.set(k, p);
    }
  const pl = sheet(wb, "Цуглуулах жагсаалт", [
    { header: "Байршил", key: "site", width: 16 },
    { header: "Бин", key: "bin", width: 20 },
    { header: "Код", key: "code", width: 11 },
    { header: "Нэр", key: "name", width: 44 },
    { header: "Тоо", key: "qty", width: 6 },
    { header: "Багцууд", key: "sets", width: 50 },
  ]);
  for (const p of [...pick.values()].sort((a, b) => a.site.localeCompare(b.site) || a.bin.localeCompare(b.bin) || a.code.localeCompare(b.code)))
    pl.addRow({ ...p, site: SITE_MN[p.site] ?? p.site, sets: p.sets.join(", ") });

  // Шалгалт
  const ch = sheet(wb, "Шалгалт", [
    { header: "Шалгалт", key: "name", width: 50 },
    { header: "Үр дүн", key: "ok", width: 10 },
    { header: "Дэлгэрэнгүй", key: "detail", width: 70 },
  ]);
  for (const c of d.checks) {
    const r = ch.addRow({ name: c.nameMn || c.name, ok: c.ok ? "ДАВСАН" : "УНАСАН", detail: c.detailMn || c.detail });
    r.getCell("ok").font = { bold: true, color: { argb: c.ok ? "FF1F7A4D" : "FFB3261E" } };
  }

  // Санхүү
  if (d.finance) {
    const fi = sheet(wb, "Санхүү", [
      { header: "Түвшин", key: "label", width: 18 },
      { header: "Багц", key: "sets", width: 8 },
      { header: "Орлого ₮", key: "revenue", money: true, width: 14 },
      { header: "НӨАТ ₮", key: "vat", money: true, width: 12 },
      { header: "Цэвэр орлого ₮", key: "net", money: true, width: 14 },
      { header: "Барааны үнэ ₮", key: "contentsValue", money: true, width: 14 },
      { header: "Барааны өртөг ₮", key: "landed", money: true, width: 14 },
      { header: "Бохир ашиг ₮", key: "gross", money: true, width: 14 },
      { header: "Ашиг %", key: "margin", pct: true, width: 9 },
    ]);
    for (const r of [...d.finance.rows, { ...d.finance.total, label: "НИЙТ" }]) fi.addRow(r);
    fi.lastRow!.font = { bold: true };
    fi.addRow({});
    fi.addRow({ label: "Үнэ НӨАТ (10%)-тэй; ашиг % = (орлого ÷ 1.1 − буулгасан өртөг) ÷ (орлого ÷ 1.1). Сав баглаа боодол тооцоогүй." });
  }

  // Дүрэм
  const ru = sheet(wb, "Дүрэм", [{ header: "Дүрэм", key: "line", width: 140 }]);
  for (const line of rulesMn(d.rules, d.batches)) ru.addRow({ line });
  ru.getColumn("line").alignment = { wrapText: true };

  const file = path.join(exportDir(d), `${baseName(d)}.xlsx`);
  const tmp = file + ".tmp";
  await wb.xlsx.writeFile(tmp);
  fs.renameSync(tmp, file);
  return file;
}
