/**
 * Server side: the bundled fonts and the Measurer built from them.
 *
 * Carlito (metric twin of Calibri) and Caladea (metric twin of Cambria), both
 * SIL Open Font License 1.1, live in public/fonts/resume with their licence
 * files. They are read with fs from there; next.config.mjs lists the folder in
 * outputFileTracingIncludes so the files ship inside the serverless functions
 * that need them. The browser loads the same files by URL.
 *
 * Widths are plain glyph advances with ligatures and kerning off. That is what
 * the PDF carries (pdf-lib places glyphs by advance), what Word does by default,
 * and what the HTML asks for (font-kerning none), so all three wrap alike.
 */

import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { FACE_FILES, type FaceKey } from "./style";
import type { Measurer } from "./layout";

export const FONT_FEATURES = { liga: false, clig: false, kern: false } as const;

function fontDir(): string {
  const candidates = [
    path.join(process.cwd(), "public", "fonts", "resume"),
    path.join(process.cwd(), "apps", "consumer", "public", "fonts", "resume"),
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, FACE_FILES.serif))) return c;
  throw new Error("resume fonts not found: public/fonts/resume");
}

const bytesCache = new Map<FaceKey, Uint8Array>();
export function fontBytes(face: FaceKey): Uint8Array {
  let b = bytesCache.get(face);
  if (!b) {
    b = new Uint8Array(fs.readFileSync(path.join(fontDir(), FACE_FILES[face])));
    bytesCache.set(face, b);
  }
  return b;
}

type FKFont = ReturnType<typeof fontkit.create>;
const fkCache = new Map<FaceKey, FKFont>();
function fk(face: FaceKey): FKFont {
  let f = fkCache.get(face);
  if (!f) {
    f = fontkit.create(Buffer.from(fontBytes(face)));
    fkCache.set(face, f);
  }
  return f;
}

let shared: Measurer | null = null;
export function fontMeasurer(): Measurer {
  if (shared) return shared;
  const widthCache = new Map<string, number>();
  shared = {
    width(face, text, size) {
      const key = `${face}\u0000${text}`;
      let units = widthCache.get(key);
      if (units === undefined) {
        const font = fk(face);
        const { glyphs } = font.layout(text, FONT_FEATURES as never) as { glyphs: { advanceWidth: number }[] };
        units = glyphs.reduce((s, g) => s + g.advanceWidth, 0);
        widthCache.set(key, units);
      }
      return (units * size) / fk(face).unitsPerEm;
    },
    ascent: (face) => fk(face).ascent / fk(face).unitsPerEm,
    descent: (face) => Math.abs(fk(face).descent) / fk(face).unitsPerEm,
  };
  return shared;
}
