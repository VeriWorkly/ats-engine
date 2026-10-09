import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { applyVocabulary } from "../../src/locales/languages.js";
import { languagePackSchema } from "../../src/locales/schema.js";

/**
 * A language pack adds the soft skills its postings ask for, so a German or Hindi posting's
 * "Teamfähigkeit" or "नेतृत्व" is named apart and weighed as "teamwork" is. Invented people and
 * companies only.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);

describe("soft skills from a language pack", () => {
  it("names a German posting's soft skills apart", () => {
    const resume = [
      "Max Mustermann",
      "max.mustermann@example.de",
      "Berufserfahrung",
      "Softwareentwickler, Beispiel GmbH, 01/2019 – heute",
      "- Entwicklung von Diensten mit Java und Spring für die Abrechnung",
      "- Betrieb der Dienste auf einer eigenen Plattform",
    ].join("\n");
    const posting = [
      "Ihr Profil",
      "- Mehrjährige Erfahrung mit Java und Kubernetes",
      "- Ausgeprägte Teamfähigkeit und Kommunikationsstärke",
      "- Zuverlässigkeit und Belastbarkeit",
    ].join("\n");
    const report = AtsScoringService.check(resume, POLICY, { jobDescription: posting, now: NOW });
    expect(report.locale.languages).toContain("de");
    const { hard, soft } = report.missingKeywordGroups;
    expect(hard).toContain("kubernetes");
    expect(soft).toEqual(
      expect.arrayContaining([
        "teamfähigkeit",
        "kommunikationsstärke",
        "zuverlässigkeit",
        "belastbarkeit",
      ]),
    );
    expect(report.matchedKeywordGroups.hard).toContain("java");
  });

  it("names a Hindi posting's soft skills apart, and reads संचार कौशल as संचार", () => {
    const resume = [
      "अनीता शर्मा",
      "anita.sharma@example.in",
      "अनुभव",
      "सॉफ्टवेयर इंजीनियर, उदाहरण प्राइवेट लिमिटेड, 2019 – वर्तमान",
      "- Python और SQL में डेटा पाइपलाइन बनाई",
    ].join("\n");
    const posting = [
      "आवश्यकताएँ",
      "- Python और Kubernetes में अनुभव",
      "- अच्छा संचार कौशल",
      "- नेतृत्व और टीमवर्क",
      "- समस्या समाधान की क्षमता",
    ].join("\n");
    const report = AtsScoringService.check(resume, POLICY, { jobDescription: posting, now: NOW });
    expect(report.locale.languages).toContain("hi");
    const { hard, soft } = report.missingKeywordGroups;
    expect(hard).toContain("kubernetes");
    expect(soft).toEqual(expect.arrayContaining(["संचार", "नेतृत्व", "टीमवर्क", "समस्या समाधान"]));
    expect(report.missingKeywords).not.toContain("कौशल");
  });

  it("adds a pack's soft skills to the policy's", () => {
    const pack = languagePackSchema.parse({
      id: "xx",
      name: "Test",
      status: "community",
      script: "Devanagari",
      softSkills: ["Zusammenhalt"],
    });
    const policy = applyVocabulary(DEFAULT_POLICY, pack);
    expect(policy.keywordMatch.softSkills).toEqual(
      expect.arrayContaining(["communication", "zusammenhalt"]),
    );
    expect(DEFAULT_POLICY.keywordMatch.softSkills).not.toContain("zusammenhalt");
  });
});
