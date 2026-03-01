/**
 * Demo Mode Sample Data — "Jordan"
 *
 * A complete ForgeSession with realistic data for partner/observer
 * demo walkthroughs. Pre-filled so no user input is required.
 */

import type { ForgeSessionData } from "./forge-context";

export const DEMO_SESSION: ForgeSessionData = {
  // Page 1: Readiness
  readinessStage: "preparation",

  // Page 2: Resume
  resumeText: `Jordan Mitchell
Milwaukee, WI | (414) 555-0192

WORK EXPERIENCE

Warehouse Associate — Regional Distribution Co., Milwaukee, WI
June 2021 – Present (3 years)
• Operate forklifts and pallet jacks to move inventory across 200,000 sq ft facility
• Trained 4 new hires on safety protocols and inventory management systems
• Maintained 99.2% order accuracy rate over 18-month period
• Promoted to informal team lead for night shift (8-person crew)

Maintenance Helper — Kenosha County Parks, Kenosha, WI
March 2020 – May 2021
• Performed grounds maintenance, equipment repair, and facility upkeep
• Coordinated with full-time staff on seasonal project schedules

EDUCATION
GED — Milwaukee Area Technical College, 2019

CERTIFICATIONS
• OSHA Forklift Certification (current)
• Warehouse Inventory Management — Regional Distribution Co. internal training

SKILLS
Forklift operation, inventory systems (WMS), team leadership, safety compliance, equipment maintenance`,
  resumeFileName: "jordan-mitchell-resume.pdf",
  resumeMethod: "upload",

  // Page 3: Goals
  goals: ["stability", "growth"],
  goalNarrative:
    "I want something stable where I can move up. I've been doing warehouse work for a few years and I'm good at it, but I want to get into logistics management or supply chain. I like leading people and solving problems when things go wrong on the floor.",

  // Page 4: Story
  challenges: ["criminal_record", "employment_gap"],
  criminalRecord: {
    type: "felony",
    charge_count: "1",
    most_recent: "3-5 years",
    supervision: "completed",
    context:
      "One felony conviction from 2020. Completed all supervision requirements. Haven't had any issues since.",
  },
  challengeNarratives: {
    employment_gap:
      "There's about a year gap from 2019-2020 while I was dealing with court stuff and getting my GED.",
  },

  // Page 5: Preferences
  preferences: {
    schedule: "full-time",
    environment: "physical",
    commute: "short-drive",
    location: "Milwaukee, WI",
  },

  // Audience & tracking
  audience: "partner",
  isDemo: true,
  pagesVisited: [
    "welcome",
    "resume",
    "goals",
    "story",
    "preferences",
    "processing",
    "output",
  ],
  startedAt: new Date().toISOString(),
  lastPageVisited: "output",
  consentGranted: true,
};

/**
 * Pre-generated Forge output for demo mode.
 * Skips the /api/analyze call entirely.
 */
export const DEMO_OUTPUT = {
  schema_version: "forge_output.v1",
  generated_at: new Date().toISOString(),
  narrative: {
    headline: "A Leader on the Rise",
    summary:
      "Jordan brings three years of consistent warehouse operations experience with a track record that speaks louder than any title. Training new hires, maintaining 99.2% accuracy, and leading an 8-person night crew — all without the formal promotion. The pattern is clear: Jordan doesn't wait to be told to lead. He steps up, solves problems, and makes people around him better. The gap in his timeline isn't a weakness — it's context. What came after it is what matters: a GED, certifications, steady work, and upward trajectory.",
    reflection:
      "Jordan's story follows what researchers call a 'redemption sequence' — a narrative arc where difficult experiences become the foundation for positive change. His goals aren't about escaping his past; they're about building on what he's already proven he can do.",
    strengths: [
      {
        title: "Natural Team Leader",
        evidence:
          "Promoted to informal team lead for night shift (8-person crew). Trained 4 new hires on safety protocols.",
        source: "resume" as const,
      },
      {
        title: "Exceptional Accuracy Under Pressure",
        evidence:
          "Maintained 99.2% order accuracy rate over 18 months in a high-volume distribution facility.",
        source: "resume" as const,
      },
      {
        title: "Self-Directed Growth",
        evidence:
          "Earned GED, obtained forklift certification, and completed internal training — all self-initiated after a difficult period.",
        source: "ai_inferred" as const,
      },
    ],
  },
  strengths: [
    {
      title: "Natural Team Leader",
      evidence:
        "Promoted to informal team lead for night shift (8-person crew). Trained 4 new hires on safety protocols.",
      source: "resume",
    },
    {
      title: "Exceptional Accuracy Under Pressure",
      evidence:
        "Maintained 99.2% order accuracy rate over 18 months in a high-volume distribution facility.",
      source: "resume",
    },
    {
      title: "Self-Directed Growth",
      evidence:
        "Earned GED, obtained forklift certification, and completed internal training — all self-initiated after a difficult period.",
      source: "ai_inferred",
    },
  ],
  skills: [
    { name: "Forklift Operation (OSHA Certified)", category: "hard" as const },
    {
      name: "Warehouse Management Systems (WMS)",
      category: "hard" as const,
    },
    { name: "Inventory Management", category: "hard" as const },
    { name: "Equipment Maintenance", category: "hard" as const },
    { name: "Team Leadership", category: "soft" as const },
    { name: "New Hire Training", category: "soft" as const },
    { name: "Safety Compliance", category: "transferable" as const },
    { name: "Problem Solving", category: "transferable" as const },
    { name: "Process Optimization", category: "transferable" as const },
  ],
  barriers: [
    {
      type: "criminal_record",
      user_narrative:
        "One felony conviction from 2020. Completed all supervision requirements.",
      resources: [
        {
          name: "Wisconsin Fair Chance Hiring Guide",
          type: "legal",
          description:
            "Wisconsin restricts when employers can ask about criminal history. Milwaukee County has additional ban-the-box protections for county positions.",
        },
        {
          name: "Careeronestop.org — Reentry Resources",
          type: "federal",
          description:
            "U.S. DOL resource for justice-impacted job seekers with state-specific information.",
        },
        {
          name: "HIRE Network (National)",
          type: "nonprofit",
          description:
            "Legal information and resources for people with criminal records seeking employment.",
        },
      ],
      legal_notes:
        "With a single felony conviction 3-5 years ago and completed supervision, Jordan is in a strong position. Many employers' lookback windows are 5-7 years. Ban-the-box laws in Milwaukee delay criminal history inquiry until after conditional offer.",
    },
    {
      type: "employment_gap",
      user_narrative:
        "About a year gap from 2019-2020 while dealing with court stuff and getting GED.",
      resources: [
        {
          name: "Gap Framing Strategy",
          type: "coaching",
          description:
            "Frame the gap around what was accomplished during it: GED completion, personal development, and preparation for re-entry into the workforce.",
        },
      ],
      legal_notes: "",
    },
  ],
  career_paths: [
    {
      title: "Logistics Coordinator",
      industry: "Supply Chain & Logistics",
      match_reason:
        "Direct pathway from warehouse operations. Jordan's accuracy rate, team leadership, and WMS experience are exactly what logistics coordinator roles require. Many positions in Milwaukee's distribution corridor.",
      salary_range: "$42,000 - $58,000",
      next_steps: [
        "Look into APICS CSCP certification (supply chain professional)",
        "Ask current employer about internal logistics coordinator openings",
        "Register on Indeed with 'logistics coordinator Milwaukee' alerts",
      ],
    },
    {
      title: "Warehouse Supervisor",
      industry: "Distribution & Warehousing",
      match_reason:
        "Already functioning as an informal team lead. Formalization of this role is the shortest path to higher pay and title. Forklift certification and safety training are prerequisites already met.",
      salary_range: "$45,000 - $62,000",
      next_steps: [
        "Request formal team lead or shift supervisor title from current employer",
        "Document training and leadership contributions for resume update",
        "Explore warehouse supervisor openings at larger distribution centers",
      ],
    },
    {
      title: "Operations Associate → Operations Manager",
      industry: "Manufacturing & Operations",
      match_reason:
        "Transferable skills in process optimization, team coordination, and equipment management. Manufacturing operations in Milwaukee metro area are actively hiring. Longer pathway but higher ceiling.",
      salary_range: "$38,000 - $55,000 (associate) → $65,000+ (manager)",
      next_steps: [
        "Research Lean Six Sigma Yellow Belt certification (many free courses)",
        "Apply to operations associate roles at mid-size manufacturers",
        "Build on equipment maintenance skills — cross-training adds value",
      ],
    },
  ],
};
