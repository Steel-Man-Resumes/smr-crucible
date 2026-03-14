/**
 * Tour Stop Definitions
 *
 * Each stop maps to a real page in the app.
 * Narration explains what's happening at each step.
 * The tour runs ON TOP of the real app with demo data loaded.
 */

export interface TourStop {
  id: string;
  page: string;           // Route to navigate to
  title: string;          // Short title for progress indicator
  narration: string;      // What the floating panel says
  detail?: string;        // Optional second paragraph for deeper explanation
  section: "forge" | "refinery";
}

export const TOUR_STOPS: TourStop[] = [
  // ── THE FORGE ─────────────────────────────────────────────────────────
  {
    id: "intro",
    page: "/intro",
    title: "Meet t.ROY",
    narration:
      "This is where every user starts. t.ROY introduces the tool and asks one question: who are you? Three paths — client, partner, or observer — each get a different experience.",
    section: "forge",
  },
  {
    id: "welcome",
    page: "/welcome?demo=true",
    title: "Readiness Check",
    narration:
      "We assess readiness using Prochaska's Stages of Change. Jordan is in 'Preparation' — ready to take action but needs a plan. This shapes everything downstream.",
    detail:
      "The tool adapts its tone, suggestions, and pacing to the user's stage. Someone in precontemplation gets gentler nudges. Someone in action gets direct next steps.",
    section: "forge",
  },
  {
    id: "resume",
    page: "/resume?demo=true",
    title: "Resume Intake",
    narration:
      "Five ways to share your experience: paste text, upload a file, import from LinkedIn or Indeed, or build from scratch with a guided form. Jordan uploaded a PDF.",
    section: "forge",
  },
  {
    id: "goals",
    page: "/goals?demo=true",
    title: "Goals",
    narration:
      "Goals drive everything downstream. Jordan wants stability and growth. The AI uses this to match career paths, filter jobs, and prioritize resources.",
    section: "forge",
  },
  {
    id: "story",
    page: "/story?demo=true",
    title: "Barriers",
    narration:
      "This is the hard part — and the most important. Jordan has a felony and an employment gap. The tool uses this to find the right legal resources, flag fair-chance employers, and build a disclosure script.",
    detail:
      "Everything shared here stays private. No case managers, no parole officers, no employers see this data.",
    section: "forge",
  },
  {
    id: "output",
    page: "/output?demo=true",
    title: "Forge Results",
    narration:
      "Four AI analyses ran in parallel: narrative generation, skills mapping, career path matching, and barrier-to-resource connecting. Jordan got a rewritten professional summary, 12 skills identified, 4 career paths, and resources matched to each barrier.",
    section: "forge",
  },

  // ── THE REFINERY ──────────────────────────────────────────────────────
  {
    id: "dashboard",
    page: "/dashboard",
    title: "Dashboard",
    narration:
      "The Refinery is where the real work happens. Eight tools, all fed by the Forge data. The dashboard shows Jordan's narrative, skills, career paths, and saved work.",
    section: "refinery",
  },
  {
    id: "jobs",
    page: "/dashboard/jobs",
    title: "Job Board",
    narration:
      "Real job listings from JSearch API — actual Indeed and LinkedIn postings, not AI-generated suggestions. Fair-chance employers are highlighted and sorted first. Everything stays in-app — no external links.",
    detail:
      "Save jobs you like. Mark when you apply. The Application Tracker follows each job through your pipeline.",
    section: "refinery",
  },
  {
    id: "resources",
    page: "/dashboard/resources",
    title: "Resources",
    narration:
      "Verified local resources for Milwaukee and Waukesha. Real organizations with real phone numbers, addresses, and hours. Matched to Jordan's barriers — housing and legal aid surfaced first.",
    detail:
      "Every resource is verified. Users can report issues. Local organizations can get listed through a simple form.",
    section: "refinery",
  },
  {
    id: "resume-builder",
    page: "/dashboard/resume-builder",
    title: "Resume Builder",
    narration:
      "The Forge data is already loaded — professional summary, skills, and work history pre-populated. Jordan refines the resume for a specific job, not starting from scratch. AI suggestions fade as the user builds confidence.",
    section: "refinery",
  },
  {
    id: "disclosure",
    page: "/dashboard/disclosure",
    title: "Disclosure Planner",
    narration:
      "For people with records, disclosure is the hardest conversation. This tool generates a timing strategy, a legal context summary, and a practice script. Then you rehearse with an AI hiring manager.",
    section: "refinery",
  },
  {
    id: "interview",
    page: "/dashboard/interview",
    title: "Interview Practice",
    narration:
      "AI mock interviews with real feedback. Four types: general, behavioral STAR, industry-specific, and disclosure-focused. The AI adjusts follow-up questions based on your answers and gives structured feedback after 5-6 exchanges.",
    section: "refinery",
  },
  {
    id: "progress",
    page: "/dashboard/progress",
    title: "Progress & Quick Wins",
    narration:
      "Not just a scoreboard. Personalized quick wins tell the user exactly what to do next, based on their readiness stage, barriers, and activity. A visual roadmap shows the full journey from foundation to momentum.",
    section: "refinery",
  },
  {
    id: "security",
    page: "/dashboard/security",
    title: "Security & Privacy",
    narration:
      "Trust is everything for this population. This page explains exactly what data is collected, who can see it (nobody), where it lives, and how to export or delete everything. Written at a 6th grade reading level.",
    section: "refinery",
  },
];
