import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY, type AtsRequirement, check } from "../../src/index.js";
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
  check(resume, policy, { jobDescription: job, now: NOW }).requirements;
const one = (line: string, resume?: string) =>
  judge(`Requirements\n- ${line}`, resume)[0] as AtsRequirement;

describe("requirements", () => {
  it("reads each line under the posting's headings, with its importance", () => {
    const found = judge(
      "Senior Engineer\nRequirements\n- Go\n- Kubernetes\nNice to have\n- Terraform",
    );
    expect(found.map((r) => [r.text, r.importance])).toEqual([
      // The level its title names comes first.
      ["Senior Engineer", "required"],
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
    expect(check(RESUME, DEFAULT_POLICY, { now: NOW }).requirements).toEqual([]);
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
    check(RESUME.replace("Go, Python, Kubernetes, Terraform, PostgreSQL", skills), DEFAULT_POLICY, {
      jobDescription: `Requirements\n- ${ask}`,
      now: NOW,
    });

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

  it("reads no skill inside a web address written without its scheme", () => {
    for (const address of ["www.example.com/careers/rust/kafka", "jobs.example.com/rust/kafka"]) {
      const report = listing("Python", `Python\n- Apply at ${address}`);
      for (const junk of ["www.example.com", "jobs.example.com", "careers", "rust", "kafka"])
        expect(report.missingKeywords, address).not.toContain(junk);
    }
    // A skill written with a dot and a slash is still a skill.
    expect(listing("Python", "Python, Node.js/React").missingKeywords).toEqual(
      expect.arrayContaining(["node.js", "react"]),
    );
  });

  it.each([
    ["System.Text.Json", "system.text.json"],
    ["Microsoft.Extensions.DependencyInjection", "microsoft.extensions.dependencyinjection"],
    ["org.springframework.boot", "org.springframework.boot"],
    ["java.util.concurrent", "java.util.concurrent"],
    ["Microsoft.Extensions.Logging/Serilog", "serilog"],
    ["Microsoft.Graph.Net", "microsoft.graph.net"],
    ["Microsoft.Bot.Builder.AI", "microsoft.bot.builder.ai"],
    ["akka.stream.io", "akka.stream.io"],
    ["com.example.app", "com.example.app"],
    ["Microsoft.Extensions.AI/Ollama", "ollama"],
    ["akka.stream.io/Pekko", "pekko"],
    ["com.example.app/Kotlin", "kotlin"],
    ["Microsoft.Graph.Net/Azure", "azure"],
  ])("reads a dotted name, %s, as a keyword, not a web address", (ask, term) => {
    expect(listing("Python", `Python, ${ask}`).missingKeywords).toContain(term);
  });

  it("reads no keyword inside a host whose last label is a country's", () => {
    const report = listing("Python", "Python\n- Apply at careers.acme.co.uk");
    expect(report.missingKeywords).not.toContain("careers.acme.co.uk");
    const io = listing("Python", "Python\n- Apply at boards.greenhouse.io/acme/jobs/123");
    expect(io.missingKeywords.join(" ")).not.toMatch(/greenhouse|acme|jobs/);
    const careers = listing("Python", "Python\n- Apply at boards.greenhouse.io/careers/rust");
    expect(careers.missingKeywords.join(" ")).not.toMatch(/greenhouse|careers|rust/);
  });

  it.each([
    ["SAP S/4HANA", ["s", "4hana"]],
    ["z/OS mainframes", ["z", "os"]],
    ["Pub/Sub messaging", ["pub", "sub"]],
  ])("keeps a name written with a slash whole: %s", (ask, junk) => {
    const report = listing("Python", `Python, ${ask}`);
    for (const part of junk) expect(report.missingKeywords).not.toContain(part);
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

  // "Or a related field" widens the field of study; it lets no experience stand in for the degree.
  it("reads 'or related field' as about the field, not as equivalent experience", () => {
    for (const ask of [
      "Master's degree in Computer Science or related field",
      "Master's degree in Computer Science or a related field",
      "PhD in Physics or related field",
    ])
      expect(one(ask), ask).toMatchObject({
        kind: "education",
        status: "missing",
        detail: expect.not.stringMatching(/equivalent experience/),
      });
    // The field named meets it; another may be related, which the resume cannot show.
    const ask = "Bachelor's degree in Computer Science or related field";
    expect(one(ask)).toMatchObject({ kind: "education", status: "met" });
    const physics = RESUME.replace("B.S. Computer Science", "B.S. Physics");
    expect(one(ask, physics)).toMatchObject({ kind: "education", status: "partial" });
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
    expect(
      authorized(
        "Will require H-1B visa sponsorship",
        "Candidates requiring sponsorship will not be considered",
      ).status,
    ).toBe("missing");
  });

  it.each([
    "Candidates requiring sponsorship are ineligible",
    "Applicants who require sponsorship will be disqualified",
    "Candidates needing sponsorship are excluded",
    "Applications requiring sponsorship will be rejected",
    // An offer word elsewhere in the line is about something else.
    "Candidates requiring sponsorship cannot be offered a position",
    "Applicants requiring sponsorship will not be offered employment",
    "Candidates requiring sponsorship are ineligible for offer",
    "Candidates requiring sponsorship are ineligible; benefits available",
    "Candidates requiring sponsorship are not eligible; relocation offered",
    "Applicants requiring sponsorship need not apply; remote work available",
    "Candidates requiring sponsorship are ineligible. Competitive salary offered",
    "Candidates requiring sponsorship are not eligible (no exceptions available)",
    "Candidates requiring sponsorship: we will not provide it",
  ])("is missing where the posting turns away who needs sponsorship: %s", (ask) => {
    expect(authorized("Will require H-1B visa sponsorship", ask).status).toBe("missing");
  });

  it.each([
    "Visa sponsorship is available for candidates who need sponsorship",
    "We welcome applicants who require sponsorship",
    "We will sponsor candidates who need sponsorship",
    "Sponsorship provided for those who need sponsorship",
  ])("is not missing where the posting offers sponsorship: %s", (ask) => {
    expect(authorized("Will require H-1B visa sponsorship", ask)).toMatchObject({
      kind: "authorization",
      status: "unverifiable",
    });
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
    // A clause of its own saying where not.
    "Authorized to work in Canada, not in the US",
    "Authorized to work in the EU, not in the US",
    "Authorized to work in the UK (not the US)",
  ])("does not take a negated statement for one: %s", (statement) => {
    expect(authorized(statement, WITHOUT_SPONSORSHIP).status).not.toBe("met");
  });

  it.each([
    "Authorized to work in the US; no sponsorship required",
    "U.S. citizen, does not require visa sponsorship",
    "Authorized to work in the US without sponsorship",
    "US Citizen; not requiring sponsorship",
    // A negation about something else, in a clause of its own.
    "Authorized to work in the US (no visa needed)",
    "Authorized to work in the US, not open to relocation",
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

  // US authorisation met a UK ask, and "British citizen" was read as a skill.
  it.each([
    ["Authorized to work in the US", "Must have the right to work in the UK"],
    ["Authorized to work in the United Kingdom", "Must be authorized to work in the US"],
    ["Green card holder", "Must have the right to work in the UK"],
    ["EU citizen", "Must be authorized to work in the United States"],
    ["U.S. citizen", "Must be a British citizen"],
    // "us" the pronoun is no country.
    [
      "Authorized to work in the US",
      "Must have the right to work in the UK. Tell us if you need sponsorship.",
    ],
    // A heading naming the subject is no statement of it.
    ["Work Authorization\nAuthorized to work in the US", "Must have the right to work in the UK"],
    // Only a list of places carries on past a comma; a bracket's place adds none.
    ["Authorized to work in the US, based in London, UK", "Must have the right to work in the UK"],
    ["Authorized to work in the US, relocating to the UK", "Must have the right to work in the UK"],
    ["US citizen, UK", "Must have the right to work in the UK"],
    ["Authorized to work in the US (Texas)", "Must have the right to work in the UK"],
    ["Right to work in Germany and France", "Must be authorized to work in the United States"],
    // A place one moves to is not one worked in, and the US is not every country.
    [
      "Authorized to work in Canada; open to relocating to the US",
      "Must be authorized to work in the United States",
    ],
    ["Authorized to work in the US", "Must have the right to work in Germany"],
    ["Authorized to work in the US", "Must have the right to work in Ireland"],
  ])("does not take a statement about another country as evidence: %s for %s", (statement, ask) => {
    expect(authorized(statement, ask)).toMatchObject({
      kind: "authorization",
      status: "unverifiable",
    });
  });

  it.each([
    ["Right to work in the UK", "Must have the right to work in the United Kingdom"],
    ["British citizen", "Must be a British citizen"],
    ["Authorized to work in the U.S.A.", "Must be authorized to work in the US"],
    ["EU citizen; right to work in the European Union", "Must be authorized to work in the EU"],
    // A statement naming no country is read as before.
    ["Full right to work, no sponsorship needed", "Must have the right to work in the UK"],
    // An Irish citizen may work in the EU and the UK.
    ["Work authorization: Irish citizen", "Must have the right to work in the EU"],
    ["US citizen", "Must be authorized to work in the United States"],
  ])("meets an ask about the country the statement names: %s", (statement, ask) => {
    expect(authorized(statement, ask)).toMatchObject({ kind: "authorization", status: "met" });
  });

  // Every country after the first comma or bracket was dropped, and a place the countries did not
  // name made the line about other countries.
  it.each([
    ["Authorized to work in the US, Canada and the UK", "Must have the right to work in the UK"],
    ["Authorized to work in the US, UK and EU", "Must have the right to work in the EU"],
    ["Authorized to work in Canada, the US and Mexico", "Must be authorized to work in the US"],
    ["Authorized to work in Canada, US", "Must be authorized to work in the US"],
    ["Work authorization: Canada, USA", "Must be authorized to work in the United States"],
    ["Right to work: UK, Ireland", "Must have the right to work in Ireland"],
    [
      "Authorized to work in Canada (PR) and the U.S. (TN visa)",
      "Must be authorized to work in the US",
    ],
    [
      "Work authorization: EU (Spain), UK (pre-settled status)",
      "Must have the right to work in the UK",
    ],
    ["Authorized to work in America and Canada", "Must be authorized to work in the United States"],
    ["Authorized to work in the States and the UK", "Must be authorized to work in the US"],
    ["Right to work in Germany and the UK", "Must have the right to work in the EU"],
    ["Authorized to work in Ontario and the US", "Must be authorized to work in Canada"],
  ])("reads every country of a list: %s for %s", (statement, ask) => {
    expect(authorized(statement, ask)).toMatchObject({ kind: "authorization", status: "met" });
  });

  // A nationality was no citizenship but the US's.
  it.each([
    ["Citizenship: Indian", "Must be an Indian citizen"],
    ["Indian national", "Must be an Indian citizen"],
    ["EU passport", "Must be an EU citizen"],
    ["Citizen of an EU member state", "Must be an EU citizen"],
    ["British passport holder", "Must be a British citizen"],
    ["British national", "Must be a British citizen"],
    ["Nationality: American", "Must be a U.S. citizen"],
    ["Citizenship: U.S.", "Must be a U.S. citizen"],
    ["Citizen of USA", "Must be a U.S. citizen"],
    ["Dual US-UK citizen", "Must be a U.S. citizen"],
    ["Dual US-UK citizen", "Must be a British citizen"],
  ])("reads a nationality as that citizenship: %s for %s", (statement, ask) => {
    expect(authorized(statement, ask)).toMatchObject({ kind: "authorization", status: "met" });
  });

  it.each([
    ["Latin American national", "Must be a U.S. citizen"],
    ["Indian national", "Must be a U.S. citizen"],
    ["British passport holder", "Must be a U.S. citizen"],
    ["Played for the Indian national team", "Must be an Indian citizen"],
  ])("reads no other citizenship from a nationality: %s for %s", (statement, ask) => {
    expect(authorized(statement, ask)).toMatchObject({
      kind: "authorization",
      status: "unverifiable",
    });
  });

  // "Irish citizen" and "Latin American citizen" met a U.S. citizenship ask, and the country was
  // read per line, not per clause.
  it.each([
    ["Irish citizen", "Must be a U.S. citizen"],
    ["Irish citizen", "Must be a British citizen"],
    ["Irish citizen", "Must be authorized to work in the United States"],
    ["Citizen of Ireland", "US citizenship required"],
    ["Latin American citizen", "Must be a U.S. citizen"],
    ["Indian citizen; authorized to work in the US", "Must be a U.S. citizen"],
    ["British citizen, previously worked in the US", "US citizenship required"],
    ["Canadian citizen living in the US", "Must be a U.S. citizen"],
    ["Irish citizen", "US citizen or green card holder"],
    ["Latin American citizen", "Must be authorized to work in the United States"],
    ["Indian citizen; open to relocating to the US", "Must be a U.S. citizen"],
    [
      "British citizen, previously worked in the US",
      "Must be authorized to work in the United States",
    ],
  ])(
    "meets a citizenship ask only with that country's citizenship: %s for %s",
    (statement, ask) => {
      expect(authorized(statement, ask)).toMatchObject({
        kind: "authorization",
        status: "unverifiable",
      });
    },
  );

  it.each([
    // An Irish citizen may work in the UK and the EU, and a British or EU citizen in Ireland.
    ["Irish citizen", "Must have the right to work in the UK"],
    ["Irish citizen", "Must be authorized to work in the EU"],
    ["British citizen", "Must have the right to work in Ireland"],
    ["EU citizen", "Must have the right to work in Ireland"],
    ["Dual US/Canadian citizen", "Must be a U.S. citizen"],
    ["Indian citizen; authorized to work in the US", "Must be authorized to work in the US"],
  ])("meets an ask with a clause about its country: %s for %s", (statement, ask) => {
    expect(authorized(statement, ask)).toMatchObject({ kind: "authorization", status: "met" });
  });

  // A bare "US" beside another country was not read as the US.
  it.each([
    "Authorized to work in Canada and US",
    "Authorized to work in Canada/US",
    "Authorized to work in US & Canada",
    "US Permanent Resident (Canadian citizen)",
    "US work authorization; Canadian citizen",
  ])("reads a bare US beside another country or a right to work: %s", (statement) => {
    expect(authorized(statement, "Must be authorized to work in the United States")).toMatchObject({
      status: "met",
      evidence: [statement],
    });
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
    // A level named well past the clearance is not its level.
    [
      "Active Secret clearance",
      "Active Top Secret clearance required to handle confidential information",
      "Secret read, Top Secret asked",
    ],
    [
      "Active Confidential clearance",
      "Security clearance (Secret or above)",
      "Confidential read, Secret asked",
    ],
    // Named further from the clearance than three words, and no level beside it.
    [
      "Active Secret clearance",
      "Must hold an active security clearance at the Top Secret level",
      "Secret read, Top Secret asked",
    ],
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
    // A negation or a level not held yet that is about something else.
    ["Active Secret clearance; no incidents", "Active Secret clearance required"],
    ["Top Secret clearance (TS/SCI eligible)", "Active Top Secret clearance required"],
    ["Inactive Confidential clearance, active Secret clearance", "Secret clearance required"],
  ])("is met by the level asked or one above: %s for %s", (statement, ask) => {
    expect(cleared(statement, ask).status).toBe("met");
  });

  it("does not read a level only eligible for as held", () => {
    expect(
      cleared("Top Secret clearance (TS/SCI eligible)", "TS/SCI clearance required"),
    ).toMatchObject({ status: "partial", detail: "Top Secret read, TS/SCI asked" });
  });

  it("compares the UK's levels", () => {
    expect(cleared("Active SC clearance", "Active DV clearance required")).toMatchObject({
      status: "partial",
      detail: "SC read, DV asked",
    });
    expect(cleared("Active CTC clearance", "SC clearance required").status).toBe("partial");
    expect(cleared("Active DV clearance", "SC clearance required").status).toBe("met");
    // Across the two, no worse than when the UK's were not known.
    expect(cleared("Active SC clearance", "Secret clearance required").status).toBe("partial");
    expect(cleared("Active Secret clearance", "SC clearance required").status).toBe("met");
    // A degree's "Sc" is not SC.
    expect(
      cleared("Active Confidential clearance", "Secret clearance, M.Sc preferred").status,
    ).toBe("partial");
  });

  it.each([
    "Charleston, SC: Active Secret clearance required",
    "Diversity Visa (DV) holders welcome; Secret clearance required",
    "Secret clearance required, CTC up to 30 LPA",
    "Secret clearance required; Sc.D. preferred",
  ])("reads a UK level only beside a clearance or vetting: %s", (ask) => {
    expect(cleared("Active Confidential clearance", ask)).toMatchObject({
      status: "partial",
      detail: "Confidential read, Secret asked",
    });
  });

  it.each([
    "Must hold SC or DV clearance",
    "SC/DV clearance required",
    "SC / DV clearance required",
    "SC, DV clearance required",
  ])("reads each of a list of UK levels before the clearance: %s", (ask) => {
    expect(cleared("Active SC clearance", ask).status).toBe("met");
    expect(cleared("Active BPSS clearance", ask)).toMatchObject({
      status: "partial",
      detail: "BPSS read, SC asked",
    });
  });

  it("reads every level of a longer list before the clearance", () => {
    expect(cleared("Active BPSS clearance", "Must hold BPSS, CTC, SC or DV clearance").status).toBe(
      "met",
    );
  });

  it("reads a UK level in brackets after the clearance", () => {
    expect(
      cleared("Active BPSS clearance", "Must hold active UK security clearance (SC)"),
    ).toMatchObject({ status: "partial", detail: "BPSS read, SC asked" });
  });

  it.each([
    ["TS/SCI (inactive since 2022)", "Active TS/SCI clearance"],
    ["Secret clearance, expired 2021", "Secret clearance"],
    ["Eligible for Secret clearance", "Secret clearance"],
    ["Top Secret clearance pending", "Secret clearance"],
    ["Able to obtain a security clearance", "Active security clearance required"],
    // Past a semicolon, a word saying it is not held any more still is about it.
    ["Secret clearance; expired 2021", "Active Secret clearance required"],
    ["Secret clearance; inactive since 2020", "Active Secret clearance required"],
    ["Secret clearance; currently inactive", "Active Secret clearance required"],
    ["Secret clearance; eligible for reinstatement", "Active Secret clearance required"],
    // A negation in the clearance's own clause, or a bracket saying it is not held.
    ["No active Secret clearance", "Secret clearance required"],
    ["TS/SCI clearance not active", "TS/SCI clearance required"],
    ["Secret clearance (not active)", "Secret clearance required"],
    ["Secret clearance, no longer held", "Secret clearance required"],
    // A clause of its own that says so, in any order.
    ["TS/SCI clearance (not obtained)", "TS/SCI clearance required"],
    ["Not currently cleared, TS/SCI previously", "TS/SCI clearance required"],
    ["Held TS/SCI clearance, not renewed", "TS/SCI clearance required"],
    // A bracket or comma saying it is not held, or a negation alone, still is about it.
    ["TS/SCI clearance (not granted)", "Active TS/SCI clearance required"],
    ["Applied for TS/SCI clearance, not yet granted", "Active TS/SCI clearance required"],
    ["TS/SCI clearance, not in use since 2018", "Active TS/SCI clearance required"],
    ["TS/SCI clearance (no)", "Active TS/SCI clearance required"],
    ["Secret clearance: No", "Secret clearance required"],
    ["Active Secret clearance, no", "Secret clearance required"],
    ["Held TS/SCI clearance, no longer active", "TS/SCI clearance required"],
  ])("takes no clearance from one not held: %s", (statement, ask) => {
    expect(cleared(statement, ask).status).toBe("unverifiable");
  });

  // Any "no" near the clearance cancelled it.
  it.each([
    ["Active TS/SCI clearance, no lapses since 2015", "TS/SCI clearance required"],
    ["Active Secret clearance (no incidents)", "Secret clearance required"],
    ["Secret clearance, held without interruption since 2018", "Secret clearance required"],
    ["Active TS/SCI clearance; promotion to lead in progress", "TS/SCI clearance required"],
    ["TS/SCI clearance (active), polygraph in progress", "TS/SCI clearance required"],
    // A "no" answering another label, or a "not" past a semicolon, is about something else.
    ["U.S. Citizen; Active Secret clearance; Visa sponsorship: No", "Secret clearance required"],
    ["Active Secret clearance; Relocation: No", "Secret clearance required"],
    ["Top Secret clearance, active; polygraph: no", "Top Secret clearance required"],
    ["Active TS/SCI clearance; no longer with Lockheed Martin", "TS/SCI clearance required"],
    ["Active Top Secret clearance; not active duty military", "Top Secret clearance required"],
    ["Active Secret clearance; sponsorship needed: no", "Active Secret clearance required"],
    ["Active TS/SCI clearance; no longer requires sponsorship", "TS/SCI clearance required"],
    ["Active Secret clearance; not in use since 2024 but valid", "Secret clearance required"],
  ])("keeps a clearance beside a negation about something else: %s", (statement, ask) => {
    expect(cleared(statement, ask).status).toBe("met");
  });
});

describe("seniority, from the posting's title", () => {
  const level = (job: string, resume?: string, policy?: typeof DEFAULT_POLICY) =>
    judge(`${job}\nRequirements\n- Go`, resume, policy).find((r) => r.kind === "seniority");
  const career = (...roles: string[]) =>
    `Jane Doe\njane@example.com\nExperience\n${roles.join("\n- Built services in Go\n")}\n- Built services in Go\nEducation\nB.S. Computer Science, State University 2010`;

  it("is met by a latest title at the level asked", () => {
    expect(level("Senior Backend Engineer")).toEqual({
      text: "Senior Backend Engineer",
      importance: "required",
      kind: "seniority",
      status: "met",
      terms: [],
      evidence: ["Senior Engineer, Acme Corp Jan 2019 - Present"],
      detail: "Latest title senior, 10 years in the work history; senior asked (5+ years)",
    });
  });

  it("is partial with a lower title and the years the level takes", () => {
    expect(level("Staff Software Engineer")).toMatchObject({
      status: "partial",
      detail: "Latest title senior, 10 years in the work history; staff asked (8+ years)",
    });
  });

  it("reads the years when the latest title names no level", () => {
    const three = career("Engineer, Acme Jan 2023 - Present");
    expect(level("Senior Engineer", three)).toMatchObject({
      status: "missing",
      detail: "No level in the latest title, 3 years in the work history; senior asked (5+ years)",
    });
    const seven = career("Engineer, Acme Jan 2019 - Present");
    expect(level("Senior Engineer", seven)?.status).toBe("met");
  });

  it("judges the latest role, not the highest one", () => {
    const stepped = career(
      "Junior Developer, Globex Jan 2024 - Present",
      "Senior Engineer, Acme Jan 2012 - Dec 2023",
    );
    expect(level("Senior Engineer", stepped)).toMatchObject({
      status: "partial",
      evidence: ["Junior Developer, Globex Jan 2024 - Present"],
    });
    expect(
      level("Senior Engineer", career("Junior Developer, Globex Jan 2025 - Present")),
    ).toMatchObject({ status: "missing" });
  });

  it("is met at or above an entry level", () => {
    expect(level("Junior Developer")).toMatchObject({
      status: "met",
      detail: expect.stringMatching(/junior asked$/),
    });
  });

  it.each([
    ["a title without a level", "Backend Engineer"],
    ["a sentence", "We are hiring a senior engineer."],
    // "Lead" is a title word too, but here names neither the job nor a level of it.
    ["an employer named for a level", "Lead Bank"],
    [
      "a long line",
      "Senior Engineer to build payments with our platform team in Berlin and Lisbon",
    ],
    ["a sales title", "Lead Generation Specialist"],
    // A JSON-LD posting without a title starts with its employer.
    ["a company's name", "Principal Health Partners"],
    ["a staff title outside engineering", "Staff Accountant"],
    ["a title naming no job", "Staff Nurse"],
    ["a care home's title", "Senior Living Community Coordinator"],
    ["an inspector's title", "Lead Paint Inspector"],
  ])("is not judged from %s", (_, job) => {
    expect(level(job)).toBeUndefined();
  });

  it.each([
    ["We are hiring a senior engineer", "senior"],
    ["Team Lead, Customer Support", "lead"],
    ["Tech Lead", "lead"],
    ["Data Science Intern", "intern"],
  ])("reads the level in %s", (job, word) => {
    expect(level(job)?.detail).toMatch(new RegExp(`; ${word} asked`));
  });

  it("reads a French title, its level after the noun", () => {
    const localized = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    const read = (job: string) =>
      check(RESUME, localized, {
        jobDescription: `${job}\nExigences\n- Go`,
        now: NOW,
        languages: ["fr"],
      }).requirements.find((r) => r.kind === "seniority");
    expect(read("Chargé de clientèle junior")?.detail).toMatch(/; junior asked$/);
    expect(read("Ingénieur logiciel expérimenté en CDI")?.detail).toMatch(
      /; expérimenté asked \(5\+ years\)$/,
    );
  });

  it("reads staff as a level only in engineering and science titles", () => {
    const accountant = career("Staff Accountant, Acme Jan 2024 - Present");
    expect(level("Senior Accountant", accountant)).toMatchObject({
      status: "missing",
      detail: "No level in the latest title, 2 years in the work history; senior asked (5+ years)",
    });
    expect(level("Staff Data Scientist")?.detail).toMatch(/staff asked \(8\+ years\)$/);
  });

  it("is partial for a title at the level with under half its years", () => {
    expect(
      level("Senior Engineer", career("Senior Engineer, Acme Jan 2025 - Present")),
    ).toMatchObject({ status: "partial", detail: expect.stringContaining(", 1 year in the work") });
  });

  it("is met at an entry level without dated roles", () => {
    const graduate =
      "Jane Doe\njane@example.com\nEducation\nB.S. Computer Science, State University 2026\nSkills\nGo";
    expect(level("Junior Developer", graduate)).toMatchObject({
      status: "met",
      detail: "No level in the latest title, no dated roles; junior asked",
    });
  });

  it("quotes the role's line, not a summary naming the title", () => {
    const resume = career("Analyst, Globex Jan 2016 - Present").replace(
      "Experience\n",
      "Summary\nAnalyst with a decade in retail.\nExperience\n",
    );
    expect(level("Senior Analyst", resume)?.evidence).toEqual([
      "Analyst, Globex Jan 2016 - Present",
    ]);
  });

  it("judges the highest of several current roles", () => {
    const both = career(
      "Junior Web Developer, Self Jan 2024 - Present",
      "Senior Analyst, Acme Jan 2015 - Present",
    );
    expect(level("Senior Analyst", both)).toMatchObject({
      status: "met",
      evidence: ["Senior Analyst, Acme Jan 2015 - Present"],
    });
  });

  it("is not judged from a requirement naming a level", () => {
    const found = judge("Requirements\n- Work with senior stakeholders\n- Go");
    expect(found.some((r) => r.kind === "seniority")).toBe(false);
  });

  it("reads the words a language pack adds", () => {
    const localized = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    const read = (job: string, languages: string[]) =>
      check(RESUME, localized, {
        jobDescription: `${job}\nRequirements\n- Go`,
        now: NOW,
        languages,
      }).requirements.find((r) => r.kind === "seniority");
    expect(read("Werkstudent Softwareentwicklung (m/w/d)", ["de"])).toMatchObject({
      status: "met",
      detail: expect.stringMatching(/werkstudent asked$/),
    });
    expect(read("Développeur confirmé", ["fr"])).toMatchObject({
      status: "met",
      detail: expect.stringMatching(/confirmé asked \(5\+ years\)$/),
    });
    // Without the pack, its words name no level.
    expect(level("Werkstudent Softwareentwicklung (m/w/d)")).toBeUndefined();
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

  it("reads countries in time on a long run of joiners and spaces", () => {
    for (const run of ["and / & ".repeat(6_000), `in${" \t".repeat(25_000)}`]) {
      const statement = `Authorized to work in Canada ${run}us; US citizen ${run}`;
      expectFast(() => stating(statement, "Must be a U.S. citizen"), 1_000, run.slice(0, 8));
    }
  });

  it("reads a long list of countries and brackets in time", () => {
    for (const run of [", Canada and".repeat(4_000), " (PR), the US".repeat(4_000)]) {
      const statement = `Authorized to work in the UK${run}; Right to work: EU${run}`;
      expectFast(
        () => stating(statement, "Must be authorized to work in the United States"),
        1_000,
        run.slice(0, 8),
      );
    }
  });
});
