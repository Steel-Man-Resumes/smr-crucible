/**
 * Mock AI responses for zero-cost development testing.
 *
 * Usage: set MOCK_AI=true in apps/consumer/.env.local
 *
 * All fixtures are based on "Jordan" — the canonical demo persona:
 * warehouse associate, Milwaukee WI, felony record (1 count, 3-5 years ago),
 * preparation stage, goals: stability + growth.
 *
 * To use: call isMockEnabled() before any AI API call.
 */

export function isMockEnabled(): boolean {
  return process.env.MOCK_AI === "true";
}

export const MOCK_FORGE_OUTPUT = {
  schema_version: "forge_output.v1",
  generated_at: new Date().toISOString(),
  readiness_stage: "preparation",
  narrative: {
    headline: "Operations professional with 8 years of warehouse and logistics experience",
    summary:
      "Jordan brings hands-on expertise in warehouse operations, inventory management, and team coordination. Known for reliability and efficiency, with a track record of meeting production targets in fast-paced environments.",
    reflection:
      "You described wanting stability for your family while building toward something more. That combination tells me a lot — you want roots and runway at the same time.",
    strengths: [
      {
        title: "Operational reliability",
        evidence: "8 years in warehouse environments across multiple employers",
        source: "resume",
      },
      {
        title: "Physical endurance and safety awareness",
        evidence: "Forklift certified, OSHA-10 training, zero reported incidents",
        source: "resume",
      },
      {
        title: "Team coordination",
        evidence: "Trained 4 new hires at last position",
        source: "resume",
      },
    ],
  },
  strengths: [
    { title: "Operational reliability", evidence: "8 years across 3 employers", source: "resume" },
    { title: "Forklift certification", evidence: "Current OSHA-10, forklift licensed", source: "resume" },
    { title: "Team training", evidence: "Trained 4 new hires at last position", source: "resume" },
  ],
  skills: [
    { name: "Forklift operation", category: "hard" },
    { name: "Inventory management", category: "hard" },
    { name: "OSHA safety compliance", category: "hard" },
    { name: "Pallet jack / reach truck", category: "hard" },
    { name: "Team training", category: "soft" },
    { name: "Problem-solving under pressure", category: "soft" },
    { name: "Reliability", category: "soft" },
    { name: "Physical endurance", category: "transferable" },
    { name: "Process adherence", category: "transferable" },
  ],
  career_paths: [
    {
      title: "Warehouse Lead / Shift Supervisor",
      industry: "Logistics & Distribution",
      match_reason:
        "Your training background and 8 years of floor experience position you above entry level. Supervisory roles build on what you already do.",
      salary_range: "$42,000-$55,000/year",
      next_steps: [
        "Target Amazon, FedEx, and Sysco — all are Fair Chance Pledge signatories",
        "Update resume to highlight the 4 hires you trained",
        "Ask about internal advancement track during interviews",
      ],
    },
    {
      title: "Logistics Coordinator",
      industry: "Supply Chain",
      match_reason:
        "Inventory and coordination skills transfer directly. This role moves you off the floor into operations management with higher ceiling.",
      salary_range: "$45,000-$62,000/year",
      next_steps: [
        "Consider a free APICS CPIM prep course online",
        "Apply to mid-size distributors in Milwaukee metro area",
        "Your forklift cert is a differentiator in this role",
      ],
    },
    {
      title: "CDL-A Driver (Class A Truck Driver)",
      industry: "Transportation",
      match_reason:
        "Physical reliability + logistics experience = strong CDL candidate. 10+ years shortage means employers are flexible on background for the right person.",
      salary_range: "$55,000-$78,000/year",
      next_steps: [
        "CDL-A training programs in Milwaukee: MATC, TransAm Trucking (paid CDL program)",
        "Felony records: most carriers review case-by-case; older non-violent records rarely disqualify",
        "Wisconsin MVR check recommended before applying",
      ],
    },
  ],
  barriers: [
    {
      type: "criminal_record",
      user_narrative: "Felony from 4 years ago. Paid my debt. Moving forward.",
      resources: [
        {
          name: "Legal Action of Wisconsin",
          type: "legal_aid",
          description:
            "Free legal help for expungement eligibility under WI §973.015. Call (414) 278-7722 or visit legalactionwi.org.",
        },
        {
          name: "Milwaukee County Reentry Council",
          type: "reentry_support",
          description:
            "Coordinates services across 40+ reentry orgs in Milwaukee. Starting point for navigation. reentrycouncil.org",
        },
        {
          name: "Nehemiah Manufacturing",
          type: "employer",
          description:
            "Cincinnati-based manufacturer, Milwaukee area. 70%+ of workforce justice-impacted. Entry-level manufacturing + advancement track.",
        },
      ],
      legal_notes:
        "Wisconsin ban-the-box applies to state and county government employers. Milwaukee city ordinance extends to private employers with 15+ employees. A felony 3-5 years old may qualify for expungement under WI §973.015 — contact Legal Action of Wisconsin to assess eligibility.",
    },
  ],
};

export const MOCK_JOB_RESULTS = {
  jobs: [
    {
      id: "mock-job-1",
      title: "Warehouse Associate",
      company: "Amazon",
      location: "Kenosha, WI",
      salary: "$18-22/hr",
      description:
        "Pick, pack, and ship customer orders. Physical work, set schedule, full benefits from day one.",
      requirements: ["Able to lift 50 lbs", "Steel-toed boots required", "No experience needed"],
      benefits: ["Health insurance day 1", "401k", "Career Choice tuition program"],
      employment_type: "Full-time",
      posted: "2 days ago",
      second_chance: true,
      fair_chance_reason:
        "Amazon is a Fair Chance Pledge signatory. They review backgrounds individually and do not auto-disqualify for older records.",
      remote: false,
    },
    {
      id: "mock-job-2",
      title: "Forklift Operator",
      company: "Sysco Foods",
      location: "Milwaukee, WI",
      salary: "$20-25/hr",
      description: "Operate forklift in a food distribution warehouse. Day shift available.",
      requirements: ["Forklift certified", "Warehouse experience preferred", "Food safety awareness"],
      benefits: ["Full benefits", "Overtime available", "Union position"],
      employment_type: "Full-time",
      posted: "Today",
      second_chance: true,
      fair_chance_reason:
        "Sysco participates in fair-chance hiring initiatives and evaluates records individually.",
      remote: false,
    },
    {
      id: "mock-job-3",
      title: "Production Worker",
      company: "Quad/Graphics",
      location: "Sussex, WI",
      salary: "$17-19/hr",
      description: "Manufacturing production line work. Second shift (2pm-10pm). Consistent schedule.",
      requirements: ["Able to stand for full shift", "Team player", "Drug test required"],
      benefits: ["Health/dental/vision", "Shift differential", "Annual raises"],
      employment_type: "Full-time",
      posted: "3 days ago",
      second_chance: false,
      fair_chance_reason: null,
      remote: false,
    },
  ],
  fair_chance_info:
    "Milwaukee city's ban-the-box ordinance requires employers with 15+ employees to wait until after a conditional job offer to run a background check. You have the right to explain your record before a hiring decision is made.",
  source: "mock",
};

export const MOCK_DISCLOSURE_PLAN = {
  timing_advice:
    "With a felony 3-5 years old and Milwaukee as your location, wait until after you receive a conditional job offer before disclosing. Milwaukee's ban-the-box ordinance requires this for employers with 15+ staff. This gives you time to demonstrate your value first.",
  legal_context:
    "WI ban-the-box (2016) applies to state/county government employers. Milwaukee city ordinance extends to private employers with 15+ employees. Expungement: under WI §973.015, your charge may qualify if committed under age 25 or for certain offense classes. Contact Legal Action of Wisconsin — free, (414) 278-7722.",
  script:
    "I want to be upfront with you. I have a felony on my record from about four years ago. I handled it, completed everything required, and I've been focused on moving forward ever since. What I want you to know about me now is: I've got eight years of warehouse experience, I've trained people on the job, and I show up. I'm applying here because I genuinely want to build something here.",
  tips: [
    "Practice the script out loud 5-10 times before the interview — natural delivery matters more than perfect words",
    "Pivot immediately to your strengths after the disclosure — don't linger or over-explain",
    "If asked for details, answer briefly and redirect: 'I'd rather focus on what I bring to this role'",
    "Research the company's ban-the-box policy before applying — many post it in their careers section",
  ],
};

export const MOCK_FOLLOW_UP = {
  subject: "Following up -- Warehouse Associate application",
  body: "Hi,\n\nI wanted to follow up on my application for the Warehouse Associate role I submitted last week. I'm still very interested and would welcome the chance to talk about how my eight years of warehouse experience could help your team.\n\nPlease let me know if there's anything else you need from me. Thank you for your time.\n\nBest,\nJordan Williams",
};

export const MOCK_RESUME = `Jordan M. Williams
Milwaukee, WI | (414) 555-0192 | jordan.williams@email.com

SUMMARY
Operations professional with 8 years of warehouse and logistics experience. Forklift certified, OSHA-10 trained, and proven in high-volume environments. Known for reliability, team training, and consistent performance under pressure.

EXPERIENCE

Warehouse Associate — US Foods, Milwaukee, WI (2022–Present)
- Processed 400+ orders per shift with 98.7% accuracy rate
- Trained 4 new hires on safety protocols and picking procedures
- Maintained forklift certification; zero safety incidents over 2 years

Warehouse Worker — Uline, Waukesha, WI (2019–2022)
- Operated reach truck, electric pallet jack, and stand-up forklift
- Supported inventory audits with 99.2% count accuracy
- Recognized as Employee of the Month, March 2021

General Laborer — Manpower Staffing (various sites), 2018–2019
- Placed in multiple warehouse environments; retained by 3 clients
- Adapted quickly to different facilities and safety protocols

SKILLS
Forklift Certification (current) | OSHA-10 | Inventory Management
Pick/Pack | Pallet Building | Reach Truck | Stand-Up Forklift | Electric Pallet Jack
Team Training | Process Adherence | Reliability

EDUCATION
GED, 2017`;
