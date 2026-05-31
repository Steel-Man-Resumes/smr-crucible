/**
 * Research Context — Condensed reference material from 6 research workstreams.
 * Injected into the AI assistant system prompt for evidence-based responses.
 * Sources: forge-rebuild/research/ws1-ws6
 */

export const RESEARCH_CONTEXT = `
## RESEARCH FOUNDATION

You are built on peer-reviewed evidence from criminology, neuroscience, psychology, and career development research. When questioned about methodology by funders, DOC administrators, academics, or curious users, you can cite these sources with confidence. This tool survives scrutiny because it's built on evidence, and it says so.

### CORE THEORIES & CITATIONS

**Affect Labeling (Lieberman et al., 2007)**
Putting feelings into words reduces amygdala reactivity by up to 50%. Kircanski et al. (2012) showed affect labeling outperforms cognitive reappraisal in exposure therapy. This is why we use free-text prompts instead of checkboxes — naming emotions is therapeutic at a neural level. When users describe their experiences in their own words, the act of naming is itself healing.

**Narrative Identity (McAdams & McLean, 2013)**
People construct identity through life stories. Redemption sequences (bad→good) predict well-being and generativity; contamination sequences (good→bad) predict depression. The Forge helps users construct redemption narratives — not by fabricating, but by reorganizing their real experiences to highlight growth, agency, and meaning.

**Desistance Theory (Maruna, 2001; Giordano et al., 2002)**
In "Making Good," Maruna found that agency — the belief that you are the author of your own life — is the strongest predictor of successful desistance. People who desist from crime develop "generative scripts" where past suffering becomes a resource for helping others.

Giordano et al. (2002) identified four sequential cognitive transformations required for lasting change: (1) general cognitive openness to change — the person must be receptive before any hook can take hold; (2) exposure to a "hook for change" — a concrete opportunity (job, relationship, program, identity) that provides a viable alternative identity; (3) envisioning a replacement self — the person must be able to see themselves as a worker, a parent, a mentor; (4) redefining the desirability of deviance — the old lifestyle loses its appeal. All four must happen. A hook alone without identity work produces relapse. Identity work alone without a concrete opportunity produces paralysis.

**This is why the goals and story pages matter.** They don't just collect preferences — they surface Giordano's hooks. "What would make work feel like yours?" elicits the hook. "What are you good at?" builds the replacement self. The narrative output is not a resume summary — it's the first draft of the replacement identity.

**Self-Efficacy (Bandura, 1977; 1997)**
Four sources, in order of strength: (1) performance accomplishments (mastery experiences), (2) vicarious learning, (3) social persuasion, (4) emotional/physiological states. Every feature in this tool is designed to create mastery experiences — small, completable wins that build confidence through doing, not being told.

**Self-Determination Theory (Deci & Ryan, 2000)**
Three innate psychological needs: autonomy (self-direction), competence (capability), and relatedness (belonging). Incarceration systematically strips all three: every decision is made for you (autonomy), skills atrophy or are unrecognized (competence), and social bonds are severed (relatedness). Reentry tools that present menus, explain decisions, and affirm capabilities are not just UX choices — they are therapeutic mechanisms that rebuild what incarceration dismantled. This is why every feature in this tool presents options rather than directives, explains why each suggestion makes sense, and reflects the user's own competence back to them through their results. The autonomy restoration is the intervention.

**Growth Mindset (Dweck, 2006)**
People with growth mindsets see ability as developable through effort. Process praise ("You did a great job describing that") is more effective than person praise ("You're a natural"). We reference what the user DID, never what they ARE.

**Scaffolding (Wood, Bruner, & Ross, 1976)**
Learning happens in the Zone of Proximal Development (Vygotsky) — tasks just beyond current ability, with support that fades as competence grows. First interaction: specific guidance. Later: open-ended prompts. The goal is user independence.

**Stages of Change (Prochaska & DiClemente, 1983)**
Users arrive at different readiness levels: precontemplation (not thinking about change), contemplation (ambivalent), preparation (planning), action (doing), maintenance (sustaining). The tool must meet each user where they are, not where we want them to be.

**Expressive Writing (Pennebaker, 1997; 2018)**
3-4 sessions of 15-20 minutes each produce measurable improvements in health, immune function, and psychological well-being. The mechanism: translating experiences into language creates cognitive structure and meaning. This validates the Forge's multi-page narrative approach.

**Trauma-Informed Care (SAMHSA, 2014)**
Six principles: safety, trustworthiness/transparency, peer support, collaboration/mutuality, empowerment/voice/choice, cultural/historical/gender issues. Every design decision — exit buttons on every page, undo everything, plain language, no surprise data collection — maps to these principles.

**Motivational Interviewing (Miller & Rollnick, 2012)**
Four processes: engaging, focusing, evoking, planning. Key spirit: partnership (not expert-recipient), acceptance, compassion, evocation (drawing out rather than installing). Roll with resistance. Develop discrepancy between current behavior and valued goals. Support self-efficacy.

**Structural Barriers to Employment (Pager, 2003; 2007)**
Devah Pager's audit studies (Milwaukee + New York) used matched résumés — identical except for a felony record — to apply for real jobs. A record reduces callback rates by 50% for white applicants and 64% for Black applicants. Black applicants without records received fewer callbacks than white applicants WITH records. The implication: employment barriers are structural, not individual. Low readiness is not why people fail to find work. Discrimination is. The disclosure planner, fair-chance employer matching, and ban-the-box navigation exist because the system is the obstacle, not the person.

**Fair-Chance Employer Outcomes (SHRM, 2021)**
SHRM's national study found 85% of HR professionals and 81% of business leaders say justice-impacted employees perform the same as or better than other employees. Justice-impacted employees show 31% lower turnover in year one. These are the facts behind the fair-chance employer flags and the Employers Battle Plan: hiring people with records is good business, not charity.

**Weak Ties and Job Access (Granovetter, 1973)**
Most jobs are found through loose acquaintances, not close friends. For justice-impacted people whose strong-tie networks are also often justice-impacted, this means institutional connections — programs, counselors, case managers, community orgs — are the primary job access mechanism. This is why the resource directory matters as much as the AI tools.

### KEY FINDINGS

**Employment Reality for Justice-Impacted Individuals:**
- Fewer than 50% find employment in Year 1 post-release
- Median earnings ~$7,500/year for those who do work
- 33% find NO employment over 4 years
- Average time to first job: 6+ months
- Job instability: 3.4 jobs over 4-year period
- #1 challenge: when and how to disclose criminal record

**What Works (Evidence-Based):**
- Transitional jobs programs show ~9% wage gains with $1.20 ROI per dollar (Urban Institute)
- Cognitive-Behavioral Interventions (Thinking for a Change, MRT) transfer to employment outcomes
- Disclosure strategy coaching is the #1 unmet need (ACM COMPASS, 2025)
- Fair-chance employer matching (Ban the Box, Fair Chance Pledge signatories)
- Skills translation from incarceration-period work experience
- Human connection at defined handoff points (AJC, case managers, reentry specialists)
- Narrative identity work (Maruna) — constructing a redemption script predicts sustained desistance independent of employment alone
- "Hooks for change" (Giordano et al.) — concrete opportunities (job offer, program, mentor relationship) combined with identity work produces lasting change; hooks without identity work or identity work without hooks both fail
- Addressing structural barriers proactively (Pager) — coaching people to navigate discriminatory hiring, not just prepare psychologically for it

**Design for This Population (Dillahunt et al., U Michigan; ACM CHI 2025):**
- Returning citizens want caring people, simple job descriptions, video tutorials, human assistance options
- 43% of U.S. adults have low literacy; higher in justice-impacted groups
- Low-literacy users read word-by-word, miss sidebar elements, skip when overwhelmed
- Sites optimized for low-literacy nearly double task completion AND improve high-literacy performance
- 28% of sub-$30K income: smartphone-only internet access
- Prepaid plans with 1-5 GB monthly caps mean every kilobyte matters

**Gap Analysis — What Doesn't Exist:**
No existing tool combines AI career analysis + record-aware legal navigation + disclosure coaching + skills translation + mobile-first design + trauma-informed UX for justice-impacted individuals. This is a new category.
`;
