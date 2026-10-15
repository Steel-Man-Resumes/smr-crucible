# @crucible/core

Shared server and browser code for the consumer app and the Crucible.

## Resume engine contract

Three pure modules (no I/O, safe in the browser) decide what a resume may say
and whether it is finished. Import them by path, the same way the mint check
is imported today:

```ts
import { RESUME_RULES_VERSION, resumeRulesBlock } from "@crucible/core/src/resumeRules";
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { getResumeStatus, pickDefendLines, questionForFinding } from "@crucible/core/src/resumeStatus";
```

### 1. One rulebook (`resumeRules.ts`)

`RESUME_RULES` is the single list of rules, versioned by `RESUME_RULES_VERSION`.
`resumeRulesBlock(scope)` renders one scope as prompt text with the version in
its first line:

- `"truth"`: what may go on the page. The context library's resume block and
  Rush carry it.
- `"page"`: page layout (one column, skills as one comma-separated line or a
  few short labeled lines). The Forge writer carries it.
- `"fix"`: a fix only removes, reverts to the person's words, or asks.

Each rule lists the checker rule ids (`STD-*`) it is graded under;
`rulesForStd(id)` maps a finding back to its rule. Change a rule, bump the
version.

### 2. Draft or finished (`resumeStatus.ts`)

```ts
getResumeStatus({
  resumeText: string,          // exactly what the person would receive
  sourceText: string,          // only the person's own words
  defendAnswers?: DefendAnswer[],
  requireDefend?: boolean,     // default true
}): {
  state: "finished" | "draft",
  openItems: { rule, severity: "BLOCK" | "FIX", line, question, why }[],
  blockCount, fixCount,
  defendLines: DefendLine[],
  rulesVersion: string,
}
```

- **An open BLOCK means `"draft"`.** Only a page with no open BLOCK is
  `"finished"`. No resume text, or no source text to check against, is always
  a draft.
- `openItems` lists BLOCKs first, then FIXes, each in page order.
- Every item has a `question` for the person, built only from the finding. It
  never introduces a fact: it never shows a number or a year, and it never
  suggests a value. Credential and skills questions repeat the page's own
  words (a credential's name such as "OSHA 10", or a skills term) only so the
  person knows which line is meant.
- Wiring for the finish page: confetti, "download as finished", email and the
  review ask wait for `state === "finished"`. A download while
  `state === "draft"` is labeled DRAFT and lists `openItems`.

### 3. The defend step (`pickDefendLines`)

```ts
pickDefendLines(resumeText, sourceText, { minFurthest = 2 }): {
  line: string,
  reasons: ("number" | "credential" | "far_from_your_words")[],
  question: string,
}[]
```

Every line with a number (years and contact digits excluded), every
credential line, and the `minFurthest` lines furthest from the person's own
wording, in page order. Show each `question`; send the answers back as:

```ts
interface DefendAnswer {
  line: string;     // the resume line as shown
  answer: string;   // the person's own words
  verdict?: "stands" | "cut" | "unsure"; // omitted = not answered yet
}
```

Until each defend line has an answer that stands, it is an open BLOCK
(`STD-C04`). An answer stands only when:

- its `verdict` is `"stands"` (a missing verdict means not answered yet);
- it has words in it and is not an "I don't know";
- it does not deny its own line ("never got certified" against "Forklift
  Certified" keeps the line open).

Answers belong to their own line only. They are never pooled into the source
text, so an answer on one line cannot clear a finding on another, and the page
is always checked against `sourceText` alone. The one finding a standing
answer can settle besides its own defend item is a credential's missing
status, when that line's answer gives a status or a year.

A number the writer put on the page that is not in `sourceText` stays a BLOCK
even if the person repeats it in a defend answer: they were shown the number,
so repeating it does not make it theirs. The line comes off, or the person
gives the number in their own words somewhere no number was shown (for example
a "describe it your way" step whose text goes into `sourceText`). For a line
like that, the defend question is the describe-it question and never mentions
the number. "cut" and "unsure" keep the line open until it is reworded or
removed.
