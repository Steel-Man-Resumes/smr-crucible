"use client";

/**
 * Plain text for application boxes, with live counts. Characters are counted
 * the way most forms count them: every character, spaces and line breaks
 * included. Put in a box's limit to check it.
 */

import { useState } from "react";
import { BIO_LENGTHS, BIO_LIMITS, bioText } from "@crucible/core/src/creativeBio";
import {
  artistResumePlainText,
  plainTextDoc,
  workSampleListPlainText,
  type ArtistResumeModel,
  type PlainTextDoc,
  type WorkSampleRow,
} from "@crucible/core/src/creativeLaneShared";
import { PLAIN_TEXT_HOW, overLimit } from "@/lib/creative";
import type { CreativeCtx } from "./CreativeLaneView";

function Box({ doc }: { doc: PlainTextDoc }) {
  const [limit, setLimit] = useState("");
  const over = overLimit(doc.chars, parseInt(limit, 10) || null);
  return (
    <section className="border border-t-line bg-t-panel p-3 space-y-2" data-testid={`plain-${doc.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-t-white">{doc.label}</h3>
        <label className="flex items-center gap-2 text-xs text-t-phos-dim">
          Box limit
          <input
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
            className="t-focus w-20 min-h-touch bg-t-bg border border-t-line px-2 text-t-white"
            aria-label={`Character limit for ${doc.label}`}
            data-testid={`plain-limit-${doc.key}`}
          />
        </label>
      </div>
      <textarea readOnly value={doc.text} rows={Math.min(12, Math.max(3, doc.text.split("\n").length + 1))} className="w-full bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white" aria-label={doc.label} />
      <p className={`text-sm ${over ? "text-t-red" : "text-t-phos"}`} data-testid={`plain-count-${doc.key}`}>
        {doc.chars} characters with spaces, {doc.words} words{over ? `. ${over} over the limit.` : ""}
      </p>
    </section>
  );
}

export function PlainTextPanel({ ctx, model, samples }: { ctx: CreativeCtx; model: ArtistResumeModel; samples: WorkSampleRow[] }) {
  const statement = ctx.statement.versions.length ? ctx.statement.versions[ctx.statement.versions.length - 1].text : "";
  const docs: PlainTextDoc[] = [
    plainTextDoc("artist_resume", "Artist resume", artistResumePlainText(model)),
    ...BIO_LENGTHS.map((l) => plainTextDoc(`bio_${l}` as PlainTextDoc["key"], `${BIO_LIMITS[l].label} bio`, bioText(ctx.bio.lengths[l]))),
    plainTextDoc("statement", "Statement", statement),
    plainTextDoc("work_samples", "Work samples", workSampleListPlainText(samples)),
  ].filter((d) => d.text);
  return (
    <div className="space-y-3" data-testid="plain-text-panel">
      <p className="text-sm text-t-phos-dim">{PLAIN_TEXT_HOW}</p>
      {docs.length ? docs.map((d) => <Box key={d.key} doc={d} />) : <p className="text-sm text-t-phos-dim">Nothing saved yet.</p>}
    </div>
  );
}
