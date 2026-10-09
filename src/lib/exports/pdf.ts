// HTML / PDF files for a version. The PDF is the A4 print layout printed by headless Edge
// (Edge x86 → Edge → Chrome), the method proven in redbox_pdf.py / gift_pdf.py.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { baseName, exportDir, type ExportData } from "./data";
import { reportHtml } from "./report";

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
];

function browser(): string {
  const b = BROWSERS.find((p) => fs.existsSync(p));
  if (!b) throw new Error("No Edge or Chrome found to print the PDF");
  return b;
}

export async function writeHtml(d: ExportData): Promise<string> {
  const file = path.join(exportDir(d), `${baseName(d)}.html`);
  fs.writeFileSync(file + ".tmp", await reportHtml(d, "web"), "utf8");
  fs.renameSync(file + ".tmp", file);
  return file;
}

export async function writePdf(d: ExportData): Promise<string> {
  const dir = exportDir(d);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gs-pdf-"));
  const html = path.join(tmp, "print.html");
  fs.writeFileSync(html, await reportHtml(d, "print"), "utf8");
  const out = path.join(tmp, "out.pdf");
  await new Promise<void>((resolve, reject) => {
    execFile(
      browser(),
      ["--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", `--user-data-dir=${path.join(tmp, "profile")}`, `--print-to-pdf=${out}`, "--virtual-time-budget=20000", pathToFileURL(html).href],
      { timeout: 180_000, windowsHide: true },
      (err) => (fs.existsSync(out) ? resolve() : reject(err ?? new Error("PDF was not written"))),
    );
  });
  const file = path.join(dir, `${baseName(d)}.pdf`);
  fs.copyFileSync(out, file);
  fs.rmSync(tmp, { recursive: true, force: true });
  return file;
}
