import { describe, expect, it } from "vitest";
import { balanceBonus, type BonusItem } from "@/lib/bonus";

const pool: BonusItem[] = [
  ...Array.from({ length: 6 }, (_, i): BonusItem => ({ id: `f${i}`, name: `Snack ${i}`, qty: 4, value: 2_000 + i * 300, kind: "food", family: `snack${i}` })),
  ...Array.from({ length: 10 }, (_, i): BonusItem => ({ id: `g${i}`, name: `Gift ${i}`, qty: 3, value: 4_000 + i * 1_500, kind: "beauty", family: `gift${i}` })),
  { id: "lip1", name: "Lip A", qty: 3, value: 24_000, kind: "lip", family: "lipA" },
  { id: "lip2", name: "Lip B", qty: 3, value: 26_000, kind: "lip", family: "lipB" },
  { id: "bad", name: "Dog bone candy", qty: 20, value: 3_000, kind: "food", exclude: true, reason: "looks cheap" },
];

describe("bonus balancer", () => {
  it("lands every set in its tier band with a required kind and rising tiers", () => {
    const sets = [...Array.from({ length: 8 }, (_, i) => ({ code: `A${i}`, tier: "199k" })), ...Array.from({ length: 4 }, (_, i) => ({ code: `B${i}`, tier: "299k" })), ...Array.from({ length: 2 }, (_, i) => ({ code: `C${i}`, tier: "499k" }))];
    const r = balanceBonus({
      sets,
      pool,
      bands: [
        { tier: "199k", lo: 15_000, hi: 20_000 },
        { tier: "299k", lo: 25_000, hi: 30_000 },
        { tier: "499k", lo: 60_000, hi: 80_000, minItems: 3 },
      ],
      requireKind: "food",
      maxPerKind: { lip: 1 },
    });
    expect(r.report.join("\n")).not.toMatch(/[1-9]\d* outside/);
    expect(r.ok).toBe(true);
    for (const [code, items] of r.assign) {
      expect(items.some((i) => i.kind === "food")).toBe(true);
      expect(items.some((i) => i.exclude)).toBe(false);
      expect(new Set(items.map((i) => i.family)).size).toBe(items.length);
      expect(items.filter((i) => i.kind === "lip").length).toBeLessThanOrEqual(1);
      if (code.startsWith("C")) expect(items.length).toBeGreaterThanOrEqual(3);
    }
  });
});
