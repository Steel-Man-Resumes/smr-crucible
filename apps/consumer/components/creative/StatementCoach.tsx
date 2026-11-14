"use client";

/**
 * The statement coach (decision C3, rule CR-03), strict v1. The person
 * writes. Beside the text: a fixed bank of questions and a read-back of the
 * person's own sentences. Spelling marks come from a word list on the server
 * (only a token that is not a word, only the one closest word), each shown in
 * its sentence and fixed one at a time. No model sees or answers the
 * statement, and nothing on this screen inserts text into it.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { COACH_QUESTIONS, applySpellingMark, type SpellingMark, type StatementVersion } from "@crucible/core/src/creativeStatement";
import { countChars, countWords } from "@crucible/core/src/creativeLaneShared";
import { overLimit, sendJson } from "@/lib/creative";

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function StatementCoach({
  laneId,
  statement,
  rev,
  onSaved,
}: {
  laneId: string;
  statement: { versions: StatementVersion[] };
  /** The revision this screen loaded; a save lands only on it. */
  rev: number | null;
  onSaved: () => void;
}) {
  const t = useTranslations("refineryResume.creative.statement");
  const ts = useTranslations("refineryResume.creative.shared");
  const saved = statement.versions.length ? statement.versions[statement.versions.length - 1].text : "";
  const [text, setText] = useState(saved);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [readBack, setReadBack] = useState<string[]>([]);
  const [marks, setMarks] = useState<SpellingMark[]>([]);
  const dirty = text !== saved;
  const chars = countChars(text);
  const over = overLimit(chars, parseInt(limit, 10) || null);

  async function save(body: { text: string; acceptedMark?: SpellingMark }) {
    setBusy(true);
    setError("");
    setMsg("");
    const r = await sendJson(`/api/creative/${laneId}/docs`, "PUT", {
      type: "artist_statement",
      text: body.text,
      acceptedMark: body.acceptedMark ? { word: body.acceptedMark.word, suggestion: body.acceptedMark.suggestion } : undefined,
      rev,
    });
    setBusy(false);
    if (r.ok) {
      setMsg(body.acceptedMark ? t("fixed", { word: body.acceptedMark.word }) : t("saved"));
      if (body.acceptedMark) setMarks((ms) => ms.filter((x) => x.word !== body.acceptedMark!.word));
      onSaved();
      return true;
    }
    setError(r.data.message || ts("didntSave"));
    return false;
  }

  return (
    <div className="space-y-4" data-testid="statement-coach">
      <p className="text-sm text-t-phos-dim">{ts("statementHow")}</p>

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-2">
          <label htmlFor="statement-text" className="block text-sm font-semibold text-t-white">
            {t("label")}
          </label>
          <textarea
            id="statement-text"
            data-testid="statement-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="t-focus w-full bg-t-bg border border-t-line px-3 py-2 text-base text-t-white focus:border-t-steel focus:outline-none"
            placeholder={t("placeholder")}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={over ? "text-t-red" : "text-t-phos"} data-testid="statement-counts" aria-live="polite">
              {t("counts", { chars, words: countWords(text) })}{over ? `. ${t("over", { over })}` : ""}
            </span>
            <label className="flex items-center gap-2 text-t-phos-dim">
              {t("boxLimit")}
              <input
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
                className="t-focus w-20 min-h-touch bg-t-bg border border-t-line px-2 text-t-white"
                aria-label={t("limitAria")}
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
              {t("saveWords")}
            </button>
            <button
              type="button"
              data-testid="statement-coach-me"
              disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                const r = await sendJson<{ readBack?: string[]; marks?: SpellingMark[]; capped?: boolean }>("/api/creative/coach", "POST", { laneId, text });
                setBusy(false);
                if (r.ok) {
                  setReadBack(r.data.readBack ?? []);
                  setMarks(r.data.marks ?? []);
                  if (r.data.capped) setMsg(ts("spellingCapped"));
                  else if (!(r.data.marks ?? []).length) setMsg(t("noSpelling"));
                } else setError(r.data.message || t("didntWork"));
              }}
              className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white disabled:opacity-50"
            >
              {t("checkSpelling")}
            </button>
            <a href={`/api/creative/${laneId}/export?doc=statement&format=txt`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">
              {t("plainText")}
            </a>
          </div>
        </div>

        <aside className="space-y-3" aria-label={t("asideAria")}>
          <section className="border border-t-line bg-t-panel p-3" data-testid="statement-questions">
            <h3 className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">{t("questionsTitle")}</h3>
            <ul className="mt-2 space-y-2 text-sm text-t-white">
              {[...readBack, ...COACH_QUESTIONS.map((q, i) => (i < 7 ? t(`coach.${i}`) : q))].map((q, i) => (
                <li key={`${i}-${q}`}>{q}</li>
              ))}
            </ul>
          </section>
          {marks.length > 0 && (
            <section className="border border-t-line bg-t-panel p-3" data-testid="statement-marks">
              <h3 className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">{t("spelling")}</h3>
              <p className="text-xs text-t-phos-dim">{dirty ? t("saveFirst") : ts("spellingHow")}</p>
              <ul className="mt-2 space-y-2">
                {marks.map((m) => (
                  <li key={`${m.word}-${m.suggestion}`} className="flex flex-col gap-1 text-sm" data-testid="statement-mark">
                    {m.sentence && <span className="text-xs text-t-phos-dim break-words">&ldquo;{m.sentence}&rdquo;</span>}
                    <span className="flex items-center justify-between gap-2">
                    <span className="text-t-white">
                      <s className="text-t-phos-dim">{m.word}</s> {t("to")} <span className="font-semibold">{m.suggestion}</span>
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
                        {t("fix")}
                      </button>
                      <button type="button" className="t-focus min-h-touch px-2 text-t-phos-dim" onClick={() => setMarks(marks.filter((x) => x !== m))}>
                        {t("ignore")}
                      </button>
                    </span>
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
          <summary className="cursor-pointer text-t-phos-dim hover:text-t-white">{t("versions", { count: statement.versions.length })}</summary>
          <ul className="mt-2 space-y-1 text-t-phos-dim">
            {[...statement.versions].reverse().map((v) => (
              <li key={v.savedAt}>
                {fmt(v.savedAt)}: {v.via === "spelling" ? t("versionFixed", { word: v.mark?.word ?? "" }) : t("versionWords", { count: countWords(v.text) })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
