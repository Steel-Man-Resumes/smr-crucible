import { parseInterviewFeedback, type InterviewFeedback } from "./interview-feedback";
export interface SavedVoiceReport { artifactId: string; feedback: InterviewFeedback; completedAt: string | null }
/** Never attach a nearby report by date or title; the saved session ID must agree. */
export function readSavedVoiceReport(row: { id: string; artifact_type: string; target_context: Record<string, unknown>; content: Record<string, unknown> } | null, sessionId: string): SavedVoiceReport | null {
  if (!row || row.artifact_type !== "interview_prep" || row.target_context?.voiceSessionId !== sessionId || row.content?.mode !== "voice") return null;
  const parsed = parseInterviewFeedback(JSON.stringify({ closing: "Saved practice feedback.", feedback: row.content.feedback }));
  return parsed ? { artifactId: row.id, feedback: parsed.feedback, completedAt: typeof row.content.completedAt === "string" ? row.content.completedAt : null } : null;
}
