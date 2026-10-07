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
  never shows a number, a year or any other fact; the person's answer is the
  only thing that can add one.
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
  verdict?: "stands" | "cut" | "unsure"; // omitted = "stands" when answer has words
}
```

Until each defend line has an answer that stands, it is an open BLOCK
(`STD-C04`). Answers that stand count as the person's own words for the check,
so a number the person states in their answer clears an added-number BLOCK.
"cut" and "unsure" keep the line open until it is reworded or removed.
