/**
 * Spanish walk of 2026-11-15, finding F14: the five application status tiles at a phone's width.
 *
 * The row used five tiles at min-w-[80px] inside a horizontally scrolling flex row. Five tiles plus gaps are
 * 432 px, so on a 390 px phone the last tile ("Con oferta" in Spanish) was cut off. The row is now a grid: three
 * columns on a phone, five from the sm breakpoint up, and each tile can shrink and wrap (min-w-0, break-words).
 *
 * This fix ALSO changes the English phone layout (the row is shared), so it is held on its own branch until
 * someone has looked at it rendered. These tests read the classes and structure; they use no browser, so the fix
 * is NOT visually verified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

test("F14: the status tiles lay out as a grid that cannot be wider than the phone", () => {
  for (const file of ["app/(dashboard)/dashboard/applications/page.tsx", "app/(dashboard)/dashboard/progress/page.tsx"]) {
    const src = read(file);
    assert.doesNotMatch(src, /min-w-\[80px\]/, `${file}: the 80 px minimum (5 x 80 + gaps = 432 px) is gone`);
    assert.match(src, /className="grid grid-cols-3 gap-2 (?:mb-6 )?sm:grid-cols-5">/, file);
    assert.match(src, /className=\{?[`"]min-w-0 break-words p-3 border text-center/, file);
  }
  // The tour still finds the overview.
  assert.match(read("app/(dashboard)/dashboard/applications/page.tsx"), /id="refinery-tool-application-overview" className="grid grid-cols-3/);
});
