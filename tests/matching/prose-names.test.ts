import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/main.js";
import { AtsScoringService, DEFAULT_POLICY, parseAtsPolicy } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";

/**
 * `missingKeywords` named the employer and the places a posting mentions in passing ("At
 * Freightways, we ship…" → "freightways"), and ranked them beside the skills, because a capital
 * mid-sentence read as a proper noun and a proper noun as a skill. Every posting here is
 * invented; each test says what must disappear and which real skills must stay.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const missing = (
  resume: string,
  jobDescription: string,
  options: { jobCompany?: string; policy?: typeof POLICY } = {},
) =>
  AtsScoringService.check(resume, options.policy ?? POLICY, {
    jobDescription,
    jobCompany: options.jobCompany,
    now: NOW,
  }).missingKeywords;

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com",
  "Experience",
  "Analyst, Example Corp 2019 - Present",
  "- Wrote reports in Python and SQL",
].join("\n");

const SOFTWARE = `Senior Platform Engineer

At Freightways, we ship two million parcels a week from our Harbor Point depot. The platform team keeps routing services healthy on Kubernetes and streams scan events through Kafka into Snowflake.

What you'll do
- Run and scale our Kubernetes clusters
- Build event pipelines with Kafka
- Model shipment data in Snowflake

Requirements
- 5+ years writing Go in production
- Kubernetes, Kafka and Snowflake experience
- Incident response and on-call`;

const NURSING = `Registered Nurse - Medical-Surgical

Cedar Valley Health is hiring nurses for the 32-bed unit at our Desert Ridge campus. You will chart in Epic and report to the Cedar Valley nurse manager.

Responsibilities
- Assess, plan and document care for five patients per shift
- Administer medications and IV therapy
- Keep unit schedules in Excel

Qualifications
- Active RN license
- BLS and ACLS certification
- Epic charting experience`;

const SALES = `Account Executive, Mid-Market

Brightwell sells scheduling software to clinics across the Sunbelt. From the Austin office you will own a territory of 300 accounts and sell the Lighthouse product line.

What you'll do
- Run discovery calls and product demos
- Keep pipeline and forecasts current in Salesforce
- Build territory plans in Excel

Requirements
- 3+ years of B2B SaaS sales
- Salesforce and Excel proficiency
- A record of closing against quota`;

describe("missingKeywords leaves out names written only in a posting's prose", () => {
  it("drops the employer and the depot of a software posting, keeps its skills", () => {
    const keywords = missing(RESUME, SOFTWARE);
    expect(keywords).not.toContain("freightways");
    expect(keywords).not.toContain("harbor");
    expect(keywords).not.toContain("point");
    for (const skill of ["kubernetes", "kafka", "snowflake", "go"])
      expect(keywords).toContain(skill);
  });

  it("drops the hospital and campus of a nursing posting, keeps its skills", () => {
    const keywords = missing(RESUME, NURSING);
    for (const place of ["cedar", "valley", "desert", "ridge"])
      expect(keywords).not.toContain(place);
    for (const skill of ["epic", "excel", "bls", "acls", "rn"]) expect(keywords).toContain(skill);
  });

  it("drops the region, office and product line of a sales posting, keeps its skills", () => {
    const keywords = missing(RESUME, SALES);
    for (const name of ["sunbelt", "austin", "lighthouse"]) expect(keywords).not.toContain(name);
    for (const skill of ["salesforce", "excel", "saas", "b2b"]) expect(keywords).toContain(skill);
  });

  it("leaves out every word of the employer a host passes as jobCompany", () => {
    const posting = `Brightwell is hiring an account executive.

Requirements
- Salesforce
- Excel
- Quota attainment`;
    // "Brightwell" opens a sentence, so its capital says nothing; only the host knows the name.
    expect(missing(RESUME, posting)).toContain("brightwell");
    const keywords = missing(RESUME, posting, { jobCompany: "Brightwell Health, Inc." });
    expect(keywords).not.toContain("brightwell");
    expect(keywords).toContain("salesforce");
    expect(keywords).toContain("excel");
  });

  it("keeps a word the posting also writes in a list, in lowercase, or in its vocabulary", () => {
    const keywords = missing(
      RESUME,
      `Data Engineer

You will move our warehouse to Snowflake, manage Terraform state and tune Kafka. Our snowflake schemas are documented, and you will move ingestion off Talend.

Requirements
- Kafka operations
- Data modelling
- Pipeline testing`,
    );
    // In a list (Kafka), lowercase elsewhere (snowflake), a policy skill (Terraform implies IaC).
    for (const skill of ["kafka", "snowflake", "terraform"]) expect(keywords).toContain(skill);
    expect(keywords).not.toContain("talend");
  });

  it("drops nothing from a posting that lists nothing: there is no list to compare with", () => {
    const keywords = missing(
      RESUME,
      "Join Freightways as a data engineer. You will build pipelines on Snowflake and Kafka and report to the Harbor Point team.",
    );
    for (const word of ["snowflake", "kafka", "freightways", "harbor"])
      expect(keywords).toContain(word);
  });

  it("is a policy switch", () => {
    const off = parseAtsPolicy({
      ...DEFAULT_POLICY,
      keywordMatch: {
        ...DEFAULT_POLICY.keywordMatch,
        proseNames: { ...DEFAULT_POLICY.keywordMatch.proseNames, enabled: false },
      },
    });
    expect(missing(RESUME, SOFTWARE, { policy: withLocales(off, BUILT_IN_LOCALES) })).toContain(
      "harbor",
    );
    expect(DEFAULT_POLICY.keywordMatch.proseNames).toEqual({ enabled: true, minListLines: 3 });
  });

  it("keeps German nouns, which are capitalised wherever they stand", () => {
    const keywords = missing(
      "Max Mustermann\nmax@example.de\nBerufserfahrung\nAnalyst, Beispiel GmbH 2019 - heute\n- Betrieb und Pflege der Plattform, Berichte mit Python und SQL",
      `Dateningenieur (m/w/d)

Sie verantworten die Netzwerksicherheit und die Datenqualität unserer Plattform.

Ihre Aufgaben
- Betrieb der Kubernetes-Cluster
- Pflege der Datenpipelines

Ihr Profil
- Erfahrung mit Snowflake und Kafka
- Kenntnisse in Go`,
    );
    for (const word of ["netzwerksicherheit", "datenqualität", "kafka", "snowflake", "go"])
      expect(keywords).toContain(word);
  });

  it("keeps Latin-script skills in a Hindi posting, where a capital says nothing about a name", () => {
    const keywords = missing(
      "राहुल शर्मा\nrahul@example.in\nअनुभव\nविश्लेषक, उदाहरण कंपनी 2019 - वर्तमान\n- Python और SQL में रिपोर्ट",
      `डेटा इंजीनियर

हमारी टीम Snowflake पर data platform चलाती है और आप Airflow से pipelines बनाएँगे।

ज़िम्मेदारियाँ
- डेटा पाइपलाइन बनाना
- रिपोर्टिंग

आवश्यकताएँ
- Kafka का अनुभव
- Go`,
    );
    for (const skill of ["snowflake", "airflow", "kafka", "go"]) expect(keywords).toContain(skill);
  });
});

describe("ats-engine check --job with a saved page", () => {
  const dir = mkdtempSync(join(tmpdir(), "ats-names-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("leaves the page's hiring organisation out of the keywords", async () => {
    const write = (name: string, content: string) => {
      const path = join(dir, name);
      writeFileSync(path, content);
      return path;
    };
    const job = write(
      "job.html",
      `<html><body><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Platform Engineer",
        hiringOrganization: { "@type": "Organization", name: "Quillmark Systems" },
        description:
          "<p>Quillmark builds billing software for utilities. You run it on Kubernetes.</p>" +
          "<ul><li>Own the deploy pipeline and on-call rotation</li>" +
          "<li>Design services for payments at scale</li>" +
          "<li>Mentor engineers across two product teams</li>" +
          "<li>Operate Kafka and Snowflake in production</li></ul>",
      })}</script></body></html>`,
    );
    const out: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    expect(await main(["check", write("resume.txt", RESUME), "--job", job, "--json"])).toBe(0);
    log.mockRestore();

    const { missingKeywords } = JSON.parse(out.join("\n"));
    expect(missingKeywords).not.toContain("quillmark");
    expect(missingKeywords).not.toContain("systems");
    for (const skill of ["kubernetes", "kafka", "snowflake"])
      expect(missingKeywords).toContain(skill);
  });
});
