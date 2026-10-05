import type { AtsEnginePolicy } from "../policy/schema.js";
import { wordListPattern } from "../text/text.js";
import { titleWordsOf } from "./experience.js";
import { isSectionHeading, sectionKind } from "./sections.js";
import { memo } from "../util/memo.js";

/**
 * Contact recovery.
 *
 * The email and link patterns stay in source rather than in the policy: they match address
 * grammars (RFC-ish email, URL) rather than any language's vocabulary, so they do not move when
 * the resume is written in another language. The policy owns words; this owns punctuation.
 * Phone numbers are country-shaped, not language-shaped, and are read in `phone.ts`.
 */

/**
 * Bounded on purpose. The unbounded form (`[A-Z0-9._%+-]+@[A-Z0-9.-]+`) restarts its scan at
 * every position of a long run like "a.a.a.…", which is quadratic: a 50k-character input took
 * over a second per call, and a scan evaluates this pattern about nine times. The lookbehind
 * anchors a match to the start of a local-part run, and the lengths are RFC 5321's own limits.
 */
export const EMAIL =
  /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]{1,64}@[A-Z0-9-]{1,63}(?:\.[A-Z0-9-]{1,63}){0,8}\.[A-Z]{2,24}\b/i;
/**
 * A web address: with a scheme or "www.", a profile on a site resumes link to without either
 * ("dribbble.com/jane", "orcid.org/0000-…"), or a personal site on `.dev`, a top-level domain
 * that names nothing but websites ("janedoe.dev"). Not one inside an email address.
 */
export const LINK =
  /(?:https?:\/\/|www\.)[^\s|,]+|(?:linkedin\.com|github\.com|gitlab\.com|bitbucket\.org|dribbble\.com|behance\.net|orcid\.org|medium\.com|stackoverflow\.com|kaggle\.com|scholar\.google\.com)\/[^\s|,]+|(?<![\w.@/-])[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9][a-z0-9-]{0,62}){0,3}\.dev(?![\w@-])(?:\/[^\s|,]*)?/gi;

/**
 * A word of a name: capitalised in a script with case ("Jane", "DOE", "O'Brien", "F."), or any
 * word in a script without one (Devanagari, Arabic, Han), where capitals carry no signal.
 */
const NAME_WORD = /^(?:\p{Lu}|\p{Lo})[\p{L}\p{M}'’.-]*$/u;

/** A credential after a name: short, and read as an abbreviation — two capitals or a full stop. */
const isPostNominal = (token: string) =>
  /^[\p{L}.]{2,8}$/u.test(token) && (token.includes(".") || /\p{Lu}[\p{L}.]*\p{Lu}/u.test(token));

/**
 * The line without the credentials after the name: "Jane Doe, PhD", "Raj Patel, M.D., CPA".
 *
 * Walks the comma-separated parts from the end and stops at the first that is not all
 * credentials, so each part is read once. It was a regex repeating a group of letters, which
 * tried every partition of a letter run that did not end the line: a 60-byte name line held the
 * thread for seconds, and each further letter multiplied that.
 */
function withoutPostNominals(line: string) {
  const parts = line.split(",");
  let cut = parts.length;
  let stripped = false;
  while (cut > 1) {
    const tokens = parts[cut - 1].trim().split(/\s+/).filter(Boolean);
    // An empty part is only a trailing comma ("Jane Doe, PhD, "); anywhere else it ends the run.
    if (tokens.length === 0 ? cut !== parts.length : !tokens.every(isPostNominal)) break;
    stripped ||= tokens.length > 0;
    cut -= 1;
  }
  return stripped ? parts.slice(0, cut).join(",") : line;
}

const birthPattern = memo(
  (rp: AtsEnginePolicy["resumeParse"]) =>
    new RegExp(
      String.raw`${wordListPattern(rp.dateOfBirthLabels)}.{0,40}?(?:(?<!\d)(?:19|20)\d{2}(?!\d)|(?<!\d)\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}(?!\d))`,
      "iu",
    ),
);

/**
 * Whether the resume states a date of birth: one of the policy's labels with a date or a year
 * after it on the same line ("Date of birth: 04.05.1990", "Born 1990"). The date is what
 * separates the personal detail from "a born leader with 8 years of experience" or "born and
 * raised in Chennai, 2 kids": any other number is not one.
 */
export function statesDateOfBirth(lines: string[], policy: AtsEnginePolicy) {
  const re = birthPattern(policy.resumeParse);
  return lines.some((line) => re.test(line));
}

const nameVocabulary = memo(
  ({ nameParticles, documentTitles, nameLabels }: AtsEnginePolicy["resumeParse"]) => ({
    particles: new RegExp(`^(?:${nameParticles.join("|")})$`, "u"),
    titles: new RegExp(`^(?:${documentTitles.join("|")})$`, "iu"),
    label: new RegExp(String.raw`^${wordListPattern(nameLabels)}\s*[:：]\s*`, "iu"),
  }),
);

/** Where a contact line puts one detail after the next: "Jane Doe | jane@… | 415-…". */
// Each run of spaces is matched from its start: from inside it, a long run with no separator
// after it would be rescanned from every position.
const CONTACT_SEPARATOR = /(?<!\s)\s*[|·•,]\s*|\t|\s{2,}|(?<!\s)\s+[–—-]\s+/;

/**
 * The part of a line that could be the name: after a "Name:" label, and on a contact line that
 * also holds an email or a number, the part before the first separator (`split`).
 */
function nameCandidate(line: string, label: RegExp) {
  const value = line.replace(label, "");
  if (!EMAIL.test(value) && !/\d/.test(value)) return { text: value, split: false };
  const first = value.split(CONTACT_SEPARATOR)[0] ?? "";
  return EMAIL.test(first) || /\d/.test(first) || first === value
    ? null
    : { text: first, split: true };
}

/**
 * The candidate's name, taken from the top of the document.
 *
 * An ATS reads the name from the header block, so this looks only at the first few lines and
 * takes the first that reads like a person rather than a contact detail or a job title. Getting
 * this wrong is cheap — it is reported, not scored on its content — but not finding one at all
 * is worth knowing, because it usually means the name is inside an image or a text box.
 *
 * A name is two to five name words, with lowercase particles allowed between them ("Ludwig van
 * Beethoven") and credentials after a comma left off ("Jane Doe, PhD"). An all-caps banner
 * qualifies. A single word qualifies only as the very first line — that is where a mononym
 * ("Suharto") sits, and anywhere lower a lone capitalised word is far more likely a heading — and
 * never when it is a section heading or the document's own title ("Resume").
 */
export function findName(lines: string[], policy: AtsEnginePolicy) {
  const { particles, titles, label } = nameVocabulary(policy.resumeParse);
  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  const titleWords = titleWordsOf(policy);

  /** The name a line holds, or null. */
  const nameIn = (line: string, index: number, firstLine: boolean) => {
    const candidate = nameCandidate(line, label);
    if (candidate === null || titles.test(candidate.text)) return null;

    const name = withoutPostNominals(candidate.text).trim();
    const words = name.split(/\s+/);
    const named = words.filter((word) => !particles.test(word));
    // A name shares a line with the contact details only at the top, and is two words or more:
    // further down, "San Francisco, CA | 415-555-0142" is an address.
    if (candidate.split && (!firstLine || named.length < 2)) return null;
    if (named.length === 0 || named.length > 5 || words.length > 7) return null;
    if (!named.every((word) => NAME_WORD.test(word))) return null;
    // Particles sit between the words they join, never at the ends.
    if (particles.test(words[0]) || particles.test(words[words.length - 1])) return null;
    if (named.length === 1 && index > 0) return null;
    // A headline ("Senior Software Engineer") has the shape of a name, and is what this used to
    // return when the real name was in an image.
    if (isSectionHeading(name, policy) || titleWords.test(name)) return null;
    // "Jane Doe, PhD" loses its credential; "San Francisco, CA" loses its state the same way,
    // so a name found only by cutting a comma tail is the weaker reading.
    return { name, cut: name !== candidate.text.trim() };
  };

  // A name directly above a headline ("LUCAS MOREAU" over "Senior Product Designer") is the
  // name, wherever the reading order put it: a sidebar read first pushes it below the contact
  // block, out of the first few lines. Never from the work history, where "Acme Corporation"
  // over "Senior Engineer" has the same shape.
  const headlined = () => {
    for (const [index, line] of trimmed.slice(0, 40).entries()) {
      if (sectionKind(line, policy) === "experience") break;
      const next = trimmed[index + 1];
      if (!next || next.split(/\s+/).length > 6 || !titleWords.test(next)) continue;
      if (isSectionHeading(next, policy)) continue;
      const found = nameIn(line, index + 1, false);
      if (found && !found.cut) return found.name;
    }
    return "";
  };

  // Only lines above that cannot be the name: the document's title, a section heading.
  let onlyHeadingsAbove = true;
  for (const [index, line] of trimmed.slice(0, 6).entries()) {
    // The work history is never the header block, whatever is missing above it.
    if (sectionKind(line, policy) === "experience") break;
    const firstLine = onlyHeadingsAbove;
    onlyHeadingsAbove &&= titles.test(line) || isSectionHeading(line, policy);
    const found = nameIn(line, index, firstLine);
    if (!found) continue;
    return found.cut ? headlined() || found.name : found.name;
  }
  return headlined();
}
