/**
 * Shared interview-voice session config + instruction builder.
 *
 * Phase 1D split this into its own module because two routes now build the
 * same OpenAI Realtime "session" instructions: the token route (reserves the
 * server-side lease, no OpenAI call) and the call route (does the actual SDP
 * exchange with OpenAI and needs the same instructions text to send). Keeping
 * one copy means the two can never drift.
 */

import { sanitizeArray, sanitizeForPrompt } from "./sanitize";

export const REALTIME_MODEL = "gpt-realtime-2";

export interface VoiceSessionBody {
  config?: {
    targetRole?: string;
    interviewType?: string;
    includeDisclosure?: boolean;
    /** Skills the user chose to target this run, carried from last time's
     *  feedback (Phase 5.9 progressive practice). Encouraging, never a deficit. */
    focusAreas?: string[];
  };
  forgeContext?: {
    skills?: string[];
    strengths?: string[];
    narrative?: string;
  };
}

export function buildVoiceInstructions(body: VoiceSessionBody): string {
  const config = body.config || {};
  const forge = body.forgeContext || {};
  const targetRole = sanitizeForPrompt(config.targetRole, 120);
  const interviewType = sanitizeForPrompt(config.interviewType, 80);
  const skills = sanitizeArray(forge.skills, 10, 80);
  const strengths = sanitizeArray(forge.strengths, 6, 120);
  const narrative = sanitizeForPrompt(forge.narrative, 700);
  const includeDisclosure =
    config.includeDisclosure || config.interviewType === "disclosure";
  const focusAreas = sanitizeArray(config.focusAreas, 4, 60);

  return `You are a professional hiring manager running a live voice mock interview.

Target role: ${targetRole}
Interview type: ${interviewType}
Candidate skills: ${skills}
Candidate strengths: ${strengths}
Candidate context: ${narrative}
${focusAreas ? `The candidate is working on these skills this session: ${focusAreas}. Give them natural chances to practice these, and notice when they do it well.` : ""}

Rules:
- Start immediately with a short greeting and one interview question.
- Ask one question at a time.
- Keep spoken turns short: 1-3 sentences.
- Use natural follow-up questions based on the user's answer.
- Be fair, direct, and realistic. Do not flatter.
- After about 5 candidate answers, end the practice and give concise feedback.
- Feedback should cover clarity, confidence, specificity, and next improvement.
- Do not promise hiring outcomes or give legal advice.
${
  includeDisclosure
    ? "- Around the third or fourth answer, ask professionally about background-check context so the user can practice disclosure."
    : "- Do not ask for criminal record details unless the user raises it first."
}`;
}

/** The OpenAI Realtime "session" config both routes send -- the token route
 *  no longer sends this to OpenAI itself (Phase 1D stopped minting an
 *  ephemeral client secret there), but the call route does, as the `session`
 *  field alongside the SDP offer in the multipart POST to
 *  https://api.openai.com/v1/realtime/calls. */
export function buildVoiceSessionConfig(body: VoiceSessionBody) {
  return {
    type: "realtime" as const,
    model: REALTIME_MODEL,
    instructions: buildVoiceInstructions(body),
    reasoning: { effort: "low" as const },
    audio: {
      // Transcribe the user's speech so the browser receives text-final events
      // (conversation.item.input_audio_transcription.completed). This powers the
      // on-screen live captions (accessibility) and the opt-in, text-only
      // transcript capture (Phase 5.7). Audio is never stored by us; only the
      // transcribed text can be, and only when the user consents.
      input: {
        transcription: {
          model: "whisper-1",
        },
      },
      output: {
        voice: "marin",
      },
    },
  };
}
