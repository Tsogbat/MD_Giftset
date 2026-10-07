// Defaults and the two proven designs, transcribed from the Python builders:
//   Red Box 199k  — Documents\Redbox\redbox_199k.py (RECIPES :132-264, constants :43-104)
//   Tsagaan gar   — Documents\Tsagaan gar\gift_bundles.py (RECIPES :178-250, constants :46-114)
// The agent offers them as recommended answers ("like Red Box?"); they are not set types.
import type { Batch, Pattern, Recipe, Rules, Slot } from "./types";

const slot = (label: string, kinds: string | string[], lo: number, hi: number, extra: Partial<Slot> = {}): Slot => ({
  label,
  kinds: Array.isArray(kinds) ? kinds : [kinds],
  band: [lo, hi],
  ...extra,
});

// --- Exclusions the user already decided (both projects) ---------------------------------------
export const EXCLUDED_TOP = ["Service", "Food", "Deliveries", "Equipment", "Lock"];

export const PLAIN_PENS_AND_PENCILS: Pattern[] = [
  { label: "Plain pens (Monami / Uni / Zebra 'X Pen') and refills", pattern: "X Pen|Correction Tape/Refill" },
  { label: "Pencils, mechanical pencils, colour pencils", pattern: "Writing Instrument / Pencil|Mechanical Pencil" },
];
export const ALL_WRITING_INSTRUMENTS: Pattern[] = [
  { label: "All pens, markers, pencils and refills", pattern: "Writing Instrument|Mechanical Pencil|Correction Tape/Refill" },
];

export const BASE_CATEG_EXCLUSIONS: Pattern[] = [
  { label: "Locks", pattern: "Key & Lock" },
  { label: "Toy candy", pattern: "Toy candy" },
  { label: "Gift bags, eco bags, gift boxes, wrapping, ribbon", pattern: "Packaging Accessory|Eco Bag" },
  { label: "Foil balloons", pattern: "Foil Balloon" },
  { label: "Pet accessories", pattern: " / Pet / " },
  { label: "Cables and chargers", pattern: "Charging Device" },
  { label: "Perfume and fragrance, incl. perfume bottles", pattern: "Fragrance|Perfume" },
  { label: "K-pop albums", pattern: "Kpop- Albums" },
  { label: "Socks, slippers, oral care, razors", pattern: "Socks & Underwear|Slippers|Oral Care|Shaving & Hair Removal" },
];

export const BASE_NAME_EXCLUSIONS: Pattern[] = [
  { label: "Alcohol-themed items (soju / beer / makgeolli glasses and designs, 'drunk' characters)", pattern: "сөжү|сожү|сожу|шар айраг|макголи|согтуу|soju|beer" },
  { label: "Nipple covers", pattern: "хөхний" },
  { label: "Earplugs", pattern: "бөглөө" },
  { label: "Contact-lens cases", pattern: "линз" },
  { label: "Hair-cutting scissors", pattern: "үс засагч" },
  { label: "Pimple extractors and eyebrow razors", pattern: "батга|хөмсөгний хутга" },
];

export const BASE_BRAND_EXCLUSIONS: Pattern[] = [{ label: "D.Tale (all products of the brand)", pattern: "d\\.?\\s*tale" }];

/** Kids: nothing sharp or breakable (scissors, cutters, razors, nail clippers, glass), no hair dye. */
export const KIDS_EXCLUDE = "хутга|хайч|зүсэгч|шилэн|үс будах|cutter|razor|knife";

/** Phone items: USB-C only — no 3.5 mm jack, AUX, Lightning (8-pin), micro-USB, USB-A. */
export const OTHER_PORTS = "3\\.5\\s*(мм|mm)|\\baux\\b|8\\s*-?pin|lightning|micro\\s*-?usb|5\\s*-?pin|usb-a";
export const USB_C = "usb-?\\s*c\\b|type-?\\s*c\\b";

export const PAPER_BAGS = [
  { code: "S", w: 110, h: 160, maxStack: 35 },
  { code: "L", w: 130, h: 240, maxStack: 45 },
];

// --- Rule sets ----------------------------------------------------------------------------------
/** Red Box: a mystery box worth its price — best-seller hero + slow movers, one site, stock reserved. */
export function mysteryBoxRules(): Rules {
  return {
    kind: "Mystery box: retail value of the contents ≈ the box price; 1 best-seller hero + slow movers",
    itemPrice: [1_000, 100_000],
    hero: { enabled: true, topShare: 0.25, minUnits: 0, keepWeeks: 2, excludeCateg: "Posture Corrector", distinct: true },
    filler: { coverQuantile: 0.5, minUnits: 0, newArrivalDays: 14, weighting: "cover" },
    mix: { leaf: 1, sub: 2, top: 4, minTopCats: 4 },
    reuse: { maxUsesPerSku: 3, maxShared: 2, reuseWeight: 0.02, maxFamilyUses: 4, familyWeight: 0.15 },
    stock: { sites: ["WH", "CEN", "ENC"], oneSitePerSet: true, preferSite: "WH", allocate: true },
    packaging: { enabled: false, bags: PAPER_BAGS, topFold: 20, girthSlack: 10 },
    exclusions: { topCategories: [...EXCLUDED_TOP], categ: [...PLAIN_PENS_AND_PENCILS, ...BASE_CATEG_EXCLUSIONS], name: [...BASE_NAME_EXCLUSIONS], brand: [...BASE_BRAND_EXCLUSIONS] },
    segmentExcludes: [{ segment: "Kids", label: "Kids: nothing sharp or glass, no hair dye", pattern: KIDS_EXCLUDE }],
    search: { attempts: 500, enoughPerfect: 30, heroesTried: 3, maxHeroesTried: 15, seed: 199, seedTries: 5, minSlotPool: 8 },
  };
}

/** Tsagaan gar: small gift bundles — each SKU once, high-stock slow movers, must fit a paper bag. */
export function giftBundleRules(): Rules {
  return {
    kind: "Small gift bundle: 1 best-seller hero + high-stock slow movers, each SKU once, fits a paper bag",
    itemPrice: [1_000, 100_000],
    hero: { enabled: true, topShare: 0.25, minUnits: 10, keepWeeks: 0, distinct: true },
    filler: { coverQuantile: 0.5, minUnits: 20, newArrivalDays: 14, weighting: "cover_units" },
    mix: { leaf: 1, sub: 2 },
    reuse: { maxUsesPerSku: 1, reuseWeight: 0.02, maxFamilyUses: 2, familyWeight: 0.15 },
    stock: { sites: ["WH", "CEN", "ENC"], oneSitePerSet: false, preferSite: "WH", allocate: false },
    packaging: { enabled: true, bags: PAPER_BAGS, topFold: 20, girthSlack: 10 },
    exclusions: { topCategories: [...EXCLUDED_TOP], categ: [...ALL_WRITING_INSTRUMENTS, ...BASE_CATEG_EXCLUSIONS], name: [...BASE_NAME_EXCLUSIONS], brand: [...BASE_BRAND_EXCLUSIONS] },
    segmentExcludes: [{ segment: "Kids", label: "Kids: nothing sharp or glass, no hair dye", pattern: KIDS_EXCLUDE }],
    search: { attempts: 500, enoughPerfect: 30, heroesTried: 3, maxHeroesTried: 15, seed: 2026, seedTries: 5, minSlotPool: 8 },
  };
}

// --- Red Box 199k recipes -----------------------------------------------------------------------
const PENS = ["Stationery / Writing Instrument / Ballpoint Pen", "Stationery / Writing Instrument / Highlighter", "Stationery / Writing Instrument / Other Pen"];
const RB_HAIR = ["Beauty & Life / Beauty Accessories / Hair Accessory"];

const RB_RECIPES: Recipe[] = [
  {
    key: "R1", name: "Photocard Collector", boxes: 4,
    pitch: "For K-pop fans: a card case to show off photocards, plus keyrings, stickers and a photo album.",
    hero: slot("Photocard / card case", "Fashion Accessories / Card Case", 21_000, 36_000),
    slots: [
      slot("Figure keyring", "Kidult / Keyring / Figure Accessory", 10_000, 20_000),
      slot("Mini keyring", "Kidult / Keyring / Mini Keyring", 15_000, 25_000),
      slot("3D sticker", "Design Paper / Sticker / 3D Sticker", 8_000, 16_000),
      slot("Seal sticker", "Design Paper / Sticker / Seal Sticker", 6_000, 9_000),
      slot("Photo album", "Design Paper / Album", 25_000, 58_000),
      slot("Phone accessory", "Lifestyle Goods / Living Accessories / Phone Accessories", 15_000, 55_000),
      slot("Sticky notes", "Design Paper / Sticky Note", 6_000, 13_000),
      slot("Character pen", PENS, 6_000, 25_000),
      slot("Badge / patch", "Fashion Accessories / Accessories / Badge/Patch", 12_000, 20_000),
    ],
  },
  {
    key: "R2", name: "Figure Hunter", boxes: 8, heroShare: 0.35,
    pitch: "A blind-box figure as the star, with charms, a mood light and a card case to display it.",
    hero: slot("Random / designer figure", "Kidult / Figure", 35_000, 81_000),
    slots: [
      slot("Keyring & charm", "Kidult / Keyring / Keyring & Charms", 12_000, 35_000),
      slot("Plush accessory", "Kidult / Plush & Plush Keyrings / Plush Accessories", 8_000, 32_000),
      slot("Custom game", "Kidult / Game / Custom Game", 9_000, 41_000),
      slot("Sticker", "Design Paper / Sticker", 6_000, 22_000),
      slot("Retro toy", "Lifestyle Goods / Personal Accessories / Retro Game", 10_000, 35_000),
      slot("Home interior (light / clock / frame)", "Home & Life / Home Interior", 16_000, 52_000),
      slot("Card case", "Fashion Accessories / Card Case", 20_000, 42_000),
      slot("Desk accessory", "Stationery / Stationery Accessory", 6_000, 25_000),
    ],
  },
  {
    key: "R3", name: "Plush Hug", boxes: 4,
    pitch: "A plush keyring or plush bag with cute letter paper, a mirror, a cup and a pouch.",
    hero: slot("Plush / plush keyring", "Kidult / Plush & Plush Keyrings", 22_000, 42_000),
    slots: [
      slot("Figure keyring", "Kidult / Keyring / Figure Accessory", 10_000, 20_000),
      slot("Letter paper", "Design Paper / Letter Paper / Letter Paper", 7_000, 19_000),
      slot("Seal sticker", "Design Paper / Sticker / Seal Sticker", 6_000, 9_000),
      slot("Greeting card", "Design Paper / Card", 7_000, 16_000),
      slot("Hair accessory", RB_HAIR, 10_000, 33_000),
      slot("Hand mirror", "Home & Life / Personal Care / Mirror", 15_000, 26_000),
      slot("Cup / glass / tumbler", "Home & Life / Drinkware", 15_000, 50_000),
      slot("Pouch", "Fashion Accessories / Accessories / Basic Pouch", 25_000, 46_000),
      slot("Plush accessory", "Kidult / Plush & Plush Keyrings / Plush Accessories", 8_000, 32_000),
      slot("Character pen", PENS, 6_000, 25_000),
    ],
  },
  {
    key: "R4", name: "Doodle Desk", boxes: 4,
    pitch: "An LCD drawing board as the star, with craft supplies, pens, a lamp and a keyring pouch.",
    hero: slot("Electronic drawing board", "Lifestyle Goods / Personal Accessories / Idea Goods", 30_000, 40_000),
    slots: [
      slot("Art & craft supply", "Stationery / Art Supply", 8_000, 30_000),
      slot("Letter paper", "Design Paper / Letter Paper", 7_000, 19_000),
      slot("Custom sticky notes", "Design Paper / Sticky Note / Custom Sticky Note", 6_000, 13_000),
      slot("Pen set / character pen", PENS, 8_000, 28_000),
      slot("Home interior (light / clock / frame)", "Home & Life / Home Interior", 15_000, 50_000),
      slot("Keyring pouch", "Kidult / Keyring / Keyring Pouch", 25_000, 45_000),
      slot("Phone accessory", "Lifestyle Goods / Living Accessories / Phone Accessories", 15_000, 55_000),
      slot("Personal care", "Home & Life / Personal Care", 10_000, 30_000),
    ],
  },
  {
    key: "R5", name: "Play Time", boxes: 4,
    pitch: "A toy or game everyone is buying, with squishies, plush, sticker sets and a craft kit.",
    hero: slot("Toy / game", ["Kidult / Game", "Kidult / Toy", "Lifestyle Goods / Personal Accessories / Retro Game"], 20_000, 65_000),
    slots: [
      slot("Custom game", "Kidult / Game / Custom Game", 9_000, 41_000),
      slot("Squishy / fidget toy", ["Kidult / Toy", "Kidult / Game / Other Game"], 8_000, 30_000),
      slot("Plush keyring", "Kidult / Plush & Plush Keyrings / Plush Keyring", 20_000, 46_000),
      slot("Kids sticker", "Design Paper / Sticker / Kids Sticker", 10_000, 24_000),
      slot("Sticker set", "Design Paper / Sticker / Sticker Set", 9_000, 22_000),
      slot("Art & craft supply", "Stationery / Art Supply", 8_000, 30_000),
      slot("Retro toy", "Lifestyle Goods / Personal Accessories / Retro Game", 10_000, 35_000),
      slot("Hair accessory", RB_HAIR, 10_000, 33_000),
      slot("Phone accessory", "Lifestyle Goods / Living Accessories / Phone Accessories", 15_000, 55_000),
    ],
  },
  {
    key: "R6", name: "Self-care Spa", boxes: 2,
    pitch: "A best-selling beauty tool (gua sha, sleep mask, hair clip) with a pouch, cup, soft light and neck pillow.",
    hero: slot("Beauty tool", ["Beauty & Life / Beauty Accessories", "Home & Life / Massage & Health / Beauty Device", "Home & Life / Personal Care / Mirror"], 20_000, 45_000),
    slots: [
      slot("Beauty accessory", "Beauty & Life / Beauty Accessories", 8_000, 45_000),
      slot("Personal care", "Home & Life / Personal Care", 10_000, 30_000),
      slot("Pouch", ["Fashion Accessories / Accessories / Basic Pouch", "Fashion Accessories / Accessories / Make Up Pouch", "Fashion Accessories / Accessories / Mini Pouch"], 18_000, 50_000),
      slot("Cup / mug / tumbler", "Home & Life / Drinkware", 15_000, 50_000),
      slot("Lighting", "Home & Life / Home Interior / Lighting", 15_000, 50_000),
      slot("Letter paper", "Design Paper / Letter Paper", 7_000, 19_000),
      slot("Sticky notes", "Design Paper / Sticky Note", 6_000, 13_000),
      slot("Neck pillow", "Kidult / Plush & Plush Keyrings / Neck Pillow", 30_000, 58_000),
    ],
  },
  {
    key: "R7", name: "Style Up", boxes: 4,
    pitch: "A trending fashion piece (hair set, pouch, badge) with a card wallet, card case, charms and a phone grip.",
    hero: slot("Fashion accessory", "Fashion Accessories / Accessories", 22_000, 50_000),
    slots: [
      slot("Hair accessory", "Beauty & Life / Beauty Accessories / Hair Accessory", 10_000, 33_000),
      slot("Card case", "Fashion Accessories / Card Case", 18_000, 42_000),
      slot("Keyring & charm", "Kidult / Keyring / Keyring & Charms", 12_000, 35_000),
      slot("Phone accessory", "Lifestyle Goods / Living Accessories / Phone Accessories", 15_000, 55_000),
      slot("Card wallet", "Fashion Accessories / Accessories / Card Wallet", 25_000, 55_000),
      slot("Sticker", "Design Paper / Sticker", 6_000, 22_000),
      slot("Mirror / personal care", "Home & Life / Personal Care", 12_000, 30_000),
      slot("Mini keyring", "Kidult / Keyring / Mini Keyring", 15_000, 25_000),
      slot("Greeting card", "Design Paper / Card", 7_000, 16_000),
    ],
  },
  {
    key: "R8", name: "Little Ones", boxes: 4,
    pitch: "For parents: a character kids' cutlery set with stickers, toys, craft and a cup.",
    hero: slot("Kids' cutlery / tableware", "Home & Life / Kitchenware / Tableware", 24_000, 36_000),
    slots: [
      slot("Kids sticker", "Design Paper / Sticker / Kids Sticker", 10_000, 24_000),
      slot("Kids stationery item", ["Stationery / Stationery Accessory / Kids Item", "Stationery / Stationery Accessory / Custom Kids Item"], 10_000, 30_000),
      slot("Toy / mini figure", ["Kidult / Toy", "Kidult / Figure / Designer Figure"], 8_000, 30_000),
      slot("Art & craft supply", "Stationery / Art Supply", 8_000, 30_000),
      slot("Fidget / small game", "Kidult / Game / Other Game", 9_000, 35_000),
      slot("Seal sticker", "Design Paper / Sticker / Seal Sticker", 6_000, 9_000),
      slot("Cup / glass", "Home & Life / Drinkware", 15_000, 30_000),
      slot("Hair accessory", RB_HAIR, 8_000, 25_000),
      slot("Plush accessory", "Kidult / Plush & Plush Keyrings / Plush Accessories", 8_000, 32_000),
      slot("3D card", "Design Paper / Card / 3D", 7_000, 16_000),
      slot("Character pen", PENS, 6_000, 20_000),
    ],
  },
  {
    key: "R9", name: "Phone Life", boxes: 2, exclude: OTHER_PORTS,
    pitch: "A best-selling phone gadget (MagSafe wallet, grip, earphones) with more phone and travel gear. USB-C only: nothing with a 3.5 mm jack, AUX or Lightning (8-pin) plug.",
    hero: slot("Phone gadget", ["Digital / Smart Device Accessory", "Digital / Audio Device", "Lifestyle Goods / Living Accessories"], 20_000, 46_000),
    slots: [
      slot("Phone accessory", "Lifestyle Goods / Living Accessories / Phone Accessories", 15_000, 55_000),
      slot("Phone case / holder", "Digital / Smart Device Accessory", 20_000, 45_000),
      slot("Earphones / audio (USB-C)", "Digital / Audio Device", 20_000, 55_000, { require: USB_C }),
      slot("Photo card case", "Fashion Accessories / Card Case / Photo Card Case", 20_000, 42_000),
      slot("Keyring & charm", "Kidult / Keyring / Keyring & Charms", 12_000, 35_000),
      slot("Sticker", "Design Paper / Sticker", 6_000, 22_000),
      slot("Travel accessory", "Fashion Accessories / Travel Accessories", 15_000, 41_000),
    ],
  },
  {
    key: "R10", name: "Desk & Memories", boxes: 4,
    pitch: "A desk statement piece (photo album, pencil case, highlighter set) with paper goods, a clock and a cup.",
    hero: slot("Desk statement piece", ["Design Paper / Album", "Fashion Accessories / Pencil Cases", "Stationery / Writing Instrument / Highlighter", "Design Paper / Sticker / 3D Sticker", "Home & Life / Home Care"], 25_000, 40_000),
    slots: [
      slot("Letter paper", "Design Paper / Letter Paper / Letter Paper", 7_000, 19_000),
      slot("Custom sticky notes", "Design Paper / Sticky Note / Custom Sticky Note", 6_000, 13_000),
      slot("Marker / sign pen", "Stationery / Writing Instrument / Other Pen", 10_000, 28_000),
      slot("Desk accessory", "Stationery / Stationery Accessory", 6_000, 25_000),
      slot("Clock", "Home & Life / Home Interior / Clock", 20_000, 55_000),
      slot("Figure keyring", "Kidult / Keyring / Figure Accessory", 10_000, 20_000),
      slot("Cup / glass / mug", "Home & Life / Drinkware", 15_000, 50_000),
      slot("Pouch / pencil case", ["Fashion Accessories / Pencil Cases", "Fashion Accessories / Accessories / Basic Pouch"], 15_000, 55_000),
    ],
  },
];

export function redBox199kBatch(): Batch {
  return { key: "199k", label: "Red Box 199k", prefix: "RB199", target: 199_000, tolerance: 2_000, recipes: structuredClone(RB_RECIPES) };
}

// --- Tsagaan gar 22.5K recipes ------------------------------------------------------------------
const SEAL = "Design Paper / Sticker / Seal Sticker";
const STICKER_3D = "Design Paper / Sticker / 3D Sticker";
const KIDS_STICKER = "Design Paper / Sticker / Kids Sticker";
const GENERAL_STICKER = "Design Paper / Sticker / General Sticker";
const STICKER_SET = "Design Paper / Sticker / Sticker Set";
const BODY_DECO = "Design Paper / Sticker / Body Deco Sticker";
const CUSTOM_NOTE = "Design Paper / Sticky Note / Custom Sticky Note";
const BASIC_NOTE = "Design Paper / Sticky Note / Basic";
const LETTER = ["Design Paper / Letter Paper / Letter Paper", "Design Paper / Letter Paper / Letter paper"];
const ENVELOPE = "Design Paper / Letter Paper / Envelope";
const CARD = "Design Paper / Card";
const ERASER = "Stationery / Stationery Accessory / Correction Supply";
const KIDS_ITEM = ["Stationery / Stationery Accessory / Custom Kids Item", "Stationery / Stationery Accessory / Kids Item"];
const DESK = ["Stationery / Stationery Accessory / Clip/Pin/Clamp", "Stationery / Stationery Accessory / Desk Organizer", "Stationery / Stationery Accessory / Tape/Cutter", "Stationery / Stationery Accessory / Ruler"];
const FIGURE_KEYRING = "Kidult / Keyring / Figure Accessory";
const CHARMS = "Kidult / Keyring / Keyring & Charms";
const SQUISHY = "Kidult / Toy / Squishy";
const TOY = "Kidult / Toy";
const OTHER_GAME = "Kidult / Game / Other Game";
const CUSTOM_GAME = "Kidult / Game / Custom Game";
const RETRO = "Lifestyle Goods / Personal Accessories / Retro Game";
const HAIR = "Beauty & Life / Beauty Accessories / Hair Accessory";
const BEAUTY_GEN = "Beauty & Life / Beauty Accessories / General Accessory";
const NAIL = "Beauty & Life / Beauty Accessories / Nail Accessories";
const MAKEUP = "Beauty & Life / Beauty Accessories / Makeup Accessory";
const MIRROR = "Home & Life / Personal Care / Mirror";
const PLUSH_ACC = "Kidult / Plush & Plush Keyrings / Plush Accessories";
const ART = "Stationery / Art Supply";
const SLIME = "Stationery / Stationery Accessory / Slime";
const GLUE = "Stationery / Stationery Accessory / Glue/Adhesive";
const READING = "Stationery / Stationery Accessory / Reading Accessory";
const SOUVENIR = "Lifestyle Goods / Living Accessories / Souvenir";
const TISSUE = "Home & Life / Daily & Hygiene Goods / Tissue";
const BADGE = "Fashion Accessories / Accessories / Badge/Patch";

const kid = { segment: "Kids", codeGroup: "K", boxes: 5 };
const young = { segment: "Young adults", codeGroup: "Y", boxes: 5 };

const TG_RECIPES: Recipe[] = [
  {
    key: "K1", name: "Sticker World", nameMn: "Стикерийн ертөнц", ...kid,
    pitchMn: "Хамгийн их зарагддаг хүүхдийн эсвэл 3D стикер, наалт стикер, наадаг цаас эсвэл захидлын цаастай.",
    hero: slot("Kids / 3D sticker", [KIDS_STICKER, STICKER_3D, GENERAL_STICKER, STICKER_SET], 8_000, 11_400, { labelMn: "Хүүхдийн, 3D стикер" }),
    slots: [
      slot("Seal sticker", SEAL, 4_900, 8_100, { labelMn: "Наалт стикер" }),
      slot("Sticky notes / letter paper", [BASIC_NOTE, ...LETTER], 3_000, 8_100, { labelMn: "Наадаг цаас, захидлын цаас" }),
    ],
  },
  {
    key: "K2", name: "Play Time", nameMn: "Тоглоомын цаг", ...kid,
    pitchMn: "Гол нь жижиг тоглоом (ид шид, хөвөн капсул, стресс тайлагч). Стикер, дүрстэй наадаг цаастай.",
    hero: slot("Pocket game / fidget", [CUSTOM_GAME, RETRO, OTHER_GAME, SQUISHY, TOY], 8_000, 9_900, { labelMn: "Жижиг тоглоом, стресс тайлагч" }),
    slots: [
      slot("Sticker", [GENERAL_STICKER, KIDS_STICKER, STICKER_SET, STICKER_3D], 3_900, 9_100, { labelMn: "Стикер" }),
      slot("Sticky notes", [CUSTOM_NOTE, BASIC_NOTE], 3_000, 8_500, { labelMn: "Наадаг цаас" }),
    ],
  },
  {
    key: "K3", name: "Little Crafter", nameMn: "Бяцхан урлаач", ...kid, heroShare: 0.4,
    pitchMn: "Гол нь чимэглэлийн цавуу тууз, мини баллуур, DIY багц эсвэл номын хавчуурга. Наалт стикер, үзэгний таг, хавчаар, скоч эсвэл наадаг цаастай.",
    hero: slot("Craft / kids stationery", [GLUE, ART, SLIME, ERASER, READING, ...KIDS_ITEM], 7_000, 11_400, { labelMn: "Гар урлал, хүүхдийн бичгийн хэрэгсэл" }),
    slots: [
      slot("Seal sticker", SEAL, 4_900, 8_100, { labelMn: "Наалт стикер" }),
      slot("Desk item / sticky notes", [...DESK, ...KIDS_ITEM, BASIC_NOTE], 3_000, 9_400, { labelMn: "Үзэгний таг, хавчаар, скоч, шугам, наадаг цаас" }),
    ],
  },
  {
    key: "K4", name: "Sparkle & Bows", nameMn: "Гялалзсан гоёл", ...kid,
    pitchMn: "Гол нь үсний гоёл, сахиус, гарын толь, энгэрийн тэмдэг эсвэл гялалзсан стикер. Хүүхэлдэйний гоёл эсвэл гарын толь, стикертэй.",
    hero: slot("Sparkle accessory", [HAIR, BODY_DECO, CHARMS, BADGE, MIRROR, STICKER_3D], 8_000, 12_300, { labelMn: "Үсний гоёл, сахиус, толь, гялалзсан стикер" }),
    slots: [
      slot("Doll accessory / mirror", [PLUSH_ACC, MIRROR, HAIR], 3_000, 9_700, { labelMn: "Хүүхэлдэйний гоёл, гарын толь, үсний гоёл" }),
      slot("Seal / 3D sticker", [SEAL, STICKER_3D], 4_900, 7_500, { labelMn: "Наалт эсвэл 3D стикер" }),
    ],
  },
  {
    key: "K5", name: "Animal Friends", nameMn: "Амьтан найзууд", ...kid,
    pitchMn: "Гол нь хамгийн их зарагддаг дүрстэй түлхүүрийн оосор. Наадаг цаас эсвэл жижиг захидлын цаас, стикертэй.",
    hero: slot("Figure keyring", FIGURE_KEYRING, 9_000, 11_400, { labelMn: "Дүрстэй түлхүүрийн оосор" }),
    slots: [
      slot("Sticky notes / mini letter paper", [CUSTOM_NOTE, BASIC_NOTE, ...LETTER], 3_000, 8_100, { labelMn: "Наадаг цаас, жижиг захидлын цаас" }),
      slot("Sticker", [GENERAL_STICKER, KIDS_STICKER, STICKER_3D, STICKER_SET], 3_900, 8_100, { labelMn: "Стикер" }),
    ],
  },
  {
    key: "Y1", name: "Charm Pick", nameMn: "Сахиусны сонголт", ...young,
    pitchMn: "Гол нь хамгийн их зарагддаг, үнэтэй дүрстэй түлхүүрийн оосор эсвэл сахиус. Наалт стикер, наадаг цаастай.",
    hero: slot("Figure keyring / charm", [FIGURE_KEYRING, CHARMS, SOUVENIR], 11_400, 14_600, { labelMn: "Дүрстэй түлхүүрийн оосор, сахиус" }),
    slots: [
      slot("Seal sticker", SEAL, 4_900, 7_100, { labelMn: "Наалт стикер" }),
      slot("Sticky notes", [CUSTOM_NOTE, BASIC_NOTE], 3_000, 6_500, { labelMn: "Наадаг цаас" }),
    ],
  },
  {
    key: "Y2", name: "Dear Friend", nameMn: "Хайрт найздаа", ...young,
    pitchMn: "Найздаа захидал бичих багц: трэнд стикер, захидлын цаас, мэндчилгээний карт эсвэл дугтуй.",
    hero: slot("3D / trend sticker", [STICKER_3D, GENERAL_STICKER], 7_000, 9_100, { labelMn: "3D, трэнд стикер" }),
    slots: [
      slot("Letter paper", LETTER, 4_900, 8_100, { labelMn: "Захидлын цаас" }),
      slot("Card / envelope", [CARD, ENVELOPE], 3_000, 8_100, { labelMn: "Мэндчилгээний карт, дугтуй" }),
    ],
  },
  {
    key: "Y3", name: "Desk Mood", nameMn: "Ширээний өнгө аяс", ...young,
    pitchMn: "Гол нь хамгийн их зарагддаг дүрстэй наадаг цаас. Ширээний жижиг хэрэгсэл, наалт стикертэй.",
    hero: slot("Custom sticky notes", CUSTOM_NOTE, 7_000, 9_100, { labelMn: "Дүрстэй наадаг цаас" }),
    slots: [
      slot("Desk item", DESK, 3_000, 11_400, { labelMn: "Хавчаар, үзэгний таг, скоч, шугам" }),
      slot("Seal sticker", SEAL, 4_900, 8_100, { labelMn: "Наалт стикер" }),
    ],
  },
  {
    key: "Y4", name: "Beauty Pocket", nameMn: "Гоо сайхны халаас", ...young,
    pitchMn: "Гол нь хамгийн их зарагддаг гоо сайхны хэрэгсэл (хумсны хутга, хямсаа, үсний наалт, гарын толь). Будгийн порлон эсвэл бусад жижиг хэрэгсэл, стикертэй.",
    hero: slot("Beauty accessory", [HAIR, BEAUTY_GEN, NAIL, MIRROR], 8_000, 12_300, { labelMn: "Гоо сайхны хэрэгсэл" }),
    slots: [
      slot("Beauty filler", [MAKEUP, NAIL, HAIR, MIRROR, BEAUTY_GEN, TISSUE], 3_000, 9_700, { labelMn: "Будгийн порлон, хумсны хутга, толь, салфетка" }),
      slot("Sticker", [GENERAL_STICKER, STICKER_3D, BODY_DECO], 3_900, 8_100, { labelMn: "Стикер" }),
    ],
  },
  {
    key: "Y5", name: "Fidget & Fun", nameMn: "Стресс тайлагч", ...young,
    pitchMn: "Гол нь трэнд стресс тайлагч, шоо эсвэл ретро тоглоом. Стикер, наадаг цаас эсвэл карттай. Тоглоомын хайрцаг зузаан тул нэмэлт бараа нь нимгэн.",
    hero: slot("Fidget / retro game", [OTHER_GAME, RETRO, SQUISHY, CUSTOM_GAME], 10_000, 13_000, { labelMn: "Стресс тайлагч, ретро тоглоом" }),
    slots: [
      slot("Sticker", [GENERAL_STICKER, STICKER_3D, SEAL], 3_900, 7_100, { labelMn: "Стикер" }),
      slot("Notes / card / letter paper", [CUSTOM_NOTE, BASIC_NOTE, CARD, ...LETTER], 3_000, 6_500, { labelMn: "Наадаг цаас, карт, захидлын цаас" }),
    ],
  },
];

export function tsagaanGarBatch(): Batch {
  return { key: "22.5k", label: "Tsagaan gar 22.5K", prefix: "TG", target: 22_500, tolerance: 2_000, close: 1_000, hardRange: [20_000, 25_000], recipes: structuredClone(TG_RECIPES) };
}

export const PRESETS = {
  redBox: { title: "Like Red Box (mystery box 199k × 40)", rules: mysteryBoxRules, batches: () => [redBox199kBatch()] },
  tsagaanGar: { title: "Like Tsagaan gar (gift bundles 22.5K × 50, paper bag)", rules: giftBundleRules, batches: () => [tsagaanGarBatch()] },
} as const;
