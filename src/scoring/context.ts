import { roleBodyLines } from "../checks/bullets.js";
import {
  copiedPosting,
  homoglyphWords,
  injectionPhrases,
  stuffedTerms,
} from "../checks/integrity/text.js";
import { unsupportedSkills } from "../checks/skills.js";
import { timelineIssues } from "../checks/timeline.js";
import {
  bulletsPerRole,
  dateFormats,
  firstPersonLines,
  longBullets,
  passiveVoice,
  repeatedOpeners,
  roleBlocks,
  tenseMismatches,
  weakOpeners,
} from "../checks/writing.js";
import { parseResumeDocument } from "../document/parse.js";
import type { PreparedResume } from "../input.js";
import { BULLET, wordListRegex, words } from "../text/text.js";
import { statesDateOfBirth } from "../parser/contact.js";
import { parseQuality, parseReadLines, readSections } from "../parser/index.js";
import { readResumeLines } from "../parser/lines.js";
import { headedKinds, isHeadingLine, type ResumeSection } from "../parser/sections.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsLayoutSignals, AtsParsedResume } from "../types.js";
import { memo } from "../util/memo.js";
import type { RuleContext } from "./rules.js";

/**
 * Lines that carry substantive content, which both ratio metrics divide by.
 *
 * On a resume written in bullets, that is the bullets: they are what "open each bullet with a
 * verb" and "quantify outcomes" are about, and counting the lines around them too — headers,
 * contact rows, a summary — graded a resume on how many of those it had. A two-line PDF header
 * row was enough to flip the verb check on an otherwise identical resume.
 *
 * Without bullets (prose, or a list whose markers did not survive extraction) it falls back to
 * full sentences: lines naming a content verb or running to four words, as opposed to headings,
 * short skill tags and layout debris. The verb list comes from `policy.text.contentLineVerbs`,
 * so a policy in another language brings its own.
 */
const MIN_BULLETS = 3;
const contentLineTest = memo((text: AtsEnginePolicy["text"]) => {
  const verbs = wordListRegex(text.contentLineVerbs);
  return (line: string) => verbs.test(line) || line.split(/\s+/).length >= 4;
});

/**
 * The bullets: the lines with a list marker or, where the markers were lost in extraction, the
 * sentences under each dated role, as the bullets were. Empty when there are neither.
 */
function bulletsOf(lines: string[], policy: AtsEnginePolicy) {
  const bullets = lines.filter((line) => BULLET.test(line));
  return bullets.length >= MIN_BULLETS ? bullets : roleBodyLines(lines, policy);
}

const contentLinesOf = (lines: string[], bullets: string[], policy: AtsEnginePolicy) =>
  bullets.length ? bullets : lines.filter(contentLineTest(policy.text));

export type ReadResume = {
  ctx: RuleContext;
  lines: string[];
  sections: ResumeSection[];
  parsed: AtsParsedResume;
};

/**
 * Everything the rules read about one resume, read once.
 *
 * The lines are read before anything else sees them — wrapped lines rejoined, letter-spaced ones
 * read back — and segmented once, so the word count, the parser, the heading rules, the skills
 * check and the requirements all agree on what a line and a section are. The same pass gives the
 * report's recovered fields: a structured document is read from its fields, text is parsed.
 */
export function readResume(
  prepared: PreparedResume,
  policy: AtsEnginePolicy,
  {
    jobDescription,
    layout,
    now,
    languages = [],
  }: {
    jobDescription?: string;
    layout?: AtsLayoutSignals;
    now: Date;
    /** The attached language packs the resume itself is written in; see `RuleContext.languages`. */
    languages?: readonly string[];
  },
): ReadResume {
  const { lines, spaced } = readResumeLines(prepared.text.split(/\n+/), policy);
  const sections = readSections(lines, policy);
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  const parsed = prepared.document
    ? parseResumeDocument(prepared.document, policy, now)
    : parseReadLines(lines, policy, now, sections);
  // The writing rules read bullets only: a summary paragraph is not one, nor a contact row.
  const bullets = bulletsOf(lines, policy);
  const roles = roleBlocks(sections, policy);

  const ctx: RuleContext = {
    text,
    wordCount: words(text).length,
    lines,
    headingLines: lines.filter(isHeadingLine),
    contact: { email: parsed.email, phone: parsed.phone },
    sections: headedKinds(sections),
    contentLines: contentLinesOf(lines, bullets, policy),
    languages: languages.length ? languages : [policy.text.language],
    letterSpacedLines: spaced,
    layout,
    quality: {
      ...parseQuality(parsed),
      dateOfBirthStated: Number(statesDateOfBirth(lines, policy)),
    },
    findings: {
      injectionPhrases: injectionPhrases(
        // By line: a quote is excused by the word on its own line that says it was caught.
        lines.join("\n"),
        // Text no reader sees: smuggled in tag characters, or in the file's metadata. And lines
        // opening with "#" as written: the line reader drops a Markdown heading's marks, and
        // "### System:" is a prompt delimiter with them.
        [
          prepared.hidden.smuggled,
          layout?.metadataText ?? "",
          ...prepared.text.split("\n").filter((line) => line.trimStart().startsWith("#")),
        ].join("\n"),
        policy,
      ),
      invisibleCharacters: {
        value: prepared.hidden.count,
        sample: prepared.hidden.smuggled.slice(0, 80),
      },
      homoglyphWords: homoglyphWords(text),
      copiedPostingRatio: jobDescription?.trim() ? copiedPosting(text, jobDescription) : null,
      stuffedTerms: stuffedTerms(text, lines, policy, now),
      timelineIssues: timelineIssues(parsed.roles, parsed.monthsOfExperience, now),
      unsupportedSkills: unsupportedSkills(sections, parsed.skills),
      firstPersonLines: firstPersonLines(bullets, policy),
      passiveVoiceRatio: passiveVoice(bullets, policy),
      weakOpeners: weakOpeners(bullets, policy),
      longBullets: longBullets(bullets, policy),
      tenseMismatches: tenseMismatches(roles, policy),
      bulletsPerRole: bulletsPerRole(roles, policy),
      repeatedOpeners: repeatedOpeners(roles, policy),
      dateFormats: dateFormats(roles, policy),
    },
    policy,
  };
  return { ctx, lines, sections, parsed };
}
