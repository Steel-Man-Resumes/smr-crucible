"use client";

/**
 * The bio (decision C3): t.ROY drafts from confirmed record facts only, and
 * the person keeps or cuts each sentence. Nothing drafted is in the bio until
 * it is kept. The person can write any sentence themselves. Three lengths,
 * each with a live word and character count (spaces included).
 */

import { useState } from "react";
import {
  BIO_LENGTHS,
  BIO_LIMITS,
  bioCounts,
  bioText,
  type BioContent,
  type BioLength,
  type BioSentence,
} from "@crucible/core/src/creativeBio";
import { BIO_DISCLOSURE_MODES, BIO_PRONOUNS, type CreativeKindSettings } from "@crucible/core/src/creativeLaneShared";
import { getCreativeStatus } from "@crucible/core/src/creativeChecks";
import { BIO_HOW, DISCLOSURE_COPY, PRONOUN_COPY, sendJson } from "@/lib/creative";
import type { CreativeCtx } from "./CreativeLaneView";
import { OpenItems } from "./OpenItems";
import { CreativePage } from "./CreativePage";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

let localId = 0;

export function BioPanel({
  laneId,
  ctx,
  onSettings,
  onSaved,
}: {
  laneId: string;
  ctx: CreativeCtx;
  onSettings: (patch: Partial<CreativeKindSettings>) => Promise<boolean>;
  onSaved: () => void;
}) {
  const [bio, setBio] = useState<BioContent>(ctx.bio);
  const [len, setLen] = useState<BioLength>("short");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [own, setOwn] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const s = ctx.settings;
  const hasFacility = ctx.entries.some((e) => e.names_facility);
  const needsDisclosure = hasFacility && !s.bioDisclosure;
  const list = bio.lengths[len];
  const text = bioText(list);
  const counts = bioCounts(text, len);
  const lim = BIO_LIMITS[len];
  // Open items for the bio as it stands on screen (saved or not).
  const live = getCreativeStatus({ entries: ctx.entries, settings: s, bio: { ...bio, disclosure: s.bioDisclosure } });
  const setList = (next: BioSentence[]) => setBio((b) => ({ ...b, lengths: { ...b.lengths, [len]: next } }));

  return (
    <div className="space-y-4" data-testid="bio-panel">
      <p className="text-sm text-t-phos-dim">{BIO_HOW}</p>

      {!s.displayName && (
        <p className="border border-t-amber/60 bg-t-panel p-3 text-sm text-t-white">
          Add your name on the Artist resume tab first. Your bio uses it.
        </p>
      )}

      <fieldset className="border border-t-line bg-t-panel p-3">
        <legend className="px-1 text-sm text-t-white">How should your bio refer to you?</legend>
        <div className="flex flex-wrap gap-2">
          {BIO_PRONOUNS.map((p) => (
            <label key={p} className={`min-h-touch flex items-center gap-2 border px-3 text-sm cursor-pointer ${(s.bioPronoun ?? "name") === p ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>
              <input type="radio" name="bio-pronoun" className="sr-only" checked={(s.bioPronoun ?? "name") === p} onChange={() => onSettings({ bioPronoun: p })} />
              {PRONOUN_COPY[p]}
            </label>
          ))}
        </div>
      </fieldset>

      {hasFacility && (
        <fieldset className="border border-t-line bg-t-panel p-3 space-y-2" data-testid="bio-disclosure">
          <legend className="px-1 text-sm text-t-white">Some of your work names a facility. In your bio:</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {BIO_DISCLOSURE_MODES.map((m) => (
              <label key={m} className={`flex gap-2 border p-2 cursor-pointer ${s.bioDisclosure === m ? "border-t-amber" : "border-t-line"}`}>
                <input type="radio" name="bio-disclosure" value={m} className="mt-1" checked={s.bioDisclosure === m} data-testid={`bio-disclosure-${m}`} onChange={() => onSettings({ bioDisclosure: m })} />
                <span>
                  <span className="block text-sm font-semibold text-t-white">{DISCLOSURE_COPY[m].label}</span>
                  <span className="block text-xs text-t-phos-dim">{DISCLOSURE_COPY[m].body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex gap-1" role="tablist" aria-label="Bio length">
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
            {BIO_LIMITS[l].label}
          </button>
        ))}
      </div>

      <div className="border border-t-line bg-t-panel p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm ${counts.over ? "text-t-red" : "text-t-phos"}`} data-testid="bio-counts" aria-live="polite">
            {counts.words} of {lim.maxWords} words{lim.maxChars ? `, ${counts.chars} of ${lim.maxChars} characters` : `, ${counts.chars} characters`}
          </p>
          <button
            type="button"
            data-testid="bio-draft"
            disabled={busy || !s.displayName || needsDisclosure}
            onClick={async () => {
              setBusy(true);
              setMsg("");
              const r = await sendJson<{ sentences?: BioSentence[]; dropped?: number }>("/api/creative/bio-draft", "POST", { laneId, length: len });
              setBusy(false);
              if (r.ok && Array.isArray(r.data.sentences)) {
                const kept = list.filter((x) => x.approved || x.origin === "person");
                setList([...kept, ...r.data.sentences]);
                setMsg(
                  r.data.sentences.length
                    ? `${r.data.sentences.length} drafted from your record. Keep or cut each one.`
                    : "Not enough in your record to draft from yet. Add a few entries first."
                );
              } else setMsg(r.data.message || "t.ROY couldn't draft right now. Try again in a moment.");
            }}
            className="t-focus min-h-touch px-3 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright disabled:opacity-50"
          >
            {busy ? "Drafting..." : "Draft with t.ROY"}
          </button>
        </div>
        {needsDisclosure && <p className="text-xs text-t-phos-dim">Pick how your bio handles that work first.</p>}
        <p aria-live="polite" className="text-sm text-t-phos" data-testid="bio-msg">{msg}</p>

        <ol className="space-y-2" data-testid="bio-sentences">
          {list.map((x) => (
            <li key={x.id} className={`border p-2 ${x.approved ? "border-t-steel" : "border-dashed border-t-line"}`} data-testid="bio-sentence" data-approved={x.approved ? "yes" : "no"}>
              {editing === x.id ? (
                <div className="space-y-2">
                  <textarea className={inputCls} rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} aria-label="Your sentence" />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white"
                      onClick={() => {
                        const t = editText.replace(/\s+/g, " ").trim();
                        setList(list.map((y): BioSentence => (y.id === x.id ? { ...y, text: t, origin: "person", approved: !!t } : y)).filter((y) => y.text));
                        setEditing(null);
                      }}
                    >
                      Use my words
                    </button>
                    <button type="button" className="t-focus min-h-touch px-3 text-sm text-t-phos-dim" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-t-white">{x.text}</p>
                  <p className="text-xs text-t-phos-dim">{x.origin === "person" ? "Your words." : x.approved ? "Drafted by t.ROY. You kept it." : "Drafted by t.ROY from your record. Not in your bio yet."}</p>
                  <div className="mt-1 flex flex-wrap gap-3 text-sm">
                    {!x.approved && (
                      <button type="button" data-testid="bio-keep" className="t-focus min-h-touch text-t-amber-bright underline" onClick={() => setList(list.map((y) => (y.id === x.id ? { ...y, approved: true } : y)))}>
                        Keep
                      </button>
                    )}
                    <button type="button" data-testid="bio-cut" className="t-focus min-h-touch text-t-phos-dim underline" onClick={() => setList(list.filter((y) => y.id !== x.id))}>
                      Cut
                    </button>
                    <button type="button" className="t-focus min-h-touch text-t-steel underline" onClick={() => { setEditing(x.id); setEditText(x.text); }}>
                      Say it my way
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>

        <label className="block text-sm text-t-white">
          Add a sentence in your own words
          <textarea className={`${inputCls} mt-1`} rows={2} value={own} data-testid="bio-own" onChange={(e) => setOwn(e.target.value)} />
        </label>
        <button
          type="button"
          className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white disabled:opacity-50"
          disabled={!own.trim()}
          data-testid="bio-own-add"
          onClick={() => {
            setList([...list, { id: `p${Date.now().toString(36)}${localId++}`, text: own.replace(/\s+/g, " ").trim(), origin: "person", approved: true }]);
            setOwn("");
          }}
        >
          Add it
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="bio-save"
          onClick={async () => {
            const r = await sendJson(`/api/creative/${laneId}/docs`, "PUT", { type: "artist_bio", bio });
            setMsg(r.ok ? "Bio saved." : r.data.message || "That didn't save. Try again.");
            if (r.ok) onSaved();
          }}
          className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright"
        >
          Save bio
        </button>
        <a href={`/api/creative/${laneId}/export?doc=bio&format=pdf`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">PDF</a>
        <a href={`/api/creative/${laneId}/export?doc=bio&format=docx`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">Word</a>
      </div>

      <OpenItems status={live} doc="bio" testId="bio-open-items" />

      {BIO_LENGTHS.some((l) => bioText(bio.lengths[l])) && (
        <CreativePage
          request={{
            doc: "bio",
            card: {
              name: s.displayName ?? "",
              discipline: s.discipline ?? "",
              bios: BIO_LENGTHS.map((l) => ({ label: `${BIO_LIMITS[l].label} bio`, text: bioText(bio.lengths[l]) })),
            },
          }}
          fallbackText={BIO_LENGTHS.map((l) => bioText(bio.lengths[l])).filter(Boolean).join("\n\n")}
        />
      )}
    </div>
  );
}
