// Write all three exports for a project version: npx tsx scripts/export-check.ts <projectId> <version>
import { prisma } from "../src/lib/db";
import { loadExport } from "../src/lib/exports/data";
import { writeXlsx } from "../src/lib/exports/xlsx";
import { writeHtml, writePdf } from "../src/lib/exports/pdf";

const d = await loadExport(Number(process.argv[2]), Number(process.argv[3]));
for (const [name, fn] of [["xlsx", writeXlsx], ["html", writeHtml], ["pdf", writePdf]] as const) {
  const t = Date.now();
  const f = await fn(d);
  console.log(name, f, `${((Date.now() - t) / 1000).toFixed(1)}s`);
}
await prisma.$disconnect();
