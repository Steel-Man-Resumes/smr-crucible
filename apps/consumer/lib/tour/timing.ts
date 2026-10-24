/**
 * Reading pace for the entrance tour. A beat stays up long enough to read its
 * caption at an unhurried pace, never less than the floor (a short line still
 * needs the camera to land and the eye to find it) and never more than the cap
 * (a tired person should not wait on a slide).
 */
import type { TourBeat } from './beats';

/** Time for the camera to land and the eye to find the caption. */
export const ORIENT_MS = 1100;
/** About 240 words a minute: comfortable for most adults, not a speed read. */
export const MS_PER_WORD = 250;
export const READ_FLOOR_MS = 3200;
export const READ_CAP_MS = 9000;
/** The stage shrinking into the corner caption between the acts. */
export const ACT_CHANGE_MS = 900;
/** Camera ease, the walkthrough's tempo. */
export const CAMERA_MS = 1100;
export const CAMERA_EASE = 'cubic-bezier(.65,0,.3,1)';

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function readingMs(words: number, extra = 0): number {
  const base = Math.min(READ_CAP_MS, Math.max(READ_FLOOR_MS, ORIENT_MS + words * MS_PER_WORD));
  return base + Math.max(0, extra);
}

export function holdMs(beat: Pick<TourBeat, 'title' | 'body'> & { extra?: number }): number {
  return readingMs(wordCount(`${beat.title} ${beat.body}`), beat.extra ?? 0);
}

/** Runtime at default pace, by act. The ending (quiz and reward) is the person's own time. */
export function tourRuntimeMs(beats: readonly TourBeat[]) {
  let stage = 0;
  let room = 0;
  for (const beat of beats) {
    if (beat.kind === 'stage') stage += holdMs(beat);
    else room += holdMs(beat);
  }
  if (room) room += ACT_CHANGE_MS;
  return { stage, room, total: stage + room };
}
