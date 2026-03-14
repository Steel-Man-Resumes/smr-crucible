/**
 * Resource Directory — Curated, verified local resources
 *
 * Geo-scoped to Milwaukee + Waukesha counties (initial launch).
 * Every entry is a real organization with real contact info.
 *
 * Types:
 *   link    — Official page (rendered as info card, no outbound navigation)
 *   api     — Backed by live API endpoint (HUD, CareerOneStop, etc.)
 *   phone   — Call/text number (rendered as tel: link — stays on device)
 *   chat    — Text/chat service (rendered inline)
 *   curated — Manually verified local resource
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ResourceCategory =
  | "housing"
  | "transportation"
  | "legal"
  | "id_documents"
  | "mental_health"
  | "substance"
  | "education"
  | "financial"
  | "employment";

export type ResourceType = "api" | "link" | "phone" | "chat" | "curated";
export type ResourceGeo = "milwaukee" | "waukesha" | "wisconsin" | "national";

export interface ResourceEntry {
  id: string;
  category: ResourceCategory;
  type: ResourceType;
  title: string;
  provider: string;
  description: string;
  phone?: string;
  textNumber?: string;
  address?: string;
  hours?: string;
  apiEndpoint?: string;
  geo: ResourceGeo;
  verifiedAt: string;
  tags: string[];
  eligibility?: string;
  partnerOrg?: boolean;
}

export const CATEGORY_META: Record<
  ResourceCategory,
  { label: string; icon: string; description: string }
> = {
  housing: {
    label: "Housing",
    icon: "\u{1F3E0}",
    description: "Shelters, transitional housing, affordable apartments",
  },
  transportation: {
    label: "Transportation",
    icon: "\u{1F68C}",
    description: "Bus routes, ride programs, commute help",
  },
  legal: {
    label: "Legal Aid",
    icon: "\u2696\uFE0F",
    description: "Expungement, record sealing, free legal help",
  },
  id_documents: {
    label: "ID & Documents",
    icon: "\u{1F4CB}",
    description: "State ID, birth certificate, Social Security card",
  },
  mental_health: {
    label: "Mental Health",
    icon: "\u{1F49A}",
    description: "Counseling, therapy, crisis support",
  },
  substance: {
    label: "Recovery Support",
    icon: "\u{1F331}",
    description: "Treatment programs, support groups, sober housing",
  },
  education: {
    label: "Education & Training",
    icon: "\u{1F4DA}",
    description: "GED, trade schools, certifications, job training",
  },
  financial: {
    label: "Financial Literacy",
    icon: "\u{1F4B0}",
    description: "Banking, credit repair, budgeting help",
  },
  employment: {
    label: "Employment Help",
    icon: "\u{1F4BC}",
    description: "Job centers, career counseling, fair-chance employers",
  },
};

// ─── Barrier → Category Mapping ─────────────────────────────────────────────

export const BARRIER_CATEGORY_MAP: Record<string, ResourceCategory[]> = {
  housing: ["housing"],
  transportation: ["transportation"],
  criminal_record: ["legal", "employment"],
  recovery: ["substance", "mental_health"],
  health: ["mental_health"],
  no_degree: ["education"],
  no_id: ["id_documents"],
  financial: ["financial"],
  employment_gap: ["employment", "education"],
};

// ─── Directory ──────────────────────────────────────────────────────────────

export const RESOURCE_DIRECTORY: ResourceEntry[] = [
  // ════════════════════════════════════════════════════════════════════════
  // HOUSING
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "housing-211wi",
    category: "housing",
    type: "phone",
    title: "211 Wisconsin — Housing Help",
    provider: "United Way of Wisconsin",
    description:
      "Free, confidential help finding shelters, transitional housing, and affordable apartments. Available 24/7. Call, text, or search online.",
    phone: "211",
    textNumber: "211",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["housing", "shelter", "transitional", "affordable"],
  },
  {
    id: "housing-hud-counselors",
    category: "housing",
    type: "api",
    title: "HUD Housing Counselors Near You",
    provider: "U.S. Department of Housing and Urban Development",
    description:
      "Free housing counseling — help with rent, buying a home, foreclosure prevention, and fair housing complaints. Find a counselor near you.",
    apiEndpoint: "/api/resources/hud-counselors",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["housing", "counseling", "rent", "foreclosure"],
  },
  {
    id: "housing-rescue-mission",
    category: "housing",
    type: "curated",
    title: "Milwaukee Rescue Mission",
    provider: "Milwaukee Rescue Mission",
    description:
      "Emergency shelter, meals, and transitional housing for men in Milwaukee. Also offers job readiness programs and spiritual support.",
    phone: "(414) 271-0530",
    address: "830 N 19th St, Milwaukee, WI 53233",
    hours: "Open 24/7 for emergency shelter",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["housing", "shelter", "emergency", "men"],
    eligibility: "Adult men",
  },
  {
    id: "housing-guest-house",
    category: "housing",
    type: "curated",
    title: "Guest House of Milwaukee",
    provider: "Guest House of Milwaukee",
    description:
      "Emergency shelter and supportive housing for men. Offers case management, job training, and help getting permanent housing.",
    phone: "(414) 345-3240",
    address: "1216 N 13th St, Milwaukee, WI 53205",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["housing", "shelter", "men", "case-management"],
    eligibility: "Adult men experiencing homelessness",
  },
  {
    id: "housing-hope-house",
    category: "housing",
    type: "curated",
    title: "Hope House of Milwaukee",
    provider: "Hope House",
    description:
      "Transitional housing for women and women with children. Provides case management, life skills training, and employment support.",
    phone: "(414) 389-3838",
    address: "209 W Orchard St, Milwaukee, WI 53204",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["housing", "transitional", "women", "children"],
    eligibility: "Women and women with children",
  },

  // ════════════════════════════════════════════════════════════════════════
  // TRANSPORTATION
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "transport-mcts",
    category: "transportation",
    type: "curated",
    title: "MCTS Bus Routes & Schedules",
    provider: "Milwaukee County Transit System",
    description:
      "Bus routes and schedules for all of Milwaukee County. Plan your commute to work, interviews, or appointments.",
    phone: "(414) 344-6711",
    hours: "Service hours vary by route — most routes 5am to midnight",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["transportation", "bus", "commute"],
  },
  {
    id: "transport-mcts-reduced",
    category: "transportation",
    type: "curated",
    title: "MCTS Reduced Fare Program",
    provider: "Milwaukee County Transit System",
    description:
      "Half-price bus passes for people with disabilities, seniors (65+), and Medicare cardholders. Bring valid ID to apply.",
    phone: "(414) 344-6711",
    address: "1942 N 17th St, Milwaukee, WI 53205",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["transportation", "bus", "reduced-fare", "discount"],
    eligibility: "Seniors 65+, Medicare, disability",
  },
  {
    id: "transport-waukesha-metro",
    category: "transportation",
    type: "curated",
    title: "Waukesha Metro Transit",
    provider: "City of Waukesha",
    description:
      "Fixed-route bus service in Waukesha. Routes connect to major employers, shopping, and medical facilities.",
    phone: "(262) 524-3640",
    hours: "Monday-Friday 5:30am - 7:00pm, Saturday 8:00am - 5:00pm",
    geo: "waukesha",
    verifiedAt: "2026-03-14",
    tags: ["transportation", "bus", "commute"],
  },
  {
    id: "transport-wisconsin-works",
    category: "transportation",
    type: "curated",
    title: "W-2 Transportation Assistance",
    provider: "Wisconsin Works (W-2)",
    description:
      "Help with transportation costs for people in the W-2 program. Can include bus passes, gas cards, or car repair assistance.",
    phone: "(414) 270-4700",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["transportation", "assistance", "financial"],
    eligibility: "W-2 program participants",
  },

  // ════════════════════════════════════════════════════════════════════════
  // LEGAL AID
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "legal-lsc",
    category: "legal",
    type: "link",
    title: "Free Legal Help Finder",
    provider: "Legal Services Corporation",
    description:
      "Find free legal aid near you. Help with expungement, record sealing, housing disputes, family law, and more.",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["legal", "expungement", "record", "free"],
  },
  {
    id: "legal-las-milwaukee",
    category: "legal",
    type: "curated",
    title: "Legal Aid Society of Milwaukee",
    provider: "Legal Aid Society of Milwaukee",
    description:
      "Free legal help for low-income Milwaukee residents. Family law, housing, public benefits, and consumer law.",
    phone: "(414) 727-5300",
    address: "727 N Water St, Suite 300, Milwaukee, WI 53202",
    hours: "Monday-Friday 8:30am - 5:00pm",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["legal", "free", "family", "housing"],
    eligibility: "Low-income Milwaukee County residents",
  },
  {
    id: "legal-expungement-wi",
    category: "legal",
    type: "curated",
    title: "Wisconsin Expungement Project",
    provider: "Wisconsin State Law Library",
    description:
      "Information about expungement eligibility in Wisconsin. Explains who qualifies, how to petition, and what records can be sealed.",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["legal", "expungement", "record-sealing"],
  },
  {
    id: "legal-lawhelp-wi",
    category: "legal",
    type: "link",
    title: "LawHelp Wisconsin",
    provider: "LawHelp.org",
    description:
      "Free legal information and forms for Wisconsin. Topics include criminal records, housing, employment, family, and public benefits.",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["legal", "free", "forms", "information"],
  },

  // ════════════════════════════════════════════════════════════════════════
  // ID & DOCUMENTS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "id-wisdot",
    category: "id_documents",
    type: "link",
    title: "Wisconsin State ID Card",
    provider: "Wisconsin DOT",
    description:
      "How to get a Wisconsin state ID card. Lists required documents, fees, and DMV locations. Free ID cards available for voting purposes.",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["id", "state-id", "dmv"],
  },
  {
    id: "id-realid",
    category: "id_documents",
    type: "link",
    title: "REAL ID Information",
    provider: "Wisconsin DOT",
    description:
      "Starting May 2025, you need a REAL ID-compliant card to fly or enter federal buildings. Learn what documents you need and how to apply.",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["id", "real-id", "federal"],
  },
  {
    id: "id-vital-records",
    category: "id_documents",
    type: "curated",
    title: "Milwaukee County Vital Records",
    provider: "Milwaukee County",
    description:
      "Get copies of birth certificates, death certificates, and marriage certificates for Milwaukee County. Needed for state ID applications.",
    phone: "(414) 286-8200",
    address: "901 N 9th St, Room 118, Milwaukee, WI 53233",
    hours: "Monday-Friday 8:00am - 4:30pm",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["id", "birth-certificate", "vital-records"],
  },
  {
    id: "id-social-security",
    category: "id_documents",
    type: "curated",
    title: "Social Security Office — Milwaukee",
    provider: "Social Security Administration",
    description:
      "Replace a lost or stolen Social Security card. Free — no fee to get a replacement card. Bring photo ID and proof of citizenship.",
    phone: "1-800-772-1213",
    address: "6401 N 76th St, Milwaukee, WI 53223",
    hours: "Monday-Friday 9:00am - 4:00pm",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["id", "social-security", "ssn"],
  },

  // ════════════════════════════════════════════════════════════════════════
  // MENTAL HEALTH
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "mental-988",
    category: "mental_health",
    type: "phone",
    title: "988 Suicide & Crisis Lifeline",
    provider: "SAMHSA / Wisconsin DHS",
    description:
      "Free, confidential support 24/7. Call or text 988. Trained counselors help with suicidal thoughts, emotional distress, substance use crises, and more.",
    phone: "988",
    textNumber: "988",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["mental-health", "crisis", "suicide", "24/7"],
  },
  {
    id: "mental-crisis-text",
    category: "mental_health",
    type: "chat",
    title: "Crisis Text Line",
    provider: "Crisis Text Line",
    description:
      "Free crisis counseling via text message. Text HOME to 741741 to connect with a trained crisis counselor. Available 24/7.",
    textNumber: "741741",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["mental-health", "crisis", "text", "24/7"],
  },
  {
    id: "mental-mke-crisis",
    category: "mental_health",
    type: "curated",
    title: "Milwaukee County Crisis Line",
    provider: "Milwaukee County BHD",
    description:
      "24/7 crisis line for Milwaukee County residents. Mental health emergencies, substance abuse crises, and emotional distress. Mobile crisis teams available.",
    phone: "(414) 257-7222",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["mental-health", "crisis", "local", "24/7"],
  },
  {
    id: "mental-nami-milwaukee",
    category: "mental_health",
    type: "curated",
    title: "NAMI Greater Milwaukee",
    provider: "National Alliance on Mental Illness",
    description:
      "Free support groups, education programs, and advocacy for people with mental illness and their families in the Milwaukee area.",
    phone: "(414) 344-0447",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["mental-health", "support-group", "free", "family"],
  },

  // ════════════════════════════════════════════════════════════════════════
  // RECOVERY SUPPORT
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "substance-211wi-addiction",
    category: "substance",
    type: "phone",
    title: "Wisconsin Addiction Recovery Helpline",
    provider: "211 Wisconsin",
    description:
      "Free, confidential help finding addiction treatment programs, support groups, and recovery resources in Wisconsin.",
    phone: "211",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["substance", "addiction", "recovery", "treatment"],
  },
  {
    id: "substance-samhsa",
    category: "substance",
    type: "phone",
    title: "SAMHSA Treatment Locator",
    provider: "Substance Abuse and Mental Health Services Administration",
    description:
      "Find treatment facilities for substance use and mental health near you. National helpline is free, confidential, and available 24/7.",
    phone: "1-800-662-4357",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["substance", "treatment", "locator", "24/7"],
  },
  {
    id: "substance-meta-house",
    category: "substance",
    type: "curated",
    title: "META House",
    provider: "META House Inc.",
    description:
      "Residential and outpatient substance abuse treatment for women in Milwaukee. Women can bring their children. Trauma-informed care.",
    phone: "(414) 847-9269",
    address: "2625 N Weil St, Milwaukee, WI 53212",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["substance", "treatment", "women", "children", "residential"],
    eligibility: "Women (children welcome)",
  },
  {
    id: "substance-st-charles",
    category: "substance",
    type: "curated",
    title: "St. Charles Youth & Family Services",
    provider: "St. Charles",
    description:
      "Substance abuse treatment, mental health services, and support for young adults and families in Milwaukee.",
    phone: "(414) 344-5575",
    address: "151 S 84th St, Milwaukee, WI 53214",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["substance", "mental-health", "youth", "family"],
  },

  // ════════════════════════════════════════════════════════════════════════
  // EDUCATION & TRAINING
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "edu-careeronestop",
    category: "education",
    type: "link",
    title: "CareerOneStop — Training Programs",
    provider: "U.S. Department of Labor",
    description:
      "Find job training programs, certifications, and apprenticeships near you. Free tool from the Department of Labor.",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["education", "training", "certification", "apprenticeship"],
  },
  {
    id: "edu-matc",
    category: "education",
    type: "curated",
    title: "Milwaukee Area Technical College (MATC)",
    provider: "MATC",
    description:
      "GED programs, technical certifications, and associate degrees. Campuses across Milwaukee. Financial aid available. Many programs are 1 year or less.",
    phone: "(414) 297-6282",
    address: "700 W State St, Milwaukee, WI 53233",
    hours: "Monday-Friday 8:00am - 4:30pm",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["education", "ged", "technical", "certification", "college"],
  },
  {
    id: "edu-wrtp",
    category: "education",
    type: "curated",
    title: "WRTP/BIG STEP",
    provider: "Wisconsin Regional Training Partnership",
    description:
      "Free job training for construction, manufacturing, and other trades in Milwaukee. Helps people with records get into union apprenticeships.",
    phone: "(414) 342-9787",
    address: "3841 W Wisconsin Ave, Milwaukee, WI 53208",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["education", "training", "trades", "construction", "manufacturing", "free"],
    eligibility: "Milwaukee County residents, priority for underemployed/records",
  },
  {
    id: "edu-goodwill-training",
    category: "education",
    type: "curated",
    title: "Goodwill TalentBridge",
    provider: "Goodwill Industries of SE Wisconsin",
    description:
      "Free job training, career coaching, and skills workshops. Programs include IT, healthcare, manufacturing, and customer service. Open to people with records.",
    phone: "(414) 847-4000",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["education", "training", "free", "it", "healthcare"],
  },
  {
    id: "edu-student-aid",
    category: "education",
    type: "link",
    title: "Federal Student Aid",
    provider: "U.S. Department of Education",
    description:
      "Apply for grants, loans, and work-study to pay for college or trade school. Most people with records ARE eligible for federal student aid.",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["education", "financial-aid", "grants", "college"],
  },

  // ════════════════════════════════════════════════════════════════════════
  // FINANCIAL LITERACY
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "financial-cfpb",
    category: "financial",
    type: "link",
    title: "CFPB Consumer Tools",
    provider: "Consumer Financial Protection Bureau",
    description:
      "Free tools for managing money — budgeting, credit scores, dealing with debt, avoiding scams. Trusted federal resource.",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["financial", "budgeting", "credit", "debt"],
  },
  {
    id: "financial-cfpb-toolkit",
    category: "financial",
    type: "link",
    title: "Your Money, Your Goals Toolkit",
    provider: "Consumer Financial Protection Bureau",
    description:
      "Free workbook with 43 tools and handouts for building financial skills. Covers budgeting, saving, credit, and debt. Written in plain language.",
    geo: "national",
    verifiedAt: "2026-03-14",
    tags: ["financial", "toolkit", "workbook", "free"],
  },
  {
    id: "financial-acts-housing",
    category: "financial",
    type: "curated",
    title: "ACTS Housing",
    provider: "ACTS Housing",
    description:
      "Free homebuyer counseling and financial coaching in Milwaukee. Helps people build credit, save for a down payment, and buy a home.",
    phone: "(414) 271-2287",
    address: "2717 S Chase Ave, Milwaukee, WI 53207",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["financial", "credit", "homebuyer", "free"],
  },
  {
    id: "financial-community-first",
    category: "financial",
    type: "curated",
    title: "Community First Credit Union",
    provider: "Community First CU",
    description:
      "Credit union that works with people who have been denied by traditional banks. Second-chance checking and savings accounts. No ChexSystems requirement.",
    phone: "(920) 830-7200",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["financial", "banking", "second-chance", "checking"],
  },

  // ════════════════════════════════════════════════════════════════════════
  // EMPLOYMENT HELP
  // ════════════════════════════════════════════════════════════════════════
  {
    id: "employ-ajc-milwaukee",
    category: "employment",
    type: "curated",
    title: "American Job Center — Milwaukee",
    provider: "Employ Milwaukee / U.S. DOL",
    description:
      "Free career counseling, resume help, job training referrals, and job fairs. Open to everyone. Extra programs for people with records.",
    phone: "(414) 270-1700",
    address: "2342 N 27th St, Milwaukee, WI 53210",
    hours: "Monday-Friday 8:00am - 4:30pm",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["employment", "job-center", "resume", "training", "free"],
  },
  {
    id: "employ-center-street-jobs",
    category: "employment",
    type: "curated",
    title: "Center Street Jobs",
    provider: "Center Street Jobs",
    description:
      "Connects Milwaukee residents with immediate employment opportunities. Walk-in welcome. Specializes in construction, warehouse, and labor positions.",
    phone: "(414) 988-5800",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["employment", "immediate", "walk-in", "construction", "warehouse"],
  },
  {
    id: "employ-dvr",
    category: "employment",
    type: "curated",
    title: "Division of Vocational Rehabilitation (DVR)",
    provider: "Wisconsin DWD",
    description:
      "Free employment services for people with disabilities. Includes job coaching, training, workplace accommodations, and job placement.",
    phone: "(414) 438-7150",
    geo: "wisconsin",
    verifiedAt: "2026-03-14",
    tags: ["employment", "disability", "rehabilitation", "free"],
    eligibility: "People with disabilities that affect employment",
  },
  {
    id: "employ-set-ministry",
    category: "employment",
    type: "curated",
    title: "SET Ministry",
    provider: "SET Ministry",
    description:
      "Job readiness program in Milwaukee focused on formerly incarcerated individuals. Includes job skills training, mentoring, and employer connections.",
    phone: "(414) 562-5070",
    address: "2935 N Dr Martin Luther King Jr Dr, Milwaukee, WI 53212",
    geo: "milwaukee",
    verifiedAt: "2026-03-14",
    tags: ["employment", "reentry", "formerly-incarcerated", "mentoring"],
    eligibility: "Formerly incarcerated individuals",
  },
];

// ─── Query Helpers ──────────────────────────────────────────────────────────

export function getResourcesByCategory(category: ResourceCategory): ResourceEntry[] {
  return RESOURCE_DIRECTORY.filter((r) => r.category === category);
}

export function getResourcesForBarriers(barriers: string[]): ResourceEntry[] {
  const relevantCategories = new Set<ResourceCategory>();
  for (const barrier of barriers) {
    const cats = BARRIER_CATEGORY_MAP[barrier];
    if (cats) cats.forEach((c) => relevantCategories.add(c));
  }

  return RESOURCE_DIRECTORY.filter((r) => relevantCategories.has(r.category));
}

export function getResourcesByGeo(geo: ResourceGeo): ResourceEntry[] {
  return RESOURCE_DIRECTORY.filter((r) => r.geo === geo);
}

export function searchResources(query: string): ResourceEntry[] {
  const lower = query.toLowerCase();
  return RESOURCE_DIRECTORY.filter(
    (r) =>
      r.title.toLowerCase().includes(lower) ||
      r.description.toLowerCase().includes(lower) ||
      r.tags.some((t) => t.includes(lower)) ||
      r.provider.toLowerCase().includes(lower)
  );
}
