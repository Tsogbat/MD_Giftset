// Every rule as a named check (English for the app, Mongolian for the exports), like verify() in both
// Python builders. Checks are derived from the Rules, so a gift bundle gets the bag check and a mystery
// box gets the one-site and overlap checks without a set type.
import type { Batch, BuiltSet, Check, Plan } from "./types";
import { type Bin, familyOf, rx } from "./items";
import { bagFor, matches, recipeExclude, type PoolStats } from "./solver";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function verify(plan: Plan, sets: BuiltSet[], stats: Record<string, PoolStats>, bins: Bin[] | null): Check[] {
  const { rules } = plan;
  const checks: Check[] = [];
  const check = (name: string, nameMn: string, ok: boolean, detail: string, detailMn = detail) => checks.push({ name, nameMn, ok, detail, detailMn });
  const recipeOf = new Map(plan.batches.flatMap((b) => b.recipes.map((r) => [`${b.key}|${r.key}`, { batch: b, recipe: r }] as const)));

  // 1. counts
  const per = new Map<string, number>();
  for (const s of sets) per.set(`${s.batch}|${s.recipeKey}`, (per.get(`${s.batch}|${s.recipeKey}`) ?? 0) + 1);
  const planned = plan.batches.flatMap((b) => b.recipes.map((r) => [`${b.key}|${r.key}`, r.boxes, r.key] as const));
  const nPlanned = planned.reduce((a, p) => a + p[1], 0);
  const split = planned.map(([k, n, key]) => `${key} ${per.get(k) ?? 0}/${n}`).join(", ");
  check(`${nPlanned} sets, as many per recipe as planned`, `${nPlanned} багц, жор бүрт төлөвлөсөн тоогоор`, sets.length === nPlanned && planned.every(([k, n]) => per.get(k) === n), split);

  // 2. value
  for (const b of plan.batches) {
    const t = sets.filter((s) => s.batch === b.key).map((s) => s.total);
    if (!t.length) continue;
    const ok = t.every((v) => Math.abs(v - b.target) <= b.tolerance && (!b.hardRange || (v >= b.hardRange[0] && v <= b.hardRange[1])));
    const avg = t.reduce((a, v) => a + v, 0) / t.length;
    const close = b.close !== undefined ? t.filter((v) => Math.abs(v - b.target) <= b.close!).length : null;
    check(
      `${b.label}: value ${fmt(b.target)}₮ ± ${fmt(b.tolerance)}₮${b.hardRange ? `, inside ${fmt(b.hardRange[0])}–${fmt(b.hardRange[1])}₮` : ""}`,
      `${b.label}: үнэ ${fmt(b.target)}₮ ± ${fmt(b.tolerance)}₮`,
      ok,
      `range ${fmt(Math.min(...t))}–${fmt(Math.max(...t))}₮, average ${fmt(avg)}₮${close !== null ? `; ${close} within ± ${fmt(b.close!)}₮` : ""}`,
      `${fmt(Math.min(...t))}–${fmt(Math.max(...t))}₮, дундаж ${fmt(avg)}₮${close !== null ? `; ${close} нь ± ${fmt(b.close!)}₮ дотор` : ""}`,
    );
  }

  // 3. recipe followed
  const follows = (s: BuiltSet) => {
    const r = recipeOf.get(`${s.batch}|${s.recipeKey}`)?.recipe;
    if (!r) return false;
    for (const it of s.items) {
      const spec = it.slot === -1 ? r.hero : r.slots[it.slot];
      if (!spec || !matches(it.categ, spec.kinds) || it.price < spec.band[0] || it.price > spec.band[1]) return false;
      if (spec.require && !rx(spec.require).test(it.name)) return false;
    }
    const want = [...(r.hero && rules.hero.enabled ? [-1] : []), ...r.slots.map((_, i) => i)];
    return JSON.stringify(s.items.map((i) => i.slot).sort((a, b) => a - b)) === JSON.stringify(want);
  };
  check("Every set follows its recipe", "Багц бүр жороо дагасан", sets.every(follows), "Each item matches its slot's kind and price band; every slot filled once", "Бараа бүр слотынхоо төрөл, үнийн хязгаарт; слот бүр нэг удаа");

  // 4–5. hero and fillers
  if (rules.hero.enabled && sets.some((s) => s.items.some((i) => i.role === "hero"))) {
    const heroOk = sets.every((s) => {
      const h = s.items.find((i) => i.role === "hero");
      if (!h) return true;
      const r = recipeOf.get(`${s.batch}|${s.recipeKey}`)!.recipe;
      const cut = stats[s.batch]?.cuts[String(r.heroShare ?? rules.hero.topShare)] ?? 0;
      return h.weekly >= cut - 1e-9 && h.units >= rules.hero.minUnits;
    });
    const heroes = sets.map((s) => s.items.find((i) => i.role === "hero")?.pid).filter(Boolean);
    const distinct = new Set(heroes).size === heroes.length;
    check(
      "One best-seller hero per set" + (rules.hero.distinct ? ", a different one in every set" : ""),
      "Багц бүрт нэг онцлох (их зарагддаг) бараа",
      heroOk && (!rules.hero.distinct || distinct),
      `top ${Math.round(rules.hero.topShare * 100)}% of sellers by weekly sales; ${new Set(heroes).size} distinct heroes`,
      `7 хоногийн борлуулалтаар эхний ${Math.round(rules.hero.topShare * 100)}%; ${new Set(heroes).size} өөр онцлох бараа`,
    );
  }
  if (rules.filler.coverQuantile > 0 || rules.filler.minUnits > 0) {
    const fillers = sets.flatMap((s) => s.items.filter((i) => i.role === "filler").map((i) => ({ i, cut: stats[s.batch]?.coverCut ?? 0 })));
    const ok = fillers.every(({ i, cut }) => i.cover >= cut - 1e-9 && i.units >= rules.filler.minUnits);
    const covers = fillers.map((f) => f.i.cover).sort((a, b) => a - b);
    const med = covers.length ? covers[Math.floor(covers.length / 2)] : 0;
    check("Fillers are slow movers" + (rules.filler.minUnits ? " with high stock" : ""), "Нэмэлт бараа нь удаан эргэлттэй", ok, `median ${med.toFixed(0)} weeks of cover`, `медиан ${med.toFixed(0)} долоо хоногийн нөөц`);
  }

  // 6. one site
  if (rules.stock.allocate && rules.stock.oneSitePerSet) {
    const ok = sets.every((s) => new Set(s.items.map((i) => i.site)).size === 1);
    const bySite = new Map<string, number>();
    for (const s of sets) bySite.set(s.site ?? "?", (bySite.get(s.site ?? "?") ?? 0) + 1);
    check("One site per set", "Багц бүр нэг байршлаас", ok, [...bySite].map(([k, v]) => `${k} ${v}`).join(", "));
  }

  // 7. exclusions
  const all = sets.flatMap((s) => s.items);
  const excluded = all.filter(
    (i) =>
      i.price < rules.itemPrice[0] ||
      i.price > rules.itemPrice[1] ||
      rules.exclusions.topCategories.includes(i.categ.split(" / ")[0]) ||
      rules.exclusions.categ.some((p) => rx(p.pattern).test(i.categ)) ||
      rules.exclusions.name.some((p) => rx(p.pattern).test(i.name)) ||
      rules.exclusions.brand.some((p) => rx(p.pattern).test(i.brand ?? "")) ||
      rules.exclusions.codes.some((c) => c.code === i.code),
  );
  check(
    `No excluded categories, names or brands; every item ${fmt(rules.itemPrice[0])}–${fmt(rules.itemPrice[1])}₮`,
    "Хасагдсан ангилал, нэр, брэнд ороогүй",
    !excluded.length,
    excluded.length ? `${excluded.length} violations: ${excluded.slice(0, 3).map((i) => i.code).join(", ")}` : `${rules.exclusions.categ.length + rules.exclusions.name.length + rules.exclusions.brand.length} exclusion rules held`,
    `${excluded.length} зөрчил`,
  );

  // 8–9. recipe and segment name rules (kids safety, ports)
  const badNames = sets.flatMap((s) => {
    const r = recipeOf.get(`${s.batch}|${s.recipeKey}`)!.recipe;
    const ex = recipeExclude(r, rules);
    return ex ? s.items.filter((i) => ex.test(i.name)).map((i) => `${s.code}: ${i.name}`) : [];
  });
  if (plan.batches.some((b) => b.recipes.some((r) => recipeExclude(r, rules))))
    check("Recipe and audience name rules (kids safety, ports…)", "Жор, хэрэглэгчийн бүлгийн нэрийн дүрэм (хүүхдийн аюулгүй байдал, порт…)", !badNames.length, badNames.length ? badNames.slice(0, 3).join("; ") : "held in every set", badNames.length ? `${badNames.length} зөрчил` : "бүх багцад хэрэгжсэн");

  // 10. category mix
  const mixOk = sets.every((s) => {
    const count = (f: (c: string) => string, limit?: number) => {
      if (limit === undefined) return true;
      const m = new Map<string, number>();
      for (const i of s.items) m.set(f(i.categ), (m.get(f(i.categ)) ?? 0) + 1);
      return Math.max(...m.values()) <= limit;
    };
    const tops = new Set(s.items.map((i) => i.categ.split(" / ")[0])).size;
    const tmpls = new Set(s.items.map((i) => i.tmpl)).size === s.items.length;
    return count((c) => c, rules.mix.leaf) && count((c) => c.split(" / ").slice(0, 2).join(" / "), rules.mix.sub) && count((c) => c.split(" / ")[0], rules.mix.top) && (!rules.mix.minTopCats || tops >= rules.mix.minTopCats) && tmpls;
  });
  check(
    "Category mix per set",
    "Багц доторх ангиллын холимог",
    mixOk,
    `≤ ${rules.mix.leaf} per leaf, ≤ ${rules.mix.sub} per sub-category${rules.mix.top ? `, ≤ ${rules.mix.top} per top category` : ""}${rules.mix.minTopCats ? `, ≥ ${rules.mix.minTopCats} top categories` : ""}, one variant per product`,
  );

  // 11–13. overlap, SKU uses, product lines
  let maxShared = 0;
  let identical = 0;
  for (let a = 0; a < sets.length; a++)
    for (let b = a + 1; b < sets.length; b++) {
      const pa = new Set(sets[a].items.map((i) => i.pid));
      const shared = sets[b].items.filter((i) => pa.has(i.pid)).length;
      maxShared = Math.max(maxShared, shared);
      if (shared === pa.size && shared === sets[b].items.length) identical++;
    }
  if (rules.reuse.maxShared !== undefined) check(`Any two sets share ≤ ${rules.reuse.maxShared} products`, `Дурын хоёр багц ≤ ${rules.reuse.maxShared} ижил бараатай`, maxShared <= rules.reuse.maxShared, `most shared by any pair: ${maxShared}`);
  check("No two sets alike", "Ижил хоёр багц байхгүй", identical === 0, `${sets.length - identical} different sets`);
  const uses = new Map<number, number>();
  for (const i of all) uses.set(i.pid, (uses.get(i.pid) ?? 0) + 1);
  check(
    rules.reuse.maxUsesPerSku === 1 ? "No SKU in two sets" : `A SKU is in ≤ ${rules.reuse.maxUsesPerSku} sets`,
    rules.reuse.maxUsesPerSku === 1 ? "Нэг SKU хоёр багцад ороогүй" : `Нэг SKU ≤ ${rules.reuse.maxUsesPerSku} багцад`,
    Math.max(0, ...uses.values()) <= rules.reuse.maxUsesPerSku,
    `${uses.size} distinct SKUs for ${all.length} items`,
    `${all.length} бараанд ${uses.size} өөр SKU`,
  );
  const famPerRecipe = new Map<string, Map<string, number>>();
  const fam = new Map<string, number>();
  for (const s of sets)
    for (const i of s.items) {
      const f = familyOf(i.name);
      const k = `${s.batch}|${s.recipeKey}`;
      const m = famPerRecipe.get(k) ?? new Map<string, number>();
      m.set(f, (m.get(f) ?? 0) + 1);
      famPerRecipe.set(k, m);
      fam.set(f, (fam.get(f) ?? 0) + 1);
    }
  check("No product line twice within a recipe", "Нэг жорт нэг барааны шугам давтагдаагүй", [...famPerRecipe.values()].every((m) => Math.max(...m.values()) <= 1), "Colour / character variants of one product never go into two sets of the same recipe");
  check(`A product line is in ≤ ${rules.reuse.maxFamilyUses} sets`, `Барааны шугам ≤ ${rules.reuse.maxFamilyUses} багцад`, Math.max(0, ...fam.values()) <= rules.reuse.maxFamilyUses, `${fam.size} product lines`);

  // 14. bag
  if (rules.packaging.enabled) {
    const bags = new Map<string, number>();
    for (const s of sets) {
      const b = bagFor(s.items.map((i) => i.dims), rules.packaging) ?? "none";
      bags.set(b, (bags.get(b) ?? 0) + 1);
    }
    const label = (c: string) => {
      const b = rules.packaging.bags.find((x) => x.code === c);
      return b ? `${b.w}×${b.h}` : c;
    };
    check("Every set fits a bag", "Багц бүр ууттай таарсан", !bags.has("none"), [...bags].map(([c, n]) => `${label(c)} mm: ${n}`).join(", "), [...bags].map(([c, n]) => `${label(c)} мм: ${n} багц`).join(", "));
  }

  // 15. allocation
  if (rules.stock.allocate && bins) {
    const have = new Map(bins.map((b) => [`${b.pid}|${b.locationId}`, b.qty]));
    const used = new Map<string, number>();
    for (const i of all) if (i.locationId !== undefined) used.set(`${i.pid}|${i.locationId}`, (used.get(`${i.pid}|${i.locationId}`) ?? 0) + 1);
    const ok = all.every((i) => i.locationId !== undefined) && [...used].every(([k, n]) => n <= (have.get(k) ?? 0));
    check("Reserved ≤ available stock in every bin", "Нөөцөлсөн тоо байршил бүрийн үлдэгдлээс хэтрээгүй", ok, `${all.length} units from ${used.size} bin positions`, `${used.size} байршлаас ${all.length} ширхэг`);
  }
  return checks;
}

export function batchOf(plan: Plan, key: string): Batch | undefined {
  return plan.batches.find((b) => b.key === key);
}
