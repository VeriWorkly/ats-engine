import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY, check } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";

const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const NOW = new Date("2024-10-01");

/** A German resume long enough to be read as German. */
const resume = (role: string[]) =>
  [
    "Name: Anna Schmidt",
    "anna.schmidt@example.de | +49 30 1234567",
    "",
    "Berufserfahrung",
    ...role,
    "- Entwicklung von Zahlungssystemen mit TypeScript und Go für den Handel",
    "- Verantwortung für das Team bei der Einführung von Kubernetes auf der Plattform",
    "",
    "Ausbildung",
    "B.Sc. Informatik, Universität Bonn, 2019",
  ].join("\n");

describe("German pack vocabulary for dates, durations and names", () => {
  it("strips a printed duration in German from the role", () => {
    const report = check(
      resume(["Acme GmbH", "Softwareentwicklerin", "01/2020 – heute · 4 Jahre 9 Monate"]),
      policy,
      { now: NOW },
    );
    expect(report.locale.languages).toContain("de");
    const [role] = report.parsed.roles;
    expect(role?.current).toBe(true);
    expect(`${role?.title} ${role?.employer}`).not.toMatch(/Jahre|Monate/);
  });

  it("reads a term dated by a German season", () => {
    const report = check(resume(["Praktikantin, Acme GmbH", "Sommer 2018"]), policy, { now: NOW });
    expect(report.parsed.roles[0]?.start).toEqual({ year: 2018, month: 6 });
  });

  it.each([
    ["Softwareentwicklerin, Acme GmbH, München, Bayern, Deutschland", "Acme GmbH"],
    ["Softwareentwicklerin | Acme | Wien, Österreich", "Acme"],
    // A city the pack lists is where, with no country after it (decision D1).
    ["Softwareentwicklerin, Acme, Berlin", "Acme"],
    ["Softwareentwicklerin, Acme GmbH, München", "Acme GmbH"],
  ])("reads a German state or country as where in %j", (header, employer) => {
    const report = check(resume([header, "01/2020 – heute"]), policy, {
      now: NOW,
    });
    expect(report.locale.languages).toContain("de");
    expect(report.parsed.roles[0]?.employer).toBe(employer);
  });

  it.each([
    ["Siemens, Bayern", "Siemens"],
    ["Bosch, Baden-Württemberg", "Bosch"],
    ["Siemens, Deutschland", "Siemens"],
  ])("keeps the employer of %j on a line of its own", (line, employer) => {
    const report = check(resume(["Softwareentwicklerin", line, "01/2020 – heute"]), policy, {
      now: NOW,
    });
    expect(report.parsed.roles[0]?.employer).toBe(employer);
  });
});

describe("region codes from a region pack", () => {
  it("never takes an Indian city and state code for the name", () => {
    const text = [
      "Pune, MH | priya@example.in | +91 98765 43210",
      "Priya Raman",
      "Software Engineer",
      "",
      "Experience",
      "Software Engineer, Infosys",
      "Jan 2020 - Present",
      "- Built APIs.",
    ].join("\n");
    expect(check(text, policy, { region: "IN", now: NOW }).parsed.name).toBe("Priya Raman");
  });
});

// Decision D1 (2026-10-23): the packs list their larger cities, so a city after the employer, or on
// a line of its own, is where the role is worked. Invented people and employers.
describe("cities from the packs", () => {
  const role = (lines: string[], options: Parameters<typeof check>[2] = {}) =>
    check(["Name: Kim Lee", "kim@example.com", "", "Experience", ...lines].join("\n"), policy, {
      now: NOW,
      ...options,
    }).parsed.roles[0];

  it.each([
    [
      "Ingénieur logiciel, Ciel Bleu Logiciels SAS    Lille    09/2022 – aujourd'hui",
      "Ciel Bleu Logiciels SAS",
      ["fr"],
    ],
    [
      "Analyste de données\tMont Clair Santé SARL, Paris\t09/2021 - 09/2025",
      "Mont Clair Santé SARL",
      ["fr"],
    ],
    ["डेटा विश्लेषक, Thar Insurance, चेन्नई, सितंबर 2021 – वर्तमान", "Thar Insurance", ["hi"]],
    ["Software Engineer, Acme Ltd, Manchester    Jan 2020 – Present", "Acme Ltd", []],
    ["Software Engineer, Globex Corp, Chicago    Jan 2020 – Present", "Globex Corp", []],
    ["Software Engineer, Infosys, Pune    Jan 2020 – Present", "Infosys", []],
  ])("reads the city in %j as where", (header, employer, languages) => {
    expect(role([header], { languages })?.employer).toBe(employer);
  });

  it("reads a city on a line of its own as where, not as the employer", () => {
    const found = role(["Ciel Bleu Logiciels SARL", "Ingénieur DevOps", "Paris", "2019 – 2021"], {
      languages: ["fr"],
    });
    expect(found).toMatchObject({
      employer: "Ciel Bleu Logiciels SARL",
      title: "Ingénieur DevOps",
    });
  });

  it("keeps an employer that only starts like a city, or is one word", () => {
    expect(role(["Software Engineer, Paris Baguette    Jan 2020 – Present"])?.employer).toBe(
      "Paris Baguette",
    );
    expect(role(["Software Engineer, London Stock Exchange Group    2020 – 2022"])?.employer).toBe(
      "London Stock Exchange Group",
    );
  });
});

// Headings the multilingual bench found unread (2026-10-23): everything under them was lost.
describe("section headings as people write them", () => {
  it.each([
    ["Weiterbildungen und Zertifikate", "de"],
    ["Weiterbildung", "de"],
    ["Fort- und Weiterbildung", "de"],
  ])("reads certifications under %j", (heading, language) => {
    const text = [
      "Name: Kim Lee",
      "kim@example.com",
      heading,
      "Certified Scrum Master, Scrum Alliance, 2023",
    ].join("\n");
    expect(
      check(text, policy, { now: NOW, languages: [language] }).parsed.certifications,
    ).toMatchObject([{ name: "Certified Scrum Master", issuer: "Scrum Alliance" }]);
  });

  // Under Skills until a heading it reads: the roles would be read as skills.
  it.each(["पेशेवर अनुभव", "प्रोफेशनल अनुभव"])("reads the experience under %j", (heading) => {
    const text = [
      "नेहा वर्मा",
      "neha.verma@example.in",
      "तकनीकी कौशल",
      "Python, SQL",
      heading,
      "डेटा विश्लेषक, Thar Insurance, 2021 – 2024",
      "• बारह टीमों के लिए रिपोर्टिंग पाइपलाइन बनाई",
    ].join("\n");
    const { parsed } = check(text, policy, { now: NOW, languages: ["hi"] });
    expect(parsed.skills).toEqual(["Python", "SQL"]);
    expect(parsed.roles).toMatchObject([{ title: "डेटा विश्लेषक", employer: "Thar Insurance" }]);
  });
});

// German compound titles, the feminine form included: an employer-first header puts them second.
describe("German compound titles", () => {
  it.each([
    [
      "Alpenwerk Maschinenbau | Produktmanagerin | 05/2013 - 04/2017",
      "Produktmanagerin",
      "Alpenwerk Maschinenbau",
    ],
    [
      "Ostwind Lebensmittel SE — Marketingmanager — 03/2024 – heute",
      "Marketingmanager",
      "Ostwind Lebensmittel SE",
    ],
    ["Seewiese Studios | UX-Designerin | 2019 - 2021", "UX-Designerin", "Seewiese Studios"],
  ])("reads the title in %j", (header, title, employer) => {
    const report = check(resume([header]), policy, { now: NOW, languages: ["de"] });
    expect(report.parsed.roles[0]).toMatchObject({ title, employer });
  });
});

// Hindi titles the multilingual bench found unread in employer-first headers (2026-10-23).
describe("Hindi titles", () => {
  it.each([
    ["Himgiri Media | समाधान वास्तुकार | 01/2022 - 07/2024", "समाधान वास्तुकार", "Himgiri Media"],
    ["Ganga Logistics — यूएक्स डिज़ाइनर — 2024 से वर्तमान", "यूएक्स डिज़ाइनर", "Ganga Logistics"],
    ["Narmada Energy | सिस्टम प्रशासक | 2019 - 2021", "सिस्टम प्रशासक", "Narmada Energy"],
  ])("reads the title in %j", (header, title, employer) => {
    const text = ["नेहा वर्मा", "neha.verma@example.in", "कार्य अनुभव", header].join("\n");
    const report = check(text, policy, { now: NOW, languages: ["hi"] });
    expect(report.parsed.roles[0]).toMatchObject({ title, employer });
  });
});

// Review finding (2026-10-24): a line that is only a city's name may be the employer itself
// ("Santander" the bank, "Cambridge" the university). Only after another employer is it where.
describe("an employer named like a city", () => {
  it.each([
    [["Branch Manager", "Santander  2018 - Present", "- Grew deposits 20%"], "Santander"],
    [["Research Fellow", "Cambridge  2014 - 2018", "- Ran clinical trials"], "Cambridge"],
    [["Santander", "Branch Manager", "2018 - Present", "- Grew deposits 20%"], "Santander"],
    [["Branch Manager  2018 - Present", "Santander", "- Grew deposits 20%"], "Santander"],
  ])("keeps %j", (lines, employer) => {
    const text = ["Jordan Blake", "jordan.blake@example.com", "Experience", ...lines].join("\n");
    expect(check(text, policy, { now: NOW }).parsed.roles[0]?.employer).toBe(employer);
  });

  // With the employer and title stacked above, a city beside the dates is where (review,
  // 2026-10-24: "Paris    04/2024 à aujourd'hui" was read as the employer).
  it.each([
    [
      "fr",
      [
        "Ciel Bleu Logiciels SARL",
        "Analyste métier",
        "Paris    04/2024 à aujourd'hui",
        "• Réduction de la clôture mensuelle",
      ],
      "Ciel Bleu Logiciels SARL",
    ],
    [
      "hi",
      [
        "Sahyadri Systems Ltd",
        "व्यवसाय विश्लेषक",
        "नई दिल्ली    04/2024 से वर्तमान",
        "• मासिक क्लोज़ को दस दिन से घटाकर चार दिन किया",
      ],
      "Sahyadri Systems Ltd",
    ],
  ])(
    "reads a %s city beside the dates as where under a stacked header",
    (language, lines, employer) => {
      const text = ["Jordan Blake", "jordan.blake@example.com", "Experience", ...lines].join("\n");
      expect(
        check(text, policy, { now: NOW, languages: [language] }).parsed.roles[0]?.employer,
      ).toBe(employer);
    },
  );
});

// LinkedIn's PDF export, in the member's language (review finding, 2026-10-24): its contact and
// top-skills headings come first, so unread they took the name and lost the skills.
describe("a LinkedIn export in each language", () => {
  it.each([
    [
      "de",
      "Kontakt",
      "Top-Kenntnisse",
      "Berufserfahrung",
      "Januar 2020 - Heute (4 Jahre 10 Monate)",
    ],
    [
      "fr",
      "Coordonnées",
      "Principales compétences",
      "Expérience",
      "janvier 2020 - Present (4 ans 10 mois)",
    ],
    [
      "es",
      "Contactar",
      "Aptitudes principales",
      "Experiencia",
      "enero de 2020 - Present (4 años 10 meses)",
    ],
    [
      "pt",
      "Contato",
      "Principais competências",
      "Experiência",
      "janeiro de 2020 - Present (4 anos 10 meses)",
    ],
  ])("reads the name and the top skills in %s", (language, contact, top, experience, dates) => {
    const text = [
      contact,
      "www.linkedin.com/in/kimlee",
      top,
      "Controlling",
      "SAP S/4HANA",
      "Kim Lee",
      "Senior Consultant",
      experience,
      "Exemplo Consulting",
      "Senior Consultant",
      dates,
    ].join("\n");
    const { parsed } = check(text, policy, { now: NOW, languages: [language] });
    expect(parsed.name).toBe("Kim Lee");
    expect(parsed.skills).toEqual(["Controlling", "SAP S/4HANA"]);
    expect(parsed.roles[0]).toMatchObject({
      title: "Senior Consultant",
      employer: "Exemplo Consulting",
    });
  });
});

// "Cargo en Empresa": split only where a legal form ends the company (review, 2026-10-24); "en"
// also sits inside titles ("Especialista en Marketing", "Ingeniero en Sistemas").
describe("Spanish and Portuguese employer after en, na, em", () => {
  const first = (line: string, language: string) =>
    check(["Ana Lima", "ana@example.com", "Experiencia", line].join("\n"), policy, {
      now: NOW,
      languages: [language],
    }).parsed.roles[0];

  it.each([
    [
      "Diseñadora UX en Piedra Blanca Energía S.A.    2024 – presente",
      "es",
      "Diseñadora UX",
      "Piedra Blanca Energía S.A.",
    ],
    [
      "Ingeniero de software en Cielo Azul Software S.L.    2021 – 2024",
      "es",
      "Ingeniero de software",
      "Cielo Azul Software S.L.",
    ],
    [
      "Analista de dados na Exemplo Pagamentos Ltda.    2021 – 2024",
      "pt",
      "Analista de dados",
      "Exemplo Pagamentos Ltda",
    ],
    [
      "Especialista en Marketing, Acme S.A.    2019 – 2021",
      "es",
      "Especialista en Marketing",
      "Acme S.A.",
    ],
    [
      "Ingeniero en Sistemas Computacionales    2019 – 2021",
      "es",
      "Ingeniero en Sistemas Computacionales",
      "",
    ],
  ])("reads %j", (line, language, title, employer) => {
    expect(first(line, language)).toMatchObject({ title, employer });
  });

  // A resume repeats one layout (review, 2026-10-24): one role joined "en" before a legal form
  // shows how every role is joined, so a city on the next line is no longer taken as the employer.
  it.each([
    [
      "es",
      [
        "Diseñadora UX en Puente Viejo Estudios, enero 2023 - enero 2025",
        "Barcelona",
        "– Reducción del cierre mensual de diez a cuatro días",
        "Responsable de operaciones en Montaña Clara Salud S.L., marzo 2019 - diciembre 2022",
        "Barcelona",
        "– Planificación semanal con diseño, ventas y operaciones",
      ],
      ["Puente Viejo Estudios", "Montaña Clara Salud S.L."],
      ["Diseñadora UX", "Responsable de operaciones"],
    ],
    [
      "es",
      [
        "Especialista en Marketing en Cielo Azul Software, 2023 - actual",
        "Consultor en Acme Consultores S.A., 2019 - 2022",
      ],
      ["Cielo Azul Software", "Acme Consultores S.A."],
      ["Especialista en Marketing", "Consultor"],
    ],
    [
      "pt",
      [
        "Analista de dados na Exemplo Pagamentos, 2022 - atual",
        "Analista na Estrela Sul Tecnologia Ltda, 2019 - 2022",
      ],
      ["Exemplo Pagamentos", "Estrela Sul Tecnologia Ltda"],
      ["Analista de dados", "Analista"],
    ],
  ])("reads every %s role the way one shows", (language, lines, employers, titles) => {
    const roles = check(
      ["Ana Lima", "ana@example.com", "Experiencia", ...lines].join("\n"),
      policy,
      {
        now: NOW,
        languages: [language],
      },
    ).parsed.roles;
    expect(roles.map((role) => role.employer)).toEqual(employers);
    expect(roles.map((role) => role.title)).toEqual(titles);
  });

  it("keeps a title's own en where no role shows the layout", () => {
    expect(first("Especialista en Marketing Digital, 2019 – 2021", "es")).toMatchObject({
      title: "Especialista en Marketing Digital",
    });
  });
});

// Review findings (2026-10-24): foundations that grant degrees are schools.
describe("schools named as foundations", () => {
  it.each([
    ["pt", "MBA em Gestão de Projetos, Fundação Getulio Vargas, 2020", "Fundação Getulio Vargas"],
    [
      "es",
      "Profesional en Mercadeo, Fundación Universitaria Los Libertadores, 2016",
      "Fundación Universitaria Los Libertadores",
    ],
  ])("reads the %s school in %s", (language, line, school) => {
    const text = ["Ana Lima", "ana@example.com", "Formación", line].join("\n");
    expect(
      check(text, policy, { now: NOW, languages: [language] }).parsed.education[0]?.school,
    ).toBe(school);
  });
});

// A German LinkedIn export holds German headings, months and durations but hardly a function
// word; it is still German (review, 2026-10-24).
describe("detecting a German LinkedIn export", () => {
  it("reads it in German with no language given", () => {
    const text = [
      "Kontakt",
      "www.linkedin.com/in/felixkrueger",
      "Top-Kenntnisse",
      "SAP S/4HANA",
      "Prozessoptimierung",
      "Controlling",
      "Felix Krüger",
      "Senior Consultant bei SAP",
      "Walldorf, Baden-Württemberg, Deutschland",
      "Berufserfahrung",
      "SAP",
      "Senior Consultant",
      "Januar 2020 - Heute (4 Jahre 10 Monate)",
      "Walldorf, Baden-Württemberg, Deutschland",
      "Deloitte",
      "Consultant",
      "September 2016 - Dezember 2019 (3 Jahre 4 Monate)",
      "Frankfurt am Main, Hessen, Deutschland",
      "Ausbildung",
      "Universität Mannheim",
      "Master of Science, Betriebswirtschaftslehre · (2014 - 2016)",
    ].join("\n");
    const report = check(text, policy, { now: NOW });
    expect(report.locale.languages).toEqual(["de"]);
    expect(report.parsed.name).toBe("Felix Krüger");
    expect(report.parsed.roles.map((role) => role.employer)).toEqual(["SAP", "Deloitte"]);
  });
});

// Review findings (2026-10-24): Chile's cities, and Québec's CEGEP.
describe("Chile and Québec", () => {
  it("reads a Chilean city after the employer as where", () => {
    const text = [
      "Ana Rojas",
      "ana@example.cl",
      "Experiencia",
      "Ingeniera de procesos, Codelco, Santiago    2019 – 2023",
      "Analista, Minera Escondida, Antofagasta    2016 – 2019",
    ].join("\n");
    expect(
      check(text, policy, { now: NOW, languages: ["es"] }).parsed.roles.map(
        (role) => role.employer,
      ),
    ).toEqual(["Codelco", "Minera Escondida"]);
  });

  it("reads a CEGEP diploma as short-cycle tertiary", () => {
    const text = [
      "Julie Tremblay",
      "julie@example.ca",
      "Formation",
      "Baccalauréat en informatique, Université Laval, 2020",
      "DEC en techniques de l'informatique, Cégep du Vieux Montréal, 2017",
    ].join("\n");
    expect(
      check(text, policy, { now: NOW, languages: ["fr"] }).parsed.education.map((row) => [
        row.school,
        row.isced,
      ]),
    ).toEqual([
      ["Université Laval", 6],
      ["Cégep du Vieux Montréal", 5],
    ]);
  });
});

// The independent review of the branch (2026-10-24).
describe("what the branch review found", () => {
  it.each([
    [
      [
        "Software Engineer",
        "Deloitte, Canada    Jan 2020 – Present",
        "Worked on payments.",
        "Data Analyst",
        "Deloitte, Canada    Jan 2018 – Dec 2019",
      ],
      ["Deloitte", "Deloitte"],
    ],
    [
      [
        "Software Engineer",
        "Deloitte, Canada    Jan 2020 – Present",
        "Payments platform for retail banks",
        "Data Analyst",
        "Deloitte, Canada    Jan 2018 – Dec 2019",
      ],
      ["Deloitte", "Deloitte"],
    ],
    [
      [
        "Engineer",
        "Acme Corp    Jan 2020 – Present",
        "- Built the billing service",
        "Tech: Java, Spring",
        "Analyst",
        "Infosys, India    Jan 2018 – Dec 2019",
      ],
      ["Acme Corp", "Infosys"],
    ],
  ])("keeps the English employer beside the dates: %j", (lines, employers) => {
    const text = ["Jordan Blake", "jordan.blake@example.com", "Experience", ...lines].join("\n");
    expect(check(text, policy, { now: NOW }).parsed.roles.map((role) => role.employer)).toEqual(
      employers,
    );
  });

  it.each([
    [
      "Ingeniera en Sistemas Computacionales, Grupo Bimbo    2020 – 2023",
      "Ingeniera en Sistemas Computacionales",
      "Grupo Bimbo",
    ],
    ["Ingeniero en Sistemas    2020 – 2023", "Ingeniero en Sistemas", ""],
  ])(
    "keeps a Spanish title's field once a role shows Cargo en Empresa: %s",
    (line, title, employer) => {
      const text = [
        "Ana Lima",
        "ana@example.com",
        "Experiencia",
        "Diseñadora UX en Piedra Blanca Energía S.A.    2024 – presente",
        line,
      ].join("\n");
      const roles = check(text, policy, { now: NOW, languages: ["es"] }).parsed.roles;
      expect(roles[1]).toMatchObject({ title, employer });
    },
  );

  it.each(["Córdoba, España", "Cartagena, Murcia, España", "Guadalajara, España"])(
    "reads a header naming Spain as Spain: %s",
    (place) => {
      const text = [
        "Ana López",
        place,
        "ana.lopez@gmail.com",
        "Experiencia profesional",
        "Analista de datos, Ejemplo S.A., 2019 – actualidad",
        "• Elaboración de informes de gestión y análisis de ventas",
      ].join("\n");
      expect(check(text, policy, { now: NOW }).locale.region).toBe("ES");
    },
  );

  it.each([
    "Semestre de intercambio, Universidad de Salamanca, 2016",
    "Curso de Inglés, Universidad de Chile, 2019",
    "Diplomado en Finanzas, Universidad de los Andes, 2019",
    "Marzo 2010 – Diciembre 2015, Universidad de Chile",
    "Medellín, Universidad de Antioquia, 2015",
  ])("reads no degree from a course, a date or a place before a university: %s", (line) => {
    const text = ["Ana Lima", "ana@example.com", "Formación", line].join("\n");
    expect(
      check(text, policy, { now: NOW, languages: ["es"] }).parsed.education[0]?.isced,
    ).toBeNull();
  });
});
