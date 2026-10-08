"use client";

/**
 * The artist resume: built from the record in College Art Association order.
 * The person sets the top of the page, how each title that names a facility
 * shows on this lane, what goes on (Selected), and the page cap (2, or 4 when
 * a call allows it). Never shrinks type to fit; never pads.
 */

import { useState } from "react";
import { yearsOf, type PracticeEntry, type TitleMode } from "@crucible/core/src/practiceRecordShared";
import {
  NEEDS_PROOF_NOTE,
  artistResumePageCap,
  artistResumePlainText,
  stillNeedsProof,
  type ArtistResumeModel,
  type CreativeKindSettings,
} from "@crucible/core/src/creativeLaneShared";
import { exportOpenItemLines, type CreativeStatus } from "@crucible/core/src/creativeChecks";
import { PAGE_CAP_COPY } from "@/lib/creative";
import { FacilityChoices } from "./FacilityChoices";
import { CreativePage } from "./CreativePage";
import { OpenItems } from "./OpenItems";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

const TOP_FIELDS: { key: keyof CreativeKindSettings; label: string; placeholder: string }[] = [
  { key: "displayName", label: "Your name, as you want it printed", placeholder: "Ray Example" },
  { key: "discipline", label: "What you make", placeholder: "Painter and printmaker" },
  { key: "basedIn", label: "Where you're based", placeholder: "Toledo, OH" },
  { key: "email", label: "Email", placeholder: "you@example.com" },
  { key: "phone", label: "Phone (optional)", placeholder: "" },
  { key: "website", label: "Website (optional)", placeholder: "" },
];

export function ArtistResumePanel({
  laneId,
  entries,
  settings,
  model,
  status,
  onSettings,
  onTitleMode,
  onPages,
}: {
  laneId: string;
  entries: PracticeEntry[];
  settings: CreativeKindSettings;
  model: ArtistResumeModel;
  status: CreativeStatus;
  onSettings: (patch: Partial<CreativeKindSettings>) => Promise<boolean>;
  onTitleMode: (entryId: string, mode: TitleMode) => Promise<boolean>;
  onPages: (n: number) => void;
}) {
  const [top, setTop] = useState<Record<string, string>>(() =>
    Object.fromEntries(TOP_FIELDS.map((f) => [f.key, (settings[f.key] as string | undefined) ?? ""]))
  );
  const [msg, setMsg] = useState("");
  const [picking, setPicking] = useState(Array.isArray(settings.selection));
  const showable = entries.filter((e) => e.section !== "work");
  const selected = new Set(Array.isArray(settings.selection) ? settings.selection : showable.map((e) => e.id));
  const blocks = status.openItems.some((x) => x.severity === "BLOCK" && (x.doc === "artist_resume" || x.doc === "record"));
  const request = { doc: "artist_resume", model, draft: blocks, openItems: exportOpenItemLines(status, entries, settings, "artist_resume") };
  const cap = artistResumePageCap(settings);

  return (
    <div className="space-y-5" data-testid="artist-resume-panel">
      <form
        className="border border-t-line bg-t-panel p-4 space-y-3"
        data-testid="artist-top"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await onSettings(top as Partial<CreativeKindSettings>);
          setMsg(ok ? "Saved." : "That didn't save. Try again.");
        }}
      >
        <h3 className="text-sm font-semibold uppercase text-t-phos">Top of the page</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {TOP_FIELDS.map((f) => (
            <label key={f.key} className="block text-sm text-t-white">
              {f.label}
              <input className={`${inputCls} mt-1`} value={top[f.key] ?? ""} placeholder={f.placeholder} maxLength={200} data-testid={`artist-${f.key}`} onChange={(e) => setTop((t) => ({ ...t, [f.key]: e.target.value }))} />
            </label>
          ))}
        </div>
        <button type="submit" className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright" data-testid="artist-top-save">
          Save
        </button>
        <span aria-live="polite" className="ml-3 text-sm text-t-phos">{msg}</span>
      </form>

      <FacilityChoices entries={entries} settings={settings} onTitleMode={onTitleMode} only="pages" />

      <section className="border border-t-line bg-t-panel p-4 space-y-3">
        <label className="flex min-h-touch items-start gap-3 text-sm text-t-white">
          <input type="checkbox" className="mt-1" checked={!!settings.callAllowsMore} data-testid="artist-call-allows-more" onChange={(e) => onSettings({ callAllowsMore: e.target.checked })} />
          <span>
            <span className="block font-semibold">{PAGE_CAP_COPY.label}</span>
            <span className="block text-xs text-t-phos-dim">{PAGE_CAP_COPY.body} Right now: up to {cap} pages.</span>
          </span>
        </label>
        <div>
          <button type="button" className="t-focus text-sm text-t-steel underline" data-testid="artist-pick" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
            {picking ? "Done picking" : "Pick what goes on (for a call that wants your strongest work)"}
          </button>
          {picking && (
            <div className="mt-2 space-y-1">
              {showable.map((e) => (
                <label key={e.id} className="flex min-h-touch items-center gap-2 text-sm text-t-white">
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={(ev) => {
                      const next = new Set(selected);
                      if (ev.target.checked) next.add(e.id);
                      else next.delete(e.id);
                      onSettings({ selection: Array.from(next) });
                    }}
                  />
                  <span className="font-mono text-xs text-t-phos">{yearsOf(e)}</span> {e.title}
                </label>
              ))}
              <button type="button" className="t-focus text-sm text-t-phos-dim underline" onClick={() => onSettings({ selection: null })}>
                Use everything
              </button>
            </div>
          )}
        </div>
      </section>

      <OpenItems status={status} doc="artist_resume" testId="artist-open-items" />

      <CreativePage request={request} onPages={onPages} fallbackText={artistResumePlainText(model)} />

      {stillNeedsProof(entries, model.sections.flatMap((x) => x.rows.map((r) => r.entryId))) > 0 && (
        <p className="text-sm text-t-phos" data-testid="artist-needs-proof">{NEEDS_PROOF_NOTE}</p>
      )}
      <div className="flex flex-wrap gap-2" data-testid="artist-downloads">
        {(["pdf", "docx", "txt"] as const).map((f) => (
          <a key={f} href={`/api/creative/${laneId}/export?doc=artist_resume&format=${f}`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white hover:border-t-steel">
            {blocks ? "Draft " : ""}
            {f === "pdf" ? "PDF" : f === "docx" ? "Word" : "Plain text"}
          </a>
        ))}

      </div>
    </div>
  );
}
