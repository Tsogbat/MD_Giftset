// Rule memory seeded from the user's decisions in the Red Box and Tsagaan gar sessions (2026-09-30 → 10-06).
// Safe to run again: rules with the same title are skipped.
//   npm run seed:rules
import { prisma } from "../src/lib/db";

const RULES: Array<{ title: string; text: string; rule?: unknown }> = [
  { title: "No D.Tale", text: "Never include any D.Tale product (brand \"D. TALE\", codes 77xxxxxx) in any set.", rule: { exclusions: { brand: [{ label: "D.Tale (all products of the brand)", pattern: "d\\.?\\s*tale" }] } } },
  { title: "Phone items USB-C only", text: "Phone/digital items in one set must share USB-C: no 3.5 mm jack, AUX, Lightning (8-pin), micro-USB or USB-A items; earphones must say USB-C or Type-C." },
  { title: "Unboxing-worthy only", text: "Everything must be worth unboxing: no plain pens or pencils, no padlocks, nothing cheap-looking or that looks like dumped stock (e.g. the dog-bone candy)." },
  { title: "Never two variants of one product", text: "Never put two colours, flavours or designs of the same product in one set." },
  { title: "No alcohol themes, intimate or hygiene items", text: "No soju/beer/makgeolli glasses or designs, no 'drunk' characters, no nipple covers, earplugs, lens cases, hair-cutting scissors, pimple extractors or eyebrow razors." },
  { title: "Kids: nothing sharp, no glass, no hair dye", text: "Sets for kids: no knives, scissors, cutters, razors, nail clippers, glass items or hair dye." },
  { title: "Gender-neutral unless asked", text: "Do not put clearly one-gender items (e.g. Kuromi / My Melody nail-tip sets) into sets meant for everyone." },
  { title: "Team sets exactly as given", text: "Sets the team made by hand (e.g. Red Box 299k/499k, Tsagaan gar 45K) are included exactly as given: never substitute, re-price or re-plan them, even when their stock is short." },
  { title: "Food only from samples", text: "Food bonus items may come only from the sample/bonus file, never from our own food stock." },
  { title: "MIS names verbatim", text: "Keep MIS product names, category paths and brand names exactly as spelled (e.g. \"Random Figure\")." },
  { title: "Exact value not needed", text: "A set's contents value may be anywhere within ± 2,000₮ of the target; hitting it exactly is not needed." },
];

let added = 0;
for (const r of RULES) {
  if (await prisma.memoryRule.findFirst({ where: { title: r.title } })) continue;
  await prisma.memoryRule.create({ data: { title: r.title, text: r.text, rule: (r.rule ?? undefined) as never, createdBy: "seed (Red Box / Tsagaan gar sessions)" } });
  added++;
}
console.log(`rule memory: ${added} added, ${RULES.length - added} already there`);
await prisma.$disconnect();
