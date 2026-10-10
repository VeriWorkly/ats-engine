/**
 * Synthetic resumes per locale, with the fields an ATS should recover from each. Invented people
 * and companies only — never a real person's resume.
 *
 * Each locale's set is what `tests/locales.test.ts` holds to the field-accuracy target, and what
 * a contributor extends when they improve a pack (see LOCALES.md).
 */

import { EN_FIXTURES } from "./en-resumes.js";

/** `start`, and `end` when labelled, as "YYYY-MM" or "YYYY"; `end` "" for a role with none. */
export type ExpectedRole = {
  title: string;
  employer: string;
  start: string;
  current: boolean;
  end?: string;
};
/** `credential`: the degree as written ("B.S.", "Master of Science"), not its field. */
export type ExpectedEducation = { school: string; isced: number | null; credential?: string };
/** `date` and `expires` as "YYYY-MM", "YYYY", or "" when the row has none. */
export type ExpectedCertification = {
  name: string;
  issuer: string;
  date: string;
  expires?: string;
};
export type ExpectedLanguage = { language: string; cefr: string | null };

export type LocaleFixture = {
  id: string;
  text: string;
  locale: { languages: string[]; region: string | null };
  name: string;
  email: string;
  phone: string;
  roles: ExpectedRole[];
  education: ExpectedEducation[];
  skills: string[];
  /** As written, in any order; none when left out: a resume without links must not grow any. */
  links?: string[];
  /** None when left out: a resume without the section must not grow rows. */
  certifications?: ExpectedCertification[];
  spokenLanguages?: ExpectedLanguage[];
};

export const LOCALE_FIXTURES: Record<"en" | "de" | "hi" | "en-IN", LocaleFixture[]> = {
  en: EN_FIXTURES,
  de: [
    {
      id: "de-backend",
      text: `Jürgen Müller
juergen.mueller@example.de | +49 30 12345678 | Berlin
Kurzprofil
Erfahrener Softwareentwickler mit Schwerpunkt auf verteilten Systemen und Cloud-Plattformen.
Berufserfahrung
Senior Softwareentwickler bei Beispiel GmbH 03.2020 – heute
• Entwicklung einer Zahlungsplattform mit Kubernetes und Go für 2 Mio. Nutzer
• Leitung eines Teams von 6 Entwicklern und Einführung von CI/CD
Softwareentwickler, Muster AG 01/2017 – 02/2020
• Implementierung von REST-Schnittstellen in Java und Spring Boot
Ausbildung
Diplom-Informatiker (FH), Hochschule für Technik und Wirtschaft Berlin 2011 – 2016
Abitur, Gymnasium Steglitz 2011
Kenntnisse
Sprachen: Go, Java, TypeScript
Werkzeuge: Kubernetes, Docker, PostgreSQL`,
      locale: { languages: ["de"], region: "DE" },
      name: "Jürgen Müller",
      email: "juergen.mueller@example.de",
      phone: "+49 30 12345678",
      roles: [
        {
          title: "Senior Softwareentwickler",
          employer: "Beispiel GmbH",
          start: "2020-03",
          current: true,
          end: "",
        },
        {
          title: "Softwareentwickler",
          employer: "Muster AG",
          start: "2017-01",
          current: false,
          end: "2020-02",
        },
      ],
      education: [
        {
          school: "Hochschule für Technik und Wirtschaft Berlin",
          isced: 6,
          credential: "Diplom-Informatiker (FH)",
        },
        { school: "Gymnasium Steglitz", isced: 3, credential: "Abitur" },
      ],
      skills: ["Go", "Java", "TypeScript", "Kubernetes", "Docker", "PostgreSQL"],
    },
    {
      id: "de-consultant",
      text: `Anna Schmidt
anna.schmidt@example.de
0176 12345678
Berufliche Erfahrung
Unternehmensberaterin
Beispiel Consulting GmbH, München
seit 04/2021
• Konzeption von Datenstrategien für Kunden aus dem Mittelstand
Projektleiterin
Muster Logistik AG
10.2016 bis 03.2021
• Leitung von Projekten mit einem Budget von 3 Mio. Euro
Bildung
Master of Science Wirtschaftsinformatik, Universität Mannheim 2014 – 2016
Bachelor of Science Betriebswirtschaftslehre, Universität Mannheim 2011 – 2014
Fähigkeiten
SQL, Python, Tableau, SAP`,
      locale: { languages: ["de"], region: "DE" },
      name: "Anna Schmidt",
      email: "anna.schmidt@example.de",
      phone: "0176 12345678",
      roles: [
        {
          title: "Unternehmensberaterin",
          employer: "Beispiel Consulting GmbH",
          start: "2021-04",
          current: true,
          end: "",
        },
        {
          title: "Projektleiterin",
          employer: "Muster Logistik AG",
          start: "2016-10",
          current: false,
          end: "2021-03",
        },
      ],
      education: [
        {
          school: "Universität Mannheim",
          isced: 7,
          credential: "Master of Science",
        },
        {
          school: "Universität Mannheim",
          isced: 6,
          credential: "Bachelor of Science",
        },
      ],
      skills: ["SQL", "Python", "Tableau", "SAP"],
    },
    {
      id: "de-letterspaced",
      text: `Lukas Becker
lukas.becker@example.de | +49 89 9876543
B E R U F S E R F A H R U N G
DevOps-Ingenieur bei Beispiel Cloud GmbH März 2019 – aktuell
• Aufbau einer Plattform für 40 Teams auf Basis von Terraform
A U S B I L D U N G
Ausbildung zum Fachinformatiker, IHK München 2012 – 2015
K E N N T N I S S E
Terraform, AWS, Linux`,
      locale: { languages: ["de"], region: "DE" },
      name: "Lukas Becker",
      email: "lukas.becker@example.de",
      phone: "+49 89 9876543",
      roles: [
        {
          title: "DevOps-Ingenieur",
          employer: "Beispiel Cloud GmbH",
          start: "2019-03",
          current: true,
          end: "",
        },
      ],
      education: [{ school: "", isced: 3, credential: "Ausbildung zum Fachinformatiker" }],
      skills: ["Terraform", "AWS", "Linux"],
    },
    {
      id: "de-zertifikate",
      text: `Katrin Wagner
katrin.wagner@example.de | +49 40 1234567 | Hamburg
Kurzprofil
Cloud-Architektin mit Schwerpunkt auf sicheren Plattformen für den Mittelstand.
Berufserfahrung
Cloud-Architektin bei Beispiel Systems GmbH 06.2021 – heute
• Aufbau einer Plattform auf AWS für 25 Entwicklungsteams
Systemadministratorin, Muster IT AG 09/2016 – 05/2021
• Einführung von Terraform und Automatisierung der Bereitstellung
Ausbildung
Bachelor of Science Informatik, Universität Hamburg 2012 – 2016
Zertifikate
AWS Certified Solutions Architect – Professional, Amazon Web Services, 03/2023
Professional Scrum Master (PSM I), Scrum.org, gültig bis 12/2027
Kenntnisse
AWS, Terraform, Kubernetes, Python
Sprachen
Deutsch (Muttersprache), Englisch (verhandlungssicher, C1), Französisch (Grundkenntnisse)`,
      locale: { languages: ["de"], region: "DE" },
      name: "Katrin Wagner",
      email: "katrin.wagner@example.de",
      phone: "+49 40 1234567",
      roles: [
        {
          title: "Cloud-Architektin",
          employer: "Beispiel Systems GmbH",
          start: "2021-06",
          current: true,
          end: "",
        },
        {
          title: "Systemadministratorin",
          employer: "Muster IT AG",
          start: "2016-09",
          current: false,
          end: "2021-05",
        },
      ],
      education: [{ school: "Universität Hamburg", isced: 6, credential: "Bachelor of Science" }],
      skills: ["AWS", "Terraform", "Kubernetes", "Python"],
      certifications: [
        {
          name: "AWS Certified Solutions Architect – Professional",
          issuer: "Amazon Web Services",
          date: "2023-03",
          expires: "",
        },
        {
          name: "Professional Scrum Master (PSM I)",
          issuer: "Scrum.org",
          date: "",
          expires: "2027-12",
        },
      ],
      spokenLanguages: [
        { language: "Deutsch", cefr: "C2" },
        { language: "Englisch", cefr: "C1" },
        { language: "Französisch", cefr: "A2" },
      ],
    },
  ],
  hi: [
    {
      id: "hi-engineer",
      text: `राहुल शर्मा
rahul.sharma@example.in | +91 98765 43210
सारांश
सॉफ्टवेयर इंजीनियर, भुगतान प्रणालियों में पाँच वर्षों का अनुभव।
कार्य अनुभव
वरिष्ठ सॉफ्टवेयर इंजीनियर, उदाहरण टेक्नोलॉजीज़ जनवरी 2021 - वर्तमान
• 20 लाख उपयोगकर्ताओं के लिए भुगतान प्लेटफ़ॉर्म विकसित किया
• छह इंजीनियरों की टीम का नेतृत्व किया
सॉफ्टवेयर इंजीनियर, नमूना सॉफ्टवेयर २०१८ - २०२०
• एपीआई की गति में 40% सुधार किया
शिक्षा
बी.टेक, कंप्यूटर विज्ञान, दिल्ली विश्वविद्यालय 2014 - 2018
कौशल
Java, Go, Kubernetes, PostgreSQL`,
      locale: { languages: ["hi"], region: "IN" },
      name: "राहुल शर्मा",
      email: "rahul.sharma@example.in",
      phone: "+91 98765 43210",
      roles: [
        {
          title: "वरिष्ठ सॉफ्टवेयर इंजीनियर",
          employer: "उदाहरण टेक्नोलॉजीज़",
          start: "2021-01",
          current: true,
          end: "",
        },
        {
          title: "सॉफ्टवेयर इंजीनियर",
          employer: "नमूना सॉफ्टवेयर",
          start: "2018",
          current: false,
          end: "2020",
        },
      ],
      education: [{ school: "दिल्ली विश्वविद्यालय", isced: 6 }],
      skills: ["Java", "Go", "Kubernetes", "PostgreSQL"],
    },
    {
      id: "hi-analyst",
      text: `प्रिया वर्मा
priya.verma@example.in | +91 91234 56789
अनुभव
डेटा विश्लेषक, नमूना वित्त लिमिटेड मार्च 2020 से वर्तमान
• मासिक रिपोर्टिंग को स्वचालित किया जिससे 30 घंटे बचे
शैक्षिक योग्यता
एमबीए, उदाहरण प्रबंधन संस्थान 2018 - 2020
स्नातक (वाणिज्य), लखनऊ विश्वविद्यालय 2015 - 2018
कौशल
SQL, Excel, Power BI`,
      locale: { languages: ["hi"], region: "IN" },
      name: "प्रिया वर्मा",
      email: "priya.verma@example.in",
      phone: "+91 91234 56789",
      roles: [
        {
          title: "डेटा विश्लेषक",
          employer: "नमूना वित्त लिमिटेड",
          start: "2020-03",
          current: true,
          end: "",
        },
      ],
      education: [
        { school: "उदाहरण प्रबंधन संस्थान", isced: 7, credential: "एमबीए" },
        { school: "लखनऊ विश्वविद्यालय", isced: 6, credential: "स्नातक" },
      ],
      skills: ["SQL", "Excel", "Power BI"],
    },
    {
      id: "hi-certified",
      text: `अमित कुमार
amit.kumar@example.in | +91 99887 76655
सारांश
क्लाउड इंजीनियर, बैंकिंग प्रणालियों में चार वर्षों का अनुभव।
कार्य अनुभव
क्लाउड इंजीनियर, उदाहरण बैंक लिमिटेड जुलाई 2022 - वर्तमान
• 30 सेवाओं को एडब्ल्यूएस पर स्थानांतरित किया
सिस्टम इंजीनियर, नमूना टेक २०१९ - २०२२
• सर्वर अपडेट को स्वचालित किया
शिक्षा
बी.टेक, सूचना प्रौद्योगिकी, पुणे विश्वविद्यालय 2015 - 2019
प्रमाणपत्र
AWS Certified Developer – Associate, Amazon Web Services, 2023
पीएमपी (पीएमआई), समाप्ति 2027
कौशल
AWS, Linux, Python
भाषाएँ
हिंदी (मातृभाषा), अंग्रेज़ी (धाराप्रवाह), मराठी (बुनियादी ज्ञान)`,
      locale: { languages: ["hi"], region: "IN" },
      name: "अमित कुमार",
      email: "amit.kumar@example.in",
      phone: "+91 99887 76655",
      roles: [
        {
          title: "क्लाउड इंजीनियर",
          employer: "उदाहरण बैंक लिमिटेड",
          start: "2022-07",
          current: true,
          end: "",
        },
        {
          title: "सिस्टम इंजीनियर",
          employer: "नमूना टेक",
          start: "2019",
          current: false,
          end: "2022",
        },
      ],
      education: [{ school: "पुणे विश्वविद्यालय", isced: 6 }],
      skills: ["AWS", "Linux", "Python"],
      certifications: [
        {
          name: "AWS Certified Developer – Associate",
          issuer: "Amazon Web Services",
          date: "2023",
          expires: "",
        },
        { name: "पीएमपी", issuer: "पीएमआई", date: "", expires: "2027" },
      ],
      spokenLanguages: [
        { language: "हिंदी", cefr: "C2" },
        { language: "अंग्रेज़ी", cefr: "C1" },
        { language: "मराठी", cefr: "A2" },
      ],
    },
  ],
  "en-IN": [
    {
      id: "en-in-engineer",
      text: `Priya Iyer
priya.iyer@example.com | +91 98765 43210 | Bengaluru
Experience
Software Engineer, Example Technologies 06/2019 - Present
- Built a payments service handling 2M transactions a day
- Led a team of 4 engineers
Education
B.E. Computer Science, Anna University 2015 - 2019
Class XII, Kendriya Vidyalaya 2015
Skills
Java, Spring Boot, Kafka`,
      locale: { languages: [], region: "IN" },
      name: "Priya Iyer",
      email: "priya.iyer@example.com",
      phone: "+91 98765 43210",
      roles: [
        {
          title: "Software Engineer",
          employer: "Example Technologies",
          start: "2019-06",
          current: true,
          end: "",
        },
      ],
      education: [
        { school: "Anna University", isced: 6, credential: "B.E." },
        { school: "Kendriya Vidyalaya", isced: 3, credential: "Class XII" },
      ],
      skills: ["Java", "Spring Boot", "Kafka"],
    },
    {
      id: "en-in-national-phone",
      text: `Arjun Nair
arjun.nair@example.com | 98765 43210
Professional Experience
Senior Analyst | Sample Finance Ltd | 01/04/2018 - Present
- Reduced month-end close from 10 days to 4
Analyst, Example Bank 15/07/2015 - 31/03/2018
- Automated 12 reconciliation reports
Education
MBA, Example Institute of Management 2013 - 2015
B.Com, Sample College 2010 - 2013
Skills
Excel, SQL, Tally`,
      locale: { languages: [], region: null },
      name: "Arjun Nair",
      email: "arjun.nair@example.com",
      phone: "98765 43210",
      roles: [
        {
          title: "Senior Analyst",
          employer: "Sample Finance Ltd",
          start: "2018-04",
          current: true,
          end: "",
        },
        {
          title: "Analyst",
          employer: "Example Bank",
          start: "2015-07",
          current: false,
          end: "2018-03",
        },
      ],
      education: [
        { school: "Example Institute of Management", isced: 7, credential: "MBA" },
        // B.Com is an Indian credential: without the IN region (no +91, nothing else saying
        // India) its level is not read. A host that knows the country passes `region`. The
        // credential is labelled as written, so the bench counts it until it is read.
        { school: "Sample College", isced: null, credential: "B.Com" },
      ],
      skills: ["Excel", "SQL", "Tally"],
    },
  ],
};
