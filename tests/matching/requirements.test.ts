import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, type AtsRequirement } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

const NOW = new Date("2026-10-01T00:00:00Z");

const RESUME = `Jane Doe
jane@example.com | +1 415 555 0142
Experience
Senior Engineer, Acme Corp Jan 2019 - Present
- Built payment services in Go and Kubernetes for 2M users
Engineer, Globex Jan 2016 - Dec 2018
- Built data pipelines with Python and Kafka
Education
B.S. Computer Science, State University 2015
Skills
Go, Python, Kubernetes, Terraform, PostgreSQL
Languages
English (native), Spanish (professional)`;

const judge = (job: string, resume = RESUME, policy = DEFAULT_POLICY) =>
  AtsScoringService.check(resume, policy, { jobDescription: job, now: NOW }).requirements;
const one = (line: string, resume?: string) =>
  judge(`Requirements\n- ${line}`, resume)[0] as AtsRequirement;

describe("requirements", () => {
  it("reads each line under the posting's headings, with its importance", () => {
    const found = judge(
      "Senior Engineer\nRequirements\n- Go\n- Kubernetes\nNice to have\n- Terraform",
    );
    expect(found.map((r) => [r.text, r.importance])).toEqual([
      ["Go", "required"],
      ["Kubernetes", "required"],
      ["Terraform", "preferred"],
    ]);
  });

  it("falls back to the bullets of a posting with no headings", () => {
    expect(judge("We need someone great.\n- Go services\n- Kubernetes").map((r) => r.text)).toEqual(
      ["Go services", "Kubernetes"],
    );
  });

  it("is empty without a posting", () => {
    expect(AtsScoringService.check(RESUME, DEFAULT_POLICY, { now: NOW }).requirements).toEqual([]);
  });
});

describe("skills", () => {
  it("is met with the resume's own lines as evidence, work history before the skills list", () => {
    expect(one("Experience with Kubernetes and Terraform")).toMatchObject({
      kind: "skills",
      status: "met",
      terms: [
        { term: "kubernetes", found: true },
        { term: "terraform", found: true },
      ],
      evidence: [
        "Built payment services in Go and Kubernetes for 2M users",
        "Go, Python, Kubernetes, Terraform, PostgreSQL",
      ],
    });
  });

  it("takes either side of an alternative, even one that opens the line", () => {
    expect(one("Kafka or RabbitMQ")).toMatchObject({
      status: "met",
      evidence: ["Built data pipelines with Python and Kafka"],
    });
  });

  it("is partial with some and missing with none", () => {
    expect(one("Go and Rust").status).toBe("partial");
    expect(one("Strong experience with AWS and Rust")).toMatchObject({
      status: "missing",
      evidence: [],
    });
  });

  /** The report for a resume whose skills line is `skills`, against a posting asking `ask`. */
  const listing = (skills: string, ask: string) =>
    AtsScoringService.check(
      RESUME.replace("Go, Python, Kubernetes, Terraform, PostgreSQL", skills),
      DEFAULT_POLICY,
      { jobDescription: `Requirements\n- ${ask}`, now: NOW },
    );

  it.each([
    ["HTML, CSS, JavaScript", "HTML/CSS"],
    ["HTML/CSS, JavaScript", "HTML, CSS"],
    ["C#, .NET, SQL", "C#/.NET"],
    ["C#/.NET, SQL", "C#, .NET"],
    ["Python, Django", "Python/Django"],
    ["Python, Django", "Experience with Python/Django"],
  ])("reads each skill in a slash compound: %s for %s", (skills, ask) => {
    const report = listing(skills, ask);
    expect(report.requirements[0]?.status).toBe("met");
    expect(report.jobMatchScore).toBe(100);
  });

  it("asks for every part of a slash compound: HTML alone partly meets HTML/CSS", () => {
    const report = listing("HTML, JavaScript", "HTML/CSS");
    expect(report.requirements[0]).toMatchObject({
      status: "partial",
      terms: [
        { term: "html", found: true },
        { term: "css", found: false },
      ],
    });
    expect(report.missingKeywords).toEqual(["css"]);
  });

  it.each([
    ["TCP/IP, DNS", "TCP/IP", "tcp/ip"],
    ["CI/CD, Docker", "CI/CD", "ci/cd"],
    ["PL/SQL, Oracle", "PL/SQL", "pl/sql"],
    ["A/B testing", "A/B testing", "a/b"],
  ])("keeps a compound the policy names whole: %s", (skills, ask, term) => {
    const requirement = listing(skills, ask).requirements[0] as AtsRequirement;
    expect(requirement.status).toBe("met");
    expect(requirement.terms.map((found) => found.term)).toContain(term);
    expect(listing("Python", ask).requirements[0]?.status).not.toBe("met");
  });

  it("weighs both parts of a compound that opens a line alike", () => {
    expect(listing("Java", "Java/Kotlin").jobMatchScore).toBe(
      listing("Kotlin", "Java/Kotlin").jobMatchScore,
    );
  });

  it("reads no skill inside a link", () => {
    const linked =
      "Python\n- Apply at https://careers.example.com/jobs/123/apply or https://x.com/a/b";
    const report = listing("Python", linked);
    expect(report.missingKeywords).toEqual(
      listing("Python", linked.replace(/https\S*/g, "")).missingKeywords,
    );
    expect(report.requirements.flatMap(({ terms }) => terms.map(({ term }) => term))).not.toContain(
      "a/b",
    );
  });

  it("reads no skill in a slash between letters, numbers or function words", () => {
    const report = listing("Python", "Python; N/A for OS/2, on/off");
    for (const junk of ["n", "a", "os", "2", "on", "off"])
      expect(report.missingKeywords).not.toContain(junk);
  });
});

describe("knockouts", () => {
  it("compares years with the work history", () => {
    expect(one("5+ years of experience")).toMatchObject({
      kind: "experience",
      status: "met",
      detail: "10 years in the work history, 5 asked",
    });
    // Years of a named field are counted in the roles that name it, not the whole history.
    expect(one("5+ years of Go experience")).toMatchObject({
      status: "met",
      detail: "7 years in roles naming go, 5 asked",
    });
    expect(one("5+ years of backend experience")).toMatchObject({
      status: "missing",
      detail: "The resume does not name backend; 5 years asked",
    });
    expect(one("12+ years of experience")).toMatchObject({
      status: "missing",
      detail: "10 years in the work history, 12 asked",
    });
  });

  it("compares a degree by level, and lets stated equivalence stand in for one", () => {
    expect(one("Bachelor's degree in Computer Science")).toMatchObject({
      kind: "education",
      status: "met",
    });
    expect(one("Master's degree required")).toMatchObject({ status: "missing" });
    expect(one("Master's degree or equivalent experience")).toMatchObject({
      status: "partial",
      detail:
        "Bachelor's or equivalent read; Master's or equivalent asked, or equivalent experience",
    });
  });

  it("finds a language the resume names", () => {
    expect(one("Fluent in Spanish")).toMatchObject({ kind: "language", status: "met" });
    expect(one("Fluent in German")).toMatchObject({ kind: "language", status: "missing" });
  });

  it("leaves the right to work and a clearance unverifiable unless the resume states them", () => {
    expect(one("Must be authorized to work in the United States")).toMatchObject({
      kind: "authorization",
      status: "unverifiable",
    });
    expect(
      one("Active security clearance", `${RESUME}\nActive TS/SCI security clearance`),
    ).toMatchObject({
      kind: "clearance",
      status: "met",
    });
  });

  it("reads a German posting with the German pack", () => {
    const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    const found = judge(
      "Ihr Profil\n- Mindestens 3 Jahre Berufserfahrung in der Backend-Entwicklung mit Go\n- Abgeschlossenes Studium der Informatik oder vergleichbare Qualifikation\n- Verhandlungssichere Englischkenntnisse\n- Gültige Arbeitserlaubnis für Deutschland",
      RESUME,
      policy,
    );
    expect(found.map((r) => [r.kind, r.status])).toEqual([
      ["experience", "met"],
      ["education", "met"],
      ["language", "met"],
      ["authorization", "unverifiable"],
    ]);
  });
});

/** The judgement of `ask` for a resume that ends with `statement`. */
const stating = (statement: string, ask: string) => one(ask, `${RESUME}\n${statement}`);

describe("the right to work, read for what the statement says", () => {
  const authorized = stating;
  const WITHOUT_SPONSORSHIP = "Must be authorized to work in the US without sponsorship";

  it("is missing where the posting rules sponsorship out and the resume needs it", () => {
    expect(authorized("Requires H-1B visa sponsorship", WITHOUT_SPONSORSHIP)).toMatchObject({
      kind: "authorization",
      status: "missing",
      evidence: ["Requires H-1B visa sponsorship"],
    });
    expect(
      authorized("Will require visa sponsorship", "This role is not eligible for work sponsorship")
        .status,
    ).toBe("missing");
  });

  it.each([
    "Not currently requiring sponsorship, but will require sponsorship in the future",
    "Doesn't require sponsorship now; will need H-1B sponsorship in 2027",
  ])("reads a need for sponsorship later in the line: %s", (statement) => {
    expect(authorized(statement, WITHOUT_SPONSORSHIP)).toMatchObject({
      status: "missing",
      evidence: [statement],
    });
  });

  it.each([
    "Cannot work in the US without visa sponsorship",
    "Can't work in the US without sponsorship",
    "Not authorized to work without sponsorship",
    "Unable to work in the US without sponsorship",
  ])("does not take a negated statement for one: %s", (statement) => {
    expect(authorized(statement, WITHOUT_SPONSORSHIP).status).not.toBe("met");
  });

  it.each([
    "Authorized to work in the US; no sponsorship required",
    "U.S. citizen, does not require visa sponsorship",
    "Authorized to work in the US without sponsorship",
    "US Citizen; not requiring sponsorship",
  ])("is met by a line that needs no sponsorship: %s", (statement) => {
    expect(authorized(statement, WITHOUT_SPONSORSHIP)).toMatchObject({
      status: "met",
      evidence: [statement],
    });
  });

  it("never meets a plain ask with a line that needs sponsorship", () => {
    expect(
      authorized(
        "Requires H-1B visa sponsorship",
        "Must be authorized to work in the United States",
      ).status,
    ).toBe("unverifiable");
    expect(
      authorized("Authorized to work in the US", "Must be authorized to work in the United States")
        .status,
    ).toBe("met");
  });

  it("meets a citizenship ask only with U.S. citizenship held", () => {
    const CITIZEN = "Must be a U.S. citizen";
    expect(authorized("Green card holder", CITIZEN)).toMatchObject({
      status: "missing",
      evidence: ["Green card holder"],
    });
    expect(authorized("Permanent resident of the US", CITIZEN).status).toBe("missing");
    expect(authorized("U.S. citizen", CITIZEN).status).toBe("met");
    // Authorized, but whether as a citizen the line does not say.
    expect(authorized("Authorized to work in the US", CITIZEN).status).toBe("unverifiable");
    for (const statement of [
      "Lawful permanent resident; U.S. citizenship pending",
      "Eligible for U.S. citizenship in 2027; green card holder",
      "Former U.S. citizen",
    ])
      expect(authorized(statement, CITIZEN).status, statement).not.toBe("met");
  });

  it("meets a citizenship-or-residence ask with either", () => {
    expect(
      authorized("Green card holder", "Must be a U.S. citizen or green card holder").status,
    ).toBe("met");
    expect(
      authorized("Permanent resident", "U.S. citizenship or permanent residency required").status,
    ).toBe("met");
  });
});

describe("a clearance, compared by its level", () => {
  const cleared = stating;

  it.each([
    [
      "Active Secret clearance",
      "Active Top Secret clearance required",
      "Secret read, Top Secret asked",
    ],
    ["Active Secret clearance", "Active TS/SCI clearance", "Secret read, TS/SCI asked"],
    ["Active Top Secret clearance", "TS/SCI clearance required", "Top Secret read, TS/SCI asked"],
    ["Confidential clearance (active)", "Secret clearance", "Confidential read, Secret asked"],
    ["Active Secret clearance", "Active TS clearance required", "Secret read, Top Secret asked"],
    ["Active security clearance", "Active Top Secret clearance", "No level read, Top Secret asked"],
  ])("is partial with a lower level: %s for %s", (statement, ask, detail) => {
    expect(cleared(statement, ask)).toMatchObject({
      kind: "clearance",
      status: "partial",
      evidence: [statement],
      detail,
    });
  });

  it.each([
    ["Active TS/SCI clearance", "Active Top Secret clearance required"],
    ["Active Top Secret/SCI clearance", "Secret clearance required"],
    ["Active TS-SCI clearance with polygraph", "Active TS/SCI clearance"],
    ["Active Top Secret clearance", "Active Top Secret clearance required"],
    ["Active TS clearance", "Top Secret clearance required"],
    ["Active Secret clearance", "Active security clearance required"],
    ["Active Secret clearance", "Secret or Top Secret clearance"],
  ])("is met by the level asked or one above: %s for %s", (statement, ask) => {
    expect(cleared(statement, ask).status).toBe("met");
  });

  it.each([
    ["TS/SCI (inactive since 2022)", "Active TS/SCI clearance"],
    ["Secret clearance, expired 2021", "Secret clearance"],
    ["Eligible for Secret clearance", "Secret clearance"],
    ["Top Secret clearance pending", "Secret clearance"],
    ["Able to obtain a security clearance", "Active security clearance required"],
  ])("takes no clearance from one not held: %s", (statement, ask) => {
    expect(cleared(statement, ask).status).toBe("unverifiable");
  });
});

describe("cost", () => {
  it("stays bounded on thousands of lines under a policy with hundreds of phrases", () => {
    const policy = {
      ...DEFAULT_POLICY,
      keywordMatch: {
        ...DEFAULT_POLICY.keywordMatch,
        phrases: Array.from({ length: 400 }, (_, i) => `made up phrase ${i}`),
      },
    };
    const resume = Array.from({ length: 6_000 }, (_, i) => `- go k8s ${i}`).join("\n");
    const job = `Requirements\n${Array.from({ length: 30 }, (_, i) => `- Go, Kubernetes and tool${i}`).join("\n")}`;
    expect(expectFast(() => judge(job, resume, policy), 2_000)).toHaveLength(25);
  });
});
