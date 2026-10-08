import { NextResponse } from "next/server";
import {
  BIO_LENGTHS,
  BIO_LIMITS,
  bioFacilityCheck,
  bioTextForLane,
  countChars,
  countWords,
  currentStatementText,
  artistResumePlainText,
  workSampleListPlainText,
  workSampleListCsv,
  exportOpenItemLines,
  laneKindOf,
  cvPlainText,
  shownEntryIds,
  type CreativeDoc,
} from "@crucible/core";
import { buildCreative, renderCreativeDocx, renderCreativeHtml, renderCreativePdf, type CreativeRenderRequest } from "@/lib/resume-render";
import { docLane, gate, laneNotFound, loadCreativeContext, loadCvContext } from "@/lib/creative-server";
import type { CareerLane } from "@crucible/core";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ laneId: string }>;
}

// A creative lane never answers doc=cv (review s2 LOW 2): the CV has its own lane.
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
  const lane = await docLane(g.userId, laneId, ["creative", "cv"]);
  if (!lane) return laneNotFound();
  const url = new URL(request.url);
  if (laneKindOf(lane) === "cv") return exportCv(g.userId, lane, url);
  const doc = (DOCS as readonly string[]).includes(url.searchParams.get("doc") ?? "") ? (url.searchParams.get("doc") as Doc) : null;
  const format = (FORMATS as readonly string[]).includes(url.searchParams.get("format") ?? "") ? (url.searchParams.get("format") as Format) : null;
  if (!doc || !format) return NextResponse.json({ error: "Pick a document and a format." }, { status: 400 });

  let c = await loadCreativeContext(g.userId, lane);
  if (doc === "artist_resume") {
    // The page cap (STD-F07) needs the real page count from the layout.
    const pages = buildCreative({ doc: "artist_resume", model: c.model }).layout.pages.length;
    c = await loadCreativeContext(g.userId, lane, pages);
  }
  // The name as the page prints it: a name field the lane holds back never reaches the file name.
  const name = c.model.header.name ?? "";
  const checkDoc: CreativeDoc = doc === "work_samples" ? "work_samples" : doc === "statement" ? "statement" : doc === "bio" ? "bio" : "artist_resume";
  const items = c.status.openItems.filter((x) => x.doc === checkDoc || x.doc === "record");
  const draft = items.some((x) => x.severity === "BLOCK");
  // The to-do page is exported too: neutral lines for anything the lane keeps off, then a backstop filter.
  // Only what THIS document prints makes a hidden name public (review s2r3 N3-M1); the statement prints no entry.
  const shown =
    doc === "artist_resume"
      ? shownEntryIds(c.model)
      : doc === "work_samples"
        ? c.samples.map((r) => r.entryId)
        : doc === "bio"
          ? BIO_LENGTHS.flatMap((len) => bioFacilityCheck(c.bio.lengths[len], c.entries, c.settings).kept.map((x) => (x.origin === "fact" ? x.sourceEntryId ?? "" : ""))).filter(Boolean)
          : [];
  const openItems = exportOpenItemLines({ ...c.status, openItems: items }, c.entries, c.settings, checkDoc, shown);

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
    req = { doc: "bio", card: { name, discipline: c.model.header.discipline, bios }, draft, openItems };
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


/**
 * A CV lane's export: the CV only, built from the database with this lane's
 * current choices. DRAFT (with its to-do page, safe lines only) while a BLOCK
 * is open; the page count feeds the international two-page rule.
 */
async function exportCv(userId: string, lane: CareerLane, url: URL): Promise<NextResponse> {
  const doc = url.searchParams.get("doc");
  const format = url.searchParams.get("format");
  if (doc !== "cv" || !["pdf", "docx", "html", "txt"].includes(format ?? "")) {
    return NextResponse.json({ error: "Pick the CV and PDF, Word, HTML or plain text." }, { status: 400 });
  }
  let v = await loadCvContext(userId, lane);
  const pages = buildCreative({ doc: "cv", model: v.model }).layout.pages.length;
  v = await loadCvContext(userId, lane, pages);
  const draft = v.status.blockCount > 0;
  const openItems = exportOpenItemLines(v.status, v.entries, v.settings, "cv", shownEntryIds(v.model));
  // The file name uses the header as printed, so a detail CV-03 kept off the page never rides along in it.
  const name = v.model.header.name ?? "";
  const headers = (type: string, ext: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${fileName(name, "CV", ext)}"`, "Cache-Control": "no-store" });
  if (format === "txt") return new NextResponse((draft ? "DRAFT\n\n" : "") + cvPlainText(v.model), { headers: headers("text/plain; charset=utf-8", "txt") });
  const req: CreativeRenderRequest = { doc: "cv", model: v.model, draft, openItems };
  if (format === "pdf") return new NextResponse(Buffer.from(await renderCreativePdf(req)), { headers: headers("application/pdf", "pdf") });
  if (format === "docx") {
    return new NextResponse(new Uint8Array(await renderCreativeDocx(req)), { headers: headers("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx") });
  }
  return new NextResponse(renderCreativeHtml(req), { headers: headers("text/html; charset=utf-8", "html") });
}
