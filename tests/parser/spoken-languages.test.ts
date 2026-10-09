import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, parseResume } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { applyVocabulary } from "../../src/locales/languages.js";
import { cefrLevel } from "../../src/parser/languages.js";
import { segmentResume } from "../../src/parser/sections.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Spoken languages read as rows — the language, the level as written, and that level on the
 * CEFR scale — from a Languages section or a "Languages:" line among the skills. Invented
 * people only.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const LOCALES = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const HEAD = "Jane Doe\njane@example.com | +1 415 555 0142";
const JOB = "Experience\nSoftware Engineer, Acme Corp Jan 2019 - Present\n- Built payment services";

const parse = (body: string) =>
  parseResume(`${HEAD}\n${JOB}\n${body}`.split("\n"), DEFAULT_POLICY, NOW);
const languages = (body: string) => parse(body).spokenLanguages;

describe("level words map to CEFR", () => {
  it.each([
    ["native", "C2"],
    ["Native or bilingual proficiency", "C2"],
    ["bilingual", "C1"],
    ["fluent", "C1"],
    ["Full professional proficiency", "C2"],
    ["professional working proficiency", "C1"],
    ["advanced", "C1"],
    ["upper intermediate", "B2"],
    ["conversational", "B1"],
    ["intermediate", "B1"],
    ["Limited working proficiency", "B1"],
    ["limited", "A2"],
    ["Limited proficiency", "A2"],
    ["basic", "A2"],
    ["Elementary proficiency", "A2"],
    ["beginner", "A1"],
    ["B2", "B2"],
    ["c1", "C1"],
    ["fluent, B2", "B2"],
    ["working on it", null],
  ])("%s → %s", (text, cefr) => {
    expect(cefrLevel(text, DEFAULT_POLICY)).toBe(cefr);
  });

  it.each([
    ["Muttersprache", "C2"],
    ["muttersprachlich", "C2"],
    ["fließend", "C1"],
    ["fließend in Wort und Schrift", "C1"],
    ["verhandlungssicher", "C1"],
    ["sehr gute Kenntnisse", "B2"],
    ["gute Kenntnisse", "B1"],
    ["Grundkenntnisse", "A2"],
    ["मातृभाषा", "C2"],
    ["धाराप्रवाह", "C1"],
    ["कार्यसाधक ज्ञान", "B1"],
    ["बुनियादी ज्ञान", "A2"],
  ])("%s → %s with the packs", (text, cefr) => {
    // Every bundled language pack applied, as `check` applies one to a resume written in it.
    const packs = LOCALES.locales.languages.reduce(applyVocabulary, LOCALES);
    expect(cefrLevel(text, packs)).toBe(cefr);
  });
});

describe("a Languages heading opens a section of its own", () => {
  it.each(["Languages", "Language Skills", "Spoken Languages", "Language Proficiency"])(
    "%s",
    (heading) => {
      expect(segmentResume([heading, "English"], DEFAULT_POLICY).map((s) => s.kind)).toEqual([
        "languages",
      ]);
    },
  );

  it("does not take Programming Languages as one", () => {
    expect(segmentResume(["Skills", "Programming Languages: Go"], DEFAULT_POLICY)).toHaveLength(1);
  });
});

describe("a languages line becomes rows", () => {
  it("reads each language with its level in brackets", () => {
    expect(languages("Languages\nEnglish (native), German (B2), French (basic)")).toEqual([
      { language: "English", level: "native", cefr: "C2" },
      { language: "German", level: "B2", cefr: "B2" },
      { language: "French", level: "basic", cefr: "A2" },
    ]);
  });

  it("reads a level after a dash or a colon", () => {
    expect(languages("Languages\nEnglish – Native\nHindi: Fluent")).toEqual([
      { language: "English", level: "Native", cefr: "C2" },
      { language: "Hindi", level: "Fluent", cefr: "C1" },
    ]);
  });

  it("reads a level before the languages it covers", () => {
    expect(languages("Languages\nFluent in English and Spanish")).toEqual([
      { language: "English", level: "Fluent", cefr: "C1" },
      { language: "Spanish", level: "Fluent", cefr: "C1" },
    ]);
  });

  it("reads LinkedIn's level on the line below", () => {
    expect(
      languages(
        "Languages\nEnglish\nNative or bilingual proficiency\nGerman\nProfessional working proficiency",
      ),
    ).toEqual([
      { language: "English", level: "Native or bilingual proficiency", cefr: "C2" },
      { language: "German", level: "Professional working proficiency", cefr: "C1" },
    ]);
  });

  it("keeps a language with no level", () => {
    expect(languages("Languages\nEnglish, Hindi")).toEqual([
      { language: "English", level: "", cefr: null },
      { language: "Hindi", level: "", cefr: null },
    ]);
  });

  it("reads a Languages line among the skills, and leaves it out of the skills", () => {
    const parsed = parse(
      "Skills\nGo, Python\nLanguages: English (native), Spanish (professional working proficiency)",
    );
    expect(parsed.spokenLanguages).toEqual([
      { language: "English", level: "native", cefr: "C2" },
      { language: "Spanish", level: "professional working proficiency", cefr: "C1" },
    ]);
    expect(parsed.skills).toEqual(["Go", "Python"]);
  });

  it("keeps the skills a mixed Languages line names beside a language", () => {
    const parsed = parse("Skills\nLanguages: English (native), Python, Go");
    expect(parsed.spokenLanguages).toEqual([{ language: "English", level: "native", cefr: "C2" }]);
    expect(parsed.skills).toEqual(["Python", "Go"]);
  });

  it("leaves programming languages to the skills", () => {
    const parsed = parse("Skills\nLanguages: TypeScript, Go\nTools: Docker");
    expect(parsed.spokenLanguages).toEqual([]);
    expect(parsed.skills).toEqual(["TypeScript", "Go", "Docker"]);
  });

  it("does not count a language twice", () => {
    const parsed = parse(
      "Skills\nGo\nLanguages: English, German (B2)\nLanguages\nEnglish (native), German",
    );
    expect(parsed.spokenLanguages).toEqual([
      { language: "English", level: "native", cefr: "C2" },
      { language: "German", level: "B2", cefr: "B2" },
    ]);
  });

  it("names nothing it does not know as a language", () => {
    expect(languages("Languages\nKlingon (fluent), Toastmasters club")).toEqual([]);
  });

  it("stamps provenance", () => {
    expect(parse("Languages\nEnglish").provenance.spokenLanguages).toBe("parser");
    expect(parse("").provenance.spokenLanguages).toBe("none");
  });
});

describe("spoken languages in German and Hindi", () => {
  const read = (text: string, language: string) =>
    AtsScoringService.check(`${HEAD}\n${text}`, LOCALES, { languages: [language], now: NOW }).parsed
      .spokenLanguages;

  it("reads German level words and an explicit CEFR level", () => {
    expect(
      read(
        "Sprachen\nDeutsch (Muttersprache), Englisch (verhandlungssicher, C1), Französisch (Grundkenntnisse)",
        "de",
      ),
    ).toEqual([
      { language: "Deutsch", level: "Muttersprache", cefr: "C2" },
      { language: "Englisch", level: "verhandlungssicher, C1", cefr: "C1" },
      { language: "Französisch", level: "Grundkenntnisse", cefr: "A2" },
    ]);
  });

  it("reads Hindi level words", () => {
    expect(read("भाषाएँ\nहिंदी (मातृभाषा), अंग्रेज़ी (धाराप्रवाह)", "hi")).toEqual([
      { language: "हिंदी", level: "मातृभाषा", cefr: "C2" },
      { language: "अंग्रेज़ी", level: "धाराप्रवाह", cefr: "C1" },
    ]);
  });
});

describe("languages lines stay linear", () => {
  const N = 40_000;
  const rep = (unit: string) => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
  it.each([
    rep("English "),
    rep("English (native), "),
    rep("B2 "),
    rep("professional "),
    rep("fluent in "),
    rep("(a"),
    rep("a: "),
    `${rep(" ")}English`,
  ])("hostile languages line %#", (line) => {
    expectFast(() => parse(`Languages\n${line}\nSkills\nLanguages: ${line}`), 1_500);
  });
});
