// Uploaded workbooks (team-made sets, sample/bonus lists). Layouts differ every time, so the agent
// reads a preview and tells the parsers which header row and columns to use.
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db";

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

export function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ("error" in v) return null;
  }
  return String(v);
}

export async function readWorkbook(file: string): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals: Cell[] = [];
      // a merged range keeps its value in the first cell only (ExcelJS repeats it in every cell),
      // so "Box 1" merged down a box's rows reads like the team typed it: once, then blanks
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        vals[c - 1] = cell.isMerged && cell.master.address !== cell.address ? null : cellValue(cell.value);
      });
      for (let i = 0; i < vals.length; i++) vals[i] ??= null;
      rows[n - 1] = vals;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { name: ws.name, rows };
  });
}

export const UPLOAD_DIR = path.resolve("data", "uploads");

export async function saveUpload(projectId: number, kind: string, filename: string, data: Buffer, createdBy: string) {
  const dir = path.join(UPLOAD_DIR, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  const safe = filename.replace(/[\\/:*?"<>|]+/g, "_");
  const file = path.join(dir, `${Date.now()}-${safe}`);
  fs.writeFileSync(file, data);
  return prisma.upload.create({ data: { projectId, kind, filename, path: file, createdBy } });
}

/** Column by header text (case/space-insensitive), letter (A, AB) or 1-based number. */
export function columnIndex(header: Cell[], ref: string | number): number {
  if (typeof ref === "number") return ref - 1;
  const want = ref.trim().toLowerCase().replace(/\s+/g, " ");
  const byName = header.findIndex((h) => String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ") === want);
  if (byName >= 0) return byName;
  if (/^[A-Z]{1,2}$/i.test(ref.trim())) return ref.trim().toUpperCase().split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
  if (/^\d+$/.test(ref.trim())) return Number(ref) - 1;
  throw new Error(`Column "${ref}" not found. Header row has: ${header.filter((h) => h != null).join(" | ")}`);
}

/** A readable preview for the agent: sheet sizes, then numbered rows as tab-separated text. */
export async function previewUpload(uploadId: number, sheet?: string, startRow = 1, count = 40): Promise<string> {
  const up = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const sheets = await readWorkbook(up.path);
  const lines = [`${up.filename} (${up.kind}) — sheets: ${sheets.map((s) => `"${s.name}" ${s.rows.length} rows`).join(", ")}`];
  const s = sheet ? sheets.find((x) => x.name === sheet) : sheets[0];
  if (!s) return lines.concat(`Sheet "${sheet}" not found.`).join("\n");
  lines.push(`Sheet "${s.name}", rows ${startRow}–${Math.min(s.rows.length, startRow + count - 1)} (row number: cells, tab-separated; empty cells blank):`);
  for (let r = startRow; r <= Math.min(s.rows.length, startRow + count - 1); r++) lines.push(`${r}: ${(s.rows[r - 1] ?? []).map((c) => (c == null ? "" : String(c).replace(/\s+/g, " ").slice(0, 60))).join("\t")}`);
  return lines.join("\n");
}
