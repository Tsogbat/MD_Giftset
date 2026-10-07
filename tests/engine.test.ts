import { describe, expect, it } from "vitest";
import { buildItems, familyOf, type Bin, type RawProduct } from "@/lib/engine/items";
import { bagFor, buildAll, quantile, setCode, allocate, toBuiltSets, Rng } from "@/lib/engine/solver";
import { verify } from "@/lib/engine/verify";
import { giftBundleRules, mysteryBoxRules, PAPER_BAGS } from "@/lib/engine/presets";
import { parseDims } from "@/lib/artbox/client";
import type { Batch, Plan } from "@/lib/engine/types";

const CATS = [
  "Kidult / Figure / Random Figure / A / A",
  "Kidult / Keyring / Figure Accessory / A / A",
  "Design Paper / Sticker / Seal Sticker / A / A",
  "Design Paper / Sticky Note / Basic / A / A",
  "Home & Life / Drinkware / Cup / A / A",
  "Stationery / Art Supply / Paint / A / A",
];

/** A deterministic fake catalog: per category, 40 products over a price ladder; a few best sellers. */
function fakeCatalog(): { products: RawProduct[]; bins: Bin[] } {
  const rng = new Rng(7);
  const products: RawProduct[] = [];
  const bins: Bin[] = [];
  let pid = 1;
  for (const [ci, categ] of CATS.entries()) {
    for (let n = 0; n < 40; n++, pid++) {
      const price = ci === 0 ? 30_000 + n * 1_000 : 3_000 + (n % 20) * 600;
      products.push({
        pid,
        tmpl: pid,
        code: String(10_000_000 + pid),
        barcode: null,
        name: `Item ${categ.split(" / ")[1]} model${pid} variant`,
        brand: n % 13 === 0 ? "D. TALE" : "ARTBOX",
        categ,
        listPrice: price,
        landedCost: price * 0.35,
        active: true,
        saleOk: true,
        weeklySales: n < 12 ? 5 + rng.next() * 5 : rng.next() * 0.3,
        firstIn: new Date("2026-06-01"),
        dims: [100 + (n % 5) * 10, 60, 2 + (n % 3)],
      });
      bins.push({ pid, site: "WH", locationId: pid * 10, bin: `A-${pid}`, qty: 30 + (n % 7) * 10 });
      bins.push({ pid, site: "CEN", locationId: pid * 10 + 1, bin: "CEN/Нөөц", qty: 5 });
    }
  }
  return { products, bins };
}

const recipe = (key: string, boxes: number) => ({
  key,
  name: `Recipe ${key}`,
  boxes,
  hero: { label: "Figure", kinds: ["Kidult / Figure"], band: [30_000, 70_000] as [number, number] },
  slots: [
    { label: "Keyring", kinds: ["Kidult / Keyring"], band: [3_000, 30_000] as [number, number] },
    { label: "Sticker", kinds: ["Design Paper / Sticker"], band: [3_000, 30_000] as [number, number] },
    { label: "Notes", kinds: ["Design Paper / Sticky Note"], band: [3_000, 30_000] as [number, number] },
    { label: "Cup", kinds: ["Home & Life / Drinkware"], band: [3_000, 30_000] as [number, number] },
  ],
});

describe("helpers", () => {
  it("parses catalog sizes like parse_dims", () => {
    expect(parseDims("123*123*1")).toEqual([123, 123, 1]);
    expect(parseDims("10*200*30")).toEqual([200, 30, 10]);
    expect(parseDims("미입력")).toBeUndefined();
    expect(parseDims("120*80")).toBeUndefined();
  });
  it("drops colour words and the variant word from product lines", () => {
    expect(familyOf("Фломастер peureoseu үзэг 3000 ягаан /1wol")).toBe(familyOf("Фломастер peureoseu үзэг 3000 цэнхэр /2wol"));
  });
  it("picks the smallest paper bag that fits", () => {
    const pk = { enabled: true, bags: PAPER_BAGS, topFold: 20, girthSlack: 10 };
    expect(bagFor([[120, 80, 5], [100, 70, 3]], pk)).toBe("S");
    expect(bagFor([[185, 90, 2]], pk)).toBe("L");
    expect(bagFor([[300, 90, 2]], pk)).toBeNull();
  });
  it("quantile matches pandas linear interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
  });
  it("numbers set codes within code groups", () => {
    const b: Batch = { key: "x", label: "x", prefix: "TG", target: 1, tolerance: 0, recipes: [{ ...recipe("K1", 5), codeGroup: "K" }, { ...recipe("Y1", 5), codeGroup: "Y" }, { ...recipe("K2", 5), codeGroup: "K" }] };
    expect(setCode(b, b.recipes[2], 1)).toBe("TG-K06");
    expect(setCode(b, b.recipes[1], 3)).toBe("TG-Y03");
  });
});

describe("solver", () => {
  it("builds mystery boxes that pass every check (one site, overlap ≤ 2, stock reserved, no D.Tale)", () => {
    const { products, bins } = fakeCatalog();
    const rules = mysteryBoxRules();
    rules.mix = { leaf: 1, sub: 2, top: 4, minTopCats: 3 };
    rules.search.attempts = 150;
    const plan: Plan = { rules, batches: [{ key: "70k", label: "Test 70k", prefix: "T70", target: 70_000, tolerance: 2_000, recipes: [recipe("A", 3), recipe("B", 3)] }] };
    const items = buildItems(products, bins, rules, new Date("2026-10-06"));
    expect(items.some((i) => /tale/i.test(i.brand ?? ""))).toBe(false);
    const out = buildAll(plan.batches, items, rules);
    const alloc = allocate(out.boxes, bins, rules);
    const sets = toBuiltSets(out, alloc);
    const checks = verify(plan, sets, out.stats, bins);
    expect(sets).toHaveLength(6);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(sets.every((s) => s.items.every((i) => i.site === s.site))).toBe(true);
  });

  it("builds bundles with each SKU once that fit a bag", () => {
    const { products, bins } = fakeCatalog();
    const rules = giftBundleRules();
    rules.filler.minUnits = 20;
    rules.search.attempts = 150;
    const small = (key: string) => ({
      ...recipe(key, 3),
      hero: { label: "Keyring", kinds: ["Kidult / Keyring"], band: [3_000, 12_000] as [number, number] },
      slots: [
        { label: "Sticker", kinds: ["Design Paper / Sticker"], band: [3_000, 12_000] as [number, number] },
        { label: "Notes", kinds: ["Design Paper / Sticky Note"], band: [3_000, 12_000] as [number, number] },
      ],
    });
    const plan: Plan = { rules, batches: [{ key: "20k", label: "Test 20k", prefix: "TB", target: 20_000, tolerance: 2_000, close: 1_000, recipes: [small("K1"), small("K2")] }] };
    const items = buildItems(products, bins, rules, new Date("2026-10-06"));
    const out = buildAll(plan.batches, items, rules);
    const sets = toBuiltSets(out, null);
    const checks = verify(plan, sets, out.stats, null);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    const pids = sets.flatMap((s) => s.items.map((i) => i.pid));
    expect(new Set(pids).size).toBe(pids.length);
    expect(sets.every((s) => s.bag !== null)).toBe(true);
  });

  it("reports which recipe got stuck instead of returning bad sets", () => {
    const { products, bins } = fakeCatalog();
    const rules = giftBundleRules();
    rules.search.attempts = 20;
    rules.search.seedTries = 1;
    const impossible = { ...recipe("Z", 2), hero: null, slots: [{ label: "Cup", kinds: ["Home & Life / Drinkware"], band: [3_000, 4_000] as [number, number] }] };
    const plan: Plan = { rules, batches: [{ key: "z", label: "Z", prefix: "Z", target: 50_000, tolerance: 1_000, recipes: [impossible] }] };
    const items = buildItems(products, bins, rules, new Date("2026-10-06"));
    expect(() => buildAll(plan.batches, items, rules)).toThrow(/recipe Z/);
  });
});
