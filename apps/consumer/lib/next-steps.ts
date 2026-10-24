/**
 * "What comes next" (/dashboard/next): life past the job search, wired to the
 * support search's own categories (lib/support-search.ts CURATED_CATEGORIES).
 * Only categories the search answers appear here; each card opens Local help
 * with that category chosen.
 */
import type { ResourceCategory } from "./resource-directory";

export interface NextCategory {
  id: ResourceCategory;
  label: string;
  line: string;
}

export const NEXT_CATEGORIES: readonly NextCategory[] = [
  { id: "education", label: "School and training", line: "School and training programs." },
  { id: "financial", label: "Money and benefits", line: "Benefits, bills and getting your money steady." },
  { id: "legal", label: "Legal help with a record", line: "Legal aid, record clearing and court help." },
  { id: "mental_health", label: "Mental health", line: "Someone to talk to." },
  { id: "substance", label: "Recovery", line: "Recovery support." },
  { id: "housing", label: "A place to stay", line: "Shelter and housing help." },
  { id: "transportation", label: "Getting to work", line: "Rides and ways to get to the job." },
  { id: "id_documents", label: "ID and documents", line: "State ID, birth certificate, Social Security card." },
];

/** Local help with the category chosen. The saved location fills in on that page. */
export function nextCategoryHref(id: ResourceCategory): string {
  return `/dashboard/resources?category=${encodeURIComponent(id)}#support`;
}

/**
 * Official national starting points. Each was fetched and its page title read
 * on the date shown; anything that could not be checked was left out.
 */
export const NATIONAL_STARTING_POINTS: readonly { label: string; href: string; checked: string }[] = [
  { label: "FAFSA, federal student aid (studentaid.gov)", href: "https://studentaid.gov/h/apply-for-aid/fafsa", checked: "2026-10-23" },
  { label: "SNAP food benefits (USDA)", href: "https://www.fna.usda.gov/snap/supplemental-nutrition-assistance-program", checked: "2026-10-23" },
  { label: "Government benefits finder (USA.gov)", href: "https://www.usa.gov/benefits", checked: "2026-10-23" },
  { label: "Replace a lost ID card (USA.gov)", href: "https://www.usa.gov/replace-vital-documents", checked: "2026-10-23" },
  { label: "Health coverage (HealthCare.gov)", href: "https://www.healthcare.gov/", checked: "2026-10-23" },
  { label: "Treatment for mental health or substance use (FindTreatment.gov)", href: "https://findtreatment.gov/", checked: "2026-10-23" },
  { label: "211, local help by phone or online (211.org)", href: "https://211.org/", checked: "2026-10-23" },
];
