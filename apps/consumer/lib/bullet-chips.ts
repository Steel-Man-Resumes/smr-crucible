/**
 * Pure helpers for the Bullet Workshop's one-tap chips. A chip is a toggle: it
 * adds its text to the answer box, and tapping it again takes that text back out.
 * Answers are comma-separated lists, so a chip is "on" when its text is one of
 * the comma-separated items (case-insensitive).
 */

function items(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the chip's text is currently one item in the answer. */
export function hasChip(value: string, chip: string): boolean {
  const c = chip.trim().toLowerCase();
  return !!c && items(value).some((i) => i.toLowerCase() === c);
}

/** Add the chip if absent, remove it if present. Other typed text is kept. */
export function toggleChip(value: string, chip: string): string {
  const c = chip.trim();
  if (!c) return value;
  if (hasChip(value, c)) {
    return items(value)
      .filter((i) => i.toLowerCase() !== c.toLowerCase())
      .join(", ");
  }
  const current = value.trim().replace(/,\s*$/, "");
  return current ? `${current}, ${c}` : c;
}

/** The workshop can write a bullet once any one of the answers has something in it. */
export function canGenerateBullet(a: {
  did: string;
  tools: string;
  often: string;
  quantity: string;
  improved: string;
}): boolean {
  return !!(a.did.trim() || a.tools.trim() || a.often.trim() || a.quantity.trim() || a.improved.trim());
}
