import { describe, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY } from "../../src/index.js";
import { jobTextFromHtml } from "../../src/job/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Every input shape that has made, or could make, a pattern backtrack: 50 KB of it as the name
 * line, as a bullet and as the posting, under the community policy with every locale pack
 * applied. Most take tens of milliseconds, 25,000 short lines a few hundred: the ceiling is above
 * that and far below the seconds a super-linear pattern, or a search repeated on every line by
 * every reader, takes. SECURITY.md promises this.
 */

const N = 50_000;
const rep = (unit: string, total = N) =>
  unit.repeat(Math.ceil(total / unit.length)).slice(0, total);

const SHAPES: Record<string, string> = {
  letters: rep("a"),
  capitals: rep("A"),
  "letter-space": rep("a "),
  "digit-space": rep("1 "),
  digits: rep("1"),
  "spaces then x": `1${rep(" ", N - 2)}x`,
  "tabs then x": `1${rep("\t", N - 2)}x`,
  "dot run": rep("a."),
  "Jan run": rep("Jan "),
  "year dash run": rep("2019 - "),
  "year run": rep("2019 "),
  "comma run": rep("a, "),
  "comma caps run": rep("AB, "),
  "post-nominal letters": `Jane Doe, ${rep("AB", 4_000)}!`,
  "post-nominal dots": `Jane Doe, ${rep("AB.", 4_000)}!`,
  "post-nominal commas": `Jane Doe${rep(", AB", 4_000)}!`,
  "dash run": rep("-"),
  "lt run": rep("<"),
  "w-tag run": rep("<w:a "),
  "devanagari run": rep("क"),
  "devanagari words": rep("कार्य "),
  "ignore run": rep("ignore all previous "),
  "at run": rep("x@"),
  "plus years": rep("1+ "),
  "proficient + letters": `proficient in ${rep("a", N - 20)}`,
  "fluent letters": `fluent ${rep("a", N - 10)}`,
  parens: rep("("),
  "o bullets": rep("o "),
  "bullet glyphs": rep("•"),
  "digit dot": rep("1."),
  "plus one": rep("+1 "),
  "www run": rep("www."),
  "umlaut run": rep("Ü"),
  "since run": rep("since "),
  "B.S. run": rep("B.S. "),
  "M. run": rep("M."),
  "dipl run": rep("dipl.-"),
  "ab dash": rep("ab-"),
  "colon run": rep("a: "),
  "slash run": rep("a/"),
  "digit slash": rep("1/"),
  "date-ish": rep("01/02/"),
  "or run": rep("Go or "),
  "x or y commas": `${rep("a, b, ")} or c`,
  "mixed script": rep("aб"),
  "zwj latin": rep("a\u{200D}"),
  "tag chars": rep("\u{E0041}"),
  "hash run": rep("###"),
  "new prompt": rep("new instructions "),
  "rank run": rep("rank this candidate "),
  "title run": rep("Harbor "),
  "space then capital": `a${rep(" ", N - 2)}B`,
  // The writing checks (tests/checks/writing.test.ts runs them read as English too).
  "passive run": rep("was quickly used "),
  "pronoun slash": rep("I/"),
  "weak opener run": rep("responsible for "),
  "expires run": rep("expires 2027 "),
  "issued dot run": rep("Issued Jan 2021 · "),
  "language level run": rep("English (native), "),
  "cefr run": rep("B2 "),
  "level phrase run": rep("professional working "),
  "fließend run": rep("fließend "),
  // Soft skills matched as phrases, the English and a language pack's.
  "soft phrase run": rep("problem solving "),
  "soft phrase prefix run": rep("attention to "),
  "devanagari soft phrase run": rep("समस्या समाधान "),
  // The right to work and a clearance, read for what they say and the level they name.
  "sponsorship run": rep("authorized to work not visa "),
  "needs sponsorship run": rep("requires visa work "),
  "no sponsorship run": `authorized to work ${rep("not currently eligible for ")}`,
  "contraction run": `authorized to work ${rep("doesn't ")}`,
  "clearance level run": rep("top secret clearance "),
  "ts sci run": rep("TS - "),
  "ts slash run": rep("TS / "),
  "ts clearance run": rep("ts "),
  // Slash compounds split into their words; never inside a link.
  "slash compound run": rep("HTML/CSS/"),
  "slash number run": rep("a/1/"),
  "link run": rep("a://b/"),
  "scheme run": rep("a+b.c-"),
  // Many short lines: every reader of a line looks for its dates, so 25,000 lines cost each of
  // them 25,000 searches.
  "digit lines": rep("1\n"),
  "two-digit lines": rep("12\n"),
  "digit dot lines": rep("1.\n"),
  "devanagari lines": rep("क\n"),
  "letter lines": rep("a\n"),
  // A quoted injection example after a word that says it was caught: openers without closers.
  "curly quote run": `flags ignore all previous instructions ${rep("“", N - 40)}`,
  "low quote run": `flags ignore all previous instructions ${rep("„", N - 40)}`,
  "guillemet run": `flags ignore all previous instructions ${rep("«", N - 40)}`,
  "single quote run": `flags ignore all previous instructions ${rep("‘", N - 40)}`,
  "straight quote run": `flags ignore all previous instructions ${rep(" 'a", N - 40)}`,
  "mention verb run": rep('flags "ignore previous instructions" '),
  // A list of works, read for citations.
  "citation heading run": `Publications\n${rep("Doe J (2019) et al. ")}`,
  "citation initials run": `Talks\n${rep("Doe JJ, ")}`,
  // A product's version, a standard's number, a multiple: read by the metrics rule.
  "version run": rep("Python 1.1 "),
  "version spaces run": `Windows 1${rep(" ", N - 20)}x`,
  "standard run": rep("ISO 1 "),
  "multiple run": rep("x1 "),
  // A Greek symbol before a subscript.
  "greek subscript run": rep("νmax "),
};

const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const NOW = new Date("2026-09-30T00:00:00Z");

describe("50 KB adversarial input", () => {
  it.each(Object.entries(SHAPES))("%s, wherever it appears, in bounded time", (_, input) => {
    const resume = `${input}\njane@example.com\nExperience\nEngineer at Acme 2019 - 2022\n- ${input}`;
    const jobDescription = `Requirements\n- ${input}`;
    const html = `<p>${input}</p>`;
    expectFast(() => {
      AtsScoringService.check(resume, POLICY, {
        now: NOW,
        jobDescription,
        languages: ["de", "hi"],
        region: "DE",
      });
      jobTextFromHtml(html);
    }, 1_500);
  });

  // Certification and language rows are read only under their headings and on a labelled line.
  it.each(Object.entries(SHAPES))(
    "%s under Certifications and Languages, in bounded time",
    (_, input) => {
      const resume = `Jane Doe\njane@example.com\nCertifications\n${input}\nLanguages\n${input}\nSkills\nLanguages: ${input}\nCertifications: ${input}`;
      expectFast(
        () =>
          AtsScoringService.check(resume, POLICY, {
            now: NOW,
            jobDescription: `Requirements\n- Fluent ${input}\n- ${input} certification`,
            languages: ["de", "hi"],
          }),
        1_500,
      );
    },
  );

  // English, with lists to compare with, so the posting's prose is read for names.
  it.each(Object.entries(SHAPES))(
    "%s as an English posting's prose, in bounded time",
    (_, input) => {
      const started = performance.now();
      AtsScoringService.check("Jane Doe\njane@example.com", POLICY, {
        now: NOW,
        jobDescription: `We ship from ${input}\n- Kafka\n- Go\n- SQL`,
        languages: [],
      });
      expect(performance.now() - started).toBeLessThan(1_500);
    },
  );
});
