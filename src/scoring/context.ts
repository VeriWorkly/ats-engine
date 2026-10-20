import { citationLines, fullCitations, roleBodyLines } from "../checks/bullets.js";
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

const MIN_BULLETS = 3;

/**
 * Content lines, which both ratio metrics divide by: the bullets when there are any, else full
 * sentences (a content verb from `policy.text.contentLineVerbs`, or four words), not headings,
 * skill tags or layout debris.
 */
const contentLineTest = memo((text: AtsEnginePolicy["text"]) => {
  const verbs = wordListRegex(text.contentLineVerbs);
  return (line: string) => verbs.test(line) || line.split(/\s+/).length >= 4;
});

/** List-marked lines or, if extraction lost the markers, the sentences under each dated role. */
function bulletsOf(lines: string[], policy: AtsEnginePolicy, cited: Set<string>) {
  const bullets = lines.filter((line) => BULLET.test(line) && !cited.has(line));
  return bullets.length >= MIN_BULLETS ? bullets : roleBodyLines(lines, policy);
}

/** Never a list of works' lines (`citationLines`): a citation opens with its authors. */
const contentLinesOf = (
  lines: string[],
  bullets: string[],
  policy: AtsEnginePolicy,
  cited: Set<string>,
) =>
  bullets.length
    ? bullets
    : lines.filter((line) => contentLineTest(policy.text)(line) && !cited.has(line));

export type ReadResume = {
  ctx: RuleContext;
  lines: string[];
  sections: ResumeSection[];
  parsed: AtsParsedResume;
};

/**
 * Everything the rules read about one resume, read once, so every check agrees on what a line and
 * a section are. A structured document is read from its fields, text is parsed.
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
    /** Language packs the resume is written in, or "und"; see `RuleContext.languages`. */
    languages?: readonly string[];
  },
): ReadResume {
  const { lines, spaced } = readResumeLines(prepared.text.split(/\n+/), policy);
  const sections = readSections(lines, policy);
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  const parsed = prepared.document
    ? parseResumeDocument(prepared.document, policy, now)
    : parseReadLines(lines, policy, now, sections);
  const cited = citationLines(lines, policy);
  const bullets = bulletsOf(lines, policy, cited);
  const roles = roleBlocks(sections, policy);

  const ctx: RuleContext = {
    text,
    wordCount: words(text).length,
    lines,
    headingLines: lines.filter(isHeadingLine),
    contact: { email: parsed.email, phone: parsed.phone },
    sections: headedKinds(sections),
    contentLines: contentLinesOf(lines, bullets, policy, cited),
    languages: languages.length ? languages : [policy.text.language],
    letterSpacedLines: spaced,
    layout,
    quality: {
      ...parseQuality(parsed),
      dateOfBirthStated: Number(statesDateOfBirth(lines, policy)),
    },
    findings: {
      injectionPhrases: injectionPhrases(
        // By line: a quote is excused by a word on its own line saying it was caught.
        lines.join("\n"),
        // Text no reader sees (no quote excuses it), plus "#" lines as written: the line reader
        // drops a heading's marks, and "### System:" is a prompt delimiter.
        [
          prepared.hidden.smuggled,
          layout?.hiddenText ?? "",
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
      stuffedTerms: stuffedTerms(lines, policy, now, parsed.name ?? "", fullCitations(cited)),
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
