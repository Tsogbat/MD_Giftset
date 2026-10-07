// Read-only access to Odoo 19 (prodart19). Every session is read-only; nothing is ever written.
// Queries are the ones proven in Documents\Redbox\redbox_199k.py (:273-328) and Tsagaan gar\gift_bundles.py.
import pg from "pg";
import { requireEnv, env, redact } from "../env";

export function odooConfig(): pg.ClientConfig {
  return {
    host: requireEnv("DB_HOST"),
    port: Number(env("DB_PORT") ?? 5432),
    database: env("DB_NAME") ?? "prodart19",
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASS"),
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
    options: "-c default_transaction_read_only=on",
  };
}

/** Run queries on one read-only connection. */
export async function withOdoo<T>(fn: (q: <R extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const client = new pg.Client(odooConfig());
  try {
    await client.connect();
  } catch (e) {
    throw new Error(redact(`Odoo connect failed: ${(e as Error).message}`));
  }
  try {
    await client.query("set session characteristics as transaction read only");
    return await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const NON_PICK_LOCATIONS = ["WH/Input", "WH/Output", "WH/Packing Zone"];
export const SITES = ["WH", "CEN", "ENC", "SILK"] as const;
export type Site = (typeof SITES)[number];

export const SQL = {
  stock: `
    select sq.product_id, w.code as warehouse, l.id as location_id,
           coalesce(l.barcode, l.complete_name) as bin, l.complete_name as location,
           sum(sq.quantity - sq.reserved_quantity)::float as qty
    from public.stock_quant sq
    join public.stock_location l on l.id = sq.location_id
    join public.stock_warehouse w on w.id = l.warehouse_id
    where l.usage = 'internal' and l.active
      and not exists (select 1 from public.stock_warehouse dw
          where dw.ab_damaged_location_id is not null
            and '/' || l.parent_path like '%/' || dw.ab_damaged_location_id || '/%')
    group by 1, 2, 3, 4, 5 having sum(sq.quantity - sq.reserved_quantity) > 0`,
  products: `
    select p.product_id, p.product_tmpl_id, p.default_code, p.barcode, p.name,
           p.list_price::float as list_price, pc.complete_name as categ, p.ab_brand_name as brand, p.active, p.sale_ok
    from readonly_md.product p left join readonly_md.product_category pc on pc.id = p.categ_id`,
  cost: `
    select distinct on (l.product_id) l.product_id,
           (l.price_unit * po.current_rate + coalesce(l.cost_unit, 0))::float as landed_cost, po.name as po
    from public.purchase_order_line l join public.purchase_order po on po.id = l.order_id
    where po.state = 'purchase' and l.product_id is not null and l.price_unit > 0
    order by l.product_id, po.date_order desc, l.id desc`,
  sales: `
    select l.product_id, sum(l.qty)::float as sold from readonly_md.pos_order_line l
    join readonly_md.pos_order o on o.id = l.order_id
    where o.state in ('paid','done','invoiced') group by 1`,
  salesRange: `select min(date_order) as first, max(date_order) as last from readonly_md.pos_order where state in ('paid','done','invoiced')`,
  firstReceipt: `
    select m.product_id, min(m.date) as first_in from public.stock_move m
    join public.stock_location dst on dst.id = m.location_dest_id
    join public.stock_location src on src.id = m.location_id
    where m.state = 'done' and dst.usage = 'internal' and src.usage in ('supplier','inventory') group by 1`,
} as const;

/** SKU = default_code as 8-digit text with leading zeros. */
export function code8(defaultCode: string | null | undefined): string {
  const c = (defaultCode ?? "").trim();
  return /^\d+$/.test(c) ? c.padStart(8, "0") : c;
}
