/**
 * Demo fix T1 (2026-10-28): the exact staff t.ROY answers that showed false
 * "Check these before you use them" warnings on production 75dcfc5, and the
 * tool results the server returned for them (shapes as find_employers and
 * read_participant_overview return them). Fictional people only; employers
 * are public directory listings named as places.
 */
import type { OrgFacts } from "../org-output-verify";

export const LUPE: OrgFacts = {
  caseload: 2, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0,
  visibleNames: ["Jean", "Marqus"], staffNames: ["Lupe"], orgName: "Southside Bridge",
};

export const EMPLOYERS_RESULT = {
  status: "ok", readAt: "2026-10-28T20:00:00Z", asOf: "2026-10-27", state: "MI", q: null, markFirst: true,
  employers: [
    { id: "e1", employer: "Eaton Corporation", industry: "Manufacturing", city: "Jackson", location: "Jackson, MI", band: "B", howSure: "Reported hiring evidence, below our mark", lastChecked: "2026-09-15", recheckBy: "2026-12-14", roles: ["Assembler", "Machine Operator"], evidence: "Official second-chance policy: no conviction questions before an offer, individualized review after one. Applies to the Hydraulics and Aerospace facilities per job postings.", caveats: null, apply: "https://example.com/apply", source: "https://example.com/eaton-second-chance" },
    { id: "e2", employer: "Kelly Services", industry: "Staffing", city: "Jackson", location: "Jackson, MI", band: "B", howSure: "Reported hiring evidence, below our mark", lastChecked: "2026-09-15", recheckBy: "2026-12-14", roles: ["Light Industrial"], evidence: "Runs the Kelly 33 second-chance program and belongs to the Second Chance Business Coalition. Covers candidates with non-violent, non-relevant records.", caveats: "Staffing agency. Screening steps come from a company press release; confirm with the branch.", apply: null, source: "https://example.com/kelly" },
    { id: "e3", employer: "Eastside Fish Fry & Grill", industry: "Restaurant", city: "Lansing", location: "Lansing, MI", band: "A", howSure: "Hires people with records (our mark: dated evidence that meets our rule, where it was found)", lastChecked: "2026-10-22", recheckBy: "2027-01-20", roles: [], evidence: "The employer's own site says they hire people with records.", caveats: "The page uses the owner's own words.", apply: null, source: null },
  ],
  more: false,
};

export const OVERVIEW_RESULT = {
  status: "ok", readAt: "2026-10-28T20:00:00Z", participantId: "11111111-2222-3333-4444-555555555555", logged: true,
  person: { firstName: "Jean", joinedOn: "2026-10-20", assignedToYou: true, caseManager: "Lupe", station: "Find work", nextStepTheySee: null, progress: { applications: 3, savedJobs: 5, practiceSessions: 3, hasTailoredResume: true, lastActiveAt: "2026-10-29" }, progressShared: true },
  openTasks: [{ title: "Bring your ID to STS", dueOn: null, shared: true }],
  asks: [], suggestions: [],
  recentNotes: [{ author: "Lupe", on: "2026-10-27", body: "Joined and shared applications and resume. The STS interview is from his tracker only; details not confirmed. Review what he needs to bring." }],
  notesTotal: 1,
  applications: [
    { jobTitle: "Production Supervisor (1st & 2nd Shifts)", company: "STS Technical Services", status: "interviewing", statusUpdatedAt: "2026-10-24" },
    { jobTitle: "Forklift Driver", company: "RR Donnelley", status: "applied", appliedAt: "2026-10-24" },
    { jobTitle: "Maintenance Technician", company: "On-site Staffing Services", status: "applied", appliedAt: "2026-10-25" },
    { jobTitle: "Shop Technician", company: "Snap On", status: "saved" },
    { jobTitle: "Warehouse Associate", company: "ALogix", status: "saved" },
    { jobTitle: "Material Handler", company: "Ogden", status: "saved" },
  ],
  applicationsShared: true,
  placements: [],
};

/** The answers exactly as production showed them (POST-RELEASE-TRANSCRIPT-75dcfc5, LUPE-AI-TRANSCRIPT-2026-10-28), footer removed. */
export const ANSWERS = {
  layout: `"Your tasks" is already first on Today, shown and unfolded, so nothing needed changing. The order right now is Your tasks, Retention check-ins due, Referrals past due, then the rest. If you want a different section up top, tell me which one.`,
  jacksonAsk: `Which state is Jackson in? The directory search needs a two-letter state, and there is a Jackson in more than one. I also need to correct my last answer. I never read your Today layout, so I had no basis for saying your tasks were already first or for listing that section order. Ignore that answer. If you still want your tasks first, I'll check your setup and make the change.`,
  jackson: `Two Jackson, MI listings came back. Neither carries our hiring mark. Both are "Reported hiring evidence, below our mark." 1. **Eaton Corporation (Jackson, MI).** The evidence is an official second-chance policy with no conviction questions before an offer, and an individualized review after one. It applies to the Hydraulics and Aerospace facilities per job postings. Checked Sep 15, 2026. Recheck by Dec 14, 2026. 2. **Kelly Services (Jackson, MI branch).** It runs the "Kelly 33" second-chance program and belongs to the Second Chance Business Coalition. Its listing says the program covers candidates with non-violent, non-relevant records. Kelly is a staffing agency. The listing says the screening steps come from a company press release, so confirm them with the branch. Checked Sep 15, 2026. Recheck by Dec 14, 2026. A mark describes how an employer has hired where the evidence was found. It never promises a job or that anyone's record will be accepted. Check each listing before you send someone. This is only what our directory holds. A short list does not mean nobody else in Jackson hires people with records. Next step is yours. If you call either place, I can draft a directory update card for you to check and send.`,
  lansing: `Your tasks section is first on Today. I checked your view this time, so that earlier answer now holds up. I found one Lansing employer in the directory: **Eastside Fish Fry & Grill**, Lansing, restaurant. It carries our mark: it hires people with records. The evidence is from the employer's own site, checked Oct 22, 2026, and it needs a recheck by Jan 20, 2027. The caveat is that the page uses the owner's own words. No roles are listed. A mark describes how this employer has hired where we found the evidence. It doesn't promise a job or that anyone's record will be accepted, so check the listing before you send someone. One result is a gap in our directory. It doesn't mean nobody else in Lansing hires people with records. Next step is yours. If you use this listing for someone, tell me who and I can draft a handoff for you to review and send.`,
  undo: `Here is what I can do: 1. Triage your Today and caseload, prep you for one person, and summarize what changed or their timeline. 2. Draft case notes, check-ins, emails, handoffs, and funder narratives from real numbers. 3. Find local help and employers that hire people with records, and open pages or forms like Add people. I can also change how your own screens look, with Undo. Saving, sending, and inviting stay with you.`,
  prep: `**Where they are.** Jean (Valjean) is at "Find work" and shares progress. He was last active Thu Oct 29. He has a tailored resume, 5 saved jobs, 3 applications and 3 practice sessions (from his shared progress, Oct 29). No next step is showing for him. **What is coming.** Nothing dated on file. No interview date or follow-up date is recorded. **What is open.** - Your task "Bring your ID to STS" has no due date and he can see it. - He has no open asks or suggestions. - His tracker shows STS Technical Services, Production Supervisor (1st & 2nd Shifts), as "interviewing" (updated Oct 24). Your Oct 27 note says you have not confirmed the interview details. - He has applied to RR Donnelley, Forklift Driver (Oct 24), and On-site Staffing Services, Maintenance Technician (Oct 25). - The other 5 are saved, not applied. They include Snap On, ALogix and Ogden. **What your team wrote last time.** There is 1 note, from you on Oct 27. It says he joined, shared his applications and resume, and that the STS interview comes from his tracker only. It also says to review what he needs to bring. **Two questions worth asking.** 1. "Tell me what you know about the STS interview: when, where and who you're meeting?" This also settles the date and gives the ID task a deadline. 2. "Of the jobs you've saved, which ones feel worth applying to this week, and what's in the way of the others?" Read this before you meet. Nothing was saved or sent. If you want a note from it, say so and I will draft one for you to place and save yourself.`,
};
