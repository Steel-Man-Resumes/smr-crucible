/**
 * MOCK_AI reply for the record check: picks only, the same shape a real reply
 * must have. It goes through the same id filtering as a real one. Ids that do
 * not exist for the chosen state are dropped, like any unknown id.
 */
export const MOCK_RECORD_CHECK_REPLY = JSON.stringify({
  source_ids: [
    "oh-predetermination", "oh-licensing-law", "oh-sealing-law", "oh-sealing-help",
    "mt-licensing-law", "mt-record-relief-help", "wi-hiring-law", "mi-record-relief-help", "mo-courts-expungement",
    "us-ccrc-licensing-comparison",
  ],
  question_ids: ["q-pre-1", "q-pre-2", "q-weigh-1", "q-weigh-6", "q-time-1", "q-rehab-1", "q-appeal-1", "q-relief-1"],
});
