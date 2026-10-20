/** What a check found: how much, and a short sample for a rule's evidence to quote. */
export type Finding = { value: number; sample: string };

export const NO_FINDING: Finding = { value: 0, sample: "" };

/** Characters a quoted sample may run to, its ellipsis included. */
const QUOTE_LENGTH = 80;

/** One line of at most 80 characters; a longer one is cut where a word ends and ends in "…". */
export function quote(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= QUOTE_LENGTH) return line;
  const room = line.slice(0, QUOTE_LENGTH - 1);
  const space = room.lastIndexOf(" ");
  // No word break in a sample-long word: cut it.
  return `${space > 0 ? room.slice(0, space) : room}…`;
}
