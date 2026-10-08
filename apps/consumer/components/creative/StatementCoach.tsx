"use client";

/**
 * The statement coach (decision C3, rule CR-03). The person writes. t.ROY
 * asks questions beside the text and points out spelling. There is no button
 * anywhere that puts t.ROY's words into the statement: questions are shown,
 * never inserted; a spelling fix swaps one word the server checks; and the
 * save path refuses any run of words a model wrote.
 */

import { useState } from "react";
import { COACH_QUESTIONS, applySpellingMark, marksStillInText, type SpellingMark, type StatementVersion } from "@crucible/core/src/creativeStatement";
import { countChars, countWords } from "@crucible/core/src/creativeLaneShared";
import { STATEMENT_HOW, STATEMENT_SPELLING_HOW, overLimit, sendJson } from "@/lib/creative";

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function StatementCoach({
  laneId,
  statement,
  onSaved,
}: {
  laneId: string;
  statement: { versions: StatementVersion[]; offeredMarks: SpellingMark[] };
  onSaved: () => void;
}) {
  const saved = statement.versions.length ? statement.versions[statement.versions.length - 1].text : "";
  const [text, setText] = useState(saved);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [readBack, setReadBack] = useState<string[]>([]);
  const [asked, setAsked] = useState<string[]>([]);
  const [marks, setMarks] = useState<SpellingMark[]>(marksStillInText(statement.offeredMarks, saved));
  const dirty = text !== saved;
  const chars = countChars(text);
  const over = overLimit(chars, parseInt(limit, 10) || null);

  async function save(body: { text: string; acceptedMark?: SpellingMark }) {
    setBusy(true);
    setError("");
    setMsg("");
    const r = await sendJson<{ statement?: { offeredMarks: SpellingMark[] } }>(`/api/creative/${laneId}/docs`, "PUT", { type: "artist_statement", ...body });
    setBusy(false);
    if (r.ok) {
      setMsg(body.acceptedMark ? `Fixed "${body.acceptedMark.word}".` : "Saved. It's yours.");
      if (r.data.statement?.offeredMarks) setMarks(marksStillInText(r.data.statement.offeredMarks, body.text));
      onSaved();
      return true;
    }
    setError(r.data.message || "That didn't save. Try again.");
    return false;
  }

  return (
    <div className="space-y-4" data-testid="statement-coach">
      <p className="text-sm text-t-phos-dim">{STATEMENT_HOW}</p>

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-2">
          <label htmlFor="statement-text" className="block text-sm font-semibold text-t-white">
            Your statement
          </label>
          <textarea
            id="statement-text"
            data-testid="statement-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="t-focus w-full bg-t-bg border border-t-line px-3 py-2 text-base text-t-white focus:border-t-steel focus:outline-none"
            placeholder="Start anywhere. What you make, how you make it, why."
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={over ? "text-t-red" : "text-t-phos"} data-testid="statement-counts" aria-live="polite">
              {chars} characters with spaces, {countWords(text)} words{over ? `. ${over} over the limit.` : ""}
            </span>
            <label className="flex items-center gap-2 text-t-phos-dim">
              Box limit
              <input
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
                className="t-focus w-20 min-h-touch bg-t-bg border border-t-line px-2 text-t-white"
                aria-label="Character limit for the application box"
                data-testid="statement-limit"
              />
            </label>
          </div>
          {error && <p className="text-sm text-t-red" role="alert" data-testid="statement-error">{error}</p>}
          <p aria-live="polite" className="text-sm text-t-phos" data-testid="statement-msg">{msg}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="statement-save"
              disabled={busy || !dirty}
              onClick={() => save({ text })}
              className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50"
            >
              Save my words
            </button>
            <button
              type="button"
              data-testid="statement-coach-me"
              disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                const r = await sendJson<{ readBack?: string[]; questions?: string[]; marks?: SpellingMark[] }>("/api/creative/coach", "POST", { laneId, text });
                setBusy(false);
                if (r.ok) {
                  setReadBack(r.data.readBack ?? []);
                  setAsked(r.data.questions ?? []);
                  setMarks(r.data.marks ?? []);
                } else setError(r.data.message || "t.ROY couldn't look right now. Try again in a moment.");
              }}
              className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white disabled:opacity-50"
            >
              Ask t.ROY to read it
            </button>
            <a href={`/api/creative/${laneId}/export?doc=statement&format=txt`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">
              Plain text
            </a>
          </div>
        </div>

        <aside className="space-y-3" aria-label="t.ROY's questions">
          <section className="border border-t-line bg-t-panel p-3" data-testid="statement-questions">
            <h3 className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">Questions to write from</h3>
            <ul className="mt-2 space-y-2 text-sm text-t-white">
              {[...asked, ...readBack, ...COACH_QUESTIONS].map((q, i) => (
                <li key={`${i}-${q}`}>{q}</li>
              ))}
            </ul>
          </section>
          {marks.length > 0 && (
            <section className="border border-t-line bg-t-panel p-3" data-testid="statement-marks">
              <h3 className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">Spelling</h3>
              <p className="text-xs text-t-phos-dim">{dirty ? "Save your words first, then fix spelling." : STATEMENT_SPELLING_HOW}</p>
              <ul className="mt-2 space-y-2">
                {marks.map((m) => (
                  <li key={`${m.word}-${m.suggestion}`} className="flex items-center justify-between gap-2 text-sm" data-testid="statement-mark">
                    <span className="text-t-white">
                      <s className="text-t-phos-dim">{m.word}</s> to <span className="font-semibold">{m.suggestion}</span>
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        data-testid="statement-mark-fix"
                        disabled={busy || dirty}
                        className="t-focus min-h-touch px-2 border border-t-line text-t-amber-bright disabled:opacity-50"
                        onClick={async () => {
                          const next = applySpellingMark(saved, m);
                          if (next === saved) return;
                          if (await save({ text: next, acceptedMark: m })) setText(next);
                        }}
                      >
                        Fix
                      </button>
                      <button type="button" className="t-focus min-h-touch px-2 text-t-phos-dim" onClick={() => setMarks(marks.filter((x) => x !== m))}>
                        Ignore
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {statement.versions.length > 0 && (
        <details className="text-sm" data-testid="statement-versions">
          <summary className="cursor-pointer text-t-phos-dim hover:text-t-white">Saved versions ({statement.versions.length})</summary>
          <ul className="mt-2 space-y-1 text-t-phos-dim">
            {[...statement.versions].reverse().map((v) => (
              <li key={v.savedAt}>
                {fmt(v.savedAt)}: {v.via === "spelling" ? `fixed "${v.mark?.word ?? ""}"` : `${countWords(v.text)} words`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
