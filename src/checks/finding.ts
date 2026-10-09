/**
 * The result of a check that reads the resume itself rather than a single count: how much it
 * found, and a short sample of it, so a rule's evidence can quote the text in question.
 */
export type Finding = { value: number; sample: string };

export const NO_FINDING: Finding = { value: 0, sample: "" };

/** Characters a quoted sample may run to, its ellipsis included. */
const QUOTE_LENGTH = 80;

/**
 * A sample fit for a rule's evidence: one line, at most 80 characters. A longer one is cut where
 * a word ends, and ends in "…" so the reader knows it goes on; "from 52% t" said neither.
 */
export function quote(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= QUOTE_LENGTH) return line;
  const room = line.slice(0, QUOTE_LENGTH - 1);
  const space = room.lastIndexOf(" ");
  // A word as long as the whole sample has nowhere to break: cut it.
  return `${space > 0 ? room.slice(0, space) : room}…`;
}
