// The rule set and recipes the agent writes and the solver follows.
// Every constant of redbox_199k.py and gift_bundles.py is a field here, so "what kind of set" is decided
// by the answers (no set-type picker). zod validates whatever the agent sends before it is saved.
import { z } from "zod";

export const SlotSchema = z.object({
  label: z.string().min(1),
  labelMn: z.string().optional(),
  /** MIS category paths (any level). An item fits if its category equals or starts with one + " / ". */
  kinds: z.array(z.string().min(1)).min(1),
  /** Retail price band (₮, VAT incl.) for this slot. */
  band: z.tuple([z.number().nonnegative(), z.number().positive()]),
  /** Regex the product name must match (e.g. USB-C). */
  require: z.string().optional(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const RecipeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  nameMn: z.string().optional(),
  pitch: z.string().optional(),
  pitchMn: z.string().optional(),
  /** Audience segment (e.g. "Kids"); segment exclusions in Rules apply to it. */
  segment: z.string().optional(),
  /** Optional 1–3 letter group inside the prefix; numbering runs within it (TG-K01…, TG-Y01…). Usually empty. */
  codeGroup: z.string().max(3).optional(),
  /** How many sets of this recipe. */
  boxes: z.number().int().min(1),
  /** Widen/narrow the best-seller cut for this recipe's hero (default Rules.hero.topShare). */
  heroShare: z.number().min(0.01).max(1).optional(),
  /** Regex on product names excluded from every slot of this recipe (e.g. other phone ports). */
  exclude: z.string().optional(),
  /** null = no hero item in this recipe. */
  hero: SlotSchema.nullable(),
  slots: z.array(SlotSchema),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const BatchSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** Set codes start with it: RB199 → RB199-01. */
  prefix: z.string().min(1),
  /** Target retail value of one set (₮). */
  target: z.number().positive(),
  /** Any value within target ± tolerance is on target. */
  tolerance: z.number().nonnegative(),
  /** Preferred closeness (scores better), optional. */
  close: z.number().nonnegative().optional(),
  /** What the customer pays for one set (₮, VAT incl.). Mystery box: the box price; default = the set's contents value. */
  sellPrice: z.number().positive().optional(),
  /** Hard price range every set must stay inside, optional. */
  hardRange: z.tuple([z.number(), z.number()]).optional(),
  recipes: z.array(RecipeSchema).min(1),
});
export type Batch = z.infer<typeof BatchSchema>;

const Pattern = z.object({ label: z.string(), pattern: z.string() });
export type Pattern = z.infer<typeof Pattern>;

export const BagSchema = z.object({ code: z.string(), w: z.number().positive(), h: z.number().positive(), maxStack: z.number().positive() });

export const RulesSchema = z.object({
  /** Free description the agent fills from the answers, e.g. "mystery box, value ≈ price". */
  kind: z.string(),
  /** Every item's retail price must be inside this range. */
  itemPrice: z.tuple([z.number(), z.number()]),
  hero: z.object({
    enabled: z.boolean(),
    /** Hero = top share of sellers by weekly sales. */
    topShare: z.number().min(0.01).max(1),
    minUnits: z.number().nonnegative(),
    /** Hero must keep this many weeks of sales after one unit goes into a set (Red Box 2). */
    keepWeeks: z.number().nonnegative(),
    /** Category regex never used as hero (e.g. Posture Corrector). */
    excludeCateg: z.string().optional(),
    /** A different hero in every set. */
    distinct: z.boolean(),
  }),
  filler: z.object({
    /** Fillers need weeks of cover ≥ this quantile of all eligible items (0.5 = median = slow movers); 0 = any. */
    coverQuantile: z.number().min(0).max(1),
    minUnits: z.number().nonnegative(),
    /** Items first received less than this many days ago are not slow movers. */
    newArrivalDays: z.number().nonnegative(),
    /** Draw weight: log1p(cover) (Red Box) or log1p(cover)·log1p(units) (Tsagaan gar, high stock). */
    weighting: z.enum(["cover", "cover_units"]),
  }),
  mix: z.object({
    /** Max items per leaf category / sub-category (2 levels) / top category in one set. */
    leaf: z.number().int().min(1),
    sub: z.number().int().min(1),
    top: z.number().int().min(1).optional(),
    minTopCats: z.number().int().min(0).optional(),
  }),
  reuse: z.object({
    maxUsesPerSku: z.number().int().min(1),
    /** Max products any two sets may share; undefined = only "no two sets identical". */
    maxShared: z.number().int().min(0).optional(),
    reuseWeight: z.number().min(0).max(1),
    maxFamilyUses: z.number().int().min(1),
    familyWeight: z.number().min(0).max(1),
  }),
  stock: z.object({
    sites: z.array(z.string()).min(1),
    /** All items of a set come from one site (warehouse or one branch). */
    oneSitePerSet: z.boolean(),
    preferSite: z.string(),
    /** Reserve units in the ledger so other projects can't promise them again. */
    allocate: z.boolean(),
  }),
  packaging: z.object({
    enabled: z.boolean(),
    bags: z.array(BagSchema),
    topFold: z.number().nonnegative(),
    girthSlack: z.number().nonnegative(),
  }),
  exclusions: z.object({
    topCategories: z.array(z.string()),
    categ: z.array(Pattern),
    name: z.array(Pattern),
    brand: z.array(Pattern),
    /** Exact SKU codes never used (e.g. "looks cheap" after a photo review). */
    codes: z.array(z.object({ code: z.string(), reason: z.string() })),
  }),
  /** Extra name exclusions for one audience segment (e.g. Kids: nothing sharp, no glass). */
  segmentExcludes: z.array(z.object({ segment: z.string(), label: z.string(), pattern: z.string() })),
  search: z.object({
    attempts: z.number().int().min(10),
    enoughPerfect: z.number().int().min(1),
    heroesTried: z.number().int().min(1),
    maxHeroesTried: z.number().int().min(1),
    seed: z.number().int(),
    seedTries: z.number().int().min(1),
    minSlotPool: z.number().int().min(1),
  }),
});
export type Rules = z.infer<typeof RulesSchema>;

export const PlanSchema = z.object({ rules: RulesSchema, batches: z.array(BatchSchema).min(1) });
export type Plan = z.infer<typeof PlanSchema>;

export type Check = { name: string; nameMn: string; ok: boolean; detail: string; detailMn: string };

export type SetItem = {
  role: "hero" | "filler";
  slot: number; // -1 = hero
  slotLabel: string;
  pid: number;
  tmpl: number;
  code: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  categ: string;
  price: number;
  landed: number | null;
  weekly: number;
  cover: number;
  units: number;
  dims?: [number, number, number];
  site?: string;
  bin?: string;
  locationId?: number;
};

export type BuiltSet = {
  code: string;
  batch: string;
  recipeKey: string;
  recipe: string;
  k: number;
  site: string | null;
  total: number;
  bag: string | null;
  items: SetItem[];
};
