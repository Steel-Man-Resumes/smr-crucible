/**
 * A small, predictable word stem: the same word in another form gets the same
 * stem ("carried" and "carry", "loaded" and "loading", "prepped" and "prep"),
 * and two different words that only share a start do not ("commercial" and
 * "communication"). Lowercase, common endings off, a doubled last consonant
 * undone, then the first five letters.
 */
export function stemOf(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "").replace(/[^a-z]/g, "");
  if (w.length > 4 && /ies$/.test(w)) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /ied$/.test(w)) w = w.slice(0, -3) + "y";
  else if (w.length > 5 && /ing$/.test(w)) w = w.slice(0, -3);
  else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
  else if (w.length > 5 && /er$/.test(w)) w = w.slice(0, -2); // "worker" is "work", "leader" is "lead"
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(?:ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && /e$/.test(w)) w = w.slice(0, -1); // "drive" and "driver", "manage" and "manager"
  return w.slice(0, 5);
}

/** Two-to-four letter all-caps words (RN, LPN, GM, CNC): short, but they carry meaning. */
export function acronymsOf(text: string): string[] {
  return (text.match(/\b[A-Z]{2,4}\b/g) ?? []).filter((a) => !/^(?:I|A|AN|OR|AND|THE|OF|TO|IN|ON|AT)$/.test(a));
}
