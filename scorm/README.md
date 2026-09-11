# In-facility intake, packaged as SCORM

An offline, deterministic career intake built to run on a corrections tablet
inside a facility, and to survive the security vetting that gets content onto
one.

**This product does not have a name yet. That is Troy's call.** Everything a
person sees comes from `BRAND` at the top of `build.mjs` and from `src/screens.js`,
so naming it is a one-line change and a rebuild.

---

## Why it is built this way

Montana DOC's tablet vendor is ViaPath. CypherWorx is already on those tablets.
Third-party content reaches a tablet by being wrapped in SCORM, added to the
CypherWorx LMS, vetted by ViaPath for security, and then added to the catalog.

Steve Stookey of CypherWorx named the obstacle exactly: *"For many of the tablet
providers, there is a very significant fear of a web app or anything that allows
an inmate to get out to the web."*

That fear is the design brief. Everything below follows from it.

```
INSIDE THE WALL                     |   OUTSIDE THE WALL
------------------------------------|---------------------------------
This package, in the CypherWorx LMS  |   The Forge and The Refinery
on a ViaPath tablet                  |   Full AI, live, unrestricted
                                     |
Deterministic branching intake       |   Narrative reconstruction
Fixed questions, nothing generated   |   Resume building
Zero network calls, provably         |   Disclosure planning
Answers in cmi.suspend_data          |   Interview practice
Completion reported via SCORM API    |
                                     |
       >>> the person carries a ten character code out >>>
```

**The wall is the security boundary. The carry code is the only thing that
crosses it.** No data flows out live. No model reaches in.

---

## The carry code, and why it matters more than the SCORM plumbing

The package cannot send anything anywhere. The LMS holds a copy of the intake
in `cmi.suspend_data`, but that copy only reaches Steel Man Resumes if an
institutional export pipeline exists, and no such pipeline can be promised to
anyone today.

So the person carries it.

Every fixed-choice answer in the intake is an index or a bitmask. Packed
together they are 43 bits. With a 7 bit CRC that is 50 bits, which is exactly
ten characters of base32:

```
52S6-K22V-G6
```

Ten characters on the back of a release paper, and the entire structured intake
survives the wall with **no integration, no vendor cooperation, no server, and
no network.** Nobody has to build a pipeline. Nobody has to agree to anything.

The two free-text answers do not fit and are not carried there. They ride in
`suspend_data`, and if that copy never arrives they are re-asked outside in
under a minute. Nothing that matters is lost.

`src/carry-code.js` is the codec. `src/tables.v1.js` is the decoder ring and is
**frozen**: a person may write a code down inside and redeem it eighteen months
later, so entries are never removed, reordered, or renamed. Read the header of
that file before touching it.

---

## What is here

```
build.mjs        packager: generates the manifest, runs preflight, writes the zip
preflight.mjs    the containment scanner and the report it produces
test.mjs         codec, table integrity, data budget, script rules
e2e.mjs          drives the real package in a real browser via Playwright
shots.mjs        screenshots for the demo packet
src/             the package itself. everything in here ships
  index.html     the launch file (the SCO)
  app.js         the runtime
  screens.js     THE SCRIPT. every word a person reads is in this file
  tables.v1.js   frozen option tables
  carry-code.js  the codec
  scorm-api.js   SCORM 1.2 and 2004 adapter
  styles.css
harness/         a fake LMS for offline testing. NEVER ships
dist/            build output. gitignored
```

Zero runtime dependencies. Zero build dependencies. Nothing to `npm install`.
That is not minimalism for its own sake: **auditability is a security feature
here.** A reviewer facing eight readable files can approve it. A reviewer facing
a minified bundle with a thousand transitive dependencies has to either trust us
or say no, and their job is to say no.

---

## Commands

```bash
node build.mjs                # build both SCORM 1.2 and 2004 packages
node build.mjs --scorm 1.2    # build one
node test.mjs                 # static tests
node e2e.mjs                  # browser run, SCORM 1.2
node e2e.mjs --scorm 2004     # browser run, SCORM 2004
node shots.mjs                # screenshots into dist/shots/
node harness/serve.mjs        # then open http://127.0.0.1:8787/harness/
```

Node 20. `source ~/.nvm/nvm.sh && nvm use 20`.

---

## The containment report

Every build writes `dist/<package>-CONTAINMENT-REPORT.txt`. **It is a
deliverable, not a build log.** It goes to CypherWorx and to ViaPath with the
package.

A normal SCORM package arrives with an assurance that it makes no network
calls. This one arrives with a machine-generated report that proves it, run on
the exact bytes in the zip, reproducible by the reviewer on their own machine,
and pinned to a SHA-256 of every file. **"Trust me" becomes "run this
yourself."**

The scanner enforces 27 rules across four categories, and a blocking finding
fails the build. A package that can reach the network cannot be produced by this
toolchain:

| Category | What is banned |
|---|---|
| Containment | absolute and protocol-relative URLs, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, service workers, web workers, dynamic `import()` |
| Shared-device privacy | `localStorage`, `sessionStorage`, IndexedDB, `document.cookie`, the Cache API |
| Uncontrolled execution | `eval`, `new Function`, `innerHTML` and friends, `document.write` |
| Escape vectors | anchor tags, `window.open`, `location` writes, `tel:` and `mailto:`, iframes, forms, `<base>` |

There is exactly one exemption, and it is printed in the report: XML namespace
URIs in `imsmanifest.xml`, which are identifiers the SCORM schema requires and
which nothing dereferences.

The package also declares a Content-Security-Policy of `connect-src 'none'`, so
the browser blocks any network call even if a future edit reintroduced one. A
second lock on a door with no handle.

---

## The data budget

**SCORM 1.2 caps `cmi.suspend_data` at 4,096 characters. SCORM 2004 raises it to
64,000.** With no network permitted, that field is the only way an intake leaves
the tablet through the LMS.

The build spec assumed this would force LZString compression. It does not,
because the carry code absorbs every fixed-choice answer and free text is
capped in `src/screens.js`:

```
worst case  1,839 of 4,096 characters  (45% used, no compression needed)
real run      342 of 4,096 characters  (8.3%)
```

`test.mjs` fails if the worst case ever exceeds 75% of the 1.2 ceiling, so
raising a cap breaks the test rather than breaking a package that is already in
a facility. **This means the 4,096 character problem is solved and no
compression library is needed, on either SCORM version.**

---

## Testing status

| | Status |
|---|---|
| Static tests (`test.mjs`) | 20 of 20 pass |
| Browser run, SCORM 1.2 (`e2e.mjs`) | 26 of 26 pass |
| Browser run, SCORM 2004 | 26 of 26 pass |
| Containment report | PASS, both packages |
| Zip structure | manifest at root and first entry, CRC verified |
| SCORM Cloud | **not yet run. This is the next gate.** |
| Real LMS | not yet |

`e2e.mjs` asserts, in a real browser, that:

- **zero off-origin requests** are made during the entire run, intercepted at
  the browser level, below anything the page could do to hide one
- nothing is written to `localStorage`, `sessionStorage`, or cookies
- the carry code displayed on screen decodes, in Node, back to exactly the
  answers that were clicked. **This is the wall crossing, tested.**
- relaunching resumes where the person stopped and regenerates the same code
- `Initialize` comes first and exactly once, a commit happens on every step
  transition, and the LMS receives `completed`

---

## Recording the offline evidence video

The most persuasive single artifact available. `node harness/serve.mjs` prints
these steps too.

1. Start the harness, open it, confirm it loads.
2. **Turn wi-fi off and unplug ethernet.** Leave the harness running.
3. Start the screen recording. Show the network is off.
4. Reload and complete the intake end to end.
5. Relaunch to show it resumed. Read the carry code aloud.
6. Show the API log pane and the network counter reading zero.

That video answers the "can an inmate get out to the web" question better than
any document.

---

## What is still owed

1. **The name.** Troy's call.
2. **The script design pass.** `src/screens.js` is a faithful port of the live
   Mini Forge intake plus the three screens a facility deployment needs
   (consent, review, carry code). It works. It has not had the deterministic
   design pass the build handoff asked for, which is collaborative and is the
   real centerpiece of this product.
3. **SCORM Cloud.** Run both zips through the free tier before anything goes to
   CypherWorx.
4. **Redemption on the outside.** The consumer app currently treats an import
   code as a pointer to a database row. A carry code is not a pointer, it is the
   payload. That is a separate, small piece of work in `apps/consumer`.
5. **The data-ownership position.** The doctrine says users own their data, no
   surveillance, no law-enforcement data sharing. A facility may expect access
   the doctrine refuses. The consent screen currently states the strong version:
   nobody reads your answers. **That is a commitment, and it needs to be Troy's
   decision, not a default that got shipped.**
6. **Accessibility audit.** Built to WCAG 2.1 AA by construction, not yet
   audited against it. Montana's ADA Title II deadline is 2027-04-26.

---

## Rules that apply to anything added here

- Never an em dash. Double hyphens or restructure.
- "Justice-impacted." Never "second chance," "ex-con," "felon," or "offender."
  `test.mjs` fails the build on any of those appearing in the script.
- No emojis.
- Nothing generated at runtime. If a future change makes the set of things this
  package can say depend on what someone types, the security argument is gone.
