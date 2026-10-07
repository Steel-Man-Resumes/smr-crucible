/**
 * Placeholder text for the bullet workshop and the bullet box it opens from.
 *
 * Never a number, a range or a sample count. An example figure in an empty box
 * acts as a memory anchor: people copy it, or nudge it, instead of recalling
 * their own. The count questions name the thing to count and nothing else.
 * (Plain words for the other questions are fine; there is a test that no
 * placeholder here contains a digit.)
 */
export const WORKSHOP_PLACEHOLDERS = {
  did: "e.g., loaded trucks and kept track of inventory",
  tools: "e.g., forklift, RF scanner, Excel",
  often: "e.g., every shift, daily, during peak season",
  quantity: "How many people, orders or loads? Only if you know.",
  improved: "e.g., fewer mistakes, faster loading, kept the team on schedule",
} as const;

/** The first bullet box on a position. Names the shape of a good line, with no sample figure. */
export const FIRST_BULLET_PLACEHOLDER =
  "What you did, and what came of it. Add a number only if you know it is true.";
