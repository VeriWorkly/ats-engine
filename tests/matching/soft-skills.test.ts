import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, parseAtsPolicy } from "../../src/index.js";
import { buildVocabulary, canonicalize } from "../../src/matching/vocabulary.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * A posting's soft skills ("communication", "teamwork") are claimed on a resume, not evidenced,
 * and an ATS's keyword match gives them little value. The report names them apart from the hard
 * skills and the score weighs them less. Every company and person here is invented.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const check = (resume: string, jobDescription: string, policy = DEFAULT_POLICY) =>
  AtsScoringService.check(resume, policy, { jobDescription, now: NOW });

const resume = (...bullets: string[]) =>
  [
    "Jane Doe",
    "jane.doe@example.com",
    "Experience",
    "Analyst, Example Corp 2019 - Present",
    ...bullets.map((bullet) => `- ${bullet}`),
  ].join("\n");

const SOFTWARE = `Backend Engineer
About Brightwave Labs
Brightwave Labs builds billing software for clinics.

Requirements
- 3+ years of experience with Python and PostgreSQL
- Experience with Kubernetes and Terraform
- Excellent communication skills
- Strong problem-solving and teamwork

Nice to have
- Experience mentoring junior engineers
- Attention to detail`;

const NURSING = `Registered Nurse, Telemetry
Requirements
- BLS and ACLS certification
- 2+ years of telemetry nursing experience
- Strong communication and time management skills
- Compassion and empathy for patients

Responsibilities
- Administer medications and monitor cardiac rhythms
- Collaborate with physicians and the care team`;

const SALES = `Account Executive
Requirements
- 2+ years of B2B sales experience
- Experience with Salesforce and HubSpot
- Proven negotiation skills and a record of closing deals
- Excellent interpersonal and communication skills
- Strong time management and adaptability`;

describe("hard and soft skills in a posting", () => {
  it("names a software posting's soft skills apart from its hard skills", () => {
    const report = check(resume("Built billing services in Python on PostgreSQL"), SOFTWARE);
    const { hard, soft } = report.missingKeywordGroups;
    expect(hard).toEqual(expect.arrayContaining(["kubernetes", "terraform"]));
    expect(soft).toEqual(
      expect.arrayContaining([
        "communication",
        "problem solving",
        "teamwork",
        "attention to detail",
      ]),
    );
    // Mentoring is a duty a resume shows ("Mentored two interns"), so it stays a hard skill.
    expect(hard.join(" ")).toContain("mentor");
    expect(soft.join(" ")).not.toContain("mentor");
    expect(report.matchedKeywordGroups.hard).toEqual(
      expect.arrayContaining(["python", "postgresql"]),
    );
    expect(report.matchedKeywordGroups.soft).toEqual([]);
  });

  it("names a nursing posting's soft skills apart from its clinical ones", () => {
    const report = check(
      resume("Monitored cardiac rhythms on a telemetry unit", "Administered medications"),
      NURSING,
    );
    const { hard, soft } = report.missingKeywordGroups;
    expect(hard).toEqual(expect.arrayContaining(["bls", "acls"]));
    expect(soft).toEqual(
      expect.arrayContaining([
        "communication",
        "time management",
        "compassion",
        "empathy",
        "collaborate",
      ]),
    );
    for (const word of soft) expect(hard).not.toContain(word);
  });

  it("names a sales posting's soft skills apart, and keeps negotiation a hard skill", () => {
    const report = check(resume("Closed deals with B2B buyers in Salesforce"), SALES);
    const { hard, soft } = report.missingKeywordGroups;
    expect(hard).toEqual(expect.arrayContaining(["hubspot", "negotiation"]));
    expect(soft).toEqual(
      expect.arrayContaining(["interpersonal", "communication", "time management", "adaptability"]),
    );
    expect(report.matchedKeywordGroups.hard).toContain("salesforce");
  });

  it.each([
    ["software", SOFTWARE],
    ["nursing", NURSING],
    ["sales", SALES],
  ])("keeps the flat lists as the hard group then the soft one, at most 12 (%s)", (_, posting) => {
    const report = check(resume("Wrote reports in Excel"), posting);
    const { missingKeywordGroups: missing, matchedKeywordGroups: matched } = report;
    expect(report.missingKeywords).toEqual([...missing.hard, ...missing.soft].slice(0, 12));
    expect(report.matchedKeywords).toEqual([...matched.hard, ...matched.soft].slice(0, 12));
    expect(report.missingKeywordGroups.soft.length).toBeGreaterThan(0);
  });

  it("reads the common spellings of soft skills as soft, never as hard words", () => {
    const report = check(
      resume("Built billing services in Go on Kubernetes"),
      `Requirements
- Excellent written and verbal communication skills
- Detail oriented and self-motivated
- Strong problem solving and critical-thinking skills
- Team-player with a growth mindset
- Go and Kubernetes`,
    );
    expect(report.missingKeywordGroups.hard).toEqual([]);
    expect(report.missingKeywordGroups.soft).toEqual(
      expect.arrayContaining([
        "communication",
        "detail oriented",
        "self motivated",
        "problem solving",
        "critical thinking",
        "team player",
        "growth mindset",
      ]),
    );
    for (const word of ["written", "verbal", "detail", "oriented", "growth", "mindset"])
      expect(report.missingKeywords).not.toContain(word);
    // Seven soft skills missing weigh less than two hard skills met.
    expect(report.jobMatchScore).toBeGreaterThan(70);
  });

  it("folds a soft skill's hyphenated and spaced spellings together", () => {
    const report = check(
      resume("Praised as self-motivated, a team-player with critical-thinking"),
      "Requirements\n- Self motivated\n- Team player\n- Critical thinking",
    );
    expect(report.missingKeywordGroups.soft).toEqual([]);
  });

  it("leaves both groups empty without a posting", () => {
    const report = AtsScoringService.check(resume("Wrote reports"), DEFAULT_POLICY, { now: NOW });
    expect(report.missingKeywordGroups).toEqual({ hard: [], soft: [] });
    expect(report.matchedKeywordGroups).toEqual({ hard: [], soft: [] });
  });
});

describe("soft skills weigh less in the job match", () => {
  const POSTING = `Requirements
- Kubernetes
- Terraform
- Excellent communication
- Teamwork`;

  it("scores a resume missing only soft skills above one missing as many hard skills", () => {
    const missingSoft = check(
      resume("Ran Kubernetes clusters provisioned with Terraform"),
      POSTING,
    );
    const missingHard = check(resume("Praised for communication and teamwork"), POSTING);
    expect(missingSoft.missingKeywordGroups).toEqual({
      hard: [],
      soft: ["communication", "teamwork"],
    });
    expect(missingHard.missingKeywordGroups).toEqual({
      hard: ["kubernetes", "terraform"],
      soft: [],
    });
    expect(missingSoft.jobMatchScore!).toBeGreaterThan(missingHard.jobMatchScore!);
  });

  it("weighs a soft skill below an ordinary word of the posting", () => {
    const posting = "Requirements\n- Experience with invoicing and reconciliation\n- Communication";
    const missingSoft = check(resume("Ran invoicing and reconciliation"), posting);
    const missingOrdinary = check(resume("Praised for communication and invoicing"), posting);
    expect(missingSoft.jobMatchScore!).toBeGreaterThan(missingOrdinary.jobMatchScore!);
  });

  it("takes the discount from the policy's softSkillWeight", () => {
    const resumeText = resume("Ran Kubernetes clusters provisioned with Terraform");
    const flat = parseAtsPolicy({
      ...DEFAULT_POLICY,
      keywordMatch: { ...DEFAULT_POLICY.keywordMatch, softSkillWeight: 1 },
    });
    expect(DEFAULT_POLICY.keywordMatch.softSkillWeight).toBe(0.4);
    expect(check(resumeText, POSTING).jobMatchScore!).toBeGreaterThan(
      check(resumeText, POSTING, flat).jobMatchScore!,
    );
  });

  it("scores a posting with no soft skills as before", () => {
    const posting = "Requirements\n- Kubernetes\n- Terraform\n- Python";
    expect(check(resume("Ran Kubernetes clusters"), posting).jobMatchScore).toBe(44);
  });
});

describe("a soft skill folds as the vocabulary does", () => {
  const km = DEFAULT_POLICY.keywordMatch;
  const vocab = buildVocabulary(km);

  it.each(["communicating", "communicate", "communicated", "communications", "communication"])(
    "reads %s as communication",
    (word) => {
      expect(canonicalize(word, km, vocab)).toBe("communication");
      expect(vocab.softTokens.has(canonicalize(word, km, vocab)!)).toBe(true);
    },
  );

  it("reads communication skills as communication, and a hyphenated phrase as the phrase", () => {
    const report = check(
      resume("Wrote reports in Excel"),
      "Requirements\n- Communication skills\n- Problem-solving\n- Decision-making",
    );
    expect(report.missingKeywordGroups).toEqual({
      hard: [],
      soft: expect.arrayContaining(["communication", "problem solving", "decision making"]),
    });
    expect(report.missingKeywords).not.toContain("skills");
  });

  it("meets a posting's communicating with a resume's communication", () => {
    const report = check(
      resume("Praised for clear communication with clients"),
      "Requirements\n- Communicating with clients",
    );
    expect(report.missingKeywords).not.toContain("communicating");
    expect(report.matchedKeywordGroups.soft).toEqual(["communicating"]);
  });

  it("keeps a soft skill out of the recognised hard skills", () => {
    expect(vocab.skillTokens.has("communication")).toBe(false);
    expect(vocab.skillTokens.has("problem solving")).toBe(false);
    expect(vocab.softTokens.has("problem solving")).toBe(true);
    expect(vocab.softTokens.has("kubernetes")).toBe(false);
  });

  it("reads a long posting of near-miss soft phrases in linear time", () => {
    const posting = `Requirements\n- ${"problem attention to time problem solving ".repeat(500)}`;
    expectFast(() => check(resume("Wrote reports"), posting), 1_500);
  });
});
