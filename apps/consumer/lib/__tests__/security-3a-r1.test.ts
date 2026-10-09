/**
 * Security review 3a round 1: one test (or more) per finding, each written to
 * fail on the code the review looked at (b38e3a3). H1 and the import side of
 * M1 are in forge-import.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";
import { emailCallbackNeedsButton, interstitialUrlFor, maskEmail } from "../sign-in-link";
import { SIGNED_IN_IP_FLOOR_PEOPLE, codeSeats, decideSignedInCall, planForgeLimit } from "../forge-rate-limit";
import {
  CHECK_IMAGE_MAX_PIXELS,
  CHECK_PDF_MAX_PAGES,
  CHECK_PDF_OCR_PAGES,
  CHECK_ZIP_MAX_UNCOMPRESSED,
  CheckFileRefused,
  assertSmallDocx,
  assertSmallImage,
  assertSmallZip,
  imageSize,
  sniffKind,
  withinBudget,
} from "../check-file-guard";
import { extractTextForCheck } from "../text-extraction";
import { termsGateVerdict, revocationCheck } from "../session-policy";
import { tickedFor, tickedMark } from "../terms-ticked";
import { CONSENT_EVENT_SQL, CONSENT_UPSERT_SQL, TERMS_VERSION, consentMethodFor } from "../terms";
import {
  FORGE_PUBLIC_PAGES,
  FORGE_SIGN_IN_PAGES,
  FORGE_SIGN_IN_STARTS_AT,
  FORGE_SIGNED_OUT_API_ALLOWLIST,
  forgeWallDateLabel,
  forgeWallStartsAt,
  forgeWallState,
  readWallSwitch,
} from "../forge-access";
import { SIGNED_OUT_MAX_MESSAGE_CHARS, signedOutAssistantRefusal } from "../assistant-limits";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/* ------------------------------------------------------------- M1 -------- */

describe("M1: login CSRF through the email-link callback", () => {
  const P = "/api/auth/callback/resend";
  it("only a same-origin navigation (our own button) reaches the callback", () => {
    assert.equal(emailCallbackNeedsButton(P, "GET", "same-origin"), false);
    for (const site of ["cross-site", "same-site", "none", null]) {
      assert.equal(emailCallbackNeedsButton(P, "GET", site), true, String(site));
      assert.equal(emailCallbackNeedsButton(P, "HEAD", site), true, String(site));
    }
    assert.equal(emailCallbackNeedsButton("/api/auth/callback/google", "GET", "cross-site"), false);
    // Round 2: every other method goes to the button page too (see security-3a-r2.test.ts).
    assert.equal(emailCallbackNeedsButton(P, "POST", "cross-site"), true);
  });

  it("it is sent to the button page with the same token, email and return path", () => {
    const u = new URL(interstitialUrlFor("https://forge.example.org/api/auth/callback/resend?token=abc&email=a%40b.c&callbackUrl=%2Fstory&x=1"));
    assert.equal(u.pathname, "/login/finish");
    assert.equal(u.searchParams.get("token"), "abc");
    assert.equal(u.searchParams.get("email"), "a@b.c");
    assert.equal(u.searchParams.get("callbackUrl"), "/story");
    assert.equal(u.searchParams.get("x"), null);
    const mw = read("middleware.ts");
    assert.match(mw, /emailCallbackNeedsButton\(req\.nextUrl\.pathname, req\.method, req\.headers\.get\("sec-fetch-site"\)\)/);
  });

  it("the button page names the account it signs in to", () => {
    assert.equal(maskEmail("morgan@example.com"), "m***@example.com");
    assert.equal(maskEmail(""), null);
    // Round 2: the full address, not a mask.
    assert.match(read("app/(auth)/login/finish/page.tsx"), /This link signs you in as/);
  });

  it("the Forge header shows the signed-in address with a way out", () => {
    assert.match(read("app/(forge)/ForgeShell.tsx"), /<ForgeAccountBar \/>/);
    const bar = read("components/forge/ForgeAccountBar.tsx");
    assert.match(bar, /Signed in as/);
    assert.match(bar, /Not you\?/);
  });
});

/* ------------------------------------------------------------- M2 -------- */

function counters() {
  const accounts = new Map<string, number>();
  const buckets = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string) => {
    const n = (m.get(k) ?? 0) + 1;
    m.set(k, n);
    return n;
  };
  return {
    accounts,
    buckets,
    c: {
      account: async (u: string, e: string) => inc(accounts, `${u}|${e}`),
      refundAccount: async (u: string, e: string) => {
        accounts.set(`${u}|${e}`, Math.max(0, (accounts.get(`${u}|${e}`) ?? 0) - 1));
      },
      bucket: async (k: string, e: string) => inc(buckets, `${k}|${e}`),
    },
  };
}

async function call(
  ctr: ReturnType<typeof counters>,
  userId: string,
  ip: string,
  code: { code: string; seats: number } | null = null,
  perPerson = 5
) {
  const plan = planForgeLimit({ userId, needsSession: true, perPerson, tierLimit: 30 });
  if (plan.kind !== "account") throw new Error("plan");
  return decideSignedInCall({ plan, endpoint: "analyze", perPerson, ip, code }, ctr.c);
}

describe("M2: signed-in limits, account first", () => {
  it("one account past its own limit leaves the next person's first call working", async () => {
    const ctr = counters();
    const tally: Record<string, number> = {};
    for (let i = 0; i < 50; i++) {
      const v = await call(ctr, "attacker", "library");
      tally[v] = (tally[v] ?? 0) + 1;
    }
    assert.deepEqual(tally, { ok: 5, account: 45 });
    assert.equal(await call(ctr, "next-person", "library"), "ok");
  });

  it("12 accounts on one IP with a 10-seat code: the seats decide, not a flat network cap", async () => {
    const ten = counters();
    const code10 = { code: "LAB10", seats: codeSeats(10) };
    const per: string[][] = [];
    for (let p = 0; p < 12; p++) {
      const mine: string[] = [];
      for (let i = 0; i < 5; i++) mine.push(await call(ten, `person${p}`, "lab", code10));
      per.push(mine);
    }
    // The code bought 10 seats x 5 calls: ten people get everything, two are told the group is out.
    assert.equal(per.slice(0, 10).flat().every((v) => v === "ok"), true);
    assert.equal(per.slice(10).flat().every((v) => v === "code"), true);
    assert.equal(ten.buckets.get("lab|signed-in:analyze"), undefined, "a code never spends the network ceiling");

    // A 20-seat code: all twelve get their full allowance, past the flat
    // ceiling the old order capped them at (10 people's worth).
    const twenty = counters();
    const code20 = { code: "LAB20", seats: codeSeats(20) };
    let ok = 0;
    for (let p = 0; p < 12; p++) for (let i = 0; i < 5; i++) if ((await call(twenty, `person${p}`, "lab", code20)) === "ok") ok++;
    assert.equal(ok, 60);
    assert.ok(60 > 5 * SIGNED_IN_IP_FLOOR_PEOPLE);
  });

  it("without a code the network ceiling still bounds a farm of accounts", async () => {
    const ctr = counters();
    let refused = 0;
    for (let p = 0; p < 12; p++) for (let i = 0; i < 5; i++) if ((await call(ctr, `farm${p}`, "one-ip")) === "network") refused++;
    assert.equal(refused, 60 - 5 * SIGNED_IN_IP_FLOOR_PEOPLE);
  });

  it("seats: 1 to 50, default 10 (the signed-out pool's rule)", () => {
    assert.equal(codeSeats(null), 10);
    assert.equal(codeSeats(0), 1);
    assert.equal(codeSeats(500), 50);
  });

  it("the wrapper uses it, and signed-out org-listing gets no code pool (L7)", () => {
    const w = read("lib/withRateLimit.ts");
    assert.match(w, /decideSignedInCall\(/);
    assert.match(w, /opts\.poolable === false \? null : getAccessCodeCookie\(request\)/);
    const ol = read("app/api/org-listing/route.ts");
    assert.match(ol, /poolable: false/);
    assert.match(ol, /checkTurnstile\(body\.turnstileToken/);
    assert.match(read("app/(forge)/get-listed/page.tsx"), /<TurnstileWidget \/>/);
  });
});

/* ------------------------------------------------------------- M3 -------- */

/** A minimal zip writer (deflate), so the tests build their own files. */
function zip(entries: Array<{ name: string; data: Buffer; lieSize?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const comp = deflateRawSync(e.data, { level: 9 });
    const name = Buffer.from(e.name);
    const usize = e.lieSize ?? e.data.length;
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const docXml = (body: string) =>
  Buffer.from(
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe("M3: the free checker opens only small files, decided by their bytes", () => {
  it("the kind comes from the bytes; the name and type are not trusted", () => {
    assert.equal(sniffKind(Buffer.from("%PDF-1.7\n...")), "pdf");
    assert.equal(sniffKind(zip([{ name: "a", data: Buffer.from("x") }])), "word");
    assert.equal(sniffKind(png(10, 10)), "png");
    assert.equal(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), "jpeg");
    assert.equal(sniffKind(Buffer.from("MORGAN SAMPLE\nLine Cook 2019 - 2023\n")), "text");
    assert.equal(sniffKind(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0])), null);
    const route = read("app/api/check/extract/route.ts");
    assert.doesNotMatch(route, /checkFileKind|file\.name|file\.type/);
  });

  it("a zip bomb is refused from the directory, before anything is unpacked", () => {
    const bomb = zip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: docXml("<w:p><w:r><w:t>" + "A".repeat(20 * 1024 * 1024) + "</w:t></w:r></w:p>") },
    ]);
    assert.ok(bomb.length < 100_000);
    assert.throws(() => assertSmallZip(bomb), (e: any) => e instanceof CheckFileRefused && e.reason === "too_big_inside");
  });

  it("a directory that lies about its sizes is caught when the entry is inflated with a cap", () => {
    // The directory says 1 KB, so the size and ratio checks pass; the entry
    // really holds 2 MB. Inflating with a 1 KB cap is what catches the lie.
    const noisy = Buffer.from(Array.from({ length: 2 * 1024 * 1024 }, (_, i) => 65 + ((i * 7919) % 26)));
    const liar = zip([{ name: "word/document.xml", data: noisy, lieSize: 1024 }]);
    assert.throws(() => assertSmallZip(liar), (e: any) => e instanceof CheckFileRefused && e.reason === "too_big_inside");
  });

  it("a total over the cap is refused even when each entry is modest", () => {
    const chunk = Buffer.from(Array.from({ length: 1024 * 1024 }, (_, i) => 65 + ((i * 31) % 26)));
    const many = zip(Array.from({ length: 6 }, (_, i) => ({ name: `word/p${i}.xml`, data: chunk })));
    assert.ok(6 * chunk.length > CHECK_ZIP_MAX_UNCOMPRESSED);
    assert.throws(() => assertSmallZip(many), /more than a resume/);
  });

  it("a real small Word file passes, and one without a document part is refused", () => {
    assert.doesNotThrow(() =>
      assertSmallDocx(zip([{ name: "word/document.xml", data: docXml("<w:p><w:r><w:t>Line Cook</w:t></w:r></w:p>") }]))
    );
    assert.throws(() => assertSmallDocx(zip([{ name: "a.xml", data: Buffer.from("<a/>") }])), CheckFileRefused);
  });

  it("the extractor refuses the bomb fast, whatever kind it is told the file is", async () => {
    const bomb = zip([
      { name: "word/document.xml", data: docXml("<w:p><w:r><w:t>" + "A".repeat(20 * 1024 * 1024) + "</w:t></w:r></w:p>") },
    ]);
    const t0 = Date.now();
    await assert.rejects(extractTextForCheck(bomb, "pdf", "application/pdf"), CheckFileRefused);
    await assert.rejects(extractTextForCheck(bomb, "word", ""), CheckFileRefused);
    assert.ok(Date.now() - t0 < 2000);
  });

  it("photos must state a size under the pixel cap", () => {
    assert.deepEqual(imageSize(png(800, 600), "png"), { w: 800, h: 600 });
    assert.doesNotThrow(() => assertSmallImage(png(2000, 3000), "png"));
    assert.throws(() => assertSmallImage(png(10_000, 10_000), "png"), CheckFileRefused);
    assert.ok(10_000 * 10_000 > CHECK_IMAGE_MAX_PIXELS);
  });

  it("PDF pages and OCR pages are capped, and the read has a time budget", async () => {
    assert.ok(CHECK_PDF_MAX_PAGES <= 10 && CHECK_PDF_OCR_PAGES <= 2);
    const te = read("lib/text-extraction.ts");
    assert.match(te, /maxPages: guard\.CHECK_PDF_MAX_PAGES/);
    assert.match(te, /extractFromPDFWithOCR\(buffer, guard\.CHECK_PDF_OCR_PAGES\)/);
    await assert.rejects(withinBudget(new Promise(() => {}), 20), /check time budget/);
    assert.match(read("app/api/check/extract/route.ts"), /withinBudget\(extractTextForCheck\(/);
  });
});

/* ------------------------------------------------------------- M4 -------- */

describe("M4: terms for every way in", () => {
  it("wall up: no Forge screen, walled Forge API, or run save without accepted terms", () => {
    for (const p of FORGE_SIGN_IN_PAGES) assert.equal(termsGateVerdict(p, true, false), "page", p);
    for (const p of ["/api/parse", "/api/analyze", "/api/forge/generate-docs", "/api/forge/save"]) {
      assert.equal(termsGateVerdict(p, true, undefined), "api", p);
    }
    assert.equal(termsGateVerdict("/welcome", true, true), "pass");
    assert.equal(termsGateVerdict("/api/parse", true, true), "pass");
  });

  it("the public pages, the signed-out allowlist and the wall-down Forge are untouched", () => {
    // Round 2: the Refinery and t.ROY's chat (signed in) are gated too; the
    // rest of the signed-out allowlist stays open.
    for (const p of [...FORGE_PUBLIC_PAGES, ...Object.keys(FORGE_SIGNED_OUT_API_ALLOWLIST).filter((r) => r !== "/api/assistant")]) {
      assert.equal(termsGateVerdict(p, true, false), "pass", p);
    }
    assert.equal(termsGateVerdict("/welcome", false, false), "pass");
  });

  it("auth.ts sets the claim from the consent row only, and gates on it", () => {
    const a = read("auth.ts");
    assert.match(a, /termsGateVerdict\(path, wallUp, termsCurrent\(session\.user as any, TERMS_VERSION\)\)/);
    assert.match(a, /pool\.query\(CONSENT_LOOKUP_SQL, \[token\.sub, TERMS_VERSION\]\)/);
    assert.match(a, /\(session\.user as any\)\.terms = \(token as any\)\.terms === true;/);
  });

  it("acceptance writes the same rows registration writes, by the way the person came in", () => {
    const reg = read("app/api/auth/register/route.ts");
    const acc = read("app/api/auth/accept-terms/route.ts");
    for (const src of [reg, acc]) {
      assert.match(src, /CONSENT_UPSERT_SQL/);
      assert.match(src, /CONSENT_EVENT_SQL/);
      assert.match(src, /TERMS_VERSION/);
    }
    assert.match(acc, /isSameOriginJsonPost\(request\.headers\)/);
    assert.match(acc, /forgeSessionUser\(session\)/);
    assert.match(CONSENT_UPSERT_SQL, /consumer_consent/);
    assert.match(CONSENT_EVENT_SQL, /consumer_consent_event/);
    assert.equal(TERMS_VERSION, "2026-08-21-v1");
    assert.equal(consentMethodFor("resend"), "email_link");
    assert.equal(consentMethodFor("google"), "google");
  });

  it("the email-link form has the checkbox; the mark only skips one tap for the same address here", () => {
    const login = read("app/(auth)/login/page.tsx");
    assert.match(login, /\(mode === "create" \|\| mode === "magic-link"\) && \(/);
    assert.match(login, /\(mode === "magic-link" && !acceptedTerms\)/);
    const now = Date.parse("2026-10-07T12:00:00Z");
    const mark = tickedMark("Morgan@Example.com ", TERMS_VERSION, now);
    assert.equal(tickedFor(mark, "morgan@example.com", TERMS_VERSION, now + 1000), true);
    assert.equal(tickedFor(mark, "other@example.com", TERMS_VERSION, now), false);
    assert.equal(tickedFor(mark, "morgan@example.com", "older", now), false);
    assert.equal(tickedFor(mark, "morgan@example.com", TERMS_VERSION, now + 2 * 86_400_000), false);
  });

  it("the terms page exists, links the existing terms and privacy pages, and has no dashes", () => {
    const page = read("app/(auth)/login/terms/page.tsx");
    assert.match(page, /TERMS_URL/);
    assert.match(page, /PRIVACY_URL/);
    assert.match(page, /I agree/);
    assert.doesNotMatch(page.replace(/\/\*[\s\S]*?\*\//g, ""), /[–—]/);
  });
});

/* ------------------------------------------------------------- LOW ------- */

describe("L1: an unreadable wall date or switch never guesses", () => {
  it("the date in this file is unset or readable (fails the build on a typo)", () => {
    if (FORGE_SIGN_IN_STARTS_AT !== null) {
      assert.notEqual(forgeWallStartsAt(FORGE_SIGN_IN_STARTS_AT), null, "FORGE_SIGN_IN_STARTS_AT is not readable");
      const [, , d] = FORGE_SIGN_IN_STARTS_AT.slice(0, 10).split("-").map(Number);
      assert.ok(forgeWallDateLabel(FORGE_SIGN_IN_STARTS_AT)!.endsWith(` ${d}`));
    }
  });

  it("impossible dates are refused (February 30, April 31, hour 24), real ones read", () => {
    for (const bad of ["2026-02-30T00:00:00-07:00", "2026-04-31T00:00:00Z", "2026-11-02T24:00:00Z", "2027-02-29T00:00:00Z"]) {
      assert.equal(forgeWallStartsAt(bad), null, bad);
      assert.equal(forgeWallState({ now: Date.parse("2030-01-01T00:00:00Z"), startsAt: bad, override: null }), "open", bad);
    }
    assert.ok(forgeWallStartsAt("2028-02-29T00:00:00Z"));
  });

  it("the switch reads ON and spaces, ignores anything else", () => {
    assert.equal(readWallSwitch(" ON "), "on");
    assert.equal(readWallSwitch("Off"), "off");
    assert.equal(readWallSwitch("yes"), null);
    assert.equal(forgeWallState({ override: "ON", startsAt: null }), "up");
  });
});

describe("L2: a revoked cookie never breaks the open routes", () => {
  it("the signed-out allowlist is checked as open, everything else as before", () => {
    for (const p of Object.keys(FORGE_SIGNED_OUT_API_ALLOWLIST)) assert.equal(revocationCheck(p), "as-open", p);
    assert.equal(revocationCheck("/api/parse"), "here");
    assert.equal(revocationCheck("/api/forge/save"), "here");
    assert.equal(revocationCheck("/dashboard"), "here");
    assert.equal(revocationCheck("/api/auth/session"), "skip");
    assert.match(read("auth.ts"), /revocationCheck\(path\) === "here"/);
    assert.match(read("middleware.ts"), /revocationCheck\(req\.nextUrl\.pathname\) === "as-open"/);
  });
});

describe("L4: t.ROY's chat signed out is bounded", () => {
  it("needs a declared size and caps the thread", () => {
    assert.equal(signedOutAssistantRefusal(null, []), 411);
    assert.equal(signedOutAssistantRefusal("100", [{ role: "user", content: "x".repeat(SIGNED_OUT_MAX_MESSAGE_CHARS + 1) }]), 413);
    assert.equal(
      signedOutAssistantRefusal("100", [{ role: "user", content: "a", parts: [{ type: "text", text: "y".repeat(SIGNED_OUT_MAX_MESSAGE_CHARS) }] }]),
      413
    );
    assert.equal(signedOutAssistantRefusal("100", [{ role: "user", content: "hello" }]), null);
    assert.match(read("app/api/assistant/route.ts"), /signedOutAssistantRefusal\(contentLength, messages\)/);
  });
});

describe("L5: every Forge page is classified", () => {
  it("each app/(forge)/*/page.tsx is public or walled, never neither", () => {
    const dir = join(root, "app", "(forge)");
    const pages = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "page.tsx")))
      .map((d) => "/" + d.name);
    assert.ok(pages.length >= 15);
    const known = new Set<string>([...FORGE_PUBLIC_PAGES, ...FORGE_SIGN_IN_PAGES]);
    for (const p of pages) assert.ok(known.has(p), `${p} is in neither FORGE_PUBLIC_PAGES nor FORGE_SIGN_IN_PAGES`);
  });
});

describe("L8: the carry page says what happens to the answers", () => {
  it("names the account they are saved to, or says they stay on this computer", () => {
    const page = read("app/(forge)/carry/page.tsx");
    assert.match(page, /your answers are saved to the account for \$\{signedInEmail\}/);
    assert.match(page, /Your answers stay on this computer\./);
    assert.doesNotMatch(page, /does\s*\n?\s*\* not hand them to us/);
  });
});
