"use client";

/**
 * "Earlier versions" in My resumes (Phase 5 lane R2, review H3): every saved
 * version of a resume, and a way to bring an earlier one back. Bringing one
 * back saves it again as the newest version, with its own words, answers and
 * status; nothing is deleted.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

interface Version {
  id: string;
  number: number;
  status: "draft" | "finished";
  createdAt: string;
  preview: string;
}

export function EarlierVersions({ artifactId, onRestored }: { artifactId: string; onRestored?: () => void }) {
  const t = useTranslations("refineryResume.lanes.earlier");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function load() {
    try {
      const r = await fetch(`/api/lane-first?artifactId=${encodeURIComponent(artifactId)}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      setVersions(r.ok && Array.isArray(j?.versions) ? j.versions : []);
    } catch {
      setVersions([]);
    }
  }

  async function restore(v: Version) {
    setBusy(v.id);
    setNote("");
    try {
      const r = await fetch("/api/lane-first", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", artifactId, revisionId: v.id }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setNote(typeof j?.error === "string" ? j.error : t("didntWork"));
      } else {
        setNote(t("back", { number: v.number }));
        await load();
        onRestored?.();
      }
    } finally {
      setBusy(null);
    }
  }

  const earlier = (versions ?? []).slice(1);
  return (
    <details className="mt-3 border-t border-t-line pt-2" data-testid="earlier-versions" onToggle={(e) => (e.target as HTMLDetailsElement).open && versions === null && void load()}>
      <summary className="t-focus cursor-pointer text-xs text-t-phos underline decoration-dotted underline-offset-2">{t("summary")}</summary>
      {versions === null ? (
        <p className="mt-2 text-xs text-t-phos-dim">{t("loading")}</p>
      ) : earlier.length === 0 ? (
        <p className="mt-2 text-xs text-t-phos-dim">{t("none")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {earlier.map((v) => (
            <li key={v.id} className="border border-t-line bg-t-bg px-3 py-2" data-testid="earlier-version">
              <p className="text-xs font-semibold text-t-white">
                {v.status === "finished" ? t("versionFinished", { number: v.number }) : t("versionDraft", { number: v.number })}
              </p>
              <p className="text-xs text-t-phos-dim">{v.preview}</p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void restore(v)}
                className="t-focus mt-1 min-h-touch text-xs font-semibold text-t-amber-bright underline underline-offset-2 disabled:opacity-60"
                data-testid="restore-version"
              >
                {busy === v.id ? t("bringing") : t("bringBack")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p role="status" className="mt-2 text-xs text-t-phos" data-testid="restore-note">
          {note}
        </p>
      )}
    </details>
  );
}
