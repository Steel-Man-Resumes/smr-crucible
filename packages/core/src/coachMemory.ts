/**
 * coachMemory -- cross-session memory for the assistant surfaces (10x wave).
 *
 * Renders the user's recent coach_conversation turns as an honest-freshness
 * system-prompt section. Doctrine: the assistant may reference ONLY what is
 * listed here, with its real date -- never fabricated memory, never claimed
 * freshness. Returns "" when there is no history (first conversation).
 */

import { query } from "./db";

const MAX_TURN_CHARS = 200;
const MAX_SECTION_CHARS = 1500;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s\S*$/, "") + "...";
}

export async function buildMemorySection(
  userId: string,
  limit = 10
): Promise<string> {
  let rows: Array<{ role: string; content: string; created_at: string }>;
  try {
    rows = await query<{ role: string; content: string; created_at: string }>(
      `SELECT role, content, created_at FROM coach_conversation
        WHERE user_id = $1 AND role IN ('user', 'assistant')
        ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
  } catch {
    return "";
  }
  if (!rows.length) return "";

  const newest = new Date(rows[0].created_at);
  const when = newest.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  const lines: string[] = [];
  let used = 0;
  for (const row of rows.slice().reverse()) {
    const line = `- ${row.role === "user" ? "them" : "you"}: ${truncate(row.content, MAX_TURN_CHARS)}`;
    if (used + line.length > MAX_SECTION_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return "";

  return `

## WHAT YOU REMEMBER (recent conversations with this user)

These notes run through ${when}. Nothing newer is stored, and they may overlap with the current chat. You may reference this work naturally (for example, "last time we were getting your application ready"), with its real date when asked. NEVER claim to remember anything not listed here -- if they ask about something older, say you only keep recent notes.
${lines.join("\n")}`;
}
