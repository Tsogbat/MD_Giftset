// GET ?format=xlsx|html|pdf — writes exports/<project>/V<n>/<Name>_V<n>.<ext> and downloads it.
import fs from "node:fs";
import path from "node:path";
import { loadExport } from "@/lib/exports/data";
import { writeXlsx } from "@/lib/exports/xlsx";
import { writeHtml, writePdf } from "@/lib/exports/pdf";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  html: "text/html; charset=utf-8",
  pdf: "application/pdf",
} as const;

export async function GET(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") as keyof typeof TYPES | null;
  if (!format || !(format in TYPES)) return Response.json({ error: "format must be xlsx, html or pdf" }, { status: 400 });
  try {
    const d = await loadExport(Number(id), Number(n));
    const file = format === "xlsx" ? await writeXlsx(d) : format === "html" ? await writeHtml(d) : await writePdf(d);
    const name = path.basename(file);
    return new Response(new Uint8Array(fs.readFileSync(file)), {
      headers: {
        "Content-Type": TYPES[format],
        "Content-Disposition": `${format === "html" || format === "pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Saved-To": encodeURIComponent(file),
      },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
