"use client";

/**
 * Plain text for application boxes, with live counts. Characters are counted
 * the way most forms count them: every character, spaces and line breaks
 * included. Put in a box's limit to check it.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BIO_LENGTHS, bioTextForLane } from "@crucible/core/src/creativeBio";
import type { CreativeDoc, CreativeStatus } from "@crucible/core/src/creativeChecks";
import {
  artistResumePlainText,
  plainTextDoc,
  workSampleListPlainText,
  type ArtistResumeModel,
  type PlainTextDoc,
  type WorkSampleRow,
} from "@crucible/core/src/creativeLaneShared";
import { overLimit } from "@/lib/creative";
import type { CreativeCtx } from "./CreativeLaneView";

const DOC_OF: Record<PlainTextDoc["key"], CreativeDoc> = {
  artist_resume: "artist_resume",
  bio_short: "bio",
  bio_medium: "bio",
  bio_long: "bio",
  statement: "statement",
  work_samples: "work_samples",
};

function Box({ doc, draft }: { doc: PlainTextDoc; draft: boolean }) {
  const t = useTranslations("refineryResume.creative.plainText");
  const ts = useTranslations("refineryResume.creative.shared");
  const [limit, setLimit] = useState("");
  const [seen, setSeen] = useState(false);
  const over = overLimit(doc.chars, parseInt(limit, 10) || null);
  return (
    <section className="border border-t-line bg-t-panel p-3 space-y-2" data-testid={`plain-${doc.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-t-white">{doc.label}</h3>
        <label className="flex items-center gap-2 text-xs text-t-phos-dim">
          {t("boxLimit")}
          <input
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
            className="t-focus w-20 min-h-touch bg-t-bg border border-t-line px-2 text-t-white"
            aria-label={t("limitAria", { label: doc.label })}
            data-testid={`plain-limit-${doc.key}`}
          />
        </label>
      </div>
      {draft && !seen ? (
        <div className="border border-t-amber/60 p-3 text-sm text-t-white" data-testid={`plain-draft-${doc.key}`}>
          <p>{ts("plainTextDraft")}</p>
          <button type="button" className="t-focus mt-2 min-h-touch px-3 border border-t-line text-sm" onClick={() => setSeen(true)} data-testid={`plain-show-${doc.key}`}>
            {t("showDraft")}
          </button>
        </div>
      ) : (
      <>
      {draft && <p className="text-xs font-semibold text-t-amber-bright">{t("draftMark")}</p>}
      <textarea readOnly value={doc.text} rows={Math.min(12, Math.max(3, doc.text.split("\n").length + 1))} className="w-full bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white" aria-label={doc.label} />
      <p className={`text-sm ${over ? "text-t-red" : "text-t-phos"}`} data-testid={`plain-count-${doc.key}`}>
        {t("count", { chars: doc.chars, words: doc.words })}{over ? `. ${t("over", { over })}` : ""}
      </p>
      </>
      )}
    </section>
  );
}

export function PlainTextPanel({ ctx, model, samples, status }: { ctx: CreativeCtx; model: ArtistResumeModel; samples: WorkSampleRow[]; status: CreativeStatus }) {
  const t = useTranslations("refineryResume.creative.plainText");
  const ts = useTranslations("refineryResume.creative.shared");
  const statement = ctx.statement.versions.length ? ctx.statement.versions[ctx.statement.versions.length - 1].text : "";
  const docs: PlainTextDoc[] = [
    plainTextDoc("artist_resume", t("artistResume"), artistResumePlainText(model)),
    ...BIO_LENGTHS.map((l) => plainTextDoc(`bio_${l}` as PlainTextDoc["key"], t(l === "short" ? "bioShort" : l === "medium" ? "bioMedium" : "bioLong"), bioTextForLane(ctx.bio.lengths[l], ctx.entries, ctx.settings))),
    plainTextDoc("statement", t("statement"), statement),
    plainTextDoc("work_samples", t("workSamples"), workSampleListPlainText(samples)),
  ].filter((d) => d.text);
  return (
    <div className="space-y-3" data-testid="plain-text-panel">
      <p className="text-sm text-t-phos-dim">{ts("plainTextHow")}</p>
      {docs.length ? (
        docs.map((d) => {
          const doc = DOC_OF[d.key];
          const draft = status.openItems.some((x) => x.severity === "BLOCK" && (x.doc === doc || x.doc === "record"));
          return <Box key={d.key} doc={d} draft={draft} />;
        })
      ) : (
        <p className="text-sm text-t-phos-dim">{t("empty")}</p>
      )}
    </div>
  );
}
