import { prisma } from "@/lib/db";
import { latestSnapshot } from "@/lib/snapshot";
import { photoPath, photoUrl } from "@/lib/catalog";
import SnapshotButton from "./snapshot-button";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const { q = "", sort = "sales" } = await searchParams;
  const snap = await latestSnapshot();
  if (!snap) {
    return (
      <div className="card">
        <h1>Catalog</h1>
        <p>No Odoo snapshot yet.</p>
        <SnapshotButton />
      </div>
    );
  }
  const term = q.trim();
  const where = {
    snapshotId: snap.id,
    ...(term
      ? { OR: [{ code: { contains: term } }, { barcode: { contains: term } }, { name: { contains: term } }, { categ: { contains: term } }, { brand: { contains: term } }] }
      : {}),
  };
  const orderBy = sort === "cover" ? { weeksCover: "desc" as const } : sort === "price" ? { listPrice: "desc" as const } : { weeklySales: "desc" as const };
  const [rows, total] = await Promise.all([prisma.snapshotProduct.findMany({ where, orderBy, take: 200 }), prisma.snapshotProduct.count({ where })]);
  const ids = rows.map((r) => r.productId);
  const codes = rows.map((r) => r.code);
  const [stock, cat, ledger] = await Promise.all([
    prisma.snapshotStock.findMany({ where: { snapshotId: snap.id, productId: { in: ids } } }),
    prisma.catalogItem.findMany({ where: { code: { in: codes } } }),
    prisma.ledgerEntry.findMany({ where: { code: { in: codes } }, include: { project: { select: { name: true } } } }),
  ]);
  const perSite = new Map<number, Record<string, number>>();
  for (const s of stock) {
    const m = perSite.get(s.productId) ?? {};
    m[s.site] = (m[s.site] ?? 0) + s.qty;
    perSite.set(s.productId, m);
  }
  const dims = new Map(cat.map((c) => [c.code, c]));
  const reserved = new Map<string, string[]>();
  for (const l of ledger) reserved.set(l.code, [...(reserved.get(l.code) ?? []), `${l.project.name} ×${l.qty}`]);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Catalog</h1>
        <span className="muted">
          Snapshot #{snap.id} · {snap.takenAt.toISOString().slice(0, 16).replace("T", " ")} · {snap.products.toLocaleString()} products with stock · sales{" "}
          {snap.salesFrom?.toISOString().slice(0, 10)} → {snap.salesTo?.toISOString().slice(0, 10)}
        </span>
        <SnapshotButton />
      </div>
      <form style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        <input name="q" defaultValue={q} placeholder="Code, barcode, name, category or brand" style={{ flex: 1 }} />
        <select name="sort" defaultValue={sort}>
          <option value="sales">Best sellers first</option>
          <option value="cover">Slowest (most weeks of cover) first</option>
          <option value="price">Highest price first</option>
        </select>
        <button className="primary">Search</button>
      </form>
      <p className="muted">
        {total.toLocaleString()} match{total === 1 ? "" : "es"}
        {total > rows.length ? ` · showing ${rows.length}` : ""}
      </p>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Code</th>
            <th>Name / category</th>
            <th className="num">Price ₮</th>
            <th className="num">Landed ₮</th>
            <th className="num">Sales/wk</th>
            <th className="num">Cover wk</th>
            <th>Stock WH / CEN / ENC</th>
            <th>Size mm</th>
            <th>Reserved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = perSite.get(r.productId) ?? {};
            const d = dims.get(r.code);
            return (
              <tr key={r.id}>
                <td>{photoPath(r.code) ? <img className="ph" src={photoUrl(r.code)} alt="" width={48} height={48} style={{ objectFit: "contain" }} /> : null}</td>
                <td>
                  <code>{r.code}</code>
                  <div className="muted" style={{ fontSize: 12 }}>{r.barcode}</div>
                </td>
                <td>
                  {r.name}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.categ}
                    {r.brand ? ` · ${r.brand}` : ""}
                  </div>
                </td>
                <td className="num">{money(r.listPrice)}</td>
                <td className="num">{money(r.landedCost)}</td>
                <td className="num">{r.weeklySales.toFixed(2)}</td>
                <td className="num">{r.weeksCover >= 999 ? "999+" : r.weeksCover.toFixed(1)}</td>
                <td>
                  {money(s.WH ?? 0)} / {money(s.CEN ?? 0)} / {money(s.ENC ?? 0)}
                </td>
                <td>{d?.dim1 ? `${d.dim1}×${d.dim2}×${d.dim3}` : <span className="muted">{d ? (d.found ? "no size" : "not in catalog") : "—"}</span>}</td>
                <td style={{ fontSize: 12 }}>{reserved.get(r.code)?.join(", ") ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
