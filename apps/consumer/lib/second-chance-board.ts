export type OpportunityCategory =
  | "warehouse"
  | "manufacturing"
  | "food_service"
  | "transportation"
  | "customer_service"
  | "trades"
  | "support";

export interface SecondChanceOpportunity {
  id: string;
  category: OpportunityCategory;
  title: string;
  employerExamples: string[];
  roles: string[];
  searchTerm: string;
  hiringSignal: "Public fair-chance signal" | "Case-by-case review" | "Partner-supported path";
  whyItFits: string;
  watchOut: string;
  bestMove: string;
  goodFor: string[];
  cautions: string[];
  sourceNote: string;
}

export const CATEGORY_LABELS: Record<OpportunityCategory | "all", string> = {
  all: "All",
  warehouse: "Warehouse",
  manufacturing: "Manufacturing",
  food_service: "Food Service",
  transportation: "Driving",
  customer_service: "Customer Service",
  trades: "Trades",
  support: "Support Paths",
};

export const SECOND_CHANCE_OPPORTUNITIES: SecondChanceOpportunity[] = [
  {
    id: "warehouse-fulfillment",
    category: "warehouse",
    title: "Warehouse and Fulfillment",
    employerExamples: ["Amazon", "UPS", "FedEx", "Goodwill", "Uline-style distributors"],
    roles: ["Warehouse Associate", "Picker/Packer", "Material Handler", "Shipping Clerk"],
    searchTerm: "Warehouse Associate",
    hiringSignal: "Case-by-case review",
    whyItFits:
      "Clear duties, fast hiring cycles, and measurable performance make this one of the most realistic starting lanes for many people rebuilding work history.",
    watchOut:
      "Some roles screen harder for theft, violence, recent charges, or driving duties. Apply broadly and keep a disclosure plan ready.",
    bestMove:
      "Lead with attendance, pace, safety, and production numbers. Build a resume around reliability and shift readiness.",
    goodFor: ["physical_work", "overtime", "no_degree", "employment_gap", "criminal_record"],
    cautions: ["transportation", "recent_theft", "recent_violence"],
    sourceNote: "Employer signals are based on public fair-chance commitments, workforce patterns, and pledge lists.",
  },
  {
    id: "manufacturing-production",
    category: "manufacturing",
    title: "Production and Light Manufacturing",
    employerExamples: ["Nehemiah Manufacturing", "Georgia-Pacific", "Koch companies", "JBM Packaging"],
    roles: ["Production Worker", "Machine Operator", "Assembler", "Packaging Associate"],
    searchTerm: "Production Worker",
    hiringSignal: "Public fair-chance signal",
    whyItFits:
      "Manufacturing employers often value attendance, safety, trainability, and supervisor references more than a perfect resume.",
    watchOut:
      "Machine, forklift, and regulated-site roles may require deeper checks. Night shifts can be easier entry points but harder on transportation.",
    bestMove:
      "Use work-history bullets that show output, safety, teamwork, and ability to follow process under pressure.",
    goodFor: ["physical_work", "skills", "no_degree", "criminal_record", "employment_gap"],
    cautions: ["transportation", "recent_violence", "active_supervision_schedule"],
    sourceNote: "Includes employers appearing in SHRM/Getting Talent Back to Work pledge references.",
  },
  {
    id: "food-back-house",
    category: "food_service",
    title: "Back-of-House Food Service",
    employerExamples: ["Local restaurants", "Institutional kitchens", "Hotels", "Caterers"],
    roles: ["Line Cook", "Prep Cook", "Dishwasher", "Kitchen Helper"],
    searchTerm: "Prep Cook",
    hiringSignal: "Case-by-case review",
    whyItFits:
      "Kitchen hiring can move quickly, rewards skill proof, and often gives people a chance to demonstrate reliability before advancement.",
    watchOut:
      "Schedules can be unstable. Some hospitality roles screen harder when alcohol, cash handling, or vulnerable populations are involved.",
    bestMove:
      "Bring a simple resume, ask for a working interview when appropriate, and practice a short answer for gaps or record questions.",
    goodFor: ["food_service", "no_degree", "employment_gap", "criminal_record", "bus_commute"],
    cautions: ["substance_recovery", "late_nights"],
    sourceNote: "Pattern-based lane; verify each employer and role before relying on it.",
  },
  {
    id: "cdl-delivery-path",
    category: "transportation",
    title: "Delivery and CDL Pathways",
    employerExamples: ["Paper Transport", "Waste Management", "Sysco-style distributors", "Local courier fleets"],
    roles: ["Driver Helper", "Delivery Assistant", "CDL Trainee", "Route Assistant"],
    searchTerm: "Driver Helper",
    hiringSignal: "Public fair-chance signal",
    whyItFits:
      "Driver-helper and warehouse-to-driver paths let someone start near transportation work even when a license, insurance, or record issue blocks immediate driving.",
    watchOut:
      "Driving roles are record-sensitive. DUI, recent drug charges, license status, and insurance rules matter.",
    bestMove:
      "Start with helper roles, get attendance wins, then ask about CDL support or internal transfer paths.",
    goodFor: ["physical_work", "growth", "overtime", "criminal_record"],
    cautions: ["dui", "license_issue", "recent_drug_charge"],
    sourceNote: "Includes pledge-listed transportation employers and common workforce entry paths.",
  },
  {
    id: "customer-service-call-center",
    category: "customer_service",
    title: "Call Center and Customer Support",
    employerExamples: ["Televerde", "Local call centers", "Utilities contractors", "Retail support desks"],
    roles: ["Customer Service Representative", "Call Center Agent", "Scheduler", "Intake Specialist"],
    searchTerm: "Customer Service Representative",
    hiringSignal: "Public fair-chance signal",
    whyItFits:
      "Phone support can convert communication skills into a cleaner career path, especially for people moving out of physical labor.",
    watchOut:
      "Finance, healthcare, government, and roles handling sensitive data often screen harder.",
    bestMove:
      "Practice concise answers out loud. Build resume bullets around de-escalation, documentation, and attendance.",
    goodFor: ["communication", "remote_interest", "career_growth", "employment_gap"],
    cautions: ["fraud_theft_financial", "data_access"],
    sourceNote: "Includes second-chance public examples plus role-risk guidance.",
  },
  {
    id: "trades-helper",
    category: "trades",
    title: "Trades Helper and Apprenticeship Entry",
    employerExamples: ["Construction contractors", "Restoration companies", "Landscaping crews", "Union pre-apprenticeships"],
    roles: ["Construction Laborer", "Apprentice Helper", "Maintenance Assistant", "Restoration Tech"],
    searchTerm: "Construction Laborer",
    hiringSignal: "Partner-supported path",
    whyItFits:
      "The trades can reward consistency and skill growth. A helper role can become a credentialed path without needing a traditional degree.",
    watchOut:
      "Transportation, tools, early start times, and safety-site rules can block good candidates if not planned.",
    bestMove:
      "Use the board to find openings, then ask workforce centers or reentry partners about paid training and tool support.",
    goodFor: ["physical_work", "growth", "no_degree", "criminal_record"],
    cautions: ["transportation", "license_issue", "childcare_schedule"],
    sourceNote: "Based on workforce-entry patterns; local partner verification matters.",
  },
  {
    id: "honest-jobs-support",
    category: "support",
    title: "Fair-Chance Job Platforms",
    employerExamples: ["Honest Jobs", "70 Million Jobs-style boards", "LinkedIn fair-chance filter"],
    roles: ["Any matched role", "Second chance jobs", "Fair chance hiring"],
    searchTerm: "Second Chance",
    hiringSignal: "Partner-supported path",
    whyItFits:
      "Specialized boards and filters reduce wasted applications by starting with employers that publicly signal openness to applicants with records.",
    watchOut:
      "A fair-chance label is not a guarantee. The specific job, offense relationship, timing, and background-check vendor still matter.",
    bestMove:
      "Use these sources for leads, then return here to tailor the resume, practice the interview, and plan disclosure.",
    goodFor: ["criminal_record", "research", "employment_gap"],
    cautions: ["false_positive_employer_lists"],
    sourceNote: "LinkedIn and public fair-chance boards maintain separate employer signals.",
  },
];

export function rankSecondChanceOpportunities(context: {
  careerTitles?: string[];
  skills?: string[];
  barriers?: string[];
}): SecondChanceOpportunity[] {
  const careerText = (context.careerTitles || []).join(" ").toLowerCase();
  const skillText = (context.skills || []).join(" ").toLowerCase();
  const barriers = new Set(context.barriers || []);

  return [...SECOND_CHANCE_OPPORTUNITIES].sort((a, b) => {
    const score = (item: SecondChanceOpportunity) => {
      let total = 0;
      const haystack = `${item.title} ${item.roles.join(" ")} ${item.searchTerm}`.toLowerCase();
      if (careerText && haystack.split(" ").some((word) => careerText.includes(word))) total += 4;
      if (skillText && item.goodFor.some((tag) => skillText.includes(tag.replace("_", " ")))) total += 2;
      if (barriers.has("criminal_record") && item.goodFor.includes("criminal_record")) total += 3;
      if (barriers.has("transportation") && item.cautions.includes("transportation")) total -= 1;
      if (barriers.has("no_degree") && item.goodFor.includes("no_degree")) total += 2;
      if (barriers.has("employment_gap") && item.goodFor.includes("employment_gap")) total += 2;
      return total;
    };
    return score(b) - score(a);
  });
}
