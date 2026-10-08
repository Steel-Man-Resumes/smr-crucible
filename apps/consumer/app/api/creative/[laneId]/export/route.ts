import { NextResponse } from "next/server";
import {
  BIO_LENGTHS,
  BIO_LIMITS,
  bioTextForLane,
  countChars,
  countWords,
  currentStatementText,
  artistResumePlainText,
  workSampleListPlainText,
  workSampleListCsv,
  exportOpenItemLines,
  type CreativeDoc,
} from "@crucible/core";
import { buildCreative, renderCreativeDocx, renderCreativeHtml, renderCreativePdf, type CreativeRenderRequest } from "@/lib/resume-render";
import { creativeLane, gate, laneNotFound, loadCreativeContext } from "@/lib/creative-server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ laneId: string }>;
}

const DOCS = ["artist_resume", "bio", "statement", "work_samples"] as const;
type Doc = (typeof DOCS)[number];
const FORMATS = ["pdf", "docx", "html", "txt", "csv"] as const;
type Format = (typeof FORMATS)[number];

function fileName(name: string, what: string, ext: string): string {
  const who = name.replace(/[^A-Za-z0-9 ]+/g, "").trim().replace(/\s+/g, "-") || "My";
  return `${who}-${what}.${ext}`;
}

/**
 * GET /api/creative/[laneId]/export?doc=artist_resume|bio|statement|work_samples&format=pdf|docx|html|txt|csv
 *
 * Built from the database, as the person: the record, this lane's choices and
 * the saved documents. A document with an open BLOCK downloads as a clearly
 * marked DRAFT with its to-do page (never as finished). The statement and the
 * sample list come as plain text (and CSV for samples), exactly as saved.
 */
export async function GET(request: Request, context: RouteContext) {
  const g = await gate(request);
  if (!g.ok) return g.res;
  const { laneId } = await context.params;
  const lane = await creativeLane(g.userId, laneId);
  if (!lane) return laneNotFound();
  const url = new URL(request.url);
  const doc = (DOCS as readonly string[]).includes(url.searchParams.get("doc") ?? "") ? (url.searchParams.get("doc") as Doc) : null;
  const format = (FORMATS as readonly string[]).includes(url.searchParams.get("format") ?? "") ? (url.searchParams.get("format") as Format) : null;
  if (!doc || !format) return NextResponse.json({ error: "Pick a document and a format." }, { status: 400 });

  let c = await loadCreativeContext(g.userId, lane);
  if (doc === "artist_resume") {
    // The page cap (STD-F07) needs the real page count from the layout.
    const pages = buildCreative({ doc: "artist_resume", model: c.model }).layout.pages.length;
    c = await loadCreativeContext(g.userId, lane, pages);
  }
  const name = c.settings.displayName ?? "";
  const checkDoc: CreativeDoc = doc === "work_samples" ? "work_samples" : doc === "statement" ? "statement" : doc === "bio" ? "bio" : "artist_resume";
  const items = c.status.openItems.filter((x) => x.doc === checkDoc || x.doc === "record");
  const draft = items.some((x) => x.severity === "BLOCK");
  // The to-do page is exported too: neutral lines for anything the lane keeps off, then a backstop filter.
  const openItems = exportOpenItemLines({ ...c.status, openItems: items }, c.entries, c.settings);

  const text = (body: string, what: string, ext = "txt", type = "text/plain; charset=utf-8") =>
    new NextResponse((draft && ext === "txt" ? "DRAFT\n\n" : "") + body, {
      headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${fileName(name, what, ext)}"`, "Cache-Control": "no-store" },
    });

  if (doc === "statement") {
    if (format !== "txt") return NextResponse.json({ error: "The statement downloads as plain text." }, { status: 400 });
    return text(currentStatementText(c.statement), "statement");
  }
  if (doc === "work_samples") {
    if (format === "csv") {
      const csv = workSampleListCsv(c.samples);
      // A spreadsheet has no DRAFT line, so the first row says it.
      return text(draft ? `DRAFT: open items remain on this list\r\n${csv}` : csv, "work-samples", "csv", "text/csv; charset=utf-8");
    }
    if (format !== "txt") return NextResponse.json({ error: "The sample list downloads as plain text or CSV." }, { status: 400 });
    return text(workSampleListPlainText(c.samples), "work-samples");
  }

  let req: CreativeRenderRequest;
  if (doc === "artist_resume") {
    if (format === "txt") return text(artistResumePlainText(c.model), "artist-resume");
    req = { doc: "artist_resume", model: c.model, draft, openItems };
  } else {
    const bios = BIO_LENGTHS.map((len) => {
      // The lane's current choices: a sentence naming a facility it keeps off never prints.
      const t = bioTextForLane(c.bio.lengths[len], c.entries, c.settings);
      return { label: `${BIO_LIMITS[len].label} bio`, text: t, words: countWords(t), chars: countChars(t) };
    }).filter((b) => b.text);
    if (format === "txt") return text(bios.map((b) => `${b.label.toUpperCase()} (${b.words} words, ${b.chars} characters with spaces)\n${b.text}`).join("\n\n"), "bio");
    req = { doc: "bio", card: { name, discipline: c.settings.discipline ?? "", bios }, draft, openItems };
  }
  if (format === "csv") return NextResponse.json({ error: "Pick PDF, Word, HTML or plain text." }, { status: 400 });

  const what = doc === "artist_resume" ? "artist-resume" : "bio";
  if (format === "pdf") {
    const bytes = await renderCreativePdf(req);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName(name, what, "pdf")}"`, "Cache-Control": "no-store" },
    });
  }
  if (format === "docx") {
    const buf = await renderCreativeDocx(req);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName(name, what, "docx")}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(renderCreativeHtml(req), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName(name, what, "html")}"`, "Cache-Control": "no-store" },
  });
}
