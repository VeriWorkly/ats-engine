import { describe, expect, it } from "vitest";

import {
  AtsPolicyError,
  DEFAULT_POLICY,
  parseAtsPolicy,
  type AtsReport,
  check as score,
} from "../../src/index.js";
import {
  BUILT_IN_LOCALES,
  atsLanguagePackJsonSchema,
  de,
  localizePolicy,
  withLocales,
} from "../../src/locales/index.js";
import { fieldChecks } from "../fixtures/accuracy.js";
import { generateResumes, renderResume } from "../fixtures/generatedResumes.js";
import {
  LOCALE_FIXTURES,
  ITALIAN_RESUME,
  RUSSIAN_RESUME,
  SPANISH_RESUME,
  type LocaleFixture,
} from "../fixtures/locale-resumes.js";

const NOW = new Date("2026-10-01T00:00:00Z");
const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const check = (text: string, options: Parameters<typeof score>[2] = {}) =>
  score(text, POLICY, { now: NOW, ...options });

const fieldAccuracy = (report: AtsReport, fixture: LocaleFixture) => {
  const checks = fieldChecks(report, fixture);
  return { correct: checks.filter((check) => check.ok).length, total: checks.length };
};

describe.each(Object.entries(LOCALE_FIXTURES))("the %s fixture set", (_, fixtures) => {
  it("is read with the expected locale", () => {
    for (const fixture of fixtures)
      expect(check(fixture.text).locale, fixture.id).toEqual({
        ...fixture.locale,
        unsupported: null,
      });
  });

  it("meets the field-accuracy target of 0.95", () => {
    let correct = 0;
    let total = 0;
    const misses: string[] = [];
    for (const fixture of fixtures) {
      const report = check(fixture.text);
      const score = fieldAccuracy(report, fixture);
      correct += score.correct;
      total += score.total;
      if (score.correct < score.total)
        misses.push(`${fixture.id}: ${JSON.stringify(report.parsed)}`);
    }
    expect(correct / total, misses.join("\n")).toBeGreaterThanOrEqual(0.95);
  });

  it("finds every section heading it has", () => {
    for (const fixture of fixtures)
      expect(
        check(fixture.text)
          .failedChecks.map((rule) => rule.id)
          .filter((id) => id.includes("structure")),
        fixture.id,
      ).toEqual([]);
  });
});

// A resume in a language the policy recognises but has no vocabulary for is read with English
// rules; the report says so, in words, instead of a lower score with no reason.
describe("a language the engine does not read yet", () => {
  it.each([
    [ITALIAN_RESUME, "it", "This resume looks Italian"],
    [RUSSIAN_RESUME, "Cyrillic", "This resume is written in Cyrillic script"],
  ])("is named, with what that means for the reading", (text, unsupported, opening) => {
    const report = check(text);
    expect(report.locale).toEqual({ languages: [], region: report.locale.region, unsupported });
    const note = report.parsingWarnings.filter((warning) => warning.startsWith(opening));
    expect(note).toEqual([
      `${opening}, which the engine does not read yet: section names, dates and degrees were read as English, and the English writing checks were skipped.`,
    ]);
  });

  it("is not named for English, or for a language a pack reads", () => {
    for (const text of [LOCALE_FIXTURES.en[0]!.text, LOCALE_FIXTURES.de[0]!.text]) {
      const report = check(text);
      expect(report.locale.unsupported).toBeNull();
      expect(report.parsingWarnings.join(" ")).not.toContain("does not read yet");
    }
  });

  it("names German when no German pack is attached", () => {
    const report = score(LOCALE_FIXTURES.de[0]!.text, DEFAULT_POLICY, { now: NOW });
    expect(report.locale.unsupported).toBe("de");
    expect(report.parsingWarnings.join(" ")).toContain("This resume looks German, which");
  });

  // Review findings, 2026-10-23. A German summary and headings over English bullets: the German
  // pack's words are read, so German is not "not read".
  it("is not named for a language a pack reads, whatever its bullets", () => {
    const report = check(
      [
        "Lukas Weber",
        "lukas.weber@example.com | +49 30 12345678 | Berlin",
        "Profil",
        "Softwareentwickler mit acht Jahren Erfahrung in der Entwicklung von Zahlungssystemen für Banken und Versicherungen. Ich arbeite gern mit verteilten Teams und bin verantwortlich für die Architektur der Plattform sowie für die Betreuung von Junior-Entwicklern durch das ganze Jahr.",
        "Berufserfahrung",
        "Senior Engineer, Beispiel Bank AG — Berlin    03/2019 – heute",
        "- Built Kafka pipelines processing 2 million events a day",
        "- Led 6 engineers through a Kubernetes migration",
        "- Cut cloud costs 30%",
        "Ausbildung",
        "B.Sc. Informatik, TU Berlin, 2015",
      ].join("\n"),
    );
    expect(report.locale).toMatchObject({ languages: ["de"], unsupported: null });
    expect(report.parsingWarnings.join(" ")).not.toContain("does not read yet");
  });

  it("is still read in none for a policy's language with words but no id, and says so", () => {
    const [spanish] = DEFAULT_POLICY.text.otherLanguages;
    const policy = parseAtsPolicy({
      ...DEFAULT_POLICY,
      text: {
        ...DEFAULT_POLICY.text,
        otherLanguages: [{ detectionWords: spanish!.detectionWords }],
      },
    });
    const report = score(SPANISH_RESUME, policy, { now: NOW });
    expect(report.locale.unsupported).toBe("und");
    expect(report.rules.some((rule) => rule.category === "writing")).toBe(false);
    expect(report.parsingWarnings).toContain(
      "This resume is in a language the engine does not read yet: section names, dates and degrees were read as English, and the English writing checks were skipped.",
    );
  });

  it("names Japanese by its kana, not the Han script it shares with Chinese", () => {
    const japanese = [
      "山田 太郎",
      "taro@example.com | +81 90-1234-5678 | 東京",
      "職務経歴",
      "シニアソフトウェアエンジニア、サンプル銀行 — 東京    2019 – 現在",
      "- 二百万人の顧客のための決済プラットフォームを開発",
      "- 六人のチームを率いてクラウドへの移行を完了",
      "学歴",
      "情報工学 学士、東京大学、2015",
    ].join("\n");
    expect(check(japanese).locale.unsupported).toBe("ja");
  });

  // A German policy that keeps the default list must not call German "not read".
  it("ignores an entry that names the policy's own language or undetermined", () => {
    for (const id of ["en", "und"]) {
      const policy = parseAtsPolicy({
        ...DEFAULT_POLICY,
        text: { ...DEFAULT_POLICY.text, otherLanguages: [{ id, script: "Greek" }] },
      });
      const greek =
        "Νίκος Παπαδόπουλος\nΕμπειρία\nΜηχανικός λογισμικού στην εταιρεία Παράδειγμα από το 2019 έως σήμερα";
      expect(score(greek, policy, { now: NOW }).locale.unsupported, id).toBeNull();
    }
  });
});

describe("detection", () => {
  it("leaves an English resume to the base vocabulary", () => {
    const report = check(
      "Jane Doe\njane@example.com | (415) 555-0199\nExperience\nEngineer, Acme 2020 - 2022",
    );
    expect(report.locale).toEqual({ languages: [], region: null, unsupported: null });
  });

  it("does not read an English resume as German for a German company name", () => {
    const report = check(
      "Jane Doe\njane@example.com\nExperience\nEngineer, Müller und Söhne GmbH 2020 - 2022\n- Built the billing platform for the team",
    );
    expect(report.locale.languages).toEqual([]);
  });

  // Invented people. French employer and school names hold as many French words as a short
  // French CV, but fewer than the English around them.
  it.each([
    [
      "New York",
      [
        "Sarah Cohen",
        "sarah@example.com | (212) 555-0199 | New York, NY",
        "Experience",
        "Associate, Banque Nationale du Canada — New York, NY",
        "03/04/2021 – Present",
        "- Managed a $40M loan book",
        "Analyst, Crédit Agricole Corporate et Investment Bank — New York, NY",
        "07/01/2018 – 03/01/2021",
        "- Built credit models",
        "Education",
        "MBA, Institut Européen d'Administration des Affaires (INSEAD), 2018",
        "BA Economics, Columbia University, 2016",
        "Skills",
        "Excel, Bloomberg, Python",
      ],
      { year: 2021, month: 3 },
    ],
    [
      "Montreal",
      [
        "Marc Tremblay",
        "marc@example.com | (514) 555-0123 | Montreal, QC",
        "Experience",
        "Data Analyst, Caisse de dépôt et placement du Québec — Montreal",
        "04/05/2021 – Present",
        "- Built risk dashboards in Power BI",
        "Analyst, Société des alcools du Québec — Montreal",
        "09/01/2018 – 03/01/2021",
        "- Automated sales reports with Python",
        "Education",
        "MSc Finance, HEC Montréal, 2018",
        "BCom, Université du Québec à Montréal, 2016",
        "Skills",
        "Python, SQL, Power BI",
      ],
      { year: 2021, month: 4 },
    ],
  ])("reads an English resume from %s naming French institutions as English", (_, lines, start) => {
    const report = check(lines.join("\n"));
    // The French words add their vocabulary; the English bullets keep the dates and the rules.
    expect(report.locale.region).toBeNull();
    expect(report.parsed.roles[0].start).toEqual(start);
    expect(report.rules.map((rule) => rule.id)).toContain("ats-v2.writing.firstPerson");
  });

  // More French words than English, from one paragraph, yet English throughout the rest: read
  // with the French pack's words, but not as French dates, and still judged as English writing.
  it("reads a resume that is English too as English, whatever its French summary", () => {
    const report = check(
      [
        "Camille Dubois",
        "camille@example.com | (617) 555-0123 | Boston, MA",
        "Summary",
        "Ingénieure logiciel avec plus de 7 ans d'expérience dans le développement des applications web et mobiles. Passionnée par la qualité du code, je travaille au sein des équipes agiles pour livrer des produits fiables aux clients. Disponible pour un poste sur Boston ou à distance.",
        "Experience",
        "Software Engineer, Société Générale — New York, NY",
        "04/05/2019 – Present",
        "- Built a trading dashboard used by 300 traders",
        "- Reduced latency by 35% by rewriting the pricing service",
        "Software Engineer, Capgemini — Boston, MA",
        "09/01/2016 – 04/01/2019",
        "- Developed REST APIs in Java for 5 clients",
        "Education",
        "Diplôme d'ingénieur, École Polytechnique, 2016",
        "Skills",
        "Java, TypeScript, React, AWS",
      ].join("\n"),
    );
    expect(report.locale).toEqual({ languages: ["fr"], region: null, unsupported: null });
    expect(report.parsed.roles[0].start).toEqual({ year: 2019, month: 4 });
    expect(report.rules.map((rule) => rule.id)).toContain("ats-v2.writing.firstPerson");
  });

  // No bullets to weigh: the whole resume decides, not an empty sample any pack's words beat.
  it("weighs a resume with no bullets whole, so place names keep it English", () => {
    const report = check(
      [
        "Ravi Kumar",
        "ravi@example.com | Des Moines, IA",
        "Experience",
        "Store Manager, Les Schwab Tire Centers — Des Moines, IA    03/2018 – 06/2021",
        "Ran the Des Moines store and its team of twelve.",
        "Research Assistant, Iowa State University — Ames, IA    09/2016 – 02/2018",
        "Co-wrote a study on tire wear (Smith et al., 2017).",
        "Education",
        "BSc Mechanical Engineering, Iowa State University, 2016",
        "Skills",
        "Inventory, Scheduling, Excel",
      ].join("\n"),
    );
    expect(report.locale.region).toBeNull();
    expect(report.rules.map((rule) => rule.id)).toContain("ats-v2.writing.firstPerson");
    // A French CV with no bullets is still French.
    const unbulleted = LOCALE_FIXTURES.fr[0]!.text.replace(/^[-•]\s*/gmu, "");
    expect(check(unbulleted).locale).toEqual(check(LOCALE_FIXTURES.fr[0]!.text).locale);
    expect(check(unbulleted).locale.region).toBe("FR");
  });

  // German or Hindi bullets keep their country's dates and rules under English headings or summary.
  const BECKER = [
    "Jonas Becker",
    "jonas.becker@example.de | Berlin",
    "Summary",
    "Backend engineer with 8 years of experience. I have built and led teams across the payments and logistics domains, using Go and Kotlin, and I care about the developer experience of the platforms that our teams use every day.",
    "Berufserfahrung",
    "Senior Backend Engineer, Zalando SE — Berlin",
    "01/03/2019 – heute",
    "- Entwicklung einer Plattform mit Kafka für über 200 Teams",
    "- Leitung eines Teams von 5 Entwicklern",
    "Softwareentwickler, SAP SE — Walldorf",
    "01/10/2015 – 01/02/2019",
    "- Umsetzung von REST-APIs für die Cloud-Plattform",
    "Ausbildung",
    "M.Sc. Informatik, TU München, 2015",
    "Skills",
    "Go, Kotlin, Kafka",
  ].join("\n");
  it.each([
    ["an English summary", BECKER, 2],
    [
      "English headings",
      BECKER.replace(/Summary\n.*\n/, "")
        .replace("Berufserfahrung", "Work Experience")
        .replace("Ausbildung", "Education"),
      2,
    ],
  ])("keeps a German CV with %s German", (_, text, roles) => {
    const report = check(text);
    expect(report.locale).toEqual({ languages: ["de"], region: "DE", unsupported: null });
    expect(report.parsed.roles).toHaveLength(roles);
    expect(report.parsed.roles[0].start).toEqual({ year: 2019, month: 3 });
    expect(report.rules.map((rule) => rule.id)).not.toContain("ats-v2.writing.firstPerson");
  });

  it("keeps India for a resume with Hindi headings over English bullets", () => {
    const report = check(
      [
        "राहुल शर्मा",
        "rahul.sharma@gmail.com | नई दिल्ली",
        "सारांश",
        "सॉफ्टवेयर इंजीनियर, जावा और स्प्रिंग बूट में पाँच वर्षों का अनुभव। बैंकिंग क्षेत्र में काम किया है।",
        "कार्य अनुभव",
        "Software Engineer, Infosys — Bengaluru",
        "05/03/2020 – Present",
        "- Built REST APIs with Spring Boot for the payments team",
        "- Reduced batch processing time by 30% using parallel streams",
        "शिक्षा",
        "B.Tech Computer Science, दिल्ली विश्वविद्यालय, 2017",
      ].join("\n"),
    );
    expect(report.locale).toEqual({ languages: ["hi"], region: "IN", unsupported: null });
    expect(report.parsed.roles[0].start).toEqual({ year: 2020, month: 3 });
  });

  it("takes the region from a +CC phone number over the language's default", () => {
    expect(
      check(LOCALE_FIXTURES.de[0].text.replace("+49 30 12345678", "+91 98765 43210")).locale,
    ).toEqual({
      languages: ["de"],
      region: "IN",
      unsupported: null,
    });
  });

  it("reads with exactly the locale a host asks for", () => {
    const report = check(LOCALE_FIXTURES["en-IN"][1].text, { region: "IN" });
    expect(report.locale).toEqual({ languages: [], region: "IN", unsupported: null });
    // The region's credentials and date order apply.
    expect(report.parsed.education[1]).toMatchObject({ isced: 6 });
    expect(report.parsed.roles[0].start).toEqual({ year: 2018, month: 4 });
    expect(check(LOCALE_FIXTURES.de[0].text, { languages: [] }).locale.languages).toEqual([]);
  });

  // A language asked for by an id no pack has is refused, not read as the base.
  it("reads a language asked for in any case, and refuses one no pack has", () => {
    const german = LOCALE_FIXTURES.de[0].text;
    expect(check(german, { languages: ["DE"] }).locale.languages).toEqual(["de"]);
    // The policy's own language names no pack: the base alone, as `[]` does.
    expect(check(german, { languages: ["en"] }).locale.languages).toEqual([]);
    expect(() => check(german, { languages: ["deu"] })).toThrow(
      /Language "deu" is not attached to the policy \(attached: de, fr, hi, es, pt\)/,
    );
  });

  // A language the policy recognises but no pack reads is read as detection reads it (2026-10-24:
  // a resume read with AI help scored its Italian bullets by the English rules).
  it("reads a recognised language no pack has as that language, by id or script", () => {
    const english =
      "Jane Doe\njane@example.com\nExperience\nEngineer, Acme Corp, 2019 - 2022\n- Built the billing service";
    const italian = check(english, { languages: ["it"] });
    expect(italian.locale).toMatchObject({ languages: [], unsupported: "it" });
    expect(check(english, { languages: ["Cyrillic"] }).locale.unsupported).toBe("Cyrillic");
    expect(check(english).locale.unsupported).toBeNull();
    // Its English-only rules are off, as for a resume detected as Italian.
    const rules = (report: ReturnType<typeof check>) => report.rules.map((rule) => rule.id);
    expect(rules(italian).length).toBeLessThan(rules(check(english)).length);
  });

  it("keeps German stopwords out of an English posting's keywords", () => {
    const report = check("Jane Doe\nArt director.", {
      jobDescription: "Requirements\nArt direction and die-cut packaging design",
    });
    expect(report.missingKeywords.join(" ")).toContain("die");
  });
});

describe("region conventions", () => {
  const dob = "\nGeburtsdatum: 04.05.1990";
  const ruleIds = (report: AtsReport) => report.rules.map((rule) => rule.id);

  it("does not judge a German resume for stating a date of birth", () => {
    const report = check(LOCALE_FIXTURES.de[0].text + dob);
    expect(ruleIds(report)).not.toContain("ats-v2.privacy.dateOfBirth");
  });

  it("warns about it in the US, and weighs it lightly when the country is unknown", () => {
    const text =
      "Jane Doe\njane@example.com | +1 415 555 0199\nExperience\nEngineer, Acme 2020 - 2022\nDate of birth: 04/05/1990";
    const us = check(text).rules.find((rule) => rule.id === "ats-v2.privacy.dateOfBirth");
    expect(us).toMatchObject({ passed: false, severity: "warning", scoreImpact: 6 });
    const unknown = check(text.replace("+1 415 555 0199", "jane2@example.com")).rules.find(
      (rule) => rule.id === "ats-v2.privacy.dateOfBirth",
    );
    expect(unknown).toMatchObject({ passed: false, severity: "info", scoreImpact: 2 });
  });

  it("warns about it in the UK too, and reads the UK's credentials only there", () => {
    const text = [
      "Jane Doe",
      "jane@example.com | +44 20 7946 0123",
      "Experience",
      "Engineer, Acme 01/09/2020 - 01/03/2022",
      "Education",
      "HND Computing, Exemplar College, 2014",
      "Date of birth: 04/05/1990",
    ].join("\n");
    const report = check(text);
    expect(report.locale).toEqual({ languages: [], region: "GB", unsupported: null });
    expect(report.rules.find((rule) => rule.id === "ats-v2.privacy.dateOfBirth")).toMatchObject({
      passed: false,
      severity: "warning",
      scoreImpact: 6,
    });
    expect(report.parsed.roles[0]).toMatchObject({
      start: { year: 2020, month: 9 },
      end: { year: 2022, month: 3 },
    });
    expect(report.parsed.education[0]).toMatchObject({ credential: "HND", isced: 5 });
    const us = check(text, { region: "US" });
    expect(us.parsed.roles[0].start).toEqual({ year: 2020, month: 1 });
    expect(us.parsed.education[0]?.isced ?? null).toBeNull();
  });

  it("weighs a photo by region, and only when the file was measured", () => {
    const layout = { columnRatio: 0, tableCount: 0, pageCount: 1, imageCount: 1 };
    const photo = (text: string, withLayout = true) =>
      check(text, withLayout ? { layout } : {}).rules.find(
        (rule) => rule.id === "ats-v2.format.photo",
      );
    expect(photo(LOCALE_FIXTURES.de[0].text)).toBeUndefined();
    expect(
      photo("Jane Doe\n+1 415 555 0199\nExperience\nEngineer, Acme 2020 - 2022"),
    ).toMatchObject({
      passed: false,
      scoreImpact: 6,
    });
    expect(photo("Jane Doe\n+1 415 555 0199", false)).toBeUndefined();
  });
});

// The guard every language pack, built in or new, must pass: attached, it leaves an English resume
// exactly as the base reads it. A pack whose words leak into English fails here.
describe("the language packs and English resumes", () => {
  const regionsOnly = withLocales(DEFAULT_POLICY, { regions: BUILT_IN_LOCALES.regions });
  // The reading, not the label: a dense run of lookalikes can still name "de" (N4 B24) while the
  // German words it attaches change nothing.
  const read = ({ engine: _engine, locale: _locale, ...report }: AtsReport) => report;
  const LOOKALIKES = [
    "Ravi Kumar",
    "ravi@example.com | (212) 555-0199 | Des Moines, IA",
    "Experience",
    "Software Engineer, Volvo AB — Gothenburg",
    "03/2018 – 06/2021",
    "- Built a billing service with the team (Smith et al., ab test), MIT licence",
    "- Moved data from Pune and Mumbai sites to the cloud, with Müller und Söhne GmbH",
    "Education",
    "BSc Computer Science, MIT, 2016",
    "Skills",
    "TypeScript, SQL",
  ].join("\n");
  // English resumes from Spanish- and Portuguese-speaking communities: names and a phrase or two
  // in those languages (the Spanish pack read the first as Spanish before its prepositions went).
  const COMMUNITIES = [
    [
      "Ana Ruiz",
      "ana@example.com | (915) 555-0100 | El Paso, TX",
      "Employment",
      "Teacher Aide, Para Los Niños — El Paso, TX",
      "2019 – Present",
      "- Bilingual tutoring, grades 1-3",
      "- Parent outreach en español",
      "Cashier, Supermercado El Rey y Más — El Paso, TX",
      "2017 – 2019",
      "- Cash handling, inventory",
      "Volunteer, Iglesia San José — El Paso, TX",
      "- Food drive con familias",
      "Education",
      "High School Diploma, Colegio Por Un Mundo Mejor, 2017",
      "Skills",
      "Spanish, Customer Service, Microsoft Office, CPR",
    ].join("\n"),
    [
      "Lucas Pereira",
      "lucas@example.com | (617) 555-0100 | Boston, MA",
      "Experience",
      "Data Analyst, Banco Itaú Unibanco — São Paulo, SP",
      "2018 – 2021",
      "- Built credit dashboards for the São Paulo branch network",
      "- Worked with the equipe de dados on monthly reporting",
      "Education",
      "BSc Economics, Universidade de São Paulo, 2018",
      "Skills",
      "SQL, Python, Tableau, Portuguese",
    ].join("\n"),
  ];

  it("leave every English resume as it reads with none attached", async () => {
    const english = [
      ...[...LOCALE_FIXTURES.en, ...LOCALE_FIXTURES["en-GB"], ...LOCALE_FIXTURES["en-IN"]].map(
        (fixture) => fixture.text,
      ),
      LOOKALIKES,
      ...COMMUNITIES,
      ...(await Promise.all(
        generateResumes(100).map(async (resume) => (await renderResume(resume, "text")).text),
      )),
    ];
    // An English posting with words other languages use ("die", "ab", "mit").
    const posting =
      "Requirements\n- 5+ years of TypeScript and SQL\n- AB testing with Optimizely\n- Die-cut packaging design\n- Work with MIT-licensed libraries";
    for (const text of english)
      for (const jobDescription of [undefined, posting]) {
        expect(text.length).toBeGreaterThan(100);
        expect(read(check(text, { jobDescription })), text.slice(0, 60)).toEqual(
          read(score(text, regionsOnly, { now: NOW, jobDescription })),
        );
      }
  });
});

// Headings in capitals are a language's own words: only a word in capitals among lower-case ones
// ("BSc, MIT, 2016") is an acronym. Invented people; short CVs where the headings tip the count.
describe("words in capitals as language evidence", () => {
  const SHORT_FR = [
    "Thomas Martin",
    "thomas.martin@example.fr | 06 98 76 54 32 | Nantes",
    "EXPÉRIENCE PROFESSIONNELLE",
    "Développeur web, Société Démo, Nantes    09/2021 – aujourd'hui",
    "• Développement d'applications web en React et Node.js",
    "• Gestion de la base de données clients",
    "• Rédaction de la documentation technique",
    "Stagiaire développeur, Exemple SAS, Rennes    02/2021 – 07/2021",
    "• Création d'un outil de reporting en Python",
    "FORMATION",
    "Licence professionnelle développement web, IUT de Nantes    2020 – 2021",
    "COMPÉTENCES",
    "React, Node.js, Python, SQL",
  ].join("\n");
  const SHORT_DE = [
    "Anna Schmidt",
    "anna.schmidt@example.de | 0176 12345678 | München",
    "BERUFSERFAHRUNG UND PRAKTIKA",
    "Werkstudentin Datenanalyse, Muster AG    10/2022 – heute",
    "• Datenanalyse mit Python",
    "• Pflege von Dashboards in Power BI",
    "Praktikantin Controlling, Beispiel GmbH    04/2022 – 09/2022",
    "• Erstellung von Monatsberichten",
    "AUSBILDUNG",
    "B.Sc. Wirtschaftsinformatik, Universität Mannheim    2019 – 2023",
    "KENNTNISSE",
    "Python, SQL, Power BI, Excel",
  ].join("\n");

  it.each([
    ["a short French CV", SHORT_FR, "fr"],
    ["a short German CV", SHORT_DE, "de"],
    ["a German CV written all in capitals", SHORT_DE.toUpperCase(), "de"],
  ])("reads %s with capitalised headings in its language", (_, text, language) => {
    const report = check(text);
    expect(report.locale.languages).toEqual([language]);
    expect(report.parsed.roles).toHaveLength(2);
  });

  it("reads a German posting with capitalised headings as German", () => {
    const posting = [
      "Backend-Entwickler (m/w/d) – Go",
      "IHRE AUFGABEN",
      "- Entwicklung neuer Microservices in Go",
      "- Betrieb unserer Kubernetes-Plattform",
      "IHR PROFIL",
      "- Mehrjährige Berufserfahrung in der Backend-Entwicklung",
      "- Sehr gute Kenntnisse in Go und PostgreSQL",
      "- Fließend Deutsch und Englisch",
      "WIR BIETEN",
      "- 30 Tage Urlaub, Homeoffice",
    ].join("\n");
    const report = check(LOCALE_FIXTURES.en[0]!.text, { jobDescription: posting });
    expect(report.locale.languages).toContain("de");
    expect(report.requirements.find((row) => row.kind === "language")?.text).toBe(
      "Fließend Deutsch und Englisch",
    );
    expect(report.missingKeywords).not.toContain("ihre");
  });
});

describe("packs", () => {
  it("are validated when attached, naming the bad field", () => {
    const broken = { ...de, id: "xx", sections: { experience: String.raw`^erfahrung\-x` } };
    expect(() => withLocales(DEFAULT_POLICY, { languages: [broken] })).toThrow(AtsPolicyError);
  });

  it("need a way to be recognised", () => {
    expect(() =>
      withLocales(DEFAULT_POLICY, { languages: [{ id: "xx", name: "X", status: "community" }] }),
    ).toThrow(AtsPolicyError);
  });

  it("attach to a frozen policy, as parseAtsPolicy returns one", () => {
    expect(Object.isFrozen(POLICY)).toBe(true);
    expect(Object.isFrozen(POLICY.locales.languages[0])).toBe(true);
    expect(() => POLICY.locales.regions.pop()).toThrow(TypeError);
    // The policy a resume is read with is cached and shared by every resume like it.
    const localized = localizePolicy(POLICY, "Berufserfahrung", { region: "DE" }).policy;
    expect(localized).not.toBe(POLICY);
    expect(Object.isFrozen(localized)).toBe(true);
    expect(Object.isFrozen(localized.resumeParse)).toBe(true);
    expect(Object.isFrozen(localized.rules)).toBe(true);
    // The packs a host passes in are left as they were: the policy holds parsed copies.
    const pack = structuredClone(de);
    withLocales(DEFAULT_POLICY, { languages: [pack] });
    expect(Object.isFrozen(pack)).toBe(false);
  });

  it("replace an attached pack with the same id", () => {
    const twice = withLocales(withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES), { languages: [de] });
    expect(twice.locales.languages.map((pack) => pack.id)).toEqual(["de", "fr", "hi", "es", "pt"]);
  });

  it("refuse a region's change to a rule id with a typo, and ignore one the policy left out", () => {
    const typo = {
      ...BUILT_IN_LOCALES.regions[0]!,
      rules: { "ats-v2.privacy.dateOfBrith": { weight: 0 } },
    };
    let error: unknown;
    try {
      withLocales(DEFAULT_POLICY, { regions: [typo] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AtsPolicyError);
    expect((error as AtsPolicyError).issues).toEqual([
      {
        path: "locales.regions.0.rules.ats-v2.privacy.dateOfBrith",
        message:
          'the policy has no rule with id "ats-v2.privacy.dateOfBrith"; did you mean "ats-v2.privacy.dateOfBirth"?',
      },
    ]);
    // A host's own policy without the photo and date-of-birth rules still takes every region.
    const own = parseAtsPolicy({
      ...DEFAULT_POLICY,
      rules: DEFAULT_POLICY.rules.filter((rule) => !/photo|dateOfBirth/.test(rule.id)),
    });
    expect(() => withLocales(own, BUILT_IN_LOCALES)).not.toThrow();
  });

  it("add seniority patterns to a level of any name, in any case", () => {
    const levels = [
      ...DEFAULT_POLICY.keywordMatch.requirements.seniorityLevels,
      { name: "constructor", years: 3, patterns: ["foreman"] },
    ];
    const policy = withLocales(
      {
        ...DEFAULT_POLICY,
        keywordMatch: {
          ...DEFAULT_POLICY.keywordMatch,
          requirements: { ...DEFAULT_POLICY.keywordMatch.requirements, seniorityLevels: levels },
        },
      },
      {
        languages: [
          {
            ...de,
            requirements: { ...de.requirements, seniorityLevels: { Senior: ["oberarzt"] } },
          },
        ],
      },
    );
    const localized = localizePolicy(policy, "", { languages: ["de"] }).policy;
    const patterns = (name: string) =>
      localized.keywordMatch.requirements.seniorityLevels.find((level) => level.name === name)
        ?.patterns;
    expect(patterns("senior")).toContain("oberarzt");
    expect(patterns("constructor")).toEqual(["foreman"]);
  });

  it("match a language name a pack writes with capitals", () => {
    const policy = withLocales(DEFAULT_POLICY, {
      regions: [
        {
          ...BUILT_IN_LOCALES.regions[0]!,
          requirements: { languageNames: { Castellano: "Spanish" } },
        },
      ],
    });
    const report = score(
      "Jane Doe\njane@example.com\nExperience\nEngineer, Acme 2020 - 2022\n- Built the billing service\nLanguages\nSpanish (native), English (fluent)",
      policy,
      {
        now: NOW,
        jobDescription: "Requirements\n- Fluent in Castellano",
        region: BUILT_IN_LOCALES.regions[0]!.id,
      },
    );
    expect(report.requirements.find((row) => row.kind === "language")?.status).toBe("met");
  });

  it("publish a JSON Schema for contributors", () => {
    expect(atsLanguagePackJsonSchema).toMatchObject({ type: "object" });
  });

  it("leave a policy without packs exactly as fast and as it was", () => {
    const report = score("Jane Doe\nExperience\nEngineer, Acme 2020 - 2022", DEFAULT_POLICY, {
      now: NOW,
    });
    expect(report.locale).toEqual({ languages: [], region: null, unsupported: null });
  });
});
