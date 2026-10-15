/**
 * Fictional fixtures for the second check. Every person, employer, place and
 * contact here is invented for these tests. Each flawed page changes one line
 * of the clean page.
 */

export const SOURCE = `Riley Example
Akron, OH | riley@example.com | 330-555-0188
I worked at Lakeside Grocery from 2018 to 2023 as a stocker.
I unloaded the delivery truck twice a week and stocked about 30 aisles.
I helped with inventory counts under the store manager.
I had a forklift certification from 2019 to 2021. It expired in 2021 and I have not renewed it.
I cooked at Pine Diner from 2023 to 2025. I made breakfast orders on the grill.`;

export const CLEAN = `RILEY EXAMPLE
Akron, OH | riley@example.com | 330-555-0188

PROFESSIONAL EXPERIENCE
STOCKER | Lakeside Grocery | 2018 - 2023
- Unloaded the delivery truck twice a week and stocked about 30 aisles.
- Helped with inventory counts under the store manager.

LINE COOK | Pine Diner | 2023 - 2025
- Made breakfast orders on the grill.

CERTIFICATIONS
- Forklift Certification | 2019 - 2021`;

const swap = (from: string, to: string) => {
  if (!CLEAN.includes(from)) throw new Error(`fixture line missing: ${from}`);
  return CLEAN.replace(from, to);
};

/** The planted flaws, one per page, with the line that carries it. */
export const FLAWED = {
  invented_number: {
    line: "- Unloaded the delivery truck twice a week and stocked about 45 aisles.",
    page: swap("stocked about 30 aisles.", "stocked about 45 aisles."),
  },
  led_for_helped: {
    line: "- Led inventory counts.",
    page: swap("- Helped with inventory counts under the store manager.", "- Led inventory counts."),
  },
  expired_as_current: {
    line: "- Forklift Certification | Current",
    page: swap("- Forklift Certification | 2019 - 2021", "- Forklift Certification | Current"),
  },
  invented_employer_detail: {
    line: "STOCKER | Lakeside Grocery, a national chain | 2018 - 2023",
    page: swap("STOCKER | Lakeside Grocery | 2018 - 2023", "STOCKER | Lakeside Grocery, a national chain | 2018 - 2023"),
  },
};

/** A model reply for a page: flags the given lines with the given kinds. */
export function reply(findings: Array<{ line: string; kind: string; severity?: string; reason?: string; question?: string }>): string {
  return JSON.stringify({
    findings: findings.map((f) => ({
      line: f.line,
      kind: f.kind,
      severity: f.severity ?? "BLOCK",
      reason: f.reason ?? "Your words do not say this.",
      question: f.question ?? "How would you say this line in your own words?",
    })),
  });
}
