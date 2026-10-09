/**
 * The record check's curated question bank and step bank (D11, security r1
 * F1/F8). Every word a person sees in a checklist comes from this file, the
 * dated source list (sources.json), or what they typed. The model only picks
 * ids; its own text is never shown or stored.
 *
 * Slots, filled on the server only:
 *   {state}  the state's name from states.ts
 *   {job}    the job or license the person typed (backstop-checked), or
 *            "this work" when there is none or it was not kept
 *   {source} the title of a picked source from sources.json
 *
 * Rules for every line here (tested): plain words, first person for
 * questions, ends with "?", never a verdict or an outcome, never a label on
 * the person, no link, no statute number, no dash as punctuation.
 */

export type QuestionTopic =
  | "predetermination"
  | "board_weighs"
  | "time_since"
  | "rehabilitation"
  | "appeal"
  | "record_relief"
  | "employer"
  | "federal"
  | "paperwork";

export interface BankQuestion {
  id: string;
  topic: QuestionTopic;
  text: string;
}

export const QUESTION_BANK: readonly BankQuestion[] = [
  // Asking before you apply or train
  { id: "q-pre-1", topic: "predetermination", text: "Do you review a record before someone applies or pays for training?" },
  { id: "q-pre-2", topic: "predetermination", text: "How do I ask for that review, and what does it cost?" },
  { id: "q-pre-3", topic: "predetermination", text: "How long does the review take, and will I get the answer in writing?" },
  { id: "q-pre-4", topic: "predetermination", text: "If I get an answer from that review, does it still hold when I apply later?" },
  { id: "q-pre-5", topic: "predetermination", text: "Can I ask for the review while I'm still in school or training for {job}?" },
  // What the board looks at
  { id: "q-weigh-1", topic: "board_weighs", text: "Which parts of a record does the board look at for {job}?" },
  { id: "q-weigh-2", topic: "board_weighs", text: "How does the board decide whether a record relates to this work?" },
  { id: "q-weigh-3", topic: "board_weighs", text: "Is there a written list of the offenses the board looks at for this license?" },
  { id: "q-weigh-4", topic: "board_weighs", text: "Does the board look at arrests that didn't end in a conviction?" },
  { id: "q-weigh-5", topic: "board_weighs", text: "Do you look at each person's situation, or follow a set rule?" },
  { id: "q-weigh-6", topic: "board_weighs", text: "Is {source} the rule you follow for this license?" },
  // Time since the conviction
  { id: "q-time-1", topic: "time_since", text: "Does the board count how long ago the conviction was, and from what date?" },
  { id: "q-time-2", topic: "time_since", text: "Is there a waiting period for this license, and when does it start?" },
  { id: "q-time-3", topic: "time_since", text: "Does time on probation or parole change how the board looks at a record?" },
  // What you have done since
  { id: "q-rehab-1", topic: "rehabilitation", text: "What papers can I bring to show what I've done since?" },
  { id: "q-rehab-2", topic: "rehabilitation", text: "Do letters from an employer, a teacher or a program count?" },
  { id: "q-rehab-3", topic: "rehabilitation", text: "Does a certificate of good conduct or rehabilitation from {state} matter for this license?" },
  { id: "q-rehab-4", topic: "rehabilitation", text: "Can I explain my record in person or in writing before you decide?" },
  // If the board has concerns
  { id: "q-appeal-1", topic: "appeal", text: "If the board has concerns, will it tell me in writing, and why?" },
  { id: "q-appeal-2", topic: "appeal", text: "How long do I have to respond, and who do I send it to?" },
  { id: "q-appeal-3", topic: "appeal", text: "If I'm turned down, how do I ask for a hearing or an appeal?" },
  { id: "q-appeal-4", topic: "appeal", text: "If I'm turned down, when can I apply again?" },
  // Clearing or sealing
  { id: "q-relief-1", topic: "record_relief", text: "Does a sealed or cleared record still come up for this license?" },
  { id: "q-relief-2", topic: "record_relief", text: "Do I have to tell the board about a record that was sealed or expunged?" },
  { id: "q-relief-3", topic: "record_relief", text: "Where in {state} can I find out about clearing or sealing my record?" },
  // Employers
  { id: "q-emp-1", topic: "employer", text: "When in the hiring process do you run a background check for {job}?" },
  { id: "q-emp-2", topic: "employer", text: "Will I get a copy of the background check and a chance to explain before you decide?" },
  { id: "q-emp-3", topic: "employer", text: "Do you look at each applicant's record on its own, or follow a set rule?" },
  // Federal rules
  { id: "q-fed-1", topic: "federal", text: "Does a federal rule cover this work, and who decides under it?" },
  { id: "q-fed-2", topic: "federal", text: "Is there a federal waiver or review, and how do I ask for it?" },
  // Paperwork
  { id: "q-paper-1", topic: "paperwork", text: "Which court papers do you need about my record?" },
  { id: "q-paper-2", topic: "paperwork", text: "Who can I call with questions, and can I get your answer in writing?" },
];

/** Asked when the model picks too few, and in the plain checklist. */
export const DEFAULT_QUESTION_IDS: readonly string[] = [
  "q-pre-1",
  "q-pre-2",
  "q-weigh-1",
  "q-time-1",
  "q-rehab-1",
  "q-appeal-1",
  "q-relief-1",
];

const BY_ID = new Map(QUESTION_BANK.map((q) => [q.id, q]));
export function bankQuestion(id: unknown): BankQuestion | null {
  return typeof id === "string" ? BY_ID.get(id) ?? null : null;
}

/** Steps, one per kind of source picked. Built on the server, never by the model. */
export interface BankStep {
  id: string;
  text: string;
}
export const STEP_BANK = {
  findBoard: { id: "s-find-board", text: "Find the licensing board for {job} in {state}. Look for its page about records." },
  predetermination: { id: "s-predetermination", text: "Ask the board for a review of your record before you pay for training." },
  askReview: { id: "s-ask-review", text: "Ask the board if it will look at your record before you apply or pay for training." },
  licensingLaw: { id: "s-licensing-law", text: "Read the {state} law on how licensing boards may use a record." },
  hiringLaw: { id: "s-hiring-law", text: "Read the {state} rules for employers about records." },
  recordRelief: { id: "s-record-relief", text: "Look into clearing or sealing options for your record." },
  federal: { id: "s-federal", text: "Check the federal rule for this kind of work." },
  backgroundChecks: { id: "s-background", text: "Learn when a background check report may be pulled for a job." },
  bonding: { id: "s-bonding", text: "Ask employers if they know about free bonding through the Federal Bonding Program." },
  reference: { id: "s-reference", text: "Use the national table below to see what else to ask." },
  notes: { id: "s-notes", text: "Write down what the board tells you, with the date and the name of the person you talked to." },
} as const satisfies Record<string, BankStep>;
