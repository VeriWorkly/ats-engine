import { describe, it } from "vitest";

import { DEFAULT_POLICY, check } from "../../src/index.js";
import { jobTextFromHtml } from "../../src/job/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Every input shape that could make a pattern backtrack: 50 KB of it as the name line, a bullet
 * and the posting, under the community policy with every locale pack. The ceiling is far below
 * what a super-linear pattern takes. SECURITY.md promises this.
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
  "month and short year run": rep("06/21 - "),
  "month slash run": rep("1/12 "),
  "onwards run": rep("2021 onwards "),
  "ab run": rep("ab 06/2021 "),
  "AB range run": rep("AB 2018 - "),
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
  // The writing checks.
  "passive run": rep("was quickly used "),
  "pronoun slash": rep("I/"),
  "weak opener run": rep("responsible for "),
  "expires run": rep("expires 2027 "),
  "issued dot run": rep("Issued Jan 2021 · "),
  "language level run": rep("English (native), "),
  "cefr run": rep("B2 "),
  "level phrase run": rep("professional working "),
  "fließend run": rep("fließend "),
  // Soft skills matched as phrases, English and a pack's.
  "soft phrase run": rep("problem solving "),
  "soft phrase prefix run": rep("attention to "),
  "devanagari soft phrase run": rep("समस्या समाधान "),
  // The right to work and a clearance.
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
  // Many short lines: every line reader searches for dates.
  "digit lines": rep("1\n"),
  "two-digit lines": rep("12\n"),
  "digit dot lines": rep("1.\n"),
  "devanagari lines": rep("क\n"),
  "letter lines": rep("a\n"),
  // A quoted injection example after a "caught" word: openers without closers.
  "curly quote run": `flags ignore all previous instructions ${rep("“", N - 40)}`,
  "low quote run": `flags ignore all previous instructions ${rep("„", N - 40)}`,
  "guillemet run": `flags ignore all previous instructions ${rep("«", N - 40)}`,
  "single quote run": `flags ignore all previous instructions ${rep("‘", N - 40)}`,
  "straight quote run": `flags ignore all previous instructions ${rep(" 'a", N - 40)}`,
  "mention verb run": rep('flags "ignore previous instructions" '),
  // A list of works, read for citations.
  "citation heading run": `Publications\n${rep("Doe J (2019) et al. ")}`,
  "citation initials run": `Talks\n${rep("Doe JJ, ")}`,
  // A version, a standard's number, a multiple: read by the metrics rule.
  "version run": rep("Python 1.1 "),
  "version spaces run": `Windows 1${rep(" ", N - 20)}x`,
  "standard run": rep("ISO 1 "),
  "multiple run": rep("x1 "),
  // A Greek symbol before a subscript.
  "greek subscript run": rep("νmax "),
  "greek look-alike run": rep("ρank "),
  // A title's department, and a city with its state or country, read in a role's header.
  "department run": rep("Director, Product Management | "),
  "place name run": rep("Austin, Texas, United States, "),
  "dated place run": `Jan 2020 - Present | ${rep("Austin, Texas, ", N - 40)}`,
  "legal form run": rep("Acme Corp, "),
  "co run": rep("Co "),
  // The French pack: "à" ranges, "depuis", language levels, years after the baccalauréat,
  // apostrophes.
  "à range run": rep("2019 à "),
  "depuis run": rep("depuis "),
  "years range run": rep("3 à 5 "),
  "courant run": rep("anglais courant "),
  "maîtrise run": rep("maîtrise de l’"),
  "apostrophe run": rep("d'"),
  "bac plus run": rep("bac + "),
  "but run": rep("BUT "),
  // The GB region's credentials.
  "as level run": rep("AS level "),
  "pg dip run": rep("pg "),
};

const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const NOW = new Date("2026-09-30T00:00:00Z");

describe("50 KB adversarial input", () => {
  it.each(Object.entries(SHAPES))("%s, wherever it appears, in bounded time", (_, input) => {
    const resume = `${input}\njane@example.com\nExperience\nEngineer at Acme 2019 - 2022\n- ${input}`;
    const jobDescription = `Requirements\n- ${input}`;
    const html = `<p>${input}</p>`;
    expectFast(() => jobTextFromHtml(html), 1_500);
    // Every region's credential patterns, compiled only under its region.
    for (const region of ["DE", "FR", "GB", "IN"])
      expectFast(
        () =>
          check(resume, POLICY, {
            now: NOW,
            jobDescription,
            languages: ["de", "fr", "hi"],
            region,
          }),
        1_500,
        region,
      );
  });

  // Certification and language rows: under their headings and on a labelled line only.
  it.each(Object.entries(SHAPES))(
    "%s under Certifications and Languages, in bounded time",
    (_, input) => {
      const resume = `Jane Doe\njane@example.com\nCertifications\n${input}\nLanguages\n${input}\nSkills\nLanguages: ${input}\nCertifications: ${input}`;
      expectFast(
        () =>
          check(resume, POLICY, {
            now: NOW,
            jobDescription: `Requirements\n- Fluent ${input}\n- ${input} certification`,
            languages: ["de", "fr", "hi"],
          }),
        1_500,
      );
    },
  );

  // English with lists, so the posting's prose is read for names.
  it.each(Object.entries(SHAPES))(
    "%s as an English posting's prose, in bounded time",
    (_, input) => {
      expectFast(
        () =>
          check("Jane Doe\njane@example.com", POLICY, {
            now: NOW,
            jobDescription: `We ship from ${input}\n- Kafka\n- Go\n- SQL`,
            languages: [],
          }),
        1_500,
      );
    },
  );
});
