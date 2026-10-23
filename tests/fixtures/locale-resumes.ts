/**
 * Synthetic resumes per locale (invented people and companies) with the fields an ATS should
 * recover. `tests/locales.test.ts` holds each set to the field-accuracy target; a contributor
 * extends it when improving a pack (see LOCALES.md).
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

export const LOCALE_FIXTURES: Record<
  "en" | "en-GB" | "de" | "fr" | "hi" | "en-IN" | "es" | "pt",
  LocaleFixture[]
> = {
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
  fr: [
    {
      id: "fr-accents",
      text: `Élodie Lefèvre
elodie.lefevre@example.fr | +33 6 12 34 56 78 | Lyon
Profil
Ingénieure logiciel spécialisée dans les plateformes de paiement, avec huit ans d'expérience.
Expérience professionnelle
Ingénieure logiciel senior chez Exemple Paiements SAS    janv. 2021 – aujourd’hui
• Conception d'une plateforme de paiement pour deux millions de clients
• Encadrement d'une équipe de cinq développeurs et mise en place de l'intégration continue
Développeuse back-end, Démo Technologies SARL    03/2017 – 12/2020
• Développement des services de facturation en Java et Spring Boot
Formation
Master Informatique, Université de Lyon    2015 – 2017
Licence Informatique, Université de Lyon    2012 – 2015
Compétences
Java, Go, Kubernetes, PostgreSQL
Langues
Français (langue maternelle), Anglais (courant, C1), Espagnol (notions)`,
      locale: { languages: ["fr"], region: "FR" },
      name: "Élodie Lefèvre",
      email: "elodie.lefevre@example.fr",
      phone: "+33 6 12 34 56 78",
      roles: [
        {
          title: "Ingénieure logiciel senior",
          employer: "Exemple Paiements SAS",
          start: "2021-01",
          current: true,
          end: "",
        },
        {
          title: "Développeuse back-end",
          employer: "Démo Technologies SARL",
          start: "2017-03",
          current: false,
          end: "2020-12",
        },
      ],
      education: [
        { school: "Université de Lyon", isced: 7, credential: "Master" },
        { school: "Université de Lyon", isced: 6, credential: "Licence" },
      ],
      skills: ["Java", "Go", "Kubernetes", "PostgreSQL"],
      spokenLanguages: [
        { language: "Français", cefr: "C2" },
        { language: "Anglais", cefr: "C1" },
        { language: "Espagnol", cefr: "A2" },
      ],
    },
    {
      id: "fr-ingenieur",
      text: `Thomas Girard
thomas.girard@example.fr
+33 1 23 45 67 89
Expérience professionnelle
Exemple Énergie SA
Ingénieur données
Depuis mars 2022
• Mise en place d'un entrepôt de données sur Snowflake pour 40 équipes
• Réduction de 30 % du coût des traitements nocturnes
Modèle Conseil
Consultant data
Septembre 2018 à février 2022
• Développement de tableaux de bord sous Power BI pour des clients industriels
Formation
Diplôme d'ingénieur (Bac+5), École Centrale d'Exemple    2015 – 2018
Baccalauréat S, Lycée Victor Exemple    2013
Certifications
AWS Certified Solutions Architect – Associate, Amazon Web Services, 2023
Compétences
Python, SQL, Snowflake, Power BI`,
      locale: { languages: ["fr"], region: "FR" },
      name: "Thomas Girard",
      email: "thomas.girard@example.fr",
      phone: "+33 1 23 45 67 89",
      roles: [
        {
          title: "Ingénieur données",
          employer: "Exemple Énergie SA",
          start: "2022-03",
          current: true,
          end: "",
        },
        {
          title: "Consultant data",
          employer: "Modèle Conseil",
          start: "2018-09",
          current: false,
          end: "2022-02",
        },
      ],
      education: [
        { school: "École Centrale d'Exemple", isced: 7, credential: "Diplôme d'ingénieur" },
        { school: "Lycée Victor Exemple", isced: 3, credential: "Baccalauréat S" },
      ],
      skills: ["Python", "SQL", "Snowflake", "Power BI"],
      certifications: [
        {
          name: "AWS Certified Solutions Architect – Associate",
          issuer: "Amazon Web Services",
          date: "2023",
          expires: "",
        },
      ],
    },
    {
      id: "fr-plain",
      text: `Karim Benali
karim.benali@example.com | 06 12 34 56 78 | Toulouse
Competences
Linux, Ansible, Docker, Bash
Experience professionnelle
Administrateur systemes et reseaux, Exemple Hebergement SARL    fevr. 2019 - present
- Gestion d'un parc de 300 serveurs Linux pour les clients de l'entreprise
- Automatisation des deploiements avec Ansible
Technicien support chez Demo Services    2016 - 2019
- Assistance aux utilisateurs et gestion des incidents
Formation
DUT Reseaux et Telecommunications, IUT de Toulouse    2014 - 2016
BTS SIO, Lycee Jean Exemple    2012 - 2014
Langues
Anglais : professionnel (B2) ; Arabe : bilingue`,
      locale: { languages: ["fr"], region: "FR" },
      name: "Karim Benali",
      email: "karim.benali@example.com",
      phone: "06 12 34 56 78",
      roles: [
        {
          title: "Administrateur systemes et reseaux",
          employer: "Exemple Hebergement SARL",
          start: "2019-02",
          current: true,
          end: "",
        },
        {
          title: "Technicien support",
          employer: "Demo Services",
          start: "2016",
          current: false,
          end: "2019",
        },
      ],
      education: [
        { school: "IUT de Toulouse", isced: 5, credential: "DUT" },
        { school: "Lycee Jean Exemple", isced: 5, credential: "BTS" },
      ],
      skills: ["Linux", "Ansible", "Docker", "Bash"],
      spokenLanguages: [
        { language: "Anglais", cefr: "B2" },
        { language: "Arabe", cefr: "C1" },
      ],
    },
  ],
  "en-GB": [
    {
      id: "en-gb-first-class",
      text: `Charlotte Davies
charlotte.davies@example.co.uk | +44 7400 123456 | Bristol
Personal Statement
Civil engineer with seven years on rail and highway schemes across the South West.
Employment History
Senior Civil Engineer, Severn Rail Partners Ltd    03/2021 – Present
- Led the design of a 4 km rail realignment delivered £2m under budget
- Managed a team of 6 engineers and 2 apprentices
Graduate Civil Engineer, Avonmouth Consulting LLP    09/2017 – 02/2021
- Produced drainage designs for 12 highway schemes
Education
University of Bath, MEng Civil Engineering, First-class honours, 2017
Clifton Sixth Form College, A-levels: Maths (A*), Physics (A), Chemistry (A), 2013
Skills
AutoCAD, Civil 3D, Revit, Eurocodes`,
      locale: { languages: [], region: "GB" },
      name: "Charlotte Davies",
      email: "charlotte.davies@example.co.uk",
      phone: "+44 7400 123456",
      roles: [
        {
          title: "Senior Civil Engineer",
          employer: "Severn Rail Partners Ltd",
          start: "2021-03",
          current: true,
          end: "",
        },
        {
          title: "Graduate Civil Engineer",
          employer: "Avonmouth Consulting LLP",
          start: "2017-09",
          current: false,
          end: "2021-02",
        },
      ],
      education: [
        { school: "University of Bath", isced: 7, credential: "MEng" },
        { school: "Clifton Sixth Form College", isced: 3, credential: "A-levels" },
      ],
      skills: ["AutoCAD", "Civil 3D", "Revit", "Eurocodes"],
    },
    {
      // Day-first dates no day over 12 settles: read in the UK's order, 01/09/2019 is September.
      id: "en-gb-stacked-day-first",
      text: `Rhys Morgan
rhys.morgan@example.com
+44 20 7946 0123
Cardiff
Experience
Network Engineer
Dragon Telecom plc
01/09/2019 - Present
- Upgraded the core network across 40 sites with no unplanned downtime
- Automated switch configuration with Python and Ansible
IT Support Technician
Valleys College
04/07/2016 - 02/08/2019
- Supported 900 staff and students across three campuses
Education
Cardiff Metropolitan University
BSc (Hons) Computer Networks, 2:1, 2016
HND Computing, Coleg Exemplar, 2014
GCSEs: 9 subjects including English and Maths, Exemplar Academy, 2010
Certifications
Cisco Certified Network Associate (CCNA), Cisco, 2020
Skills
Cisco IOS, Python, Ansible, Linux`,
      locale: { languages: [], region: "GB" },
      name: "Rhys Morgan",
      email: "rhys.morgan@example.com",
      phone: "+44 20 7946 0123",
      roles: [
        {
          title: "Network Engineer",
          employer: "Dragon Telecom plc",
          start: "2019-09",
          current: true,
          end: "",
        },
        {
          title: "IT Support Technician",
          employer: "Valleys College",
          start: "2016-07",
          current: false,
          end: "2019-08",
        },
      ],
      education: [
        { school: "Cardiff Metropolitan University", isced: 6, credential: "BSc" },
        { school: "Coleg Exemplar", isced: 5, credential: "HND" },
        { school: "Exemplar Academy", isced: 2, credential: "GCSEs" },
      ],
      skills: ["Cisco IOS", "Python", "Ansible", "Linux"],
      certifications: [
        {
          name: "Cisco Certified Network Associate (CCNA)",
          issuer: "Cisco",
          date: "2020",
          expires: "",
        },
      ],
    },
    {
      // Degree classes, on the degree's line and on a line of their own, are no credential.
      id: "en-gb-degree-classes",
      text: `Priya Patel
priya.patel@example.co.uk | +44 117 496 0789 | Bristol
Experience
Teaching Assistant, Exemplar Primary School, 01/09/2019 - 31/07/2021
Education
BA (Hons) History, Upper Second Class Honours, University of York, 2015
BSc Economics – 2:2 – University of Leeds – 2014
First Class Honours
PGCE Primary, University of Bristol, 2016
HNC Engineering, Bristol College, 2012
AS-levels: French, German, 2010
Scottish Highers, Exemplar Academy, 2009
Skills
Safeguarding, Phonics`,
      locale: { languages: [], region: "GB" },
      name: "Priya Patel",
      email: "priya.patel@example.co.uk",
      phone: "+44 117 496 0789",
      roles: [
        {
          title: "Teaching Assistant",
          employer: "Exemplar Primary School",
          start: "2019-09",
          current: false,
          end: "2021-07",
        },
      ],
      education: [
        { school: "University of York", isced: 6, credential: "BA" },
        { school: "University of Leeds", isced: 6, credential: "BSc" },
        { school: "University of Bristol", isced: 7, credential: "PGCE" },
        { school: "Bristol College", isced: 5, credential: "HNC" },
        { school: "", isced: 3, credential: "AS-levels" },
        { school: "Exemplar Academy", isced: 3, credential: "Highers" },
      ],
      skills: ["Safeguarding", "Phonics"],
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
        // B.Com is an Indian credential: its level is read only with the IN region (a host passes `region`).
        { school: "Sample College", isced: null, credential: "B.Com" },
      ],
      skills: ["Excel", "SQL", "Tally"],
    },
  ],
  es: [
    {
      id: "es-backend",
      text: `Lucía Fernández Ruiz
lucia.fernandez@example.es | +34 612 345 678 | Madrid
Perfil
Ingeniera de software con siete años de experiencia en sistemas de pago y en la nube.
Experiencia profesional
Ingeniera de software sénior, Ejemplo Tecnología S.L.    enero 2021 – actualidad
• Diseño de una plataforma de pagos para dos millones de clientes en España
• Responsable de un equipo de seis personas y de la integración continua
Ingeniera de software, Muestra Sistemas S.A.    03/2017 – 12/2020
• Desarrollo de servicios REST en Java para la gestión de pedidos
Formación
Máster en Ingeniería de Software, Universidad de Ejemplo    2015 – 2017
Grado en Ingeniería Informática, Universidad de Ejemplo    2011 – 2015
Habilidades
Go, Java, Kubernetes, PostgreSQL
Idiomas
Español (nativo), Inglés (avanzado, C1), Francés (básico)`,
      locale: { languages: ["es"], region: "ES" },
      name: "Lucía Fernández Ruiz",
      email: "lucia.fernandez@example.es",
      phone: "+34 612 345 678",
      roles: [
        {
          title: "Ingeniera de software sénior",
          employer: "Ejemplo Tecnología S.L.",
          start: "2021-01",
          current: true,
          end: "",
        },
        {
          title: "Ingeniera de software",
          employer: "Muestra Sistemas S.A.",
          start: "2017-03",
          current: false,
          end: "2020-12",
        },
      ],
      education: [
        { school: "Universidad de Ejemplo", isced: 7, credential: "Máster" },
        { school: "Universidad de Ejemplo", isced: 6, credential: "Grado" },
      ],
      skills: ["Go", "Java", "Kubernetes", "PostgreSQL"],
      spokenLanguages: [
        { language: "Español", cefr: "C2" },
        { language: "Inglés", cefr: "C1" },
        { language: "Francés", cefr: "A2" },
      ],
    },
    {
      id: "es-analista",
      text: `Carlos Méndez Ortega
carlos.mendez@example.com.mx | +52 55 1234 5678 | Ciudad de México
Resumen profesional
Analista de datos con cinco años de experiencia en el sector financiero.
Experiencia laboral
Analista de datos sénior | Banco Ejemplo S.A. de C.V. | 02/2022 – presente
• Desarrollo de tableros en Power BI para el área de riesgos
• Automatización de reportes mensuales con Python y SQL
Analista de datos | Muestra Seguros | 06/2019 – 01/2022
• Elaboración de modelos de predicción de cancelaciones
Educación
Licenciatura en Actuaría, Universidad Nacional de Ejemplo, 2019
Certificaciones
Power BI Data Analyst Associate, Microsoft, 2023
Conocimientos técnicos
Python, SQL, Power BI, Excel`,
      locale: { languages: ["es"], region: "ES" },
      name: "Carlos Méndez Ortega",
      email: "carlos.mendez@example.com.mx",
      phone: "+52 55 1234 5678",
      roles: [
        {
          title: "Analista de datos sénior",
          employer: "Banco Ejemplo S.A. de C.V.",
          start: "2022-02",
          current: true,
          end: "",
        },
        {
          title: "Analista de datos",
          employer: "Muestra Seguros",
          start: "2019-06",
          current: false,
          end: "2022-01",
        },
      ],
      education: [
        { school: "Universidad Nacional de Ejemplo", isced: 6, credential: "Licenciatura" },
      ],
      skills: ["Python", "SQL", "Power BI", "Excel"],
      certifications: [
        { name: "Power BI Data Analyst Associate", issuer: "Microsoft", date: "2023", expires: "" },
      ],
    },
    {
      id: "es-practicas",
      text: `Pablo Navarro Gil
pablo.navarro@example.es
612 345 789
Valencia
Experiencia
Becario de desarrollo web
Muestra Digital S.L.
sept. 2023 – feb. 2024
• Desarrollé componentes en React para la tienda en línea
• Mejoré el tiempo de carga de la página principal en un 40 %
Formación académica
Grado en Ingeniería Informática
Universidad de Valcourt
2020 – 2024
Bachillerato
Instituto de Educación Secundaria Ejemplo
2018 – 2020
Habilidades
JavaScript, React, Node.js, Git`,
      locale: { languages: ["es"], region: "ES" },
      name: "Pablo Navarro Gil",
      email: "pablo.navarro@example.es",
      phone: "612 345 789",
      roles: [
        {
          title: "Becario de desarrollo web",
          employer: "Muestra Digital S.L.",
          start: "2023-09",
          current: false,
          end: "2024-02",
        },
      ],
      education: [
        { school: "Universidad de Valcourt", isced: 6, credential: "Grado" },
        {
          school: "Instituto de Educación Secundaria Ejemplo",
          isced: 3,
          credential: "Bachillerato",
        },
      ],
      skills: ["JavaScript", "React", "Node.js", "Git"],
    },
  ],
  pt: [
    {
      id: "pt-backend",
      text: `Ana Paula Ribeiro
ana.ribeiro@example.com.br | +55 11 98765-4321 | São Paulo, SP
Resumo profissional
Engenheira de software com oito anos de experiência em sistemas de pagamento.
Experiência profissional
Engenheira de software sênior, Exemplo Pagamentos Ltda.    jan. 2021 – atual
• Desenvolvimento de uma plataforma de pagamentos para dois milhões de clientes
• Liderança de uma equipe de cinco desenvolvedores
Desenvolvedora back-end, Amostra Tecnologia S.A.    03/2017 – 12/2020
• Implementação de serviços REST em Java e Spring Boot
Formação acadêmica
Mestrado em Ciência da Computação, Universidade de Exemplo    2015 – 2017
Bacharelado em Sistemas de Informação, Universidade de Exemplo    2011 – 2014
Habilidades
Java, Go, Kubernetes, PostgreSQL
Idiomas
Português (nativo), Inglês (avançado), Espanhol (intermediário)`,
      locale: { languages: ["pt"], region: "BR" },
      name: "Ana Paula Ribeiro",
      email: "ana.ribeiro@example.com.br",
      phone: "+55 11 98765-4321",
      roles: [
        {
          title: "Engenheira de software sênior",
          employer: "Exemplo Pagamentos Ltda",
          start: "2021-01",
          current: true,
          end: "",
        },
        {
          title: "Desenvolvedora back-end",
          employer: "Amostra Tecnologia S.A.",
          start: "2017-03",
          current: false,
          end: "2020-12",
        },
      ],
      education: [
        { school: "Universidade de Exemplo", isced: 7, credential: "Mestrado" },
        { school: "Universidade de Exemplo", isced: 6, credential: "Bacharelado" },
      ],
      skills: ["Java", "Go", "Kubernetes", "PostgreSQL"],
      spokenLanguages: [
        { language: "Português", cefr: "C2" },
        { language: "Inglês", cefr: "C1" },
        { language: "Espanhol", cefr: "B1" },
      ],
    },
    {
      id: "pt-analista",
      text: `Rafael Costa Lima
rafael.lima@example.com.br | (21) 99876-5432 | Rio de Janeiro, RJ
Experiência
Analista de dados | Banco Amostra S.A. | 02/2022 – o momento
• Criação de painéis no Power BI para a área de crédito
• Automação de relatórios mensais com Python e SQL
Analista de BI júnior | Exemplo Varejo Ltda. | 06/2019 – 01/2022
• Elaboração de modelos de previsão de vendas
Formação
Graduação em Estatística, Universidade Federal de Exemplo, 2019
Certificações
Power BI Data Analyst Associate, Microsoft, 2023
Conhecimentos
Python, SQL, Power BI, Excel`,
      locale: { languages: ["pt"], region: "BR" },
      name: "Rafael Costa Lima",
      email: "rafael.lima@example.com.br",
      phone: "(21) 99876-5432",
      roles: [
        {
          title: "Analista de dados",
          employer: "Banco Amostra S.A.",
          start: "2022-02",
          current: true,
          end: "",
        },
        {
          title: "Analista de BI júnior",
          employer: "Exemplo Varejo Ltda",
          start: "2019-06",
          current: false,
          end: "2022-01",
        },
      ],
      education: [{ school: "Universidade Federal de Exemplo", isced: 6, credential: "Graduação" }],
      skills: ["Python", "SQL", "Power BI", "Excel"],
      certifications: [
        { name: "Power BI Data Analyst Associate", issuer: "Microsoft", date: "2023", expires: "" },
      ],
    },
    {
      id: "pt-estagio",
      text: `Beatriz Almeida Santos
beatriz.santos@example.com.br
+55 31 98888-7777
Belo Horizonte
Estágios
Estagiária de desenvolvimento
Amostra Digital Ltda.
ago. 2023 – fev. 2024
• Desenvolvi componentes em React para a loja virtual
• Melhorei o tempo de carregamento da página inicial em 40%
Formação
Tecnólogo em Análise e Desenvolvimento de Sistemas
Faculdade de Tecnologia Exemplo
2021 – 2023
Ensino médio
Colégio Estadual Exemplo
2018 – 2020
Habilidades
JavaScript, React, Node.js, Git`,
      locale: { languages: ["pt"], region: "BR" },
      name: "Beatriz Almeida Santos",
      email: "beatriz.santos@example.com.br",
      phone: "+55 31 98888-7777",
      roles: [
        {
          title: "Estagiária de desenvolvimento",
          employer: "Amostra Digital Ltda",
          start: "2023-08",
          current: false,
          end: "2024-02",
        },
      ],
      education: [
        { school: "Faculdade de Tecnologia Exemplo", isced: 6, credential: "Tecnólogo" },
        { school: "Colégio Estadual Exemplo", isced: 3, credential: "Ensino médio" },
      ],
      skills: ["JavaScript", "React", "Node.js", "Git"],
    },
  ],
};

// A resume in a language the engine recognises but has no pack for. Invented people.
export const SPANISH_RESUME = `Lucía Fernández Ruiz
lucia.fernandez@example.es | +34 612 345 678 | Madrid
Perfil
Ingeniera de software con siete años de experiencia en sistemas de pago y en la nube.
Experiencia profesional
Ingeniera de software sénior, Ejemplo Tecnología S.L.    enero 2021 – actualidad
• Diseño de una plataforma de pagos para dos millones de clientes en España
• Responsable de un equipo de seis personas y de la integración continua
• Reducción del tiempo de despliegue de dos horas a diez minutos
Ingeniera de software, Muestra Sistemas S.A.    03/2017 – 12/2020
• Desarrollo de servicios REST en Java para la gestión de pedidos
• Migración de la base de datos a PostgreSQL sin pérdida de servicio
Formación
Grado en Ingeniería Informática, Universidad de Ejemplo, 2017
Habilidades
Go, Java, Kubernetes, PostgreSQL`;

export const RUSSIAN_RESUME = `Анна Петрова
anna.petrova@example.ru | +7 912 345 67 89 | Москва
Опыт работы
Ведущий разработчик, ООО «Пример»    январь 2021 – настоящее время
• Разработка платёжной платформы на Go для двух миллионов клиентов
• Руководство командой из пяти разработчиков
Разработчик, АО «Образец»    03/2017 – 12/2020
• Разработка сервисов на Java для обработки заказов
Образование
Бакалавр информатики, Московский университет, 2017
Навыки
Go, Java, Kubernetes, PostgreSQL`;

export const ITALIAN_RESUME = `Giulia Rossi
giulia.rossi@example.it | +39 333 123 4567 | Milano
Profilo
Ingegnere del software con sette anni di esperienza nei sistemi di pagamento e nel cloud.
Esperienza professionale
Ingegnere del software senior, Esempio Tecnologie S.r.l.    gennaio 2021 – oggi
• Progettazione di una piattaforma di pagamenti per due milioni di clienti
• Responsabile di un team di sei persone e della integrazione continua
Istruzione
Laurea in Ingegneria Informatica, Università degli Studi di Esempio, 2017
Competenze
Go, Java, Kubernetes, PostgreSQL`;
