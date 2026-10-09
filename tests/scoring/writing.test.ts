import { describe, expect, it } from "vitest";

import {
  AtsScoringService,
  DEFAULT_POLICY,
  policyRubric,
  type AtsReport,
} from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import type { AtsEnginePolicy } from "../../src/policy/schema.js";
import { LOCALE_FIXTURES } from "../fixtures/locale-resumes.js";

/**
 * The writing rules: style a recruiter notices once the ATS has read the resume. Their own
 * category, so the categories that say whether a resume survives the ATS do not move; English
 * only, and dropped for a resume read in another language or with nothing to judge.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const LOCALIZED = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const check = (text: string, policy: AtsEnginePolicy = DEFAULT_POLICY, jobDescription?: string) =>
  AtsScoringService.check(text, policy, { now: NOW, jobDescription });
const rule = (report: AtsReport, id: string) =>
  report.rules.find((r) => r.id === `ats-v2.writing.${id}`);
const writingRules = (report: AtsReport) => report.rules.filter((r) => r.category === "writing");

const HEAD = "Jane Doe\njane@example.com | +1 415 555 0142\nEXPERIENCE\n";
const IDS = [
  "firstPerson",
  "passiveVoice",
  "weakOpeners",
  "tense",
  "bulletLength",
  "bulletsPerRole",
  "repeatedOpeners",
  "dateFormats",
];

/** An invented person, written the way a careful editor would leave it. */
const WELL_WRITTEN = `Priya Raman
priya.raman@example.com | +1 312 555 0199 | Chicago, IL
Summary
Platform engineer with nine years of experience building payment infrastructure.
Experience
Staff Engineer, Lakeshore Payments    Mar 2022 – Present
• Lead a team of 6 engineers building the settlement platform in Go
• Own the ledger service that settles $40M a day across 3 regions
• Design the on-call rotation, cutting pages per week from 30 to 8
Senior Engineer, Fourth Coast Logistics    Jun 2018 – Feb 2022
• Built a routing service in Go that cut delivery times by 18%
• Migrated 30 services from virtual machines to Kubernetes in 9 months
• Mentored 4 engineers through their first production launches
Software Engineer, Prairie Analytics    Jul 2015 – May 2018
• Wrote the Kafka ingestion pipeline that loads 2 billion events a month
• Reduced PostgreSQL warehouse costs by 30% by partitioning the largest tables
Education
University of Illinois, B.S. Computer Science, 2015
Skills
Go, Kafka, PostgreSQL, Kubernetes`;

describe("a well-written resume", () => {
  it("passes every writing rule, each with its evidence", () => {
    const report = check(WELL_WRITTEN);
    expect(writingRules(report).map((r) => r.id.replace("ats-v2.writing.", ""))).toEqual(IDS);
    for (const found of writingRules(report))
      expect(found, found.id).toMatchObject({ passed: true, scoreImpact: 0 });
    expect(report.categories.find((c) => c.category === "writing")).toMatchObject({
      score: 100,
      passed: IDS.length,
      total: IDS.length,
    });
  });
});

describe("first person", () => {
  it("quotes the bullets that speak as I, my, me, we or our", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• I lead the payments team of 8 engineers
• Own our billing service end to end
• Ship weekly releases with no downtime`),
      "firstPerson",
    );
    expect(found).toMatchObject({ passed: false, category: "writing", scoreImpact: 2 });
    expect(found?.evidence).toBe(
      '2 bullets speak in the first person, such as "I lead the payments team of 8 engineers".',
    );
  });

  it("does not read I/O, i.e. or a capital I in a name as a pronoun", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• Cut I/O wait on the storage tier by 40%
• Own the cache layer, i.e. the hottest path in the product
• Ship weekly releases with no downtime`),
      "firstPerson",
    );
    expect(found?.passed).toBe(true);
  });
});

describe("passive voice", () => {
  it("fails when more than a fifth of the bullets are passive, quoting one", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• Payments service was rebuilt in Go
• Releases were automated across 4 teams
• Own the checkout flow for 2 million users`),
      "passiveVoice",
    );
    expect(found).toMatchObject({ passed: false, scoreImpact: 2 });
    expect(found?.evidence).toBe(
      '67% of bullets are in the passive voice, such as "Payments service was rebuilt in Go".',
    );
  });

  it("counts an adverb between the auxiliary and the participle", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• The release train was successfully automated
• Own the checkout flow for 2 million users`),
      "passiveVoice",
    );
    expect(found?.passed).toBe(false);
  });
});

describe("weak openers", () => {
  it("quotes bullets that open with a duty rather than an action", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• Responsible for the billing service
• Worked on the checkout flow
• Own the fraud models`),
      "weakOpeners",
    );
    expect(found).toMatchObject({ passed: false, severity: "warning", scoreImpact: 2 });
    expect(found?.evidence).toBe(
      '2 bullets open with a duty rather than an action, such as "Responsible for the billing service".',
    );
  });

  it("leaves the phrase alone in the middle of a bullet", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• Own the team responsible for billing
• Lead the group that worked on checkout`),
      "weakOpeners",
    );
    expect(found?.passed).toBe(true);
  });
});

describe("tense", () => {
  it("quotes a present tense in a past role", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2022 – Present
• Lead the payments team of 8 engineers
• Built the fraud scoring service
Engineer, Globex    Jan 2018 – Dec 2021
• Manage the data warehouse for 12 teams
• Designed the event pipeline`),
      "tense",
    );
    expect(found).toMatchObject({ passed: false, scoreImpact: 2 });
    expect(found?.evidence).toBe(
      '1 bullet in a past role is in the present tense, such as "Manage the data warehouse for 12 teams".',
    );
  });

  it("accepts the current role written in the past tense, as finished work is", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2022 – Present
• Built the fraud scoring service
• Cut checkout latency 30% by caching rates
Engineer, Globex    Jan 2018 – Dec 2021
• Designed the event pipeline
• Led the migration to Kafka`),
      "tense",
    );
    expect(found).toMatchObject({ passed: true });
  });

  it("is dropped when no bullet opens with a verb it knows", () => {
    expect(
      rule(
        check(`${HEAD}Engineer, Acme Corp    Jan 2022 – Present
• Payments: 3 million transactions a day
• Fraud scoring for 12 markets`),
        "tense",
      ),
    ).toBeUndefined();
  });
});

describe("bullet length and count", () => {
  const LONG =
    "Coordinated the migration of every payment service, every reporting job and every internal tool from the old data centre to the cloud, working with finance, legal, security and support to agree a schedule that kept every customer online during the busiest quarter of the year";

  it("quotes a bullet over the word limit", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• ${LONG}
• Own the checkout flow for 2 million users`),
      "bulletLength",
    );
    expect(LONG.split(" ").length).toBeGreaterThan(40);
    expect(found).toMatchObject({ passed: false, scoreImpact: 1 });
    expect(found?.evidence).toBe(
      '1 bullet runs past two lines, such as "Coordinated the migration of every payment service, every reporting job and…".',
    );
  });

  it("flags a role with one bullet and a role with nine", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `• Shipped feature ${i + 1} to 2 markets`);
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2022 – Present
• Own the checkout flow for 2 million users
Engineer, Globex    Jan 2018 – Dec 2021
${nine.join("\n")}`),
      "bulletsPerRole",
    );
    expect(found).toMatchObject({ passed: false, scoreImpact: 1 });
    expect(found?.evidence).toBe(
      '2 roles have too few or too many bullets, such as "Engineer, Acme Corp Jan 2022 – Present".',
    );
  });

  it("is dropped when no role has bullets to count", () => {
    const report = check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present\nSKILLS\nGo, Rust`);
    expect(rule(report, "bulletsPerRole")).toBeUndefined();
    expect(rule(report, "bulletLength")).toBeUndefined();
  });
});

describe("repeated openers", () => {
  it("names the word three bullets in a row open with", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Dec 2023
• Managed the payments team of 8 engineers
• Managed the vendor budget of $2M
• Managed on-call for 3 services
• Built the fraud scoring service`),
      "repeatedOpeners",
    );
    expect(found).toMatchObject({ passed: false, scoreImpact: 1 });
    expect(found?.evidence).toBe(
      '1 run of three or more bullets in a row opens with the same word, such as "Managed".',
    );
  });

  it("does not count a run that crosses into the next role", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2022 – Dec 2023
• Managed the payments team of 8 engineers
• Built the fraud scoring service
• Managed the vendor budget of $2M
Engineer, Globex    Jan 2018 – Dec 2021
• Managed on-call for 3 services
• Designed the event pipeline`),
      "repeatedOpeners",
    );
    expect(found?.passed).toBe(true);
  });
});

describe("date formats", () => {
  it("quotes dates written in two formats", () => {
    const found = rule(
      check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present
• Own the checkout flow for 2 million users
• Lead the payments team of 8 engineers
Engineer, Globex    03/2017 – 12/2019
• Built the fraud scoring service
• Designed the event pipeline`),
      "dateFormats",
    );
    expect(found).toMatchObject({ passed: false, scoreImpact: 1 });
    expect(found?.evidence).toBe(
      'Role dates are written 2 different ways, such as "Jan 2020 – Present", "03/2017 – 12/2019".',
    );
  });

  it("is dropped with a single dated role", () => {
    expect(
      rule(
        check(`${HEAD}Engineer, Acme Corp    Jan 2020 – Present\n• Own the checkout flow`),
        "dateFormats",
      ),
    ).toBeUndefined();
  });
});

describe("when the writing rules stand down", () => {
  it.each([...LOCALE_FIXTURES.de, ...LOCALE_FIXTURES.hi].map((f) => [f.id, f.text]))(
    "drops every writing rule for %s, read in its own language",
    (_, text) => {
      const report = check(text, LOCALIZED);
      expect(report.locale.languages.length).toBeGreaterThan(0);
      expect(writingRules(report)).toEqual([]);
      expect(report.categories.find((c) => c.category === "writing")).toBeUndefined();
    },
  );

  it("still judges an English resume sent to a German posting", () => {
    const posting =
      "Wir suchen eine erfahrene Entwicklerin für unser Team in Berlin. Sie arbeiten mit Go und Kubernetes und sind für die Plattform verantwortlich, die wir seit Jahren betreiben.";
    const report = check(WELL_WRITTEN, LOCALIZED, posting);
    expect(report.locale.languages).toContain("de");
    expect(writingRules(report)).toHaveLength(IDS.length);
  });

  it("drops every writing rule when there is nothing to judge", () => {
    expect(writingRules(check("Jane Doe\njane@example.com\n+1 415 555 0142"))).toEqual([]);
  });

  it("drops a rule whose languages leave out the language the base policy is read in", () => {
    const policy: AtsEnginePolicy = {
      ...DEFAULT_POLICY,
      text: { ...DEFAULT_POLICY.text, language: "fr" },
    };
    expect(writingRules(check(WELL_WRITTEN, policy))).toEqual([]);
  });
});

/**
 * Every category but `writing`, as the engine scored these fixtures before the writing rules
 * existed (score/lost/possible/passed/total). The writing rules sit in their own category so
 * that none of these moves; only the readiness total, which now weighs `writing` too, may.
 */
const BEFORE_WRITING: Record<string, string> = {
  "en-us-classic":
    "parse:100/0/53/4/4 contact:100/0/24/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "en-us-stacked":
    "parse:100/0/53/4/4 contact:100/0/20/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:100/0/29/5/5 integrity:100/0/60/4/4",
  "en-uk-pipes":
    "parse:100/0/53/4/4 contact:100/0/20/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "en-us-at-and-since":
    "parse:100/0/53/4/4 contact:100/0/24/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "en-us-employer-first":
    "parse:62/20/53/3/4 contact:100/0/20/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "de-backend":
    "parse:100/0/53/4/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:44/10/18/1/2 content:100/0/29/5/5 integrity:100/0/60/4/4",
  "de-consultant":
    "parse:100/0/53/4/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "de-letterspaced":
    "parse:62/20/53/3/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:0/18/18/0/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "hi-engineer":
    "parse:100/0/53/4/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "hi-analyst":
    "parse:62/20/53/3/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "en-in-engineer":
    "parse:62/20/53/3/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "en-in-national-phone":
    "parse:100/0/53/4/4 contact:100/0/20/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "en-us-certified-cloud":
    "parse:100/0/53/4/4 contact:100/0/24/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:100/0/29/5/5 integrity:100/0/60/4/4",
  "en-uk-languages-in-skills":
    "parse:100/0/53/4/4 contact:100/0/20/3/3 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
  "de-zertifikate":
    "parse:100/0/53/4/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:44/10/18/1/2 content:100/0/29/5/5 integrity:100/0/60/4/4",
  "hi-certified":
    "parse:100/0/53/4/4 contact:100/0/18/2/2 structure:100/0/28/3/3 format:44/10/18/1/2 content:90/3/29/4/5 integrity:100/0/60/4/4",
};

describe("the categories that say whether a resume survives the ATS", () => {
  const fixtures = Object.values(LOCALE_FIXTURES).flat();

  it("cover every fixture", () => {
    expect(fixtures.map((f) => f.id).sort()).toEqual(Object.keys(BEFORE_WRITING).sort());
  });

  it.each(fixtures.map((f) => [f.id, f.text]))("score %s exactly as before", (id, text) => {
    const report = check(text, LOCALIZED);
    const others = report.categories
      .filter((c) => c.category !== "writing")
      .map((c) => `${c.category}:${c.score}/${c.lost}/${c.possible}/${c.passed}/${c.total}`)
      .join(" ");
    expect(others).toBe(BEFORE_WRITING[id]);
  });

  it.each(fixtures.map((f) => [f.id, f.text]))(
    "score %s as if the writing rules did not exist",
    (_, text) => {
      const without = {
        ...LOCALIZED,
        rules: LOCALIZED.rules.filter((r) => r.category !== "writing"),
      };
      const others = (report: AtsReport) =>
        report.categories.filter((c) => c.category !== "writing");
      expect(others(check(text, LOCALIZED))).toEqual(others(check(text, without)));
    },
  );
});

describe("the writing category", () => {
  it("weighs little next to what decides whether the ATS reads the resume", () => {
    const rubric = policyRubric(DEFAULT_POLICY);
    const weight = (pick: (category: string) => boolean) =>
      rubric.filter((e) => !e.deduction && pick(e.category)).reduce((sum, e) => sum + e.points, 0);
    const writing = weight((c) => c === "writing");
    expect(writing).toBe(12);
    expect(writing / weight(() => true)).toBeLessThan(0.08);
    for (const entry of rubric.filter((e) => e.category === "writing")) {
      expect(["info", "warning"]).toContain(entry.severity);
      expect(entry.points).toBeLessThanOrEqual(3);
      expect(entry.measures).toContain("(en only)");
    }
  });
});
