"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SnapshotButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function run() {
    setBusy(true);
    await fetch("/api/snapshots", { method: "POST" });
    // poll until the newest snapshot is no longer running
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const list = (await (await fetch("/api/snapshots")).json()) as Array<{ status: string }>;
      if (list[0]?.status !== "running") break;
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <button onClick={run} disabled={busy} title="Read products, stock, sales and costs from Odoo again">
      {busy ? "Reading Odoo…" : "Refresh from Odoo"}
    </button>
  );
}
