import { adviceFor, targetOf } from "../advice/index.js";
import { prepareResume, type AtsResumeInput, type PreparedResume } from "../input.js";
import { localizePolicy, type AtsLocaleOptions } from "../locales/resolve.js";
import { computeJobMatch } from "../matching/jobMatch.js";
import { judgeRequirements, withHeadings, type HeadedSection } from "../matching/requirements.js";
import { readingDatesAt } from "../parser/dates.js";
import { DEFAULT_POLICY } from "../policy/default.js";
import { policyFingerprint } from "../policy/fingerprint.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET_PREFIX, normalizeText } from "../text/text.js";
import type { AtsFileInfo, AtsLayoutSignals, AtsReport } from "../types.js";
import { ENGINE_VERSION } from "../version.js";
import { rollUpCategories } from "./categories.js";
import { readResume } from "./context.js";
import { scoreRules, strengthsOf } from "./score.js";

/**
 * Postings past this are cut: every step that reads a posting is linear in it, and a real one
 * is a few thousand characters. The AI tasks cut at the same length.
 */
const MAX_JOB_DESCRIPTION_CHARS = 20_000;

/** Format metrics that measure how the text extracts, as opposed to choices like length. */
const EXTRACTION_METRICS = new Set(["columnRatio", "tableCount", "letterSpacedLines"]);

/** Enough for any resume; a document past it is not one. */
const MAX_REPORTED_LINES = 500;
/** Tries `hiddenCover` makes before leaving the hidden lines to the claiming. */
const MAX_COVER_STEPS = 200_000;
/**
 * Where a line or part of one was set aside, between the text kept on either side: no phrase is
 * read across it, single words read the same, and it is taken out of the evidence quoted. An
 * invisible separator, which the text a resume is read from never holds (`normalizeText` strips
 * it).
 */
const BREAK = "\u2063";

/**
 * What of each resume line is visible: not the text the file's layout reports as hidden (white on
 * white, a 1pt font, off the page). The extractor reports the hidden text in full up to 5,000
 * characters (`hiddenText`); a line is set aside when the hidden text contains it, or, that text being cut, when the line
 * begins with it. The integrity cap on the job match covers whatever is past the cut.
 *
 * Each stretch of hidden text sets aside one line. When the hidden text splits into the lines'
 * texts one way only, lines of those texts are set aside (`hiddenCover`), so a visible line across
 * two hidden ones stays. Else, or when the hidden text is cut, the longest lines claim theirs
 * first: a visible "Kubernetes" skill stays when the hidden text is "Kubernetes Terraform Kafka",
 * which the hidden line of that text claims whole. A line is kept only when every letter of every
 * place the hidden text holds it lies inside text already claimed, so a visible line across two
 * hidden ones never frees them. Hidden text then left over sits inside a visible line, a white
 * "Kafka Kubernetes" after "Senior Engineer": when the layout says which hidden text the lines
 * hold (`hiddenTextRead`), it is cut from the one kept line holding it, and stays when none or two
 * do, word by word (`cutLeftovers`). Only that text is set aside or cut: hidden text the lines do
 * not hold (a Word header's hidden run, an HTML resume's hidden element) is not read by an ATS
 * and costs no visible line. A line under four characters is never set aside, either way, nor a
 * stretch under four cut. Returns, for each pass over the lines, what to read of each: its text, a
 * text with the hidden part cut (marked by `BREAK`), or `undefined`, set aside.
 */
function visibleLines(layout: AtsLayoutSignals | undefined, lines: readonly string[]) {
  const inLines = layout?.hiddenTextRead;
  const full = inLines !== undefined || layout?.hiddenText !== undefined;
  const hidden = normalizeText(inLines ?? layout?.hiddenText ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const textOf = (line: string) => line.replace(BULLET_PREFIX, "").replace(/\s+/g, " ").trim();
  if (!hidden || !layout?.hiddenTextChars)
    return () => (line: string) => line as string | undefined;
  const cut = hidden.length >= (full ? 5_000 : 80);
  const texts = lines.map(textOf);
  // For each text, its copies (counted in reading order) set aside (`undefined`) or cut (the text
  // read instead).
  const read = new Map<string, Map<number, string | undefined>>();
  const copyOf = copies(texts);
  const readAs = (line: number, value: string | undefined) => {
    const text = texts[line]!;
    if (!read.has(text)) read.set(text, new Map());
    read.get(text)!.set(copyOf[line]!, value);
  };
  const cover = cut
    ? undefined
    : hiddenCover(
        hidden,
        texts.map((text) => normalizeText(text).replace(/\s+/g, " ").trim()),
      );
  if (cover) {
    for (const line of cover) if (texts[line]!.length >= 4) readAs(line, undefined);
    return readFilter(read, textOf);
  }
  // `next[i]`: the first position from `i` no line has claimed, its path shortened as it is read,
  // so claiming and asking cost next to nothing however many lines there are.
  const next = Array.from({ length: hidden.length + 1 }, (_, i) => i);
  const free = (i: number) => {
    while (next[i] !== i) i = next[i] = next[next[i]!]!;
    return i;
  };
  // Where a text's next search starts: a second line of the same text claims the next place.
  const from = new Map<string, number>();
  // The first letter from `i` no line has claimed: the space between two claimed lines frees none.
  const letter = (i: number) => {
    for (i = free(i); hidden[i] === " "; i = free(i + 1));
    return i;
  };
  // The longest lines first, and of a text written twice the later copy, as `hiddenCover` takes.
  const order = [...texts.keys()].sort((a, b) => texts[b]!.length - texts[a]!.length || b - a);
  for (const line of order) {
    const text = texts[line]!;
    if (text.length < 4) break;
    let at = hidden.indexOf(text, from.get(text) ?? 0);
    while (at >= 0 && letter(at) >= at + text.length) at = hidden.indexOf(text, at + 1);
    if (at >= 0) {
      from.set(text, at + 1);
      for (let i = free(at); i < at + text.length; i = free(i)) next[i] = i + 1;
    } else if (!(cut && text.startsWith(hidden))) continue;
    readAs(line, undefined);
  }
  if (inLines !== undefined) cutLeftovers();
  return readFilter(read, textOf);

  /**
   * Hidden text no claimed line holds, cut from the one kept line holding it between word ends,
   * word by word: a word is cut when every copy of it the kept lines hold (inside other words and
   * in any case too: "Kafka-based", "kafka") is one the hidden text still owes, so none of them is
   * visible. A word the kept lines hold once more than owed stays: that copy may be the visible
   * one, read where the hidden copy was drawn against punctuation or across a line.
   */
  function cutLeftovers() {
    const kept = [...texts.keys()].filter((line) => !read.get(texts[line]!)?.has(copyOf[line]!));
    const joined = kept.map((line) => texts[line]).join("\n");
    // The texts of the lines set aside. Where the hidden text spells one out whole around a stretch
    // left over, that stretch is another copy of that line, listed twice but read once (a white
    // footer on every page, one Word header in two parts), not hidden text inside a visible line.
    const aside = [...new Set(texts.filter((text, line) => read.get(text)?.has(copyOf[line]!)))];
    const copyOfAside = (at: number, stretch: string) =>
      aside.some((text) => {
        for (let k = text.indexOf(stretch); k >= 0; k = text.indexOf(stretch, k + 1)) {
          if (++steps > MAX_COVER_STEPS) return true;
          if (at - k >= 0 && hidden.startsWith(text, at - k)) return true;
        }
        return false;
      });
    const lower = joined.toLowerCase();
    const starts: number[] = [];
    for (let at = 0, k = 0; k < kept.length; at += texts[kept[k++]!]!.length + 1) starts.push(at);
    let steps = 0;
    const edge = (c: string | undefined) => c === undefined || c === " " || c === "\n";
    // Where `word` stands in `text`, from `from`, between word ends; -1 when it does not, or past
    // the budget.
    const wordAt = (text: string, word: string, from: number) => {
      let at = text.indexOf(word, from);
      while (at >= 0 && !(edge(text[at - 1]) && edge(text[at + word.length]))) {
        if (++steps > MAX_COVER_STEPS) return -1;
        at = text.indexOf(word, at + 1);
      }
      return at;
    };
    // Of each word, lower-cased: the copies the hidden text holds that no line set aside or cut
    // has taken, and the copies the kept lines hold, anywhere in them.
    const owed = new Map<string, number>();
    const owe = (words: readonly string[], by: number) => {
      for (const word of words) owed.set(word, (owed.get(word) ?? 0) + by);
    };
    owe(hidden.toLowerCase().split(" "), 1);
    for (const line of texts.keys())
      if (read.get(texts[line]!)?.has(copyOf[line]!))
        owe(texts[line]!.toLowerCase().split(" "), -1);
    const held = new Map<string, number>();
    const heldOf = (word: string) => {
      let n = held.get(word);
      if (n === undefined) {
        n = 0;
        for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) {
          if (++steps > MAX_COVER_STEPS) return Infinity;
          n += 1;
        }
        held.set(word, n);
      }
      return n;
    };
    // By kept line, the spans of its text to cut.
    const spans = new Map<number, Array<[number, number]>>();
    for (let i = letter(0); i < hidden.length && steps <= MAX_COVER_STEPS; i = letter(i)) {
      let j = i;
      while (j < hidden.length && free(j) === j) j++;
      const stretch = hidden.slice(i, j).trim();
      // Whole words only: it may end at the space before a claimed word ("Redis" before "Kafka").
      const stop = i + stretch.length;
      const whole =
        (i === 0 || hidden[i - 1] === " ") &&
        (stop === hidden.length ? !cut : hidden[stop] === " ");
      const start = i;
      i = j;
      if (stretch.length < 4 || !whole || copyOfAside(start, stretch)) continue;
      let only: number | undefined;
      let place = -1;
      let found = 0;
      for (
        let at = wordAt(joined, stretch, 0);
        at >= 0 && found < 2;
        at = wordAt(joined, stretch, at + 1)
      ) {
        found += 1;
        // The kept line it is in: the last to start at or before it.
        let lo = 0;
        for (let hi = starts.length - 1; lo < hi;) {
          const mid = (lo + hi + 1) >> 1;
          if (starts[mid]! <= at) lo = mid;
          else hi = mid - 1;
        }
        only = kept[lo];
        place = at - starts[lo]!;
      }
      if (found !== 1 || only === undefined) continue;
      const taken = spans.get(only) ?? [];
      for (let from = place, k = 0, words = stretch.split(" "); k < words.length; k++) {
        const word = words[k]!;
        const key = word.toLowerCase();
        const end = from + word.length;
        if (heldOf(key) <= (owed.get(key) ?? 0) && !taken.some(([a, b]) => from < b && end > a)) {
          taken.push([from, end]);
          owe([key], -1);
          held.set(key, heldOf(key) - 1);
        }
        from = end + 1;
      }
      if (taken.length) spans.set(only, taken);
    }
    for (const [line, cuts] of spans) {
      const text = texts[line]!;
      let rest = "";
      let from = 0;
      for (const [a, b] of cuts.sort((x, y) => x[0] - y[0])) {
        rest += `${text.slice(from, a)} ${BREAK} `;
        from = b;
      }
      rest = `${rest}${text.slice(from)}`.replace(/\s+/g, " ").trim();
      readAs(line, rest.replaceAll(BREAK, "").trim() ? rest : undefined);
    }
  }
}

/** Each line's copy number among the lines of its text, in reading order, the first being 0. */
function copies(texts: readonly string[]) {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const copy = seen.get(text) ?? 0;
    seen.set(text, copy + 1);
    return copy;
  });
}

/**
 * For each pass over the lines, what to read of each: `read` names, by text and copy, a line set
 * aside (`undefined`) or the text read instead. Each pass counts its own copies, in reading order.
 * A kept copy of a text whose other copies are set aside is read apart, between `BREAK`s: which
 * copy was the hidden one is not known for sure, and two kept hidden lines side by side must not
 * be read as one phrase ("Built Python Machine" / "Learning Spark Jobs").
 */
function readFilter(
  read: ReadonlyMap<string, ReadonlyMap<number, string | undefined>>,
  textOf: (line: string) => string,
) {
  const apart = new Set(
    [...read].filter(([, of]) => [...of.values()].includes(undefined)).map(([text]) => text),
  );
  return () => {
    const seen = new Map<string, number>();
    return (line: string): string | undefined => {
      const text = textOf(line);
      const copy = seen.get(text) ?? 0;
      seen.set(text, copy + 1);
      const of = read.get(text);
      if (of?.has(copy)) return of.get(copy);
      return apart.has(text) ? `${BREAK} ${line} ${BREAK}` : line;
    };
  };
}

type CoverStep = { line: number; prev: CoverStep | undefined };
type CoverState = { stretches: number; lines: number; step: CoverStep | undefined };

/**
 * Lines whose texts are the pieces of the one way `hidden` splits into the lines' texts, or
 * `undefined` when it splits none or more ways: split two ways, a phrase could sit in either
 * ("Go Machine" / "Learning" or "Go" / "Machine Learning"), and which lines hold it is not known.
 * In reading order when the pieces' lines run in it, the set in the fewest stretches of
 * consecutive lines, then of the fewest lines, then the latest: hidden text is drawn in a few
 * blocks, often after the visible text. When they do not (a second column's hidden runs read
 * first), for each piece's text as many of its lines as the split takes, those beside a line of a
 * text next to it in the split first, then the latest. Each line is tried only where `hidden`
 * holds its text between word ends, and past `MAX_COVER_STEPS` such tries (thousands of one line
 * over a repeating hidden text) there is no answer, and the claiming in `visibleLines` decides: a
 * count, not a clock, so the same file is read the same way on any machine.
 */
function hiddenCover(hidden: string, texts: readonly string[]): number[] | undefined {
  let steps = 0;
  const end = hidden.length + 1;
  const places = new Map<string, number[]>();
  // Where a text can start, and where the next one would.
  const after = new Map<number, number[]>();
  for (const text of texts) {
    if (!text || places.has(text)) continue;
    const found: number[] = [];
    for (let i = hidden.indexOf(text); i >= 0; i = hidden.indexOf(text, i + 1)) {
      if (++steps > MAX_COVER_STEPS) return undefined;
      const stop = i + text.length;
      if ((i === 0 || hidden[i - 1] === " ") && (stop === hidden.length || hidden[stop] === " ")) {
        found.push(i);
        if (!after.has(i)) after.set(i, []);
        after.get(i)!.push(stop + 1);
      }
    }
    places.set(text, found);
  }
  // How many ways the hidden text from each start splits into texts, up to two.
  const ways = new Map<number, number>([[end, 1]]);
  for (const at of [...after.keys()].sort((a, b) => b - a)) {
    let n = 0;
    for (const to of after.get(at)!) if ((n += ways.get(to) ?? 0) >= 2) break;
    if (n) ways.set(at, Math.min(n, 2));
  }
  if (ways.get(0) !== 1) return undefined;
  const atLeastAsGood = (stretches: number, lines: number, other: CoverState | undefined) =>
    !other ||
    stretches < other.stretches ||
    (stretches === other.stretches && lines <= other.lines);
  // By the position each set has covered up to: those whose last line is the line before, and
  // the others, a new line after them opening a new stretch. A later set wins a tie.
  let adjacent = new Map<number, CoverState>();
  const apart = new Map<number, CoverState>([[0, { stretches: 0, lines: 0, step: undefined }]]);
  for (const [line, text] of texts.entries()) {
    const taken = new Map<number, CoverState>();
    const offer = (to: number, stretches: number, lines: number, prev: CoverStep | undefined) => {
      if (atLeastAsGood(stretches, lines, taken.get(to)))
        taken.set(to, { stretches, lines, step: { line, prev } });
    };
    for (const at of places.get(text) ?? []) {
      if (++steps > MAX_COVER_STEPS) return undefined;
      const to = at + text.length + 1;
      const far = apart.get(at);
      const near = adjacent.get(at);
      if (far) offer(to, far.stretches + 1, far.lines + 1, far.step);
      if (near) offer(to, near.stretches, near.lines + 1, near.step);
    }
    for (const [at, state] of adjacent)
      if (atLeastAsGood(state.stretches, state.lines, apart.get(at))) apart.set(at, state);
    adjacent = taken;
  }
  const near = adjacent.get(end);
  const far = apart.get(end);
  const best = near && atLeastAsGood(near.stretches, near.lines, far) ? near : far;
  if (best) {
    const cover: number[] = [];
    for (let step = best.step; step; step = step.prev) cover.push(step.line);
    return cover;
  }
  // Not in reading order: the one split's pieces, and for each text the lines it takes.
  const pieces: string[] = [];
  for (let at = 0; at < end;) {
    const to = after.get(at)!.find((to) => ways.get(to))!;
    pieces.push(hidden.slice(at, to - 1));
    at = to;
  }
  const beside = new Map<string, Set<string>>();
  const wanted = new Map<string, number>();
  for (const [i, text] of pieces.entries()) {
    wanted.set(text, (wanted.get(text) ?? 0) + 1);
    if (!beside.has(text)) beside.set(text, new Set());
    for (const other of [pieces[i - 1], pieces[i + 1]]) if (other) beside.get(text)!.add(other);
  }
  const linesOf = new Map<string, number[]>();
  for (const [line, text] of texts.entries())
    if (beside.has(text)) (linesOf.get(text) ?? linesOf.set(text, []).get(text)!).push(line);
  const cover: number[] = [];
  for (const [text, near] of beside) {
    const by = (line: number) =>
      Number(near.has(texts[line - 1] ?? "")) + Number(near.has(texts[line + 1] ?? ""));
    const lines = linesOf.get(text)!.sort((a, b) => by(b) - by(a) || b - a);
    if (lines.length < wanted.get(text)!) return undefined;
    cover.push(...lines.slice(0, wanted.get(text)));
  }
  return cover;
}

/** Everything `check` reads besides the resume and the policy. */
export type AtsCheckOptions = {
  /** Enables job match scoring. Read up to its first 20 000 characters. */
  jobDescription?: string | undefined;
  /**
   * The employer that posted the job, when the host knows it (the `company` of `/job`'s
   * `extractJobPosting`). Every word of it is left out of the job-match keywords.
   */
  jobCompany?: string | undefined;
  /**
   * Layout signals from a file upload (`extractResume`): page geometry, hidden text, and what the
   * file advice reads (an encrypted PDF, a Word document's tracked changes and comments). Absent
   * for pasted text and structured documents; the layout rules then drop out.
   */
  layout?: AtsLayoutSignals | undefined;
  /**
   * The reference date for the tenure of a current role and for the plausible-year ceiling.
   * Defaults to the current time; pass a fixed value wherever a result must be reproducible.
   */
  now?: Date | undefined;
  /**
   * Return the text as the engine read it, one entry per line (`report.lines`). Off by default:
   * it is the resume's full text. Worth showing a candidate, because reading order — not columns
   * as such — is what breaks a multi-column layout, and it is visible only here.
   */
  includeLines?: boolean | undefined;
  /**
   * What the host knows of the uploaded file — its name, size, format, a password, tracked
   * changes, comments — for the file advice in `report.advice`. Never scored. Absent for pasted
   * text.
   */
  file?: AtsFileInfo | undefined;
  /**
   * An applicant tracking system the resume is headed for, by its id in the policy
   * (`advice.targets`: "greenhouse", "lever", "taleo" in the community policy). Adds that
   * vendor's documented notes to `report.advice`, each with its source; never scored. Throws
   * `AtsPolicyError` for an id the policy has no notes on.
   */
  targetAts?: string | undefined;
} & AtsLocaleOptions;

/**
 * Scores a resume against a policy: the bundled default when none is given.
 *
 * The report is a pure function of (resume, policy, options); pass `options.now` to pin the
 * date that tenure and recency are counted to. `resume` may be raw input or a `PreparedResume`.
 * Throws `AtsInputError` for a structured document that fails validation, and `AtsPolicyError`
 * for a `region` or `targetAts` the policy does not have.
 */
export function check(
  resume: AtsResumeInput | PreparedResume,
  basePolicy: AtsEnginePolicy = DEFAULT_POLICY,
  options: AtsCheckOptions = {},
): AtsReport {
  const { layout } = options;
  // This check's own: the lines it reads for dates are read once for as long as it lasts.
  const now = readingDatesAt(options.now ?? new Date());
  // Untyped callers send anything; only a string is a posting.
  // Normalised as the resume is: a no-break space or a zero-width space pasted from a careers
  // page split "Machine learning" and "Kubernetes" into words no resume had.
  const jobDescription =
    typeof options.jobDescription === "string"
      ? normalizeText(options.jobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS))
      : undefined;
  // Refused before any work, as an unknown region is.
  const target = targetOf(basePolicy, options.targetAts);
  const prepared = prepareResume(resume);
  const { policy, locale, resumeLanguages } = localizePolicy(
    basePolicy,
    jobDescription === undefined ? prepared.text : `${prepared.text}\n${jobDescription}`,
    options,
    prepared.text,
  );

  const { ctx, lines, sections, parsed } = readResume(prepared, policy, {
    jobDescription,
    layout,
    now,
    languages: resumeLanguages,
  });
  const { active, results, readinessScore } = scoreRules(policy.rules, ctx);
  const failedChecks = results.filter((rule) => !rule.passed);
  const metricOf = new Map(
    active.map((rule) => [rule.id, "metric" in rule ? String(rule.metric) : ""]),
  );

  // Hidden text is no evidence of fit: the match and the requirements read only what a reader
  // sees. And when the resume was caught gaming the screener (an integrity error), the match
  // is held to the readiness score that carries the deduction, as the verdict already is.
  // Only text the policy's hidden-text rule fails is set aside: below its threshold a few
  // hidden characters are layout, and the rule says so by passing.
  const hiddenRule = active.find((rule) => metricOf.get(rule.id) === "hiddenTextChars");
  const hiding = !hiddenRule || failedChecks.some((rule) => rule.id === hiddenRule.id);
  const visible = hiding
    ? visibleLines(layout, lines)
    : () =>
        (line: string): string | undefined =>
          line;
  // Where a line was set aside, a `BREAK` between the lines kept on either side of it: setting
  // it aside must not join them into a phrase ("Machine" / "Science Spark" / "Learning" is not
  // "Machine Learning"). Words read the same; only a phrase across the gap is not.
  const keep = visible();
  const shown: string[] = [];
  let changed = false;
  let gap = false;
  for (const line of lines) {
    const kept = keep(line);
    if (kept === undefined) {
      gap = changed = true;
      continue;
    }
    if (kept !== line) changed = true;
    shown.push(gap && shown.length ? `${BREAK} ${kept}` : kept);
    gap = false;
  }
  const headed = withHeadings(lines, sections);
  const inSections = visible();
  const shownSections: HeadedSection[] = changed
    ? headed.map((section) => ({
        ...section,
        lines: section.lines.flatMap((line) => inSections(line) ?? []),
      }))
    : headed;
  const jobMatch = computeJobMatch(
    changed ? shown.join(" ").replace(/\s+/g, " ").trim() : ctx.text,
    jobDescription,
    policy,
    parsed.highestIsced,
    options.jobCompany,
  );
  const caught = failedChecks.some(
    (rule) => rule.category === "integrity" && rule.severity === "error",
  );
  const jobMatchScore =
    caught && jobMatch.score !== null ? Math.min(jobMatch.score, readinessScore) : jobMatch.score;

  return {
    version: policy.version,
    readinessScore,
    jobMatchScore,
    matchedKeywords: jobMatch.matched,
    missingKeywords: jobMatch.missing,
    matchedKeywordGroups: jobMatch.matchedGroups,
    missingKeywordGroups: jobMatch.missingGroups,
    // What stops an ATS reading the document: every parse check, and the format checks that
    // measure how the text extracts (columns, tables, letter spacing). Length and a photo are
    // format choices, not reading problems, and stay out. Matched on category and metric rather
    // than a substring of the rule id, which is only a naming convention.
    parsingWarnings: failedChecks
      .filter(
        (rule) =>
          rule.category === "parse" ||
          (rule.category === "format" && EXTRACTION_METRICS.has(metricOf.get(rule.id) ?? "")),
      )
      .map((rule) => rule.evidence),
    strengths: strengthsOf(active, results),
    failedChecks,
    prioritizedFixes: [...failedChecks]
      .sort((a, b) => b.scoreImpact - a.scoreImpact)
      .slice(0, 6)
      .map((rule) => rule.fix),
    rules: results,
    categories: rollUpCategories(active, results),
    checksPassed: results.length - failedChecks.length,
    checksTotal: results.length,
    wordCount: ctx.wordCount,
    parsed,
    locale,
    engine: { version: ENGINE_VERSION, policy: policyFingerprint(policy) },
    requirements: judgeRequirements(jobDescription, shownSections, parsed, policy, now).map(
      (requirement) =>
        changed
          ? {
              ...requirement,
              evidence: requirement.evidence.map((line) =>
                line.replaceAll(BREAK, " ").replace(/\s+/g, " ").trim(),
              ),
            }
          : requirement,
    ),
    // Read after the score is final, from nothing the score reads: advice cannot move it.
    advice: adviceFor(policy, { parsed, lines, now, file: options.file, layout, target }),
    ...(options.includeLines && { lines: lines.slice(0, MAX_REPORTED_LINES) }),
  };
}
