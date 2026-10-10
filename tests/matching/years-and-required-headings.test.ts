import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, type AtsRequirement } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { policyRegex } from "../../src/policy/regex.js";
import { stem } from "../../src/text/text.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Defects in the job match and the requirements judge, one block each. Invented people only.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const HEAD = "Jane Doe\njane@example.com | +1 415 555 0142";

const check = (body: string, job: string, now = NOW) =>
  AtsScoringService.check(`${HEAD}\n${body}`, DEFAULT_POLICY, { jobDescription: job, now });
const judge = (body: string, job: string, now = NOW) => check(body, job, now).requirements;
const one = (body: string, ask: string, now = NOW) =>
  judge(body, `Requirements\n- ${ask}`, now)[0] as AtsRequirement;

describe("years are read on the report's own date", () => {
  const body = "Experience\nEngineer, Acme Corp Jan 2023 - Present\n- Built services in Python";

  it("counts a current role up to `now`, not the wall clock", () => {
    const early = one(body, "3+ years of Python experience", new Date("2024-01-15T00:00:00Z"));
    expect(early.status).toBe("partial");
    expect(early.detail).toBe("1 years in roles naming python, 3 asked");
    expect(
      one(body, "3+ years of Python experience", new Date("2030-01-15T00:00:00Z")).status,
    ).toBe("met");
  });
});

describe("the posting is normalised like the resume", () => {
  it("reads a no-break space and a zero-width space in the posting", () => {
    const report = check(
      "Experience\nEngineer, Acme Corp Jan 2015 - Present\n- Built machine learning models on Kubernetes",
      "Requirements\n- Machine learning\n- Kuber​netes",
    );
    expect(report.jobMatchScore).toBe(100);
    expect(report.requirements.map((r) => r.status)).toEqual(["met", "met"]);
  });
});

describe("required headings", () => {
  const body = "Skills\nPython";
  it.each([
    "Minimum qualifications",
    "Basic Qualifications",
    "Required Qualifications",
    "Minimum Requirements",
    "Must-haves",
    "What you bring",
    "About you",
    "Your Profile",
  ])("reads the items under %s as required", (heading) => {
    const report = check(body, `${heading}\n- Python\n- Rust\nNice to have\n- Terraform`);
    expect(report.requirements.map((r) => [r.text, r.importance])).toEqual([
      ["Python", "required"],
      ["Rust", "required"],
      ["Terraform", "preferred"],
    ]);
    for (const word of heading.toLowerCase().split(/\s+/))
      expect(report.missingKeywords).not.toContain(word);
  });

  it("takes the body's bullets as required when only a preferred heading is recognised", () => {
    const found = judge(
      body,
      "Who we are looking for\n- Python\n- Rust\nNice to have\n- Terraform",
    );
    expect(found.map((r) => [r.text, r.importance])).toEqual([
      ["Python", "required"],
      ["Rust", "required"],
      ["Terraform", "preferred"],
    ]);
  });
});

describe("years of a named skill", () => {
  const without =
    "Experience\nEngineer, Acme Corp Jan 2014 - Dec 2022\n- Built services\nAnalyst, Globex Jan 2023 - Dec 2023\n- Wrote reports\nSkills\nPython";
  const withBullet = without.replace("- Wrote reports", "- Wrote reports with Python");

  it("does not fall back to total tenure when no role names the skill", () => {
    expect(one(without, "5+ years of Python")).toMatchObject({
      status: "partial",
      detail: "0 years in roles naming python, 5 asked",
    });
  });

  it("never gets worse when a true bullet names the skill", () => {
    const before = one(without, "5+ years of Python").status;
    const after = one(withBullet, "5+ years of Python").status;
    const rank = { missing: 0, unverifiable: 0, partial: 1, met: 2 };
    expect(rank[after]).toBeGreaterThanOrEqual(rank[before]);
  });
});

describe("stemming", () => {
  it("folds plurals of words ending in e, and short plurals like APIs", () => {
    const report = check(
      "Skills\nDatabase, pipeline, API, microservice",
      "Requirements\n- Databases\n- Pipelines\n- APIs\n- Microservices",
    );
    expect(report.jobMatchScore).toBe(100);
    const reverse = check(
      "Skills\nDatabases, pipelines, APIs, microservices",
      "Requirements\n- Database\n- Pipeline\n- API\n- Microservice",
    );
    expect(reverse.jobMatchScore).toBe(100);
  });

  it("still folds -sses, -xes, -ches and -shes", () => {
    const report = check(
      "Skills\nprocess, index, search, dash",
      "Requirements\n- Processes\n- Indexes\n- Searches\n- Dashes",
    );
    expect(report.jobMatchScore).toBe(100);
  });
});

describe("one- and two-letter skills", () => {
  it("does not read a middle initial as R", () => {
    const report = AtsScoringService.check(
      "Jane R. Doe\njane@example.com\nSkills\nPython",
      DEFAULT_POLICY,
      { jobDescription: "Requirements\n- Experience with R", now: NOW },
    );
    expect(report.requirements[0]).toMatchObject({ status: "missing", evidence: [] });
    expect(report.matchedKeywords).not.toContain("r");
  });

  it("keeps R in a list that opens with it", () => {
    expect(one("Skills\nPython", "R and Python")).toMatchObject({
      status: "partial",
      terms: [
        { term: "r", found: false },
        { term: "python", found: true },
      ],
    });
  });

  it("does not read the verb go as the language Go", () => {
    const report = check(
      "Experience\nManager, Acme Corp Jan 2015 - Present\n- I go to every meeting",
      "Requirements\n- Experience with Go\nWe go the extra mile",
    );
    expect(report.requirements[0]?.status).toBe("missing");
    expect(report.matchedKeywords).not.toContain("go");
  });

  it("does not read a compact disc as CI/CD", () => {
    expect(
      one("Experience\nDJ, Acme Corp Jan 2015 - Present\n- Burned a CD", "CI/CD pipelines").status,
    ).not.toBe("met");
  });
});

describe("activity and credential words are part of the ask", () => {
  it("does not let an engineering title meet a mentoring requirement", () => {
    const found = one(
      "Experience\nSoftware Engineering Intern, Acme Corp Jan 2023 - Dec 2023\n- Wrote Python tests",
      "Experience mentoring Python engineers",
    );
    expect(found.status).not.toBe("met");
    expect(found.terms).toContainEqual({ term: "mentoring", found: false });
  });

  it("does not let a mention of AWS meet an AWS certification", () => {
    const body = "Experience\nEngineer, Acme Corp Jan 2020 - Dec 2023\n- Deployed on AWS";
    expect(one(body, "AWS certification")).toMatchObject({
      status: "partial",
      terms: expect.arrayContaining([{ term: "certification", found: false }]),
    });
    expect(
      one(`${body}\nCertifications\nAWS Certified Solutions Architect`, "AWS certification").status,
    ).toBe("met");
  });
});

describe("hidden text", () => {
  // The signals a PDF upload reports for a white-on-white keyword line (see hidden-text.test.ts
  // for how they are measured); given by hand so this tests the engine, not the extraction.
  const layout = {
    columnRatio: null,
    tableCount: 0,
    pageCount: 1,
    hiddenTextChars: 24,
    hiddenTextSample: "Kubernetes Terraform Kafka",
  };
  const text = `${HEAD}\nExperience\nEngineer, Acme Corp Jan 2019 - Present\n- Built payment services in Go\nKubernetes Terraform Kafka`;
  const job = "Requirements\n- Kubernetes\n- Terraform\n- Go";

  it("does not count white-on-white keywords toward the match or as evidence", () => {
    const report = AtsScoringService.check(text, DEFAULT_POLICY, {
      jobDescription: job,
      layout,
      now: NOW,
    });
    expect(report.matchedKeywords).not.toContain("kubernetes");
    expect(report.requirements.map((r) => r.status)).toEqual(["missing", "missing", "met"]);
    expect(report.requirements.flatMap((r) => r.evidence).join()).not.toContain("Kubernetes");
    expect(report.jobMatchScore).toBeLessThanOrEqual(report.readinessScore);
  });

  it("reads the same line as evidence when it is visible", () => {
    const report = AtsScoringService.check(text, DEFAULT_POLICY, { jobDescription: job, now: NOW });
    expect(report.requirements.map((r) => r.status)).toEqual(["met", "met", "met"]);
  });
});

describe("a clause the posting calls a plus does not raise the bar", () => {
  it("asks for the Bachelor's when the MBA is a plus", () => {
    expect(
      one(
        "Education\nB.A. Economics, State University 2015",
        "Bachelor's degree required; MBA a plus",
      ),
    ).toMatchObject({ kind: "education", status: "met" });
  });
});

describe("years judgements", () => {
  const engineer =
    "Experience\nSoftware Engineer, Acme Corp Jan 2012 - Dec 2023\n- Built software development tooling in Java";

  it("meets enough years in the field the line names", () => {
    expect(one(engineer, "8+ years of experience").status).toBe("met");
    expect(one(engineer, "5+ years of professional software development experience")).toMatchObject(
      { status: "met", evidence: expect.arrayContaining([expect.stringContaining("Software")]) },
    );
  });

  it("is missing, and says why, when the work history is in another field", () => {
    expect(
      one(
        "Experience\nRegistered Nurse, City Hospital Jan 2010 - Dec 2023\n- Cared for patients",
        "5+ years of software engineering experience",
      ),
    ).toMatchObject({
      status: "missing",
      detail: "The resume does not name software, engineering; 5 years asked",
    });
    expect(
      one(
        "Experience\nCTO, Acme Corp Jan 2010 - Dec 2023\n- Led engineering",
        "8+ years B2B SaaS sales experience",
      ),
    ).toMatchObject({ status: "missing", detail: expect.stringContaining("does not name") });
  });

  const SOFTWARE_ENGINEER = [
    "Experience",
    "Senior Software Engineer, Northwind Labs Jan 2021 - Present",
    "- Built payment services in Go on Kubernetes serving 3M users",
    "Software Engineer, Tailspin Systems Jun 2017 - Dec 2020",
    "- Wrote REST APIs in Python backed by PostgreSQL",
  ].join("\n");

  it.each([
    "5+ years of hands-on software development experience",
    "5+ years of experience as a software developer",
  ])("counts a software engineer's years as software development: %s", (ask) => {
    expect(one(SOFTWARE_ENGINEER, ask)).toMatchObject({
      kind: "experience",
      status: "met",
      detail: expect.stringMatching(/^9 years in roles naming software, develop/),
    });
  });

  it("folds develop, developed, developer and development", () => {
    const forms = ["develop", "developed", "developer", "developers", "development"];
    const rules = DEFAULT_POLICY.keywordMatch.stemming;
    expect(new Set(forms.map((form) => stem(form, rules)))).toEqual(new Set(["develop"]));
  });

  it.each([
    ["Mechanical Engineer, Copperline Pumps", "Designed pumps", "software development"],
    ["Sales Engineer, Brightline Software", "Ran software demos", "software development"],
    ["Software Engineer, Brightline Software", "Built billing software", "business development"],
    ["Field Service Engineer, Copperline Pumps", "Serviced pumps", "business development"],
    ["Civil Engineer, Greystone Land Partners", "Surveyed land for housing", "land development"],
  ])("does not count an engineer's years as other development: %s", (role, bullet, field) => {
    const body = `Experience\n${role} Jan 2015 - Present\n- ${bullet}`;
    expect(one(body, `5+ years of ${field} experience`).status).not.toBe("met");
  });

  it.each([
    "Minimum of 5 years of software engineering experience",
    "Min. 5 years of software engineering experience",
    "A minimum of 5 years of software engineering experience",
  ])('reads "minimum" as the wording of the years, not their field: %s', (ask) => {
    const report = check(SOFTWARE_ENGINEER, `Requirements\n- ${ask}`);
    const requirement = report.requirements[0] as AtsRequirement;
    expect(requirement).toMatchObject({
      kind: "experience",
      status: "met",
      detail: "9 years in roles naming software, engineering, 5 asked",
    });
    expect(requirement.terms.map(({ term }) => term)).toEqual(["software", "engineering"]);
    expect(report.missingKeywords).not.toContain("minimum");
    expect(report.missingKeywords).not.toContain("min");
  });

  it("counts a nurse's roles toward years of nursing", () => {
    const nurse = [
      "Experience",
      "Registered Nurse, Bayview General Hospital, Houston, TX Mar 2021 - Present",
      "- Administer medications and monitor cardiac rhythms",
      "Staff Nurse, Lakeside Medical Center, Austin, TX Jun 2018 - Feb 2021",
      "- Cared for post-operative patients on a medical-surgical floor",
    ].join("\n");
    expect(one(nurse, "3+ years of nursing experience")).toMatchObject({
      kind: "experience",
      status: "met",
      detail: "8 years in roles naming nursing, 3 asked",
    });
  });

  it("does not read an account executive's years as accounting", () => {
    const sales = [
      "Experience",
      "Account Executive, Brightline Software Feb 2020 - Present",
      "- Managed a book of 60 mid-market accounts in Salesforce",
    ].join("\n");
    expect(one(sales, "2+ years of accounting experience").status).toBe("missing");
  });

  it("reads a minimum of years of a skill", () => {
    expect(one(SOFTWARE_ENGINEER, "Minimum 3 years of Python")).toMatchObject({
      status: "met",
      detail: "3 years in roles naming python, 3 asked",
    });
  });
});

describe("missing keywords", () => {
  it("leaves out the employer, the location, filler and terms of a met degree", () => {
    const report = check(
      "Experience\nEngineer, Acme Corp Jan 2012 - Dec 2023\n- Built services in Java\nEducation\nB.S. Computer Science, State University 2011",
      [
        "Acme Robotics is hiring in Seattle, WA (hybrid).",
        "Requirements",
        "- Bachelor's degree in a related field",
        "- Track record with Kafka or another message broker",
        "- Managed a million dollar budget",
        "About Acme Robotics",
        "Acme Robotics builds robots.",
      ].join("\n"),
    );
    for (const noise of [
      "kafka or another",
      "seattle",
      "wa",
      "hiring",
      "hybrid",
      "track",
      "million",
      "related",
      "field",
      "bachelor",
      "degree",
      "robotics",
    ])
      expect(report.missingKeywords).not.toContain(noise);
    expect(report.missingKeywords).toContain("kafka");
  });

  it("leaves out function words joined by a slash", () => {
    const report = check(
      "Skills\nPython",
      "Requirements\n- Python and/or Go\n- Bring his/her own laptop",
    );
    for (const word of ["and/or", "and", "or", "his/her", "his", "her"])
      expect(report.missingKeywords).not.toContain(word);
  });

  it("credits a B.Tech against a Bachelor's degree in the match score", () => {
    const report = check(
      "Education\nB.Tech Computer Science, Indian Institute of Technology 2015",
      "Requirements\n- Bachelor's degree",
    );
    expect(report.requirements[0]?.status).toBe("met");
    expect(report.jobMatchScore).toBe(100);
  });
});

describe("evidence lines", () => {
  it("evidences a degree with the degree, not a certificate", () => {
    expect(
      one(
        "Education\nAWS Certified Developer, Amazon 2020\nB.S. Computer Science, State University 2015",
        "Bachelor's degree",
      ).evidence,
    ).toEqual(["B.S. Computer Science, State University 2015"]);
  });

  it("never takes a nationality as proof of a language", () => {
    const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    const found = AtsScoringService.check(
      `${HEAD}\nPersönliche Daten\nStaatsangehörigkeit: deutsch\nSprachen\nEnglisch (fließend)`,
      policy,
      { jobDescription: "Ihr Profil\n- Sehr gute Deutschkenntnisse", now: NOW, languages: ["de"] },
    ).requirements[0];
    expect(found?.kind).toBe("language");
    expect(found?.evidence).toEqual([]);
    expect(found?.status).not.toBe("met");
  });

  it("reads a teacher's work as experience in education", () => {
    expect(
      one(
        "Experience\nTeacher, Lincoln High School Jan 2015 - Dec 2023\n- Taught algebra",
        "Experience in education or healthcare",
      ).status,
    ).toBe("met");
  });
});

describe("small readings", () => {
  const body = "Experience\nEngineer, Acme Corp Jan 2012 - Dec 2023\n- Built services in Java";

  it("does not turn an age requirement into a missing skill", () => {
    const report = check(body, "Requirements\n- Must be at least 18 years of age");
    expect(report.requirements[0]?.status).toBe("unverifiable");
    expect(report.missingKeywords).not.toContain("least");
  });

  it("reads years written as words", () => {
    for (const ask of ["Five (5) years of Java", "Five years of Java", "five (5)+ years of Java"])
      expect(one(body, ask)).toMatchObject({ kind: "experience", status: "met" });
    expect(one(body, "Fifteen years of Java")).toMatchObject({
      kind: "experience",
      status: "partial",
    });
  });

  it("reads a language named in a skills line as a language requirement", () => {
    expect(one(body, "Communication skills in English")).toMatchObject({
      kind: "language",
      status: "unverifiable",
    });
  });

  it("folds Node, NodeJS and React.js together with Node.js and React", () => {
    const report = check("Skills\nNodeJS, React.js", "Requirements\n- Node.js\n- React");
    expect(report.jobMatchScore).toBe(100);
  });
});

describe("the new patterns stay linear", () => {
  const HOSTILE = [
    " ".repeat(50_000),
    "A".repeat(50_000),
    "Aa ".repeat(16_000),
    "Seattle Seattle Seattle, ".repeat(2_000),
    `Seattle,${" ".repeat(50_000)}WA`,
    "five (".repeat(10_000),
    "five (5".repeat(8_000),
    "about ".repeat(10_000),
    "a plus; ".repeat(6_000),
    ";,()".repeat(12_000),
  ];
  const km = DEFAULT_POLICY.keywordMatch;

  it.each([
    ["ignorePatterns", km.ignorePatterns],
    ["sections", Object.values(km.sections)],
  ])("%s", (_, patterns) => {
    for (const pattern of patterns)
      for (const text of HOSTILE) {
        const matches = expectFast(
          () => [...text.matchAll(policyRegex(pattern, "giu"))],
          250,
          `${pattern} on ${text.slice(0, 12)}`,
        );
        expect(matches.length).toBeGreaterThanOrEqual(0);
      }
  });

  it("checks a hostile posting in bounded time", () => {
    for (const text of HOSTILE) {
      expectFast(
        () =>
          AtsScoringService.check(`${HEAD}\nSkills\nPython`, DEFAULT_POLICY, {
            jobDescription: `Requirements\n- ${text}`,
            now: NOW,
          }),
        2_000,
        text.slice(0, 12),
      );
    }
  });
});
