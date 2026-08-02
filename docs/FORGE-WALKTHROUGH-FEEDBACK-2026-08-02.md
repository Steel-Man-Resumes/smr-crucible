# Forge Walkthrough Feedback -- 2026-08-02

Source: Troy's full freestyle walkthrough of The Forge (desktop), captured and organized by CC. This is the raw feedback set for the Forge refinement pass. Refinery refinement is a separate session to follow.

Tags: [BUG] broken behavior | [UX] flow/interaction | [DESIGN] visual/layout | [COPY] wording | [FEATURE] new capability | [DECISION] product direction to preserve
Priority: P0 broken/confusing now | P1 strong improvement | P2 delight/polish

---

## 0. Product-direction decisions to preserve (do not lose these)

- [DECISION] **Keep the three landing paths** (Career Builder / Partner / Research-Methodology). The methodology matters to certain audiences.
- [DECISION] **Forge is one-and-done; Refinery is the ongoing home.** Running the Forge should create a Refinery account where continued work lives. But the Forge itself holds a lot of value.
- [DECISION] **Connect Forge and Refinery intelligently and subtly.** The Refinery should be able to link back to the Forge methodology so a person can return for that information. Wherever the Forge hands off, it should feel like a deliberate bridge, not a dump.
- [DECISION] **Partner anonymity model.** Partners (e.g., EXPO) get an overview of client statistics only -- never client-identifying resume content. A future, separate feature will let a client invite their caseworker or PO to access specific data. Not building that now.

---

## 1. Landing page

- [BUG][P0] **Remove the "Contact Troy" button.** Clicked it, nothing happened (dead). Also historically it is sticky at the bottom and has overlaid other content, especially on mobile. Remove entirely.
- [UX][P1] **Three paths are buried.** First impression is you must scroll all the way to the bottom to reach the three choices. Consider surfacing them higher / making them the clear focal point.
- [DESIGN][P1] **The three path boxes do not read as buttons.** Make them obviously clickable (affordance: button styling, hover, cursor, arrow, etc.).

## 2. t.ROY introduction (first entry to the Forge)

- [COPY][P1] **Strengthen the t.ROY intro to clearly establish it is an AI.** Right now it says "I'm t.ROY" without making clear enough that this is AI. The introduction is necessary precisely because this is a heavy-AI-use tool.
  - Intent to convey (do not use this wording verbatim -- these are notes): the AI is top-of-the-line; users can adjust settings later in the Refinery. Keep it light, not a disclaimer wall.

## 3. Branding / iconography

- [DESIGN][P1] **Need a consistent t.ROY icon** like the one on the link.midnightgarden.club landing page (the Midnight Garden icon), but probably recolored. The current colors do not match this environment.

---

## 4. Partner path

Overall: "really excellent."

- [FEATURE][P1] **Partner sign-in dashboard is required.** Partners need a real dashboard to work with their clients. Example structure: EXPO's Marianne is an administrator with two workers under her; the workers work with clients.
  - Admin sees an overview of client statistics only (anonymity preserved).
- [UX][P0] **Demo end-state is a dead drop.** Two options at the end of the partner page: "View the demo" (looks good) and "Sign in to the partner dashboard."
  - After the demo ends, it must land the user somewhere they can DO something. Last time it kicked to the Refinery, which was confusing.
- [UX][P0] **"Sign in to the partner dashboard" dead-ends.** It routes to the Refinery sign-in page and stops. Copy there reads: "Partners can use invitation or partner code. Each participant creates their own account." If someone has gotten this far and is interested, close the loop -- give them a real CTA (request access / start a partner org / talk to us), not a dead end.

## 5. Methodology / Research path

Overall: "really good." Wants a structuring pass.

- [UX][P1] **Restructure from a scrolling wall into layered disclosure.**
  - An interested person should quickly orient and find where they want to go.
  - Give an overview level first.
  - Let the curious click into specific points for more.
  - When they click in, reward them with a dense, technical, scholarly description of exactly that topic.

---

## 6. Job-seeker path -- entry / resume input

Overall: "feels pretty good." Options cover the main ways to enter a resume; likes the build-one option and the helper links.

- [UX][P2] **Refresh the "help me build one" resource links** -- verify they are current and add any new ones since this was first built.
- [FEATURE][P1] **Voice input** for entering info (Whispr / Whisper-style transcription). Strong accessibility fit for this audience.
- [FEATURE][P1] **"Paste what YOUR AI said" option.** Give the user a copyable prompt to hand to their own AI (ChatGPT/Claude), then paste the reply back in. (Design note: this pairs with the paste-parser fix -- route it through AI parsing so markdown output is handled.)
- See CC recommendations (section 14) for additional input methods.

## 7. Analysis output (after submitting a resume)

Overall: fast analysis, "starts really good at the top" -- says it could be stronger, offers to help, then delivers.

- [UX] **Summary help works well.** Summary came up blank; "offer to help" produced a really good result.
- [BUG][P0] **Horizontal overflow on field rows.** Other fields (education, experience, etc.) render as a single line that scrolls off to the right with no way to see the full content. Content is cut off / unreadable.
- [UX] **Per-field help is excellent** -- breaks the field into details, offers multiple choice plus write-in fields.
- [FEATURE][P1] **Extend guided multiple-choice to more fields.** Some of the extra fields would benefit from click-to-add-bullet guided choices.
- [BUG][P0] **Work is lost when finalizing a bullet.** After dialing in a bullet, it asks you to rewrite the bullet, with no way to lock in the info you saved. Eventually a "Does this look good? Use this bullet" button appears and uses the strongest bullet -- but all the extra work/detail the user put in is lost. Need to persist intermediate input and let users lock it in.

## 8. New feature -- company research assist

- [FEATURE][P1] **Company/role research button** during experience editing (hard-to-find, or even up-front). It would: research the company, look for current openings, and find a current job description matching the work they did, to predict with high accuracy the exact work that person performed at that job.
  - Accepts the AI-usage cost. Rationale: the goal is one exceptional resume to carry into the Refinery, so this spend is worth it.

## 9. Defensibility checklist (before print)

- [UX][P1] **Make the "can you defend this resume?" checklist mandatory.** Require sign-off and an admission that they are not lying (to a reasonable extent). Do not make it look like a legal document -- make them accept ownership.
  - CC note: this is also a natural place to capture their typed name (ownership + personalization).

## 10. Preview panel (right-hand side)

- [COPY][P0] **Label it as the preview.** Explicitly tell the user "this is what it's going to look like" so they can be sure before hitting next.
- [DESIGN][P1] **Make it look like a real preview.** Currently smushed in width (narrower than a real page) and elongated -- looks funny.
- [DESIGN][P1] **Distinct laptop vs mobile treatment.** The preview needs different handling between desktop and mobile.

## 11. Download options at the preview stage (docx / pdf)

- [UX][P1] **Downloading here is premature -- say so.** Let them know it is early to download but allow it if they truly need to.
  - Minimize the options and add explanation. Possibly a single small button with a dropdown that explains in depth, so it does not eat real estate.

## 12. "What do you want?" questions (after "Looks Good")

Overall: likes the first screen -- multiple choice plus questions at the bottom.

- [UX][P1] **Show the bottom questions as open fields by default,** not collapsed behind an open action.
- [COPY][P2] **Seed the fields with sample/placeholder text** to spark the user.
- [FEATURE][P1] **Voice here too** -- a microphone to let them speak freely.

## 13. Preferences screen ("a few quick preferences")

- [UX][P1] **Allow multiple selections.** Currently only one box can be checked at a time; users may be willing to take more than one option.

## 14. Processing + results (final generation)

- [UX] Processing cycled ~20 seconds -- "very short and manageable. I love it."
- [FEATURE][P2] **Confetti on completion.** A short burst starting from the top, drifting slowly down, total no more than 4 seconds. (CC note: respect prefers-reduced-motion.)
- [PRAISE] Result is amazing, narrative-centered, encouraging.
- [DESIGN][P0] **"Skills we found" bubbles have poor color differentiation.** The section is color-coded but the actual bubble colors are hard to tell apart on this screen. Fix contrast/legibility.

## 15. Final output -- resume draft, cover letter, handoff

- [UX][P1] **Lead with the real-life preview,** then put all the "what to do with it" options at the bottom. (Resume in this run was wonderful; slightly over one page is fine -- fixable in the Refinery.)
- [PRAISE] Cover letter is excellent. The "you're finished in the Forge, more work awaits in the Refinery" explanation is good.
- [UX][P1] **This handoff screen is where all save options live -- and each option should be explained.** Some users will just print and go; some save to computer; some email it to a friend. Give options and help them, but encourage them and make clear the next step (Refinery) is the crucial one: find real jobs, apply, practice, etc.

## 16. Print / take-away package

- [FEATURE][P1] **Output an extraordinary take-away package on print,** not just a bare resume. Because they may never come back, hook them up now:
  - The **narrative** printed in a book/pamphlet-style, encouraging format.
  - **Extra resources** we can give them.
  - The **resume** and a **cover letter**.
  - Make it unique to the platform and to them -- we learned a lot on this journey; the artifact should reflect that.
- [DECISION][P1] **Cover letter is docx-only.** A cover letter must be edited, so PDF is the wrong format ("a dumb download"). Explain this to the user.
  - CC note: consider adding a QR/link on the printed package back to their Refinery account, so the physical artifact routes them home.

---

## 17. CC recommendations (answers to Troy's open questions)

### Other resume-input methods (beyond voice and paste-from-AI)
Current methods in code: upload (PDF/DOCX/JPG/PNG/screenshot/camera), import, external, guided build, paste.
Worth adding, in value order:
1. **Voice / spoken interview** (Troy's idea) -- highest accessibility payoff for a 5th-grade-reading-level, trauma-informed audience.
2. **"Paste what your AI said"** (Troy's idea) -- copyable prompt out, paste reply back; route through AI parsing.
3. **LinkedIn PDF export** -- LinkedIn has a native "Save to PDF"; "download yours and upload it here." Low effort, very common, no scraping/ToS risk.
4. **Email-in** -- forward your existing resume to an address and we ingest it; good for mobile-only users.
5. **Conversational build with t.ROY** -- an AI chat/voice interview that assembles the resume; this is the guided path made warmer (and pairs with voice).

Not recommended: live LinkedIn scraping (fragile, ToS risk), generic job-board auto-import (brittle).

### Additional finishing touches
- **Durable autosave / resume-your-session** -- directly answers the "I lost my work" bug; nothing the user types should ever be discardable.
- **Progress indicator** through the Forge steps -- reduces anxiety, signals it is short.
- **Capture first name early** so t.ROY addresses them by name throughout -- large warmth multiplier for little cost.
- **"Email me my package" as a capture point** -- even if they never return, we hold an email to nurture toward the Refinery (fits the "hook them up now" instinct).
- **Accessibility pass (WCAG contrast + no horizontal cutoff)** -- the overflow bug and the skills-bubble contrast are both a11y issues; this audience includes low-vision and low-literacy users.
- **Plain-language privacy note** on data handling near the t.ROY intro -- justice-impacted users are rightly cautious about where their information goes.
- **Reduced-motion respect** on the confetti and any animation.

---

## 18. Cross-links to known issues
- The [P0] horizontal-overflow and the earlier **silent paste-parse failure** (markdown defeats `parseResumeText`; see chat 2026-08-02) are related display/parse robustness problems. Fixing the paste path to strip markdown or route through `/api/parse`, plus fixing field overflow, should be batched.

---

## 19. Status / next step
Captured only. No code changed. Awaiting Troy's go on: (a) a build-ready version of this list with file locations + effort estimates, and (b) which items to sequence first. Refinery walkthrough feedback is a separate upcoming session.
