import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, parseResume } from "../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../src/locales/index.js";
import { degreeLevel } from "../src/parser/education.js";
import { findDateRange } from "../src/parser/dates.js";
import { expectFast } from "./fixtures/timing.js";

/**
 * Parser regressions a review of the October audit fixes found, one block each. Every resume
 * here is invented.
 */

const NOW = new Date(Date.UTC(2026, 9, 5));

const parse = (text: string, policy = DEFAULT_POLICY) =>
  parseResume(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    policy,
    NOW,
  );

const rows = (text: string) =>
  parse(text).roles.map(({ title, employer, start, end, current }) => ({
    title,
    employer,
    start,
    end,
    current,
  }));

const LOCALIZED = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const check = (text: string, options: { region?: string; languages?: string[] } = {}) =>
  AtsScoringService.check(text, LOCALIZED, { now: NOW, ...options });

const HEAD = "Jane Doe\njane@example.com | 415-555-0142\n";
const JOB = "Experience\nSenior Engineer, Acme Corp    Jan 2020 - Present\n- Built things\n";
const EDU = "Education\nB.S. Computer Science, State University, 2016\n";

describe("#1 an undotted LLM is a language model unless a law school stands beside it", () => {
  it.each([
    "Hands-on experience with LLM, RAG and vector search",
    "Experience deploying LLM in production",
    "ML engineer working on LLM, RAG and search systems.",
    "DeepLearning.AI LLM (2024)",
    "Built LLM tools, 2023",
  ])("%j names no degree", (line) => {
    expect(degreeLevel(line, DEFAULT_POLICY)).toBeNull();
    expect(degreeLevel(line, LOCALIZED)).toBeNull();
  });

  it.each([
    "LLM, National Law School, 2009",
    "Master of Laws (LLM), Harvard Law School, 2015",
    "Harvard Law School, LLM 2015",
    "LLM in International Law, University of Melbourne",
    "LL.M., Columbia, 2012",
  ])("%j is still a Master of Laws", (line) => {
    expect(degreeLevel(line, DEFAULT_POLICY)?.isced).toBe(7);
    expect(degreeLevel(line, LOCALIZED)?.isced).toBe(7);
  });

  it("does not read a posting's LLM requirement as a Master's", () => {
    const report = AtsScoringService.check(`${HEAD}\n${JOB}\n${EDU}`, DEFAULT_POLICY, {
      now: NOW,
      jobDescription:
        "Requirements\n- Hands-on experience with LLM, RAG and vector search\n- Experience deploying LLM in production",
    });
    expect(report.requirements.map((requirement) => requirement.kind)).not.toContain("education");
  });

  it("does not read an LLM in a summary or a certification as a degree", () => {
    expect(
      parse(
        `${HEAD}Summary\nML engineer working on LLM, RAG and search systems.\n${JOB}Certifications\nDeepLearning.AI LLM (2024)`,
      ).education,
    ).toEqual([]);
  });
});

describe("#2 a heading joined to more heading words over a dated line is still a heading", () => {
  it("keeps Education & Certifications over a dated degree", () => {
    const parsed = parse(
      `${HEAD}${JOB}Education & Certifications\nB.S. Computer Science, State University    2014 - 2018\nAWS Certified Solutions Architect`,
    );
    expect(parsed.education.map((entry) => entry.credential)).toEqual(["B.S."]);
    expect(parsed.roles).toHaveLength(1);
  });

  it.each([
    ["Experience & Leadership", 2],
    ["Work Experience Highlights", 2],
  ])("keeps %j over the first role", (heading, count) => {
    const parsed = parse(
      `${HEAD}Skills & Tools\nPython, Go\n${heading}\nSenior Engineer, Acme Corp    Jan 2020 - Present\n- Built things\nEngineer, Beta Inc    Jun 2016 - Dec 2019\n- Built things\n${EDU}`,
    );
    expect(parsed.roles).toHaveLength(count);
    expect(parsed.skills).toEqual(["Python", "Go"]);
  });

  it.each(["Certifications & Awards", "Projects & Publications"])(
    "does not read the entries under %j as jobs",
    (heading) => {
      expect(
        parse(
          `${HEAD}${JOB}${heading}\nRealtime Chat App, Open Source    2021 - 2022\nDean's List, State University    2014 - 2016\n${EDU}`,
        ).roles,
      ).toHaveLength(1);
    },
  );

  it("still reads a heading word with a job title after it over bare dates as a role", () => {
    expect(rows("Jane Doe\nExperience\nExperience Strategist\nJan 2019 - Present")).toMatchObject([
      { title: "Experience Strategist", current: true },
    ]);
  });
});

describe("#3 an education heading the policy does not know", () => {
  it.each(["Academic Background", "Educational Background", "Academic Qualifications"])(
    "opens the education section: %j",
    (heading) => {
      const parsed = parse(
        `${HEAD}${JOB}Skills\nPython, Go\n${heading}\nM.S. Computer Science, Stanford University, 2018\nB.S. Computer Science, State University    2012 - 2016`,
      );
      expect(parsed.education.map((entry) => [entry.credential, entry.school])).toEqual([
        ["M.S.", "Stanford University"],
        ["B.S.", "State University"],
      ]);
      expect(parsed.skills).toEqual(["Python", "Go"]);
      expect(parsed.roles).toHaveLength(1);
    },
  );

  it("is still read when it is folded into the work history or the skills", () => {
    const below = (heading: string) =>
      parse(
        `${HEAD}${JOB}Skills\nPython, Go\n${heading}\nB.S. Computer Science, State University    2012 - 2016`,
      ).education.map((entry) => entry.credential);
    expect(below("Schooling")).toEqual(["B.S."]);
    expect(
      parse(
        `${HEAD}${JOB}Schooling\nState University\nB.S. Computer Science\n2012 - 2016`,
      ).education.map((entry) => [entry.credential, entry.school]),
    ).toEqual([["B.S.", "State University"]]);
  });

  it("does not read a dated role at a university as a school", () => {
    expect(
      parse(
        `${HEAD}Experience\nResearch Assistant, Stanford University    2016 - 2018\n- Ran experiments\nStanford University\nTeaching Assistant\n2014 - 2016`,
      ).education,
    ).toEqual([]);
  });
});

describe("#4 a season standing alone", () => {
  it("does not win over a full range later on the line", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nResearch Assistant, Fall 2019 cohort, Acme Lab    Jan 2019 - Dec 2020\n- Did research",
      ),
    ).toMatchObject([
      {
        title: "Research Assistant",
        employer: expect.stringContaining("Acme Lab"),
        start: { year: 2019, month: 1 },
        end: { year: 2020, month: 12 },
      },
    ]);
  });

  it("is not a term in the middle of prose", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nSoftware Engineer, Acme Corp    Jan 2019 - Present\nLed the Fall 2021 recruiting season across four campuses.\nShipped the Spring 2022 release on time.",
      ),
    ).toHaveLength(1);
  });

  it("is still a term at the end of a header or in its own column", () => {
    expect(
      rows("Jane Doe\nExperience\nResearch Intern, Acme Labs    Winter 2019\n- x"),
    ).toMatchObject([{ start: { year: 2019, month: 1 }, end: { year: 2019, month: 3 } }]);
    expect(rows("Jane Doe\nExperience\nSummer 2018\tIntern, Acme Labs")).toMatchObject([
      { start: { year: 2018, month: 6 }, end: { year: 2018, month: 8 } },
    ]);
  });
});

describe("#5 a city opening the contact line is not the name", () => {
  const BODY = `\n${JOB}${EDU}`;
  it.each([
    "New York, NY | jane@example.com | (212) 555-0100\nJane Doe\nSoftware Engineer",
    "Resume\nNew York, NY · (212) 555-0100 · jane@example.com\nJane Doe",
    "New York, NY | jane@example.com | (212) 555-0100\nJane Doe",
  ])("in %j", (top) => {
    expect(parse(`${top}${BODY}`).name).toBe("Jane Doe");
  });

  it("in a sidebar read first", () => {
    expect(
      parse(
        `CONTACT\nSan Francisco, CA | 415-555-0162 | lucas@moreau.design\nLUCAS MOREAU\nSENIOR PRODUCT DESIGNER${BODY}`,
      ).name,
    ).toBe("LUCAS MOREAU");
  });

  it("but a name with its credential on the contact line still is", () => {
    expect(parse(`Jane Doe, PhD | jane@example.com | (212) 555-0100${BODY}`).name).toBe("Jane Doe");
  });
});

describe("#6 a name with post-nominals at the top", () => {
  const BODY = `\n${JOB}${EDU}`;
  it("beats a company over a title further down", () => {
    expect(
      parse(
        `Priya Raman, MBA\npriya@example.com\nSummary\nGoldman Sachs\nInvestment Banking Analyst${BODY}`,
      ).name,
    ).toBe("Priya Raman");
    expect(
      parse(
        `Priya Raman, CPA\npriya@example.com\nVolunteer\nRed Cross Society\nVolunteer Coordinator${BODY}`,
      ).name,
    ).toBe("Priya Raman");
  });

  it("but a place cut the same way does not", () => {
    expect(parse(`San Francisco, CA\nLUCAS MOREAU\nSenior Product Designer${BODY}`).name).toBe(
      "LUCAS MOREAU",
    );
  });
});

describe("#7 a date line is not glued onto a line above that has a number", () => {
  it("keeps the next role when its dates come first", () => {
    expect(
      rows(
        "Jane Doe\nExperience\n2020 - Present\nSenior Engineer, 23andMe\n2018 - 2019\nEngineer, Beta Inc",
      ),
    ).toMatchObject([
      { title: "Senior Engineer", employer: "23andMe", current: true },
      { title: "Engineer", employer: "Beta Inc", start: { year: 2018 } },
    ]);
  });
});

describe("#8 the employer of a group", () => {
  it("is not the previous role's location line", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nSoftware Engineer, Acme Corp  Jan 2020 - Present\nSan Francisco, CA\nData Analyst\nJun 2018 - Dec 2019\n- Built dashboards",
      ),
    ).toMatchObject([
      { title: "Software Engineer", employer: "Acme Corp" },
      { title: "Data Analyst", employer: "" },
    ]);
  });

  it("is still read at the top of the section and after a block of bullets", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nAcme Corporation, New York, NY\nSenior Engineer\nJan 2020 - Present\n- Led things\nEngineer\nJun 2018 - Dec 2019\n- Did things\nGlobex Inc\nIntern\nJun 2017 - Aug 2017\n- stuff",
      ).map((role) => role.employer),
    ).toEqual(["Acme Corporation", "Acme Corporation", "Globex Inc"]);
  });
});

describe("#9 a short line between a header and its dates", () => {
  it("ends the employer the page wrapped", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nPostdoctoral Research Fellow, Harvard T.H. Chan School of Public\nHealth\nAug 2018 – Aug\n2021\n- Studied cohorts",
      ),
    ).toMatchObject([
      {
        title: "Postdoctoral Research Fellow",
        employer: "Harvard T.H. Chan School of Public Health",
      },
    ]);
  });

  it("is kept as the employer under a title and team", () => {
    const [role] = rows(
      "Jane Doe\nExperience\nSoftware Engineer - Backend\nStripe\nJan 2020 - Present\n- x",
    );
    expect(role.title).toBe("Software Engineer");
    expect(role.employer).toContain("Stripe");
  });

  it("is dropped when it says where", () => {
    expect(
      rows("Jane Doe\nExperience\nSenior Engineer, Acme Corp\nRemote\nJan 2020 - Present\n- x"),
    ).toMatchObject([{ title: "Senior Engineer", employer: "Acme Corp" }]);
    expect(
      rows("Jane Doe\nExperience\nSenior Engineer, Acme Corp\nAustin, TX\nJan 2020 - Present\n- x"),
    ).toMatchObject([{ title: "Senior Engineer", employer: "Acme Corp" }]);
  });
});

describe("#10 initials", () => {
  it("are not a J.D.", () => {
    expect(parse(`J. D. Salinger\njd@example.com\n${JOB}`).education).toEqual([]);
    expect(degreeLevel("J.D. Salinger", DEFAULT_POLICY)).toBeNull();
  });

  it.each(["J.D., Harvard Law School, 2015", "Juris Doctor (J.D.), 2015", "J.D. 2015"])(
    "while %j still is one",
    (line) => expect(degreeLevel(line, DEFAULT_POLICY)?.isced).toBe(7),
  );
});

describe("#11 a school's name", () => {
  it("loses a lone month and year after a grade", () => {
    expect(
      check(
        "Jonas Becker\n+49 221 5550 1842\nAusbildung\nAbitur, Beethoven-Gymnasium Bonn (Note 1,7)   06/2011",
        { region: "DE", languages: ["de"] },
      ).parsed.education.map((entry) => [entry.school, entry.end?.year]),
    ).toEqual([["Beethoven-Gymnasium Bonn", 2011]]);
  });
});

describe("#12 a two-digit end year", () => {
  it("is not two digits of an address", () => {
    expect(
      rows("Jane Doe\nExperience\nEngineer, Acme Corp\nSuite 2021 - 30 Main St\n2019 - 2021\n- x"),
    ).toMatchObject([{ start: { year: 2019 }, end: { year: 2021 } }]);
  });

  it("is not a year after now", () => {
    expect(rows("Jane Doe\nExperience\nEngineer, Acme Corp    2021 - 30\n- x")).toEqual([]);
  });

  it("still ends a range of years", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nSenior Engineer, Acme Corp    2019–21\n- x\nIntern, Gamma   1998 – 02",
      ),
    ).toMatchObject([
      { start: { year: 2019 }, end: { year: 2021 } },
      { start: { year: 1998 }, end: { year: 2002 } },
    ]);
  });
});

describe("licence and certification headings", () => {
  it.each([
    "Certifications",
    "Licenses and Certifications",
    "Licenses & Certifications",
    "LICENSES & CERTIFICATIONS",
    "Licensure",
    "Certificates",
  ])("%j closes the work history, so a licence's dates are not a job", (heading) => {
    const parsed = parse(
      `${HEAD}${JOB}${heading}\nRegistered Nurse, State Board of Nursing    2018 - 2026\nBLS Certification, American Heart Association    2024 - 2026\n${EDU}`,
    );
    expect(parsed.roles.map((role) => role.title)).toEqual(["Senior Engineer"]);
    expect(parsed.education.map((entry) => entry.credential)).toEqual(["B.S."]);
  });
});

describe("#7 dates first", () => {
  it.each(["Reduced costs by 30% across 4 teams", "Team of 6 engineers"])(
    "reads the header below the dates, not the line %j above",
    (closing) => {
      expect(
        rows(
          `Jane Doe\nExperience\n2020 - Present\nSenior Engineer, Acme Corp\n${closing}\n2018 - 2019\nEngineer, Beta Inc\nShipped 12 releases`,
        ).map((role) => [role.title, role.employer]),
      ).toEqual([
        ["Senior Engineer", "Acme Corp"],
        ["Engineer", "Beta Inc"],
      ]);
    },
  );
});

describe("the new shapes stay linear", () => {
  it.each([
    ["LLMs and law words", "llm, ".repeat(20_000) + "law school"],
    ["J.D.s", "j.d. ".repeat(20_000)],
    ["lone seasons", "Fall 2019 x ".repeat(20_000)],
    ["spaces around a season", `x${" ".repeat(50_000)}Fall 2019${" ".repeat(50_000)}x`],
    ["short ends", "2019 - 21 ".repeat(20_000)],
    ["state codes", "New York, NY, ".repeat(20_000)],
  ])("%s", (_, line) => {
    expectFast(() => degreeLevel(line, LOCALIZED), 500);
    expectFast(() => findDateRange(line, LOCALIZED.resumeParse, NOW), 500);
    expectFast(
      () =>
        parse(`${line}
jane@example.com
Experience
${line}
Education
${line}`),
      1500,
    );
  });
});
