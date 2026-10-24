import type { AtsEnginePolicy } from "../policy/schema.js";
import { wordListPattern } from "../text/text.js";
import {
  isPlace,
  namesPlace,
  organisationWordsOf,
  placeWords,
  splitTitleAndEmployer,
  titleWordsOf,
} from "./experience.js";
import { isSectionHeading, sectionKind } from "./sections.js";
import { knownTerms } from "../matching/vocabulary.js";
import { memo } from "../util/memo.js";
import { own } from "../util/own.js";

// Email and link patterns match address grammars, not vocabulary, so they live here, not in the policy.

/**
 * An email address, bounded to stay linear (the unbounded form is quadratic on "a.a.a.…"): the
 * lookbehind anchors a match at the start of a local-part run, and lengths are RFC 5321's limits.
 * The local part may hold accented Latin letters and an apostrophe ("o'connor.pat@example.com"),
 * but not first (a quote), and not letters of another script (a glued label: "邮箱jane@x.com").
 */
export const EMAIL =
  /(?<![\p{sc=Latn}\p{M}\p{N}._%+-]|[\p{sc=Latn}\p{M}\p{N}]['’])[\p{sc=Latn}\p{M}\p{N}._%+-][\p{sc=Latn}\p{M}\p{N}._%+'’-]{0,63}@[A-Z0-9-]{1,63}(?:\.[A-Z0-9-]{1,63}){0,8}\.[A-Z]{2,24}\b/iu;
/**
 * A web address: with a scheme or "www.", a profile on a site resumes link to ("dribbble.com/jane"),
 * or a personal `.dev` site. Not one inside an email address. A comma inside it is its own
 * ("?ids=1,2"); one before a space or a bar ends it.
 */
export const LINK =
  /(?:https?:\/\/|www\.)(?:[^\s|,]|,(?=[^\s|,]))+|(?:linkedin\.com|github\.com|gitlab\.com|bitbucket\.org|dribbble\.com|behance\.net|orcid\.org|medium\.com|stackoverflow\.com|kaggle\.com|scholar\.google\.com)\/(?:[^\s|,]|,(?=[^\s|,]))+|(?<![\w.@/-])[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9][a-z0-9-]{0,62}){0,3}\.dev(?![\w@-])(?:\/[^\s|,]*)?/gi;

/** A LinkedIn profile's address, printed in a LinkedIn export's contact block. */
const LINKEDIN_PROFILE = /linkedin\.com\/in\//i;

/** A word of a name: capitalised in a script with case ("O'Brien", "F."), or any word in a script without. */
const NAME_WORD = /^(?:\p{Lu}|\p{Lo})[\p{L}\p{M}'’.-]*$/u;

/** A credential after a name: short, an abbreviation (two capitals or a full stop). */
const isPostNominal = (token: string) =>
  /^[\p{L}.]{2,8}$/u.test(token) && (token.includes(".") || /\p{Lu}[\p{L}.]*\p{Lu}/u.test(token));

/**
 * The line without the credentials after the name ("Jane Doe, PhD"), and the parts cut. Walks the
 * comma-separated parts from the end, each read once (a regex repeating a letter group backtracks).
 */
function withoutPostNominals(line: string) {
  const parts = line.split(",");
  let cut = parts.length;
  let stripped = false;
  while (cut > 1) {
    const tokens = parts[cut - 1].trim().split(/\s+/).filter(Boolean);
    // An empty part is only a trailing comma; elsewhere it ends the run.
    if (tokens.length === 0 ? cut !== parts.length : !tokens.every(isPostNominal)) break;
    stripped ||= tokens.length > 0;
    cut -= 1;
  }
  return stripped
    ? { text: parts.slice(0, cut).join(","), tail: parts.slice(cut).map((part) => part.trim()) }
    : { text: line, tail: [] };
}

/**
 * The name without the honorifics before it ("Dr. Jane Doe", "Prof. Dr. Hans Müller"), cut only
 * while two words remain. Undotted capitals are initials ("MS Dhoni").
 */
function withoutPrefixes(text: string, prefix: RegExp) {
  let rest = text.trimStart();
  for (let cut = 0; cut < 4; cut += 1) {
    const match = prefix.exec(rest)?.[0];
    if (!match) break;
    const after = rest.slice(match.length).trimStart();
    // Undotted capitals are initials as often as an honorific: "MS Dhoni", "MS DHONI SINGH".
    if (!match.includes(".") && /\p{Lu}/u.test(match) && match === match.toUpperCase()) break;
    if (after.split(/\s+/).length < 2) break;
    rest = after;
  }
  return rest;
}

const birthPattern = memo(
  (rp: AtsEnginePolicy["resumeParse"]) =>
    new RegExp(
      String.raw`${wordListPattern(rp.dateOfBirthLabels)}.{0,40}?(?:(?<!\d)(?:19|20)\d{2}(?!\d)|(?<!\d)\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}(?!\d))`,
      "iu",
    ),
);

/**
 * Whether the resume states a date of birth: a policy label with a date or year after it on the
 * same line ("Born 1990"). The date separates it from "a born leader with 8 years of experience".
 */
export function statesDateOfBirth(lines: string[], policy: AtsEnginePolicy) {
  const re = birthPattern(policy.resumeParse);
  return lines.some((line) => re.test(line));
}

const nameVocabulary = memo(
  ({
    nameParticles,
    documentTitles,
    nameLabels,
    notNames,
    namePrefixes,
  }: AtsEnginePolicy["resumeParse"]) => ({
    particles: new RegExp(`^(?:${nameParticles.join("|")})$`, "u"),
    prefix: new RegExp(String.raw`^(?:${namePrefixes.join("|") || "(?!)"})(?=\s)`, "iu"),
    titles: new RegExp(`^(?:${documentTitles.join("|")})$`, "iu"),
    notNames: new RegExp(`^(?:${(notNames ?? ["(?!)"]).join("|")})$`, "iu"),
    label: new RegExp(String.raw`^${wordListPattern(nameLabels)}\s*[:：]\s*`, "iu"),
  }),
);

/**
 * Whether a reading of a name is, as a whole, a tagline (`resumeParse.notNames`: "Open Source")
 * or a term the policy knows ("Machine Learning"), or a word of it is a section heading: a tagline
 * the email or a link spells. A name holding a term ("Sean Go", "Vue Nguyen") is still a name.
 */
function namesTerm(name: string, policy: AtsEnginePolicy) {
  const km = policy.keywordMatch;
  const whole = name.trim().replace(/\s+/gu, " ");
  const lower = whole.toLowerCase();
  return (
    nameVocabulary(policy.resumeParse).notNames.test(lower.replace(/-/g, " ")) ||
    knownTerms(km).has(own(km.synonyms, lower) ?? lower) ||
    whole.split(" ").some((word) => isSectionHeading(word, policy))
  );
}

/** Where a contact line puts one detail after the next. Spaces match from the start of their run to stay linear. */
const CONTACT_SEPARATOR = /(?<!\s)\s*[|·•,]\s*|\t|\s{2,}|(?<!\s)\s+[–—-]\s+/;

/**
 * The part of a line that could be the name: after a "Name:" label, and on a contact line with an
 * email or number, or a line with a job title after its first separator that the email or a
 * profile link spells (`spells`: "Mira Kestrel | Data Analyst" with mira.kestrel@…), the part
 * before that separator (`split`), plus the part after a comma (`tail`: "NY" in "New York, NY |
 * jane@…").
 * Any tagline has the shape of "Name | Title" ("Los Angeles | Software Engineer").
 */
function nameCandidate(
  line: string,
  label: RegExp,
  titleWords: RegExp,
  spells: (text: string) => boolean,
) {
  const value = line.replace(label, "");
  const parts = value.split(CONTACT_SEPARATOR);
  const first = parts[0] ?? "";
  const titled = !EMAIL.test(value) && !/\d/.test(value);
  if (titled && !(titleWords.test(parts[1] ?? "") && spells(first)))
    return { text: value, tail: [] };
  if (EMAIL.test(first) || /\d/.test(first) || first === value) return null;
  const comma = value.slice(first.length).trimStart().startsWith(",");
  return { text: first, split: true, tail: comma && parts[1] ? [parts[1].trim()] : [], titled };
}

/**
 * The candidate's name, from the first few lines: the first that reads like a person, not a
 * contact detail or job title. Not finding one usually means the name is in an image.
 *
 * A name is two to five name words, lowercase particles allowed between them ("Ludwig van
 * Beethoven"), credentials after a comma left off, an all-caps banner allowed. A single word
 * qualifies only as the very first line (a mononym), never as a section heading or the
 * document's title ("Resume").
 *
 * `headlined`: the name was read over a headline further down, or over its email under a list
 * heading, where a sidebar read before the main column leaves it.
 */
export function findName(
  lines: string[],
  policy: AtsEnginePolicy,
): { name: string; headlined: boolean } {
  const { particles, titles, label, prefix } = nameVocabulary(policy.resumeParse);
  const trimmed = lines.map((line) => line.trim()).filter(Boolean);
  const titleWords = titleWordsOf(policy);
  const organisation = organisationWordsOf(policy);
  const { code, postNominal } = placeWords(policy);
  // A comma tail of state codes and no credential ("Austin, TX 78701"); "MD" reads as the credential.
  const isPlaceTail = (tail: readonly string[]) =>
    tail.length > 0 &&
    tail.every((part) => code.test(part.replace(/\s\d{5}(?:-\d{4})?$/u, ""))) &&
    !tail.some((part) => postNominal.test(part));

  // A letter-spaced name can lose its word gap ("JANEDOE"); when the email's name parts spell it
  // exactly ("jane.doe@…"), split it where they split.
  const header = trimmed.slice(0, 12).join("\n");
  const emailParts =
    header
      .match(EMAIL)?.[0]
      ?.split("@")[0]
      ?.split(/[._-]+/)
      .filter((part) => /^\p{L}{2,}$/u.test(part)) ?? [];
  const spelledByEmail = (text: string) => {
    if (emailParts.length < 2) return text;
    const letters = text.split(/\s+/);
    const word = letters.every((letter) => [...letter].length === 1) ? letters.join("") : text;
    if (/\s/.test(word) || emailParts.join("").toLowerCase() !== word.toLowerCase()) return text;
    let at = 0;
    return emailParts
      .map((part) => {
        const piece = word.slice(at, at + part.length);
        at += part.length;
        return piece;
      })
      .join(" ");
  };
  // The words of the email's name part, and of each link's last path part ("mira-kestrel" in
  // "linkedin.com/in/mira-kestrel/", not "linkedin" or "in"), without accents.
  const plain = (word: string) =>
    word
      .normalize("NFD")
      .replace(/[^\p{L}]/gu, "")
      .toLowerCase();
  const handles = [
    emailParts.join(" "),
    ...(header.match(LINK) ?? []).map((link) => link.split("/").filter(Boolean).pop()!),
  ].map((handle) => new Set(handle.split(/[^\p{L}\p{M}]+/u).map(plain)));
  // Whether one email or one link spells every word of a name, particles aside ("mira.kestrel@…"),
  // or its initials and surname ("mkestrel@…").
  const spelled = (text: string) => {
    const forms = text
      .split(/\s+/)
      .filter((word) => !particles.test(word))
      .map(plain);
    const initials =
      forms
        .map((form) => form[0])
        .join("")
        .slice(0, -1) + forms.at(-1);
    // A one-word name is never split from its title or read surname first: no need to refuse it.
    return handles.some((words) => words.has(initials) || forms.every((form) => words.has(form)));
  };

  /** The name a line holds, or null. */
  const nameIn = (line: string, index: number, firstLine: boolean) => {
    const found = nameCandidate(line, label, titleWords, spelled);
    if (found === null || titles.test(found.text)) return null;
    const candidate = { ...found, text: withoutPrefixes(found.text, prefix) };

    // "Kestrel, Mira" at the very top: a one-word surname first, read in the order the name is
    // spoken. Two skills or a place have the same shape ("Java, Spring", "Austin, TX"), so it is
    // read only when the email or a profile link spells it ("mira.kestrel@…",
    // "…/in/mira-kestrel"), never when the line names a state or a country or its given name is a
    // state's code or it is a term the policy knows ("Learning, Machine"), and never over a name
    // further down.
    const [surname = "", ...after] = candidate.text.split(",");
    const given = withoutPostNominals(after.join(","));
    const reversed =
      index === 0 &&
      after.length > 0 &&
      /^\S+$/u.test(surname.trim()) &&
      !namesPlace(candidate.text, policy) &&
      !code.test(given.text.trim()) &&
      spelled(`${given.text.trim()} ${surname}`) &&
      !namesTerm(`${given.text.trim()} ${surname.trim()}`, policy);
    const cut = reversed
      ? { text: `${given.text.trim()} ${surname.trim()}`, tail: given.tail }
      : withoutPostNominals(candidate.text);
    const place = !reversed && isPlaceTail(candidate.split ? candidate.tail : cut.tail);
    const name = spelledByEmail(cut.text.trim());
    // "New York, NY | jane@…" opens with the city, not the name.
    if (candidate.split && place) return null;
    const words = name.split(/\s+/);
    const named = words.filter((word) => !particles.test(word));
    // A name shares a line with contact details only at the top, in two words or more.
    if (candidate.split && (!firstLine || named.length < 2)) return null;
    if (named.length === 0 || named.length > 5 || words.length > 7) return null;
    if (!named.every((word) => NAME_WORD.test(word))) return null;
    // Particles sit between the words they join, never at the ends.
    if (particles.test(words[0]) || particles.test(words[words.length - 1])) return null;
    if (named.length === 1 && index > 0) return null;
    // A headline ("Senior Software Engineer") has the shape of a name, and so does an employer
    // before a title ("Acme Corp | Senior Engineer").
    if (isSectionHeading(name, policy) || titleWords.test(name)) return null;
    if (candidate.titled && organisation.test(name)) return null;
    // A term the email or a link spells: "Open Source | Software Engineer" with github.com/open-source.
    if (candidate.titled && namesTerm(name, policy)) return null;
    // "San Francisco, CA" loses its state like a credential, and is a place: the weakest reading,
    // with a name before a title or surname first, which are only ever on the first line.
    return { name, cut: cut.tail.length > 0, place: place || candidate.titled || reversed };
  };

  // A name directly above a headline ("LUCAS MOREAU" over "Senior Product Designer") is the name
  // wherever the reading order put it, never from the work history. A headline may run on after
  // its title ("Senior Engineer at Acme Corp | Building payment systems"): the title is judged.
  const headlined = () => {
    for (const [index, line] of trimmed.slice(0, 40).entries()) {
      if (sectionKind(line, policy) === "experience") break;
      const next = trimmed[index + 1];
      const title = next ? splitTitleAndEmployer(next, policy).title : "";
      if (!next?.startsWith(title) || title.split(/\s+/).length > 6 || !titleWords.test(title))
        continue;
      if (isSectionHeading(next, policy)) continue;
      const found = nameIn(line, index + 1, false);
      if (found && !found.cut) return found.name;
    }
    return exported();
  };

  // A LinkedIn export read sidebar first (profile address, then "Top Skills" and its rows): the
  // name is over the headline, and the headline over where the person is. Only under the skills
  // heading after the address and before any other heading; never an organisation's name.
  const exported = () => {
    const profile = trimmed.slice(0, 40).findIndex((line) => LINKEDIN_PROFILE.test(line));
    if (profile === -1) return "";
    let skills = false;
    for (let at = profile + 1; at < Math.min(trimmed.length, 40); at += 1) {
      const line = trimmed[at]!;
      const kind = sectionKind(line, policy);
      if (kind === "skills") skills = true;
      else if (kind !== null) break;
      if (!skills || kind !== null) continue;
      const [headline, where] = [trimmed[at + 1], trimmed[at + 2]];
      if (!headline || !where || !isPlace(where, policy) || isPlace(headline, policy)) continue;
      if (isSectionHeading(headline, policy) || organisation.test(line)) continue;
      const found = nameIn(line, at + 1, false);
      if (found && !found.cut && !found.place) return found.name;
    }
    return "";
  };

  // Only lines above that cannot be the name: the title, a section heading. A name with credentials
  // cut is still the name; one whose cut tail is a state is a place, taken only when no other name
  // is found. Under a sidebar's list heading a name is more likely one of its rows, so a name over
  // a headline further down comes first; one over the email is the name, before any further down.
  // A name before a title or surname first is on the first line, so it comes before a place.
  let onlyHeadingsAbove = true;
  let place = "";
  let listed = false;
  // The last heading's kind: a name over an email is the name under a list, not a referee's.
  let under: string | null = null;
  let row = "";
  for (const [index, line] of trimmed.slice(0, 6).entries()) {
    // The work history is never the header block.
    const kind = sectionKind(line, policy);
    if (kind === "experience") break;
    listed ||= kind !== null && kind !== "other";
    under = kind ?? under;
    const firstLine = onlyHeadingsAbove;
    onlyHeadingsAbove &&= titles.test(line) || isSectionHeading(line, policy);
    const found = nameIn(line, index, firstLine);
    if (!found) continue;
    if (found.place) place ||= found.name;
    else if (!listed) return { name: found.name, headlined: false };
    else if (under !== "other" && EMAIL.test(trimmed[index + 1] ?? ""))
      return { name: found.name, headlined: true };
    else row ||= found.name;
  }
  const over = headlined();
  return over ? { name: over, headlined: true } : { name: row || place, headlined: false };
}
