/**
 * MOCK_AI reply for the record check: a fixed model reply that goes through
 * the same cleaning as a real one. Fictional, generic, no person in it.
 */
export const MOCK_RECORD_CHECK_REPLY = JSON.stringify({
  steps: [
    { text: "Find the licensing board for this work in your state and read its page on records.", source_ids: [] },
    { text: "Ask the board for a review of your record before you pay for training.", source_ids: ["oh-predetermination"] },
    { text: "Read your state's law on how licensing boards may use a record.", source_ids: ["oh-licensing-law", "mt-licensing-law"] },
    { text: "Ask about sealing or clearing options for your record.", source_ids: ["oh-sealing-law", "oh-sealing-help", "mi-record-relief-help"] },
    { text: "Look at the national table of licensing rules to see what to ask.", source_ids: ["us-ccrc-licensing-comparison"] },
  ],
  questions: [
    "Do you review a record before someone applies or trains? How do I ask, and what does it cost?",
    "Which parts of a record does the board look at for this license, and for how long?",
    "What papers should I bring about my record and what I have done since?",
    "If the board has concerns, how do I respond, and how long do I have?",
  ],
});
