"use client";

/**
 * The bio (decision C3, strict v1). The draft is fixed sentences filled from
 * the person's record, one entry per sentence; nothing is written by a model.
 * Nothing drafted is in the bio until it is kept. The person can rewrite any
 * sentence or add their own; the server decides which sentences are record
 * sentences and which are the person's words (never this screen). Work that
 * names a facility follows this lane's choices, the same ones every page uses.
 * Three lengths, each with a live word and character count (spaces included).
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useServerText } from "@/components/ServerTextProvider";
import {
  BIO_LENGTHS,
  BIO_LIMITS,
  bioCounts,
  bioTextForLane,
  type BioContent,
  type BioLength,
  type BioSentence,
} from "@crucible/core/src/creativeBio";
import { BIO_PRONOUNS, type CreativeKindSettings } from "@crucible/core/src/creativeLaneShared";
import type { TitleMode } from "@crucible/core/src/practiceRecordShared";
import { getCreativeStatus } from "@crucible/core/src/creativeChecks";
import { sendJson } from "@/lib/creative";
import type { CreativeCtx } from "./CreativeLaneView";
import { OpenItems } from "./OpenItems";
import { CreativePage } from "./CreativePage";
import { FacilityChoices } from "./FacilityChoices";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

let localId = 0;

export function BioPanel({
  laneId,
  ctx,
  onSettings,
  onTitleMode,
  onSaved,
}: {
  laneId: string;
  ctx: CreativeCtx;
  onSettings: (patch: Partial<CreativeKindSettings>) => Promise<boolean>;
  onTitleMode: (entryId: string, mode: TitleMode) => Promise<boolean>;
  onSaved: () => void;
}) {
  const t = useTranslations("refineryResume.creative.bio");
  const ts = useTranslations("refineryResume.creative.shared");
  const sx = useServerText();
  const [bio, setBio] = useState<BioContent>(ctx.bio);
  const [len, setLen] = useState<BioLength>("short");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [own, setOwn] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const s = ctx.settings;
  const list = bio.lengths[len];
  const text = bioTextForLane(list, ctx.entries, s);
  const counts = bioCounts(text, len);
  const lim = BIO_LIMITS[len];
  // Open items for the bio as it stands on screen (saved or not), with this lane's current choices.
  const live = getCreativeStatus({ entries: ctx.entries, settings: s, bio });
  // Open items point at sentences by id (their lines never quote them); the list highlights them here.
  const flagged = new Map<string, string>();
  for (const it of live.openItems) if (it.sentenceId && !flagged.has(it.sentenceId)) flagged.set(it.sentenceId, it.question);
  const setList = (next: BioSentence[]) => setBio((b) => ({ ...b, lengths: { ...b.lengths, [len]: next } }));

  return (
    <div className="space-y-4" data-testid="bio-panel">
      <p className="text-sm text-t-phos-dim">{ts("bioHow")}</p>

      {!s.displayName && (
        <p className="border border-t-amber/60 bg-t-panel p-3 text-sm text-t-white">
          {t("addName")}
        </p>
      )}

      <fieldset className="border border-t-line bg-t-panel p-3">
        <legend className="px-1 text-sm text-t-white">{t("refer")}</legend>
        <div className="flex flex-wrap gap-2">
          {BIO_PRONOUNS.map((p) => (
            <label key={p} className={`min-h-touch flex items-center gap-2 border px-3 text-sm cursor-pointer ${(s.bioPronoun ?? "name") === p ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>
              <input type="radio" name="bio-pronoun" className="sr-only" checked={(s.bioPronoun ?? "name") === p} onChange={() => onSettings({ bioPronoun: p })} />
              {ts(`pronoun.${p}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <FacilityChoices entries={ctx.entries} settings={s} onTitleMode={onTitleMode} only="pages" />

      <div className="flex gap-1" role="tablist" aria-label={t("lengthAria")}>
        {BIO_LENGTHS.map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={len === l}
            data-testid={`bio-len-${l}`}
            onClick={() => setLen(l)}
            className={`t-focus min-h-touch flex-1 border px-2 text-sm ${len === l ? "border-t-amber text-t-amber-bright font-semibold" : "border-t-line text-t-phos-dim"}`}
          >
            {t(`length.${l}`)}
          </button>
        ))}
      </div>

      <div className="border border-t-line bg-t-panel p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm ${counts.over ? "text-t-red" : "text-t-phos"}`} data-testid="bio-counts" aria-live="polite">
            {t("counts", { words: counts.words, max: lim.maxWords })}{lim.maxChars ? t("countsChars", { chars: counts.chars, max: lim.maxChars }) : t("countsCharsOnly", { chars: counts.chars })}
          </p>
          <button
            type="button"
            data-testid="bio-draft"
            disabled={busy || !s.displayName}
            onClick={async () => {
              setBusy(true);
              setMsg("");
              const r = await sendJson<{ sentences?: BioSentence[] }>("/api/creative/bio-draft", "POST", { laneId, length: len });
              setBusy(false);
              if (r.ok && Array.isArray(r.data.sentences)) {
                const keep = list.filter((x) => x.approved || x.origin === "person_written");
                const have = new Set(keep.map((x) => x.text));
                setList([...keep, ...r.data.sentences.filter((x) => !have.has(x.text))]);
                setMsg(
                  r.data.sentences.length
                    ? t("built", { count: r.data.sentences.length })
                    : t("notEnough")
                );
              } else setMsg(r.data.message || t("didntWork"));
            }}
            className="t-focus min-h-touch px-3 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright disabled:opacity-50"
          >
            {busy ? t("building") : t("buildDraft")}
          </button>
        </div>
        <p aria-live="polite" className="text-sm text-t-phos" data-testid="bio-msg">{msg}</p>

        <ol className="space-y-2" data-testid="bio-sentences">
          {list.map((x) => (
            <li
              key={x.id}
              className={`border p-2 ${flagged.has(x.id) ? "border-t-amber" : x.approved ? "border-t-steel" : "border-dashed border-t-line"}`}
              data-testid="bio-sentence"
              data-approved={x.approved ? "yes" : "no"}
              data-open={flagged.has(x.id) ? "yes" : "no"}
            >
              {editing === x.id ? (
                <div className="space-y-2">
                  <textarea className={inputCls} rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} aria-label={t("sentenceAria")} data-testid="bio-edit-text" />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid="bio-edit-save"
                      className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white"
                      onClick={() => {
                        const t = editText.replace(/\s+/g, " ").trim();
                        // Shown as the person's words; the server decides for itself on save.
                        setList(list.map((y): BioSentence => (y.id === x.id ? { ...y, text: t, origin: t === y.text ? y.origin : "person_written", approved: !!t } : y)).filter((y) => y.text));
                        setEditing(null);
                      }}
                    >
                      {t("useMine")}
                    </button>
                    <button type="button" className="t-focus min-h-touch px-3 text-sm text-t-phos-dim" onClick={() => setEditing(null)}>
                      {ts("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-t-white">{x.text}</p>
                  <p className="text-xs text-t-phos-dim">
                    {x.origin === "person_written" ? t("originPerson") : x.approved ? t("originKept") : t("originNot")}
                  </p>
                  {flagged.has(x.id) && (
                    <p className="text-xs text-t-amber-bright" data-testid="bio-sentence-issue">
                      {sx(flagged.get(x.id) ?? "")}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3 text-sm">
                    {!x.approved && (
                      <button type="button" data-testid="bio-keep" className="t-focus min-h-touch text-t-amber-bright underline" onClick={() => setList(list.map((y) => (y.id === x.id ? { ...y, approved: true } : y)))}>
                        {t("keep")}
                      </button>
                    )}
                    <button type="button" data-testid="bio-cut" className="t-focus min-h-touch text-t-phos-dim underline" onClick={() => setList(list.filter((y) => y.id !== x.id))}>
                      {t("cut")}
                    </button>
                    <button type="button" data-testid="bio-edit" className="t-focus min-h-touch text-t-steel underline" onClick={() => { setEditing(x.id); setEditText(x.text); }}>
                      {t("sayMyWay")}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>

        <label className="block text-sm text-t-white">
          {t("addOwn")}
          <textarea className={`${inputCls} mt-1`} rows={2} value={own} data-testid="bio-own" onChange={(e) => setOwn(e.target.value)} />
        </label>
        <button
          type="button"
          className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white disabled:opacity-50"
          disabled={!own.trim()}
          data-testid="bio-own-add"
          onClick={() => {
            setList([...list, { id: `p${Date.now().toString(36)}${localId++}`, text: own.replace(/\s+/g, " ").trim(), origin: "person_written", approved: true }]);
            setOwn("");
          }}
        >
          {t("add")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="bio-save"
          onClick={async () => {
            const r = await sendJson(`/api/creative/${laneId}/docs`, "PUT", { type: "artist_bio", bio, rev: ctx.bioRev });
            setMsg(r.ok ? t("saved") : r.data.message || ts("didntSave"));
            if (r.ok) onSaved();
          }}
          className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright"
        >
          {t("save")}
        </button>
        <a href={`/api/creative/${laneId}/export?doc=bio&format=pdf`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">PDF</a>
        <a href={`/api/creative/${laneId}/export?doc=bio&format=docx`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">{ts("word")}</a>
      </div>

      <OpenItems status={live} doc="bio" testId="bio-open-items" />

      {BIO_LENGTHS.some((l) => bioTextForLane(bio.lengths[l], ctx.entries, s)) && (
        <CreativePage
          request={{
            doc: "bio",
            card: {
              name: s.displayName ?? "",
              discipline: s.discipline ?? "",
              bios: BIO_LENGTHS.map((l) => ({ label: `${BIO_LIMITS[l].label} bio`, text: bioTextForLane(bio.lengths[l], ctx.entries, s) })),
            },
          }}
          fallbackText={BIO_LENGTHS.map((l) => bioTextForLane(bio.lengths[l], ctx.entries, s)).filter(Boolean).join("\n\n")}
        />
      )}
    </div>
  );
}
