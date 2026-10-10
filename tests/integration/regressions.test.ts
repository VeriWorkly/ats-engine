import { describe, expect, it } from "vitest";

import {
  AtsScoringService,
  DEFAULT_POLICY,
  type AtsEnginePolicy,
  type AtsResumeInput,
} from "../../src/index.js";
import { prepareResume } from "../../src/input.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { extractResume } from "../../src/node/extract.js";
import { readResume } from "../../src/scoring/context.js";
import { buildPdf } from "../fixtures/buildPdf.js";
import { livePolicy } from "../fixtures/livePolicy.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Regressions found in the September 2026 audit, one test per defect.
 *
 * Every case runs against `DEFAULT_POLICY`, so this suite needs no private files and always runs
 * in CI. The adversarial-input budget also runs against the live policy when it is present,
 * because a pattern-level ReDoS in the shipped policy is the one that would actually take a
 * worker down.
 */

const NOW = new Date("2026-09-30T00:00:00Z");

const check = (
  resume: AtsResumeInput,
  jobDescription?: string,
  policy: AtsEnginePolicy = DEFAULT_POLICY,
) => AtsScoringService.check(resume, policy, { jobDescription, now: NOW });

/**
 * Inputs that made one regex restart its scan at every position. The unbounded email pattern
 * took over a second per call on the first two and a scan runs it about nine times.
 */
const ADVERSARIAL: Record<string, string> = {
  "dotted run": "a.".repeat(25_000),
  "dashed run": "a-".repeat(25_000),
  "numeric dashes": "1-".repeat(25_000),
  "at signs": "a@".repeat(25_000),
  "dotted address run": "a.b@".repeat(12_500),
};

function expectFastOn(policy: AtsEnginePolicy) {
  for (const [label, input] of Object.entries(ADVERSARIAL)) {
    // Generous: the fixed patterns take single-digit milliseconds. The ceiling is set far below
    // the seconds the quadratic pattern took, and far above CI noise.
    expectFast(
      () =>
        AtsScoringService.check(input, policy, {
          jobDescription: input.slice(0, 20_000),
          now: NOW,
        }),
      500,
      label,
    );
  }
}

describe("adversarial input", () => {
  it("scans a 50k-character pathological input in bounded time", () => {
    expectFastOn(DEFAULT_POLICY);
  });

  it("stays bounded with the locale packs detected and applied", () => {
    // Asked for rather than detected: the pathological run outweighs any real text, so detection
    // rightly reads it as no language. The packs' patterns (German compounds among them) and the
    // DE region are what scan it.
    const localized = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    const lead = "und der das mit für von bei auf ist sind eine Berufserfahrung +49 30 12345678 ";
    const devanagari = "कार्य अनुभव शिक्षा कौशल ".repeat(20);
    for (const [label, input] of Object.entries({
      ...ADVERSARIAL,
      "one long compound": "softwareentwickler".repeat(2_800),
      "letter-spaced run": "E ".repeat(25_000),
      "digit-space run": "1 ".repeat(25_000),
    })) {
      const text = `${lead}${devanagari}\n${input}`;
      const report = expectFast(
        () =>
          AtsScoringService.check(text, localized, {
            jobDescription: text.slice(0, 20_000),
            now: NOW,
            languages: ["de", "hi"],
            region: "DE",
          }),
        500,
        label,
      );
      expect(report.locale, label).toEqual({ languages: ["de", "hi"], region: "DE" });
    }
  });

  it.skipIf(!livePolicy)("scans pathological input in bounded time under the live policy", () => {
    expectFastOn(livePolicy as AtsEnginePolicy);
  });

  it("still finds ordinary email addresses", () => {
    const report = check("Jane Doe\njane.doe+jobs@mail.example.co.uk\nExperience\nEngineer");
    expect(report.parsed.email).toBe("jane.doe+jobs@mail.example.co.uk");
  });
});

describe("date ranges", () => {
  const resume = `John Smith
Experience
Platform Engineer, Initech
Mar 2019 - Present
- Scaled the platform from 1000 to 5000 users in six months
- Handled 10000-20000 requests per second at peak load
- Grew revenue 2019 - 2021 by 40%`;

  it("does not read numbers inside bullets as jobs", () => {
    const { roles, monthsOfExperience } = check(resume).parsed;
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      title: "Platform Engineer",
      employer: "Initech",
      current: true,
    });
    expect(monthsOfExperience).toBe(91);
  });

  it("rejects implausible years and backwards ranges on header lines", () => {
    const { roles } = check(
      "Experience\nEngineer, Acme\n1000 - 5000\nAnalyst, Globex\n2022 - 2019",
    ).parsed;
    expect(roles).toHaveLength(0);
  });

  it("does not take a year from the middle of a longer number", () => {
    const { roles } = check("Experience\nEngineer, Acme 12020 - 20221").parsed;
    expect(roles).toHaveLength(0);
  });

  it("accepts a month-precise start with a year-only end in the same year", () => {
    const { roles } = check("Experience\nEngineer, Acme\nDec 2019 - 2019").parsed;
    expect(roles).toHaveLength(1);
    expect(roles[0].start).toEqual({ year: 2019, month: 12 });
  });

  it("skips a bad candidate and takes a later range on the same line", () => {
    const { roles } = check("Experience\nEngineer, Acme 1000 - 5000 · 2018 - 2021").parsed;
    expect(roles[0]?.start).toEqual({ year: 2018, month: null });
  });
});

describe("degrees", () => {
  it("records a line naming two credentials at the higher one", () => {
    const { education, highestDegree } = check(
      "Education\nDiploma, Master of Science, University of Leeds, 2016 - 2018",
    ).parsed;
    expect(education[0]).toMatchObject({ level: "master", credential: "Master of Science" });
    expect(highestDegree).toBe("master");
  });

  it.each([
    "Harvard University, Cambridge, MA",
    "Jackson State University, Jackson, MS",
    "Skills: MS Excel, MS Office",
    "SSL certificate management",
    "Associate Product Manager, Acme",
  ])("does not read %j as a degree", (line) => {
    expect(check(`Education\n${line}`).parsed.highestDegree).toBeNull();
  });

  it.each([
    ["MS in Computer Science", "master"],
    ["MSc Data Science", "master"],
    ["MBA, Wharton", "master"],
    ["BS Computer Science", "bachelor"],
    ["B.Tech, Tech Institute", "bachelor"],
    ["Associate of Arts", "associate"],
    ["High School Diploma", "diploma"],
    ["PhD, MIT", "doctorate"],
  ])("reads %j as %s", (line, level) => {
    expect(check(`Education\n${line}`).parsed.highestDegree).toBe(level);
  });
});

describe("job match vocabulary", () => {
  const posting = `Senior Backend Engineer
Requirements
- Deep experience in Kubernetes and Docker
- Hands-on experience with Go or Java
- Prior exposure to Terraform is a plus`;
  const resume =
    "Experience\nEngineer, Acme\n2020 - 2024\n- Ran Kubernetes and Docker in production\n- Wrote Go services\nSkills\nTerraform";

  it("never reports function words as keywords", () => {
    const { matchedKeywords, missingKeywords } = check(resume, posting);
    for (const word of ["a", "in", "to", "or", "is", "deep", "hands-on", "prior", "exposure"]) {
      expect(matchedKeywords).not.toContain(word);
      expect(missingKeywords).not.toContain(word);
    }
  });

  it("keeps short skills the posting names", () => {
    expect(check(resume, posting).matchedKeywords).toContain("go");
  });

  it("does not rank a capitalised bullet opener as a skill", () => {
    const { missingKeywords } = check("Experience\nEngineer, Acme\n2020 - 2024", posting);
    // Named skills lead the list; a sentence-initial word must not be promoted above them.
    expect(missingKeywords.slice(0, 3)).toEqual(expect.arrayContaining(["kubernetes", "docker"]));
  });
});

describe("content metrics", () => {
  it("does not count dates as quantified outcomes", () => {
    const resume = `Jane Doe
Experience
Senior Software Engineer, Acme Corp
Jan 2020 - Present
Software Engineer, Globex Corporation
Jun 2016 - Dec 2019
Designed the internal platform for the whole engineering organisation
Improved the onboarding experience for every new engineer on the team`;
    const metrics = check(resume).rules.find((rule) => rule.id === "ats-v2.content.metrics");
    expect(metrics?.passed).toBe(false);
  });

  it("does not credit a word that merely starts with an action verb", () => {
    const resume =
      "Experience\nEngineer, Acme\n2020 - 2024\nLedger reconciliation for the finance team\nLedger audits every quarter for the board";
    const verbs = check(resume).rules.find((rule) => rule.id === "ats-v2.content.verbs");
    expect(verbs?.passed).toBe(false);
  });
});

describe("bullets, headings and bounded scans", () => {
  const roles = (text: string) =>
    check(text).parsed.roles.map((role) => [role.title, role.employer, role.start?.year ?? null]);

  it("bounds the month-name scan on long letter runs", () => {
    for (const input of ["jan".repeat(16_666), `Education\nB.S. ${"dec".repeat(16_660)}`]) {
      expectFast(() => check(input, input.slice(0, 20_000)), 200);
    }
  });

  it.each(["●", "", "o", "➢", "✓", "►", "1.", "2)"])("treats %j as a bullet", (marker) => {
    expect(
      roles(
        `Experience\nEngineer, Acme  Jan 2022 - Present\n${marker} Grew usage from 2015 - 2021`,
      ),
    ).toEqual([["Engineer", "Acme", 2022]]);
  });

  it("keeps content written after a heading's colon", () => {
    expect(check("Jane\nSkills: Python, Java, SQL").parsed.skills).toEqual([
      "Python",
      "Java",
      "SQL",
    ]);
    expect(
      check("I know Python.", "Requirements: Kubernetes, Terraform\nWe use Python.")
        .missingKeywords,
    ).toEqual(expect.arrayContaining(["kubernetes", "terraform"]));
  });

  it("does not read prose that starts like a heading as one", () => {
    const { monthsOfExperience } = check(
      "Experience\nEngineer, Acme 2016 - 2022\nEducation\nHistory of Art BA\nUniversity of Leeds 2012 - 2015",
    ).parsed;
    expect(monthsOfExperience).toBe(84);
  });

  it("does not count a degree as a job when there is no experience heading", () => {
    expect(
      roles(
        "Education\nMIT, B.S. 2010 - 2014\nRelevant Experience\nEngineer, Acme  Jan 2020 - Present",
      ),
    ).toEqual([["Engineer", "Acme", 2020]]);
  });

  it("scores the headings the parser accepts", () => {
    const failed = check(
      "Jane\nProfessional Experience\nEngineer, Acme  Jan 2020 - Present\nTechnical Skills\nGo",
    ).failedChecks.map((rule) => rule.id);
    expect(failed).not.toContain("ats-v2.structure.experience");
    expect(failed).not.toContain("ats-v2.structure.skills");
  });

  it("reads tenure generously and ignores roles that have not started", () => {
    expect(check("Experience\nEngineer, Acme 2019 - 2022").parsed.monthsOfExperience).toBe(48);
    expect(
      check("Experience\nEngineer, Acme Jan 2030 - Present").parsed.monthsOfExperience,
    ).toBeNull();
  });

  it.each([
    "Senior Engineer - Acme Corp  Jan 2020 - Present",
    "Senior Engineer\tAcme Corp\tJan 2020 - Present",
    "Senior Engineer      Acme Corp     Jan 2020 - Present",
    "Senior Engineer, Acme Corp (Jan 2020 - Present)",
    "Senior Engineer, Acme Corp  Jan 2020 to date",
    "Senior Engineer, Acme Corp  Jan-2020 − Present",
  ])("splits title and employer in %j", (line) => {
    expect(roles(`Experience\n${line}`)).toEqual([["Senior Engineer", "Acme Corp", 2020]]);
  });

  it("finds the header above, stacked above, or below the dates", () => {
    expect(roles("Experience\nSenior Engineer\nAcme Corp\nJan 2020 - Present")).toEqual([
      ["Senior Engineer", "Acme Corp", 2020],
    ]);
    expect(roles("Experience\nJan 2020 - Present\nSenior Engineer, Acme Corp\n- did x")).toEqual([
      ["Senior Engineer", "Acme Corp", 2020],
    ]);
  });

  it("does not read a word starting with an open-ended term as current", () => {
    expect(check("Experience\nEngineer, Acme  Jan 2020 - Nowhere Labs").parsed.roles).toEqual([]);
  });

  it("keeps a lone graduation year and drops Scrum Master as a degree", () => {
    const { education, highestDegree } = check(
      "Education\nStanford University, B.S. Computer Science, 2018\nCertifications\nCertified Scrum Master",
    ).parsed;
    expect(education[0]?.end).toEqual({ year: 2018, month: null });
    expect(highestDegree).toBe("bachelor");
  });

  it("trims punctuation from links and tolerates an untyped job description", () => {
    expect(check("x github.com/jane) https://jane.dev/.").parsed.links).toEqual([
      "github.com/jane",
      "https://jane.dev/",
    ]);
    expect(() =>
      AtsScoringService.check("x", DEFAULT_POLICY, { jobDescription: 5 as unknown as string }),
    ).not.toThrow();
  });

  it("does not rank an indented bullet opener as a skill", () => {
    const { missingKeywords } = check(
      "x",
      "Requirements\n      - Proficient communicator\n      - Kubernetes",
    );
    expect(missingKeywords[0]).toBe("kubernetes");
  });
});

describe("a LinkedIn profile export", () => {
  // A sidebar (Contact, Top Skills, Languages) read before the name, and roles grouped under
  // their employer with the time there on a line of its own.
  const SIDEBAR = [
    "Contact",
    "jordan.ellery@example.com",
    "www.linkedin.com/in/jordanellery",
    "Top Skills",
    "Kubernetes",
    "TypeScript",
    "PostgreSQL",
  ];
  const MAIN = [
    "Jordan Ellery",
    "Senior Software Engineer at Acme Corp",
    "Austin, Texas, United States",
    "Summary",
    "Backend engineer with nine years building payment systems.",
    "Experience",
    "Acme Corp",
    "4 years 9 months",
    "Senior Software Engineer",
    "January 2022 - Present (4 years 9 months)",
    "Austin, Texas, United States",
    "- Built a billing service handling 2M requests a day",
    "Software Engineer",
    "September 2019 - December 2021 (2 years 4 months)",
    "- Wrote the ledger reconciliation job",
    "Education",
    "Ohio State University",
    "Bachelor of Science - BS, Computer Science · (2015 - 2019)",
  ];
  const read = (
    resume: AtsResumeInput,
    layout?: Parameters<typeof AtsScoringService.check>[2]["layout"],
  ) => {
    const { parsed } = AtsScoringService.check(resume, DEFAULT_POLICY, { now: NOW, layout });
    return {
      name: parsed.name,
      roles: parsed.roles.map(({ title, employer }) => ({ title, employer })),
      skills: parsed.skills,
      schools: parsed.education.map((row) => row.school),
    };
  };
  const EXPECTED = {
    name: "Jordan Ellery",
    roles: [
      { title: "Senior Software Engineer", employer: "Acme Corp" },
      { title: "Software Engineer", employer: "Acme Corp" },
    ],
    skills: ["Kubernetes", "TypeScript", "PostgreSQL"],
    schools: ["Ohio State University"],
  };

  it("reads the name, the roles under their employer, and the top skills", () => {
    expect(read([...SIDEBAR, ...MAIN].join("\n"))).toEqual(EXPECTED);
  });

  it("reads the same from the two-column PDF", async () => {
    const esc = (value: string) => value.replace(/([()\\])/g, "\\$1");
    const column = (x: number, rows: Array<[string, number]>) => {
      let y = 740;
      return rows.map(([value, size]) => {
        const op = `BT /F1 ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET`;
        y -= size + 6;
        return op;
      });
    };
    const heading = (value: string) => ["Contact", "Top Skills", "Languages"].includes(value);
    const side = column(
      40,
      [...SIDEBAR, "Languages", "English (Native or Bilingual)"].map((value) => [
        value,
        heading(value) ? 11 : 8,
      ]),
    );
    const main = column(
      200,
      MAIN.map((value, index) => [value, index === 0 ? 22 : 10]),
    );
    const extracted = await extractResume(buildPdf([...side, ...main].join("\n")), "pdf");
    expect(read(extracted.text, extracted.layout)).toEqual(EXPECTED);
  });

  it("gives the scoring the sections the parser reads", () => {
    const { sections } = readResume(
      prepareResume([...SIDEBAR, ...MAIN].join("\n")),
      DEFAULT_POLICY,
      {
        now: NOW,
      },
    );
    const skills = sections.filter((section) => section.kind === "skills");
    expect(skills.flatMap((section) => section.lines)).toEqual([
      "Kubernetes",
      "TypeScript",
      "PostgreSQL",
    ]);
  });
});

describe("reproducibility", () => {
  it("stamps the engine version and a policy fingerprint, and repeats itself exactly", async () => {
    const { readFileSync } = await import("node:fs");
    const { ENGINE_VERSION, policyFingerprint } = await import("../../src/index.js");
    expect(ENGINE_VERSION).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);

    const text =
      "Jane Doe\njane@example.com\nExperience\nEngineer, Acme 2020 - 2022\n- Built things";
    const first = check(text, "Requirements\nGo and Kubernetes");
    expect(first.engine).toEqual({
      version: ENGINE_VERSION,
      policy: policyFingerprint(DEFAULT_POLICY),
    });
    expect(first.engine.policy).toMatch(/^ats-v2\+[0-9a-f]{8}$/);
    expect(JSON.stringify(check(text, "Requirements\nGo and Kubernetes"))).toBe(
      JSON.stringify(first),
    );
  });

  it("fingerprints a changed policy differently", async () => {
    const { parseAtsPolicy, policyFingerprint } = await import("../../src/index.js");
    const changed = parseAtsPolicy({ ...structuredClone(DEFAULT_POLICY), version: "ats-v2" });
    expect(policyFingerprint(changed)).toBe(policyFingerprint(DEFAULT_POLICY));
    changed.rules[0] = { ...changed.rules[0], fix: "Something else." };
    expect(policyFingerprint(parseAtsPolicy(changed))).not.toBe(policyFingerprint(DEFAULT_POLICY));
  });

  it("returns the lines as read only when asked", () => {
    const text = "Jane Doe\nEngineer building developer tools for teams who ship\nevery day.";
    expect(check(text).lines).toBeUndefined();
    expect(
      AtsScoringService.check(text, DEFAULT_POLICY, { now: NOW, includeLines: true }).lines,
    ).toEqual(["Jane Doe", "Engineer building developer tools for teams who ship every day."]);
  });
});
