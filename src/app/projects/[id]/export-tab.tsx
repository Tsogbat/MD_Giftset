"use client";
import type { VersionDetail } from "./shared";

export default function ExportTab({ version }: { projectId: number; version: VersionDetail | null }) {
  if (!version) return <p className="muted">Nothing built yet.</p>;
  return <p className="muted">Excel, HTML report and PDF for V{version.number} arrive in the next step (M5).</p>;
}
