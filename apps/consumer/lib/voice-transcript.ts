/**
 * Voice transcript capture -- data-channel event mapping (Phase 5.7) -- PURE.
 *
 * The OpenAI Realtime API streams events over the WebRTC data channel. Only two
 * of them are a COMPLETED turn of text worth storing:
 *   - the user's speech, transcribed and finalized
 *     ("conversation.item.input_audio_transcription.completed")
 *   - the assistant's spoken reply, transcribed and finalized
 *     ("response.audio_transcript.done")
 *
 * Everything else (deltas, audio, session lifecycle) is ignored here. This maps
 * a raw event object to a completed turn or null. TEXT ONLY -- audio bytes never
 * pass through this path. No DB, no network.
 */
export type VoiceTurnRole = "user" | "assistant";

export interface VoiceTurn {
  role: VoiceTurnRole;
  text: string;
}

export const USER_TRANSCRIPT_DONE =
  "conversation.item.input_audio_transcription.completed";
export const ASSISTANT_TRANSCRIPT_DONE = "response.audio_transcript.done";

/** Partial (streaming) assistant transcript event -- used for live captions,
 *  never for the stored transcript. */
export const ASSISTANT_TRANSCRIPT_DELTA = "response.audio_transcript.delta";

/**
 * Map one Realtime data-channel event to a completed turn, or null if the event
 * is not a finalized turn. Trims the transcript; an empty/whitespace transcript
 * yields null (nothing to store).
 */
export function turnFromRealtimeEvent(evt: unknown): VoiceTurn | null {
  if (!evt || typeof evt !== "object") return null;
  const type = (evt as { type?: unknown }).type;
  if (typeof type !== "string") return null;

  if (type === USER_TRANSCRIPT_DONE) {
    const text = readTranscript(evt);
    return text ? { role: "user", text } : null;
  }
  if (type === ASSISTANT_TRANSCRIPT_DONE) {
    const text = readTranscript(evt);
    return text ? { role: "assistant", text } : null;
  }
  return null;
}

/** Streaming assistant caption fragment (for live captions only), or null. */
export function captionDeltaFromEvent(evt: unknown): string | null {
  if (!evt || typeof evt !== "object") return null;
  const rec = evt as { type?: unknown; delta?: unknown };
  if (rec.type !== ASSISTANT_TRANSCRIPT_DELTA) return null;
  return typeof rec.delta === "string" && rec.delta.length ? rec.delta : null;
}

function readTranscript(evt: unknown): string {
  const rec = evt as { transcript?: unknown };
  return typeof rec.transcript === "string" ? rec.transcript.trim() : "";
}
