/**
 * Seeded synthetic resumes for `npm run bench`, labelled from the inputs they are written from,
 * never from what the engine reads. People, employers and schools are invented. Layout varies as
 * real resumes do (header joins, date and city placement, date format, heading synonyms, section
 * order, bullet). Each is rendered as text, a one-column PDF with flush-right dates, a two-column
 * PDF with a sidebar, and a DOCX.
 *
 * Deterministic per seed. Changing a list or the draw order changes every resume, so redo
 * bench/baseline.json.
 *
 * The same people and layouts in German, French and Hindi (`generateResumes(n, seed, "de")`):
 * each language's own headings, months, date forms, "present" words, titles, employers, schools,
 * degrees, bullets and phone numbers, written as people in that language write them, not as the
 * engine's packs happen to read them, so the bench measures the packs. English draws exactly as
 * before.
 */
import { extractResume } from "../../src/node/extract.js";
import { buildDocx } from "./buildDocx.js";
import { buildPdfPages, text, unicodeFont } from "./buildPdf.js";
import type { LocaleFixture } from "./locale-resumes.js";

export type Rendering = "text" | "pdf" | "pdf-2col" | "docx";
export const RENDERINGS: readonly Rendering[] = ["text", "pdf", "pdf-2col", "docx"];

/** One printed line. `right`, when present, is what a PDF sets flush right. */
type Line = {
  left: string;
  right?: string;
  glue?: string;
  /** Header lines that hold several details; a sidebar sets each on its own line. */
  parts?: string[];
};
type Block = {
  kind: "experience" | "education" | "skills" | "certifications" | "summary";
  heading: string;
  lines: Line[];
  /** The same entries as a narrow sidebar sets them: a line per detail, so a wrap splits no name. */
  narrow?: Line[];
};

export type GeneratedResume = LocaleFixture & {
  /** The name, contact lines and sections, in page order, for the renderers. */
  header: Line[];
  blocks: Block[];
};

/** mulberry32: a 32-bit seeded generator, small and good enough to vary a layout. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Maya",
  "Jonas",
  "Priya",
  "Tomas",
  "Elena",
  "Marcus",
  "Leila",
  "Owen",
  "Sofia",
  "Daniel",
  "Nadia",
  "Felix",
];
const LAST = [
  "Alvarez",
  "Brandt",
  "Chowdhury",
  "Donovan",
  "Eriksen",
  "Farouk",
  "Grayson",
  "Holloway",
  "Ibarra",
  "Jansen",
  "Kowalski",
  "Lindqvist",
];
const EMPLOYERS = [
  "Lakeside Retail",
  "Brightwave Labs",
  "Harborview Health",
  "Copperline Systems",
  "Stonebridge Logistics",
  "Fernhill Analytics",
  "Ironwood Media",
  "Redcrest Energy",
  "Bluepine Software",
  "Summit Ridge Bank",
  "Oakmont Foods",
  "Tidewater Robotics",
  "Quarry Lane Studios",
  "Alder Point Insurance",
];
const SUFFIXES = ["", "", "", " Ltd", " Inc"];
const TITLES = [
  "Software Engineer",
  "Senior Software Engineer",
  "Data Analyst",
  "Product Manager",
  "Project Manager",
  "Systems Administrator",
  "Business Analyst",
  "Operations Manager",
  "UX Designer",
  "DevOps Engineer",
  "Marketing Manager",
  "Solutions Architect",
];
const SCHOOLS = [
  "Eastbrook University",
  "University of Lakemont",
  "Pinecrest Institute of Technology",
  "Westfield State University",
  "University of Northgate",
  "Marlow University",
];
const DEGREES = [
  { credential: "B.S.", field: "Computer Science", isced: 6 },
  { credential: "BSc", field: "Economics", isced: 6 },
  { credential: "Bachelor of Science", field: "Statistics", isced: 6 },
  { credential: "B.A.", field: "Business Administration", isced: 6 },
  { credential: "M.S.", field: "Data Science", isced: 7 },
  { credential: "Master of Science", field: "Information Systems", isced: 7 },
  { credential: "Master of Arts", field: "Public Policy", isced: 7 },
];
const CITIES: Array<[string, string]> = [
  ["Denver", "CO"],
  ["Austin", "TX"],
  ["Portland", "OR"],
  ["Madison", "WI"],
  ["Raleigh", "NC"],
  ["Tucson", "AZ"],
];
const SKILLS = [
  "Python",
  "SQL",
  "Kubernetes",
  "Terraform",
  "TypeScript",
  "PostgreSQL",
  "Tableau",
  "Excel",
  "Docker",
  "Figma",
  "Airflow",
  "Kafka",
  "Salesforce",
  "Jira",
];
const CERTS = [
  { name: "AWS Certified Cloud Practitioner", issuer: "Amazon Web Services" },
  { name: "Certified Scrum Master", issuer: "Scrum Alliance" },
  { name: "Project Management Professional (PMP)", issuer: "PMI" },
  { name: "Google Data Analytics Professional Certificate", issuer: "Coursera" },
];
const BULLETS = [
  "Built the reporting pipeline that twelve teams rely on every week",
  "Cut the monthly close from ten days to four by automating reconciliations",
  "Led a team of five through a migration to a new platform",
  "Introduced code review and release checklists across the group",
  "Reduced support tickets by a quarter with a self-service dashboard",
  "Negotiated vendor contracts that saved six figures a year",
  "Mentored three junior colleagues into their first promotion",
  "Ran weekly planning with design, sales and operations",
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEADINGS = {
  experience: [
    "Experience",
    "Work Experience",
    "Professional Experience",
    "Employment History",
    "Relevant Experience",
  ],
  education: ["Education", "Educational Background", "Academic Background"],
  skills: ["Skills", "Technical Skills", "Core Competencies", "Technologies"],
  certifications: ["Certifications", "Licenses & Certifications"],
  summary: ["Summary", "Profile"],
};

export type GeneratedLanguage = "en" | "de" | "fr" | "hi" | "es" | "pt";

/** What a resume is written with, per language. English is the original set. */
type Vocabulary = {
  first: readonly string[];
  last: readonly string[];
  /** The name as an email address or profile URL spells it. */
  ascii: (name: string) => string;
  domain: string;
  areas: readonly string[];
  /** Three ways to write a number, from an area and a three-digit line. */
  phones: (area: string, line: string) => string[];
  cities: readonly string[];
  employers: readonly string[];
  suffixes: readonly string[];
  titles: readonly string[];
  schools: readonly string[];
  degrees: ReadonlyArray<{ credential: string; field: string; isced: number }>;
  /** Between a long credential and its field: "Master of Science in Statistics". */
  studyJoin: string;
  skills: readonly string[];
  certs: ReadonlyArray<{ name: string; issuer: string }>;
  issued: string;
  expires: string;
  validUntil: (year: number) => string;
  bullets: readonly string[];
  months: readonly string[];
  dateForms: readonly DateForm[];
  rangeWords: readonly string[];
  currentWords: readonly string[];
  /** "Engineer at Acme"; empty where the language puts a comma there. */
  at: string;
  headings: typeof HEADINGS;
  summary: string;
  region: string | null;
};

/**
 * How a job's title, employer and dates (`right`, with the city when it goes there) are set: on
 * one line, joined by a separator, the dates flush right; or on lines of their own.
 */
type RoleStyle = (
  title: string,
  employer: string,
  right: string,
  city: string,
  at: string,
) => Line[];
/** The employer with the city flush right, then the title with the dates flush right. */
const EMPLOYER_CITY_THEN_TITLE_DATES: RoleStyle = (title, employer, dates, city) => [
  { left: employer, right: city, glue: "\t" },
  { left: title, right: dates, glue: "\t" },
];
const ROLE_STYLES: readonly RoleStyle[] = [
  (title, employer, right) => [{ left: `${title} | ${employer}`, right, glue: " | " }],
  (title, employer, right) => [{ left: `${title}, ${employer}`, right, glue: "    " }],
  (title, employer, right) => [{ left: `${title} — ${employer}`, right, glue: " — " }],
  (title, employer, right, _city, at) => [
    { left: at ? `${title} ${at} ${employer}` : `${title}, ${employer}`, right, glue: ", " },
  ],
  (title, employer, right) => [{ left: `${title}\t${employer}`, right, glue: "\t" }],
  (title, employer, right) => [{ left: `${employer} | ${title}`, right, glue: " | " }],
  (title, employer, right) => [{ left: `${employer} — ${title}`, right, glue: " — " }],
  (title, employer, right) => [{ left: employer }, { left: title }, { left: right }],
  (title, employer, right) => [{ left: title }, { left: employer }, { left: right }],
  EMPLOYER_CITY_THEN_TITLE_DATES,
];

type Ym = { year: number; month: number };
type DateForm = "mon" | "monde" | "monslash" | "slash" | "iso" | "dot" | "year";

const EN: Vocabulary = {
  first: FIRST,
  last: LAST,
  ascii: (name) => name,
  domain: "example.com",
  areas: ["415", "212", "206", "312", "617"],
  phones: (area, line) => [
    `+1 ${area} 555 0${line}`,
    `(${area}) 555-0${line}`,
    `${area}-555-0${line}`,
  ],
  cities: CITIES.map(([town, state]) => `${town}, ${state}`),
  employers: EMPLOYERS,
  suffixes: SUFFIXES,
  titles: TITLES,
  schools: SCHOOLS,
  degrees: DEGREES,
  studyJoin: " in ",
  skills: SKILLS,
  certs: CERTS,
  issued: "Issued",
  expires: "Expires",
  validUntil: (year) => `expires ${year}`,
  bullets: BULLETS,
  months: MONTHS,
  dateForms: ["mon", "mon", "slash", "iso", "year"],
  rangeWords: [" – ", " - ", " to "],
  currentWords: ["Present", "Current"],
  at: "at",
  headings: HEADINGS,
  summary: "Dependable professional with a record of steady delivery.",
  region: null,
};

/** German umlauts and French accents as an address spells them: "Müller" → "mueller". */
const latin = (name: string) =>
  name
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

const DE: Vocabulary = {
  first: [
    "Lena",
    "Jonas",
    "Miriam",
    "Tobias",
    "Katrin",
    "Felix",
    "Sabine",
    "Moritz",
    "Jana",
    "Lukas",
    "Anja",
    "Niklas",
  ],
  last: [
    "Becker",
    "Hoffmann",
    "Krüger",
    "Schäfer",
    "Wagner",
    "Neumann",
    "Zimmermann",
    "Braun",
    "Hartmann",
    "Lange",
    "Vogel",
    "Fuchs",
  ],
  ascii: latin,
  domain: "example.de",
  areas: ["30", "40", "89", "69", "221"],
  phones: (area, line) => [
    `+49 ${area} 5550${line}`,
    `0${area} 5550${line}`,
    `+49 (0)${area} 5550${line}`,
  ],
  cities: ["Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main", "Leipzig"],
  employers: [
    "Nordlicht Software",
    "Rheinblick Logistik",
    "Alpenwerk Maschinenbau",
    "Elbtal Versicherung",
    "Hafenkante Medien",
    "Lindenhof Handel",
    "Bergquelle Energie",
    "Sonnenfeld Analytik",
    "Mainufer Bank",
    "Waldrand Robotik",
    "Ostwind Lebensmittel",
    "Kupferberg Systeme",
    "Talblick Gesundheit",
    "Seewiese Studios",
  ],
  suffixes: ["", " GmbH", " GmbH", " AG", " SE"],
  titles: [
    "Softwareentwickler",
    "Senior Softwareentwicklerin",
    "Datenanalyst",
    "Produktmanagerin",
    "Projektleiter",
    "Systemadministrator",
    "Business Analystin",
    "Leiter Betrieb",
    "UX-Designerin",
    "DevOps-Ingenieur",
    "Marketingmanagerin",
    "Lösungsarchitekt",
  ],
  schools: [
    "Universität Lindenberg",
    "Technische Hochschule Rheinau",
    "Hochschule Elbstadt",
    "Universität Nordhafen",
    "Technische Universität Bergtal",
    "Hochschule Sonnental",
  ],
  degrees: [
    { credential: "B.Sc.", field: "Informatik", isced: 6 },
    { credential: "B.A.", field: "Betriebswirtschaftslehre", isced: 6 },
    { credential: "Bachelor of Science", field: "Wirtschaftsinformatik", isced: 6 },
    { credential: "B.Eng.", field: "Maschinenbau", isced: 6 },
    { credential: "M.Sc.", field: "Data Science", isced: 7 },
    { credential: "Master of Science", field: "Informatik", isced: 7 },
    { credential: "M.A.", field: "Politikwissenschaft", isced: 7 },
  ],
  studyJoin: " in ",
  skills: [...SKILLS.slice(0, 13), "SAP"],
  certs: CERTS,
  issued: "Ausgestellt",
  expires: "Gültig bis",
  validUntil: (year) => `gültig bis ${year}`,
  bullets: [
    "Aufbau einer Reporting-Pipeline für zwölf Teams",
    "Verkürzung des Monatsabschlusses von zehn auf vier Tage durch automatisierte Abstimmungen",
    "Leitung eines fünfköpfigen Teams bei der Migration auf eine neue Plattform",
    "Einführung von Code-Reviews und Release-Checklisten in der Abteilung",
    "Senkung der Support-Anfragen um ein Viertel mit einem Self-Service-Dashboard",
    "Verhandlung von Lieferantenverträgen mit Einsparungen im sechsstelligen Bereich",
    "Betreuung von drei Nachwuchskräften bis zur ersten Beförderung",
    "Wöchentliche Planung mit Design, Vertrieb und Betrieb",
  ],
  months: [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ],
  dateForms: ["mon", "mon", "dot", "slash", "year"],
  rangeWords: [" – ", " - ", " bis "],
  currentWords: ["heute", "aktuell"],
  at: "bei",
  headings: {
    experience: [
      "Berufserfahrung",
      "Beruflicher Werdegang",
      "Praxiserfahrung",
      "Berufliche Erfahrung",
    ],
    education: ["Ausbildung", "Studium", "Bildungsweg"],
    skills: ["Kenntnisse", "IT-Kenntnisse", "Fähigkeiten", "Kompetenzen"],
    certifications: ["Zertifikate", "Weiterbildungen und Zertifikate"],
    summary: ["Profil", "Kurzprofil"],
  },
  summary: "Zuverlässige Fachkraft mit langjähriger Erfahrung in der Umsetzung von Projekten.",
  region: "DE",
};

const FR: Vocabulary = {
  first: [
    "Camille",
    "Julien",
    "Élodie",
    "Thomas",
    "Manon",
    "Nicolas",
    "Chloé",
    "Antoine",
    "Léa",
    "Mathieu",
    "Sophie",
    "Hugo",
  ],
  last: [
    "Martin",
    "Bernard",
    "Dubois",
    "Lefèvre",
    "Moreau",
    "Laurent",
    "Girard",
    "Roux",
    "Fontaine",
    "Chevalier",
    "Garnier",
    "Rousseau",
  ],
  ascii: latin,
  domain: "example.fr",
  areas: ["12", "23", "34", "45", "56"],
  phones: (area, line) => [
    `+33 6 ${area} 45 6${line[0]} ${line.slice(1)}`,
    `06 ${area} 45 6${line[0]} ${line.slice(1)}`,
    `+33 (0)6 ${area} 45 6${line[0]} ${line.slice(1)}`,
  ],
  cities: ["Paris", "Lyon", "Nantes", "Toulouse", "Bordeaux", "Lille"],
  employers: [
    "Ciel Bleu Logiciels",
    "Rive Gauche Logistique",
    "Mont Clair Santé",
    "Atelier Cuivre Systèmes",
    "Pierre Blanche Énergie",
    "Val Fleuri Analytique",
    "Bois Doré Médias",
    "Cap Horizon Banque",
    "Lumière Nord Assurances",
    "Marée Haute Robotique",
    "Champ Vert Alimentation",
    "Pont Levis Studios",
    "Colline Rouge Conseil",
    "Étoile Sud Technologies",
  ],
  suffixes: ["", " SA", " SAS", " SARL", ""],
  titles: [
    "Ingénieur logiciel",
    "Ingénieure logiciel senior",
    "Analyste de données",
    "Chef de produit",
    "Cheffe de projet",
    "Administrateur systèmes",
    "Analyste métier",
    "Responsable des opérations",
    "Designer UX",
    "Ingénieur DevOps",
    "Responsable marketing",
    "Architecte solutions",
  ],
  schools: [
    "Université de Valcourt",
    "École d'ingénieurs de Rivebelle",
    "Institut des sciences de Beaupré",
    "Université de Sainte-Aude",
    "École supérieure de commerce de Clairval",
    "Université du Mont-Fleuri",
  ],
  degrees: [
    { credential: "Licence", field: "Informatique", isced: 6 },
    { credential: "Licence professionnelle", field: "Développement web", isced: 6 },
    { credential: "Bachelor", field: "Commerce international", isced: 6 },
    { credential: "BUT", field: "Informatique", isced: 6 },
    { credential: "Master", field: "Science des données", isced: 7 },
    { credential: "Diplôme d'ingénieur", field: "Génie logiciel", isced: 7 },
    { credential: "Master", field: "Management", isced: 7 },
  ],
  studyJoin: " en ",
  skills: SKILLS,
  certs: CERTS,
  issued: "Obtenue en",
  expires: "Expire en",
  validUntil: (year) => `valable jusqu'en ${year}`,
  bullets: [
    "Mise en place de la chaîne de reporting utilisée chaque semaine par douze équipes",
    "Réduction de la clôture mensuelle de dix à quatre jours grâce à l'automatisation des rapprochements",
    "Encadrement d'une équipe de cinq personnes lors d'une migration vers une nouvelle plateforme",
    "Mise en place des revues de code et des listes de contrôle de livraison",
    "Baisse d'un quart des demandes de support grâce à un tableau de bord en libre-service",
    "Négociation de contrats fournisseurs avec une économie annuelle à six chiffres",
    "Accompagnement de trois collègues juniors jusqu'à leur première promotion",
    "Animation de la planification hebdomadaire avec le design, les ventes et les opérations",
  ],
  months: [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ],
  dateForms: ["mon", "mon", "slash", "slash", "year"],
  rangeWords: [" – ", " - ", " à "],
  currentWords: ["aujourd'hui", "présent"],
  at: "chez",
  headings: {
    experience: [
      "Expérience professionnelle",
      "Expériences professionnelles",
      "Parcours professionnel",
      "Expérience",
    ],
    education: ["Formation", "Formations", "Diplômes"],
    skills: ["Compétences", "Compétences techniques", "Outils"],
    certifications: ["Certifications", "Certificats"],
    summary: ["Profil", "Résumé"],
  },
  summary: "Professionnel fiable, habitué à mener des projets jusqu'au bout.",
  region: "FR",
};

/** Hindi names as an address spells them. */
const ROMAN: Record<string, string> = {
  राहुल: "rahul",
  प्रिया: "priya",
  अमित: "amit",
  नेहा: "neha",
  विकास: "vikas",
  अंजलि: "anjali",
  संजय: "sanjay",
  पूजा: "pooja",
  अर्जुन: "arjun",
  कविता: "kavita",
  रोहित: "rohit",
  सुनीता: "sunita",
  शर्मा: "sharma",
  वर्मा: "verma",
  गुप्ता: "gupta",
  सिंह: "singh",
  पटेल: "patel",
  जोशी: "joshi",
  मेहता: "mehta",
  अग्रवाल: "agarwal",
  कुमार: "kumar",
  यादव: "yadav",
  मिश्रा: "mishra",
  चौधरी: "chaudhary",
};

const HI: Vocabulary = {
  first: [
    "राहुल",
    "प्रिया",
    "अमित",
    "नेहा",
    "विकास",
    "अंजलि",
    "संजय",
    "पूजा",
    "अर्जुन",
    "कविता",
    "रोहित",
    "सुनीता",
  ],
  last: [
    "शर्मा",
    "वर्मा",
    "गुप्ता",
    "सिंह",
    "पटेल",
    "जोशी",
    "मेहता",
    "अग्रवाल",
    "कुमार",
    "यादव",
    "मिश्रा",
    "चौधरी",
  ],
  ascii: (name) => ROMAN[name] ?? name,
  domain: "example.in",
  areas: ["98765", "99887", "91234", "90011", "97654"],
  phones: (area, line) => [`+91 ${area} 5${line}0`, `0${area} 5${line}0`, `+91-${area}-5${line}0`],
  cities: ["नई दिल्ली", "मुंबई", "बेंगलुरु", "पुणे", "हैदराबाद", "चेन्नई"],
  employers: [
    "Sahyadri Systems",
    "Ganga Logistics",
    "Vindhya Analytics",
    "Kaveri Health",
    "Aravalli Software",
    "Narmada Energy",
    "Himgiri Media",
    "Konkan Retail",
    "Satpura Robotics",
    "Malabar Foods",
    "Godavari Bank",
    "Thar Insurance",
    "Nilgiri Studios",
    "Chambal Technologies",
  ],
  suffixes: ["", " Pvt Ltd", " Pvt Ltd", " Ltd", ""],
  titles: [
    "सॉफ्टवेयर इंजीनियर",
    "वरिष्ठ सॉफ्टवेयर इंजीनियर",
    "डेटा विश्लेषक",
    "उत्पाद प्रबंधक",
    "परियोजना प्रबंधक",
    "सिस्टम प्रशासक",
    "व्यवसाय विश्लेषक",
    "संचालन प्रबंधक",
    "यूएक्स डिज़ाइनर",
    "डेवऑप्स इंजीनियर",
    "विपणन प्रबंधक",
    "समाधान वास्तुकार",
  ],
  schools: [
    "सरस्वती प्रौद्योगिकी संस्थान",
    "पश्चिमी घाट विश्वविद्यालय",
    "नर्मदा तकनीकी विश्वविद्यालय",
    "हिमगिरि विश्वविद्यालय",
    "सतपुड़ा अभियांत्रिकी महाविद्यालय",
    "कावेरी विश्वविद्यालय",
  ],
  degrees: [
    { credential: "बी.टेक", field: "कंप्यूटर विज्ञान", isced: 6 },
    { credential: "बी.एससी.", field: "सांख्यिकी", isced: 6 },
    { credential: "बी.कॉम", field: "लेखा", isced: 6 },
    { credential: "बी.ए.", field: "अर्थशास्त्र", isced: 6 },
    { credential: "एम.टेक", field: "डेटा विज्ञान", isced: 7 },
    { credential: "एम.बी.ए.", field: "विपणन", isced: 7 },
    { credential: "एम.एससी.", field: "गणित", isced: 7 },
  ],
  studyJoin: " – ",
  skills: SKILLS,
  certs: CERTS,
  issued: "जारी:",
  expires: "समाप्ति:",
  validUntil: (year) => `${year} तक वैध`,
  bullets: [
    "बारह टीमों के लिए रिपोर्टिंग पाइपलाइन बनाई",
    "मासिक क्लोज़ को दस दिन से घटाकर चार दिन किया",
    "नए प्लेटफ़ॉर्म पर माइग्रेशन में पाँच लोगों की टीम का नेतृत्व किया",
    "पूरे समूह में कोड समीक्षा और रिलीज़ चेकलिस्ट शुरू की",
    "सेल्फ-सर्विस डैशबोर्ड से सहायता टिकट एक चौथाई कम किए",
    "विक्रेता अनुबंधों पर बातचीत कर हर साल लाखों रुपये बचाए",
    "तीन जूनियर सहयोगियों को उनकी पहली पदोन्नति तक मार्गदर्शन दिया",
    "डिज़ाइन, बिक्री और संचालन टीमों के साथ साप्ताहिक योजना चलाई",
  ],
  months: [
    "जनवरी",
    "फ़रवरी",
    "मार्च",
    "अप्रैल",
    "मई",
    "जून",
    "जुलाई",
    "अगस्त",
    "सितंबर",
    "अक्टूबर",
    "नवंबर",
    "दिसंबर",
  ],
  dateForms: ["mon", "mon", "slash", "slash", "year"],
  rangeWords: [" – ", " - ", " से "],
  currentWords: ["वर्तमान", "अब तक"],
  at: "",
  headings: {
    experience: ["कार्य अनुभव", "अनुभव", "पेशेवर अनुभव"],
    education: ["शिक्षा", "शैक्षणिक योग्यता"],
    skills: ["कौशल", "तकनीकी कौशल"],
    certifications: ["प्रमाणपत्र", "प्रमाणन"],
    summary: ["सारांश", "परिचय"],
  },
  summary: "परियोजनाओं को समय पर पूरा करने का अनुभव रखने वाला भरोसेमंद पेशेवर।",
  region: "IN",
};

const ES_V: Vocabulary = {
  first: [
    "Lucía",
    "Javier",
    "Marta",
    "Diego",
    "Carmen",
    "Pablo",
    "Elena",
    "Andrés",
    "Laura",
    "Sergio",
    "Paula",
    "Miguel",
  ],
  last: [
    "García",
    "Martínez",
    "López",
    "Sánchez",
    "Romero",
    "Navarro",
    "Torres",
    "Ramírez",
    "Molina",
    "Ortega",
    "Castro",
    "Herrera",
  ],
  ascii: latin,
  domain: "example.es",
  areas: ["612", "623", "634", "645", "656"],
  phones: (area, line) => [
    `+34 ${area} ${line} 45${line[0]}`,
    `${area} ${line} 45${line[0]}`,
    `+34 ${area}${line}45${line[0]}`,
  ],
  cities: ["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao", "Málaga"],
  employers: [
    "Cielo Azul Software",
    "Ribera Logística",
    "Montaña Clara Salud",
    "Taller Cobre Sistemas",
    "Piedra Blanca Energía",
    "Valle Florido Analítica",
    "Madera Dorada Medios",
    "Cabo Horizonte Banca",
    "Luz Norte Seguros",
    "Marea Alta Robótica",
    "Campo Verde Alimentación",
    "Puente Viejo Estudios",
    "Colina Roja Consultoría",
    "Estrella Sur Tecnologías",
  ],
  suffixes: ["", " S.L.", " S.L.", " S.A.", ""],
  titles: [
    "Ingeniero de software",
    "Ingeniera de software sénior",
    "Analista de datos",
    "Jefa de producto",
    "Jefe de proyecto",
    "Administrador de sistemas",
    "Analista de negocio",
    "Responsable de operaciones",
    "Diseñadora UX",
    "Ingeniero DevOps",
    "Responsable de marketing",
    "Arquitecto de soluciones",
  ],
  schools: [
    "Universidad de Valcourt",
    "Universidad Politécnica de Riberalta",
    "Universidad de Montelindo",
    "Universidad Autónoma de Sierrablanca",
    "Escuela de Negocios de Clarovalle",
    "Universidad del Mar Sereno",
  ],
  degrees: [
    { credential: "Grado", field: "en Ingeniería Informática", isced: 6 },
    { credential: "Grado", field: "en Administración de Empresas", isced: 6 },
    { credential: "Licenciatura", field: "en Economía", isced: 6 },
    { credential: "Grado", field: "en Matemáticas", isced: 6 },
    { credential: "Máster", field: "en Ciencia de Datos", isced: 7 },
    { credential: "Máster Universitario", field: "en Ingeniería de Software", isced: 7 },
    { credential: "Máster", field: "en Dirección de Empresas", isced: 7 },
  ],
  studyJoin: " ",
  skills: SKILLS,
  certs: CERTS,
  issued: "Expedido en",
  expires: "Válido hasta",
  validUntil: (year) => `válido hasta ${year}`,
  bullets: [
    "Desarrollo de la cadena de informes que usan doce equipos cada semana",
    "Reducción del cierre mensual de diez a cuatro días mediante la automatización de conciliaciones",
    "Coordinación de un equipo de cinco personas en la migración a una nueva plataforma",
    "Implantación de revisiones de código y listas de control de entregas",
    "Reducción de las incidencias de soporte en una cuarta parte con un panel de autoservicio",
    "Negociación de contratos con proveedores con un ahorro anual de seis cifras",
    "Acompañamiento de tres compañeros júnior hasta su primer ascenso",
    "Planificación semanal con diseño, ventas y operaciones",
  ],
  months: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
  dateForms: ["mon", "monde", "monde", "slash", "year"],
  rangeWords: [" – ", " - ", " a "],
  currentWords: ["actualidad", "presente", "Actual"],
  at: "en",
  headings: {
    experience: [
      "Experiencia profesional",
      "Experiencia laboral",
      "Trayectoria profesional",
      "Experiencia",
    ],
    education: ["Formación", "Formación académica", "Educación"],
    skills: ["Habilidades", "Competencias", "Conocimientos técnicos", "Herramientas"],
    certifications: ["Certificaciones", "Cursos y certificaciones"],
    summary: ["Perfil", "Resumen profesional"],
  },
  summary: "Profesional responsable con experiencia en la gestión de proyectos de principio a fin.",
  region: "ES",
};

const PT_V: Vocabulary = {
  first: [
    "Ana",
    "João",
    "Mariana",
    "Pedro",
    "Juliana",
    "Lucas",
    "Fernanda",
    "Rafael",
    "Camila",
    "Gustavo",
    "Beatriz",
    "Thiago",
  ],
  last: [
    "Silva",
    "Santos",
    "Oliveira",
    "Souza",
    "Pereira",
    "Costa",
    "Rodrigues",
    "Almeida",
    "Nascimento",
    "Lima",
    "Araújo",
    "Ribeiro",
  ],
  ascii: latin,
  domain: "example.com.br",
  areas: ["11", "21", "31", "41", "51"],
  phones: (area, line) => [
    `+55 ${area} 98${line}-45${line.slice(1)}`,
    `(${area}) 98${line}-45${line.slice(1)}`,
    `+55 (${area}) 98${line}-45${line.slice(1)}`,
  ],
  cities: [
    "São Paulo, SP",
    "Rio de Janeiro, RJ",
    "Belo Horizonte, MG",
    "Curitiba, PR",
    "Porto Alegre, RS",
    "Recife",
  ],
  employers: [
    "Céu Azul Software",
    "Ribeira Logística",
    "Monte Claro Saúde",
    "Oficina Cobre Sistemas",
    "Pedra Branca Energia",
    "Vale Florido Analítica",
    "Madeira Dourada Mídia",
    "Cabo Horizonte Banco",
    "Luz Norte Seguros",
    "Maré Alta Robótica",
    "Campo Verde Alimentos",
    "Ponte Velha Estúdios",
    "Colina Vermelha Consultoria",
    "Estrela Sul Tecnologia",
  ],
  suffixes: ["", " Ltda", " Ltda", " S.A.", ""],
  titles: [
    "Engenheiro de software",
    "Engenheira de software sênior",
    "Analista de dados",
    "Gerente de produto",
    "Gerente de projetos",
    "Administrador de sistemas",
    "Analista de negócios",
    "Coordenadora de operações",
    "Designer UX",
    "Engenheiro DevOps",
    "Gerente de marketing",
    "Arquiteto de soluções",
  ],
  schools: [
    "Universidade de Valcourt",
    "Universidade Federal de Ribeirão Alto",
    "Universidade Estadual de Montelindo",
    "Pontifícia Universidade de Serra Clara",
    "Faculdade de Negócios de Vale Claro",
    "Universidade do Mar Sereno",
  ],
  degrees: [
    { credential: "Bacharelado", field: "em Ciência da Computação", isced: 6 },
    { credential: "Bacharelado", field: "em Administração", isced: 6 },
    { credential: "Graduação", field: "em Economia", isced: 6 },
    { credential: "Licenciatura", field: "em Matemática", isced: 6 },
    { credential: "Mestrado", field: "em Ciência de Dados", isced: 7 },
    { credential: "MBA", field: "em Gestão de Projetos", isced: 7 },
    { credential: "Mestrado", field: "em Engenharia de Software", isced: 7 },
  ],
  studyJoin: " ",
  skills: SKILLS,
  certs: CERTS,
  issued: "Emitido em",
  expires: "Válido até",
  validUntil: (year) => `válido até ${year}`,
  bullets: [
    "Desenvolvimento da cadeia de relatórios usada toda semana por doze equipes",
    "Redução do fechamento mensal de dez para quatro dias com a automação das conciliações",
    "Coordenação de uma equipe de cinco pessoas na migração para uma nova plataforma",
    "Implantação de revisões de código e listas de verificação de entregas",
    "Redução de um quarto dos chamados de suporte com um painel de autoatendimento",
    "Negociação de contratos com fornecedores com economia anual de seis dígitos",
    "Mentoria de três colegas júnior até a primeira promoção",
    "Planejamento semanal com design, vendas e operações",
  ],
  months: [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ],
  dateForms: ["mon", "monde", "monslash", "slash", "year"],
  rangeWords: [" – ", " - ", " a "],
  currentWords: ["atual", "o momento", "Atual"],
  at: "",
  headings: {
    experience: [
      "Experiência profissional",
      "Experiência",
      "Histórico profissional",
      "Experiências",
    ],
    education: ["Formação acadêmica", "Formação", "Educação"],
    skills: ["Habilidades", "Competências técnicas", "Conhecimentos", "Ferramentas"],
    certifications: ["Certificações", "Cursos e certificações"],
    summary: ["Resumo profissional", "Perfil"],
  },
  summary: "Profissional dedicado com experiência na condução de projetos do início ao fim.",
  region: "BR",
};

const VOCABULARIES: Record<GeneratedLanguage, Vocabulary> = {
  en: EN,
  de: DE,
  fr: FR,
  hi: HI,
  es: ES_V,
  pt: PT_V,
};

export function generateResumes(
  count: number,
  seed = 20261001,
  language: GeneratedLanguage = "en",
): GeneratedResume[] {
  const v = VOCABULARIES[language];
  const rand = mulberry32(seed);
  const int = (n: number) => Math.floor(rand() * n);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  const chance = (p: number) => rand() < p;
  const some = <T>(items: readonly T[], n: number): T[] => {
    const pool = [...items];
    return Array.from({ length: n }, () => pool.splice(int(pool.length), 1)[0]!);
  };
  return Array.from({ length: count }, (_, index) => build(index));

  function build(index: number): GeneratedResume {
    const first = pick(v.first);
    const last = pick(v.last);
    const name = `${first} ${last}`;
    const email = `${v.ascii(first)}.${v.ascii(last)}@${v.domain}`.toLowerCase();
    const area = pick(v.areas);
    const line = String(100 + int(100));
    const phone = pick(v.phones(area, line));
    const city = pick(v.cities);
    const form: DateForm = pick(v.dateForms);
    const rangeWord = pick(v.rangeWords);
    const currentWord = pick(v.currentWords);
    const upper = chance(0.3);
    const bulletMark = pick(["•", "-", "*", "–"]);
    const style = pick(ROLE_STYLES);
    // Where the city goes, unless the style sets it beside the employer itself.
    const where =
      style === EMPLOYER_CITY_THEN_TITLE_DATES
        ? "none"
        : pick(["none", "own", "dates", "employer"] as const);

    const fmt = (d: Ym) =>
      form === "mon"
        ? `${v.months[d.month - 1]} ${d.year}`
        : form === "monde"
          ? `${v.months[d.month - 1]} de ${d.year}`
          : form === "monslash"
            ? `${v.months[d.month - 1]!.slice(0, 3)}/${d.year}`
            : form === "slash"
              ? `${String(d.month).padStart(2, "0")}/${d.year}`
              : form === "iso"
                ? `${d.year}-${String(d.month).padStart(2, "0")}`
                : form === "dot"
                  ? `${String(d.month).padStart(2, "0")}.${d.year}`
                  : `${d.year}`;
    const label = (d: Ym) =>
      form === "year" ? `${d.year}` : `${d.year}-${String(d.month).padStart(2, "0")}`;

    // Roles, newest first: each starts the month after the one before it ended.
    const roleCount = 2 + int(2);
    const currentJob = chance(0.6);
    let end: Ym = currentJob ? { year: 2026, month: 9 } : { year: 2025, month: 1 + int(12) };
    const employers = some(v.employers, roleCount);
    const roles = Array.from({ length: roleCount }, (_, i) => {
      const months = 24 + int(25);
      const total = end.year * 12 + end.month - 1 - months;
      const start = { year: Math.floor(total / 12), month: (total % 12) + 1 };
      const role = {
        title: pick(v.titles),
        employer: employers[i]! + pick(v.suffixes),
        start,
        end,
        current: i === 0 && currentJob,
        bullets: some(v.bullets, 2 + int(2)),
      };
      const before = total - 1;
      end = { year: Math.floor(before / 12), month: (before % 12) + 1 };
      return role;
    });

    const oldest = roles[roles.length - 1]!.start.year;
    const degreeCount = chance(0.35) ? 2 : 1;
    const degrees = some(v.schools, degreeCount).map((school, i) => {
      const degree =
        i === 0
          ? pick(v.degrees.filter((d) => d.isced === 6))
          : pick(v.degrees.filter((d) => d.isced === 7));
      return { school, ...degree, year: oldest - 1 - (degreeCount === 2 ? 2 - i * 2 : 0) };
    });
    degrees.sort((a, b) => b.year - a.year);

    const skills = some(v.skills, 5 + int(3));
    const certs = chance(0.35)
      ? some(v.certs, 1 + int(2)).map((cert) => ({ ...cert, kind: int(3) }))
      : [];
    const links = some(
      [
        "linkedin.com/in/" + `${v.ascii(first)}-${v.ascii(last)}`.toLowerCase(),
        "github.com/" + `${v.ascii(first)}${v.ascii(last)}`.toLowerCase(),
        "https://www.linkedin.com/in/" + `${v.ascii(first)}${v.ascii(last)}`.toLowerCase(),
      ],
      int(3),
    );

    const cased = (heading: string) => (upper ? heading.toUpperCase() : heading);
    const dateRange = (r: (typeof roles)[number]) =>
      `${fmt(r.start)}${rangeWord}${r.current ? currentWord : fmt(r.end)}`;

    const experience: Line[] = [];
    for (const role of roles) {
      const dates = dateRange(role);
      const employer = where === "employer" ? `${role.employer}, ${city}` : role.employer;
      const right = where === "dates" ? `${city}    ${dates}` : dates;
      experience.push(...style(role.title, employer, right, city, v.at));
      if (where === "own") experience.push({ left: city });
      for (const bullet of role.bullets) experience.push({ left: `${bulletMark} ${bullet}` });
    }

    const eduStyle = int(3);
    const education: Line[] = [];
    const stacked: Line[] = [];
    for (const d of degrees) {
      const study =
        d.credential.length > 5 && chance(0.5)
          ? `${d.credential}${v.studyJoin}${d.field}`
          : `${d.credential} ${d.field}`;
      if (eduStyle === 0) education.push({ left: `${d.school}, ${study}, ${d.year}` });
      else if (eduStyle === 1) education.push({ left: `${study} | ${d.school} | ${d.year}` });
      else education.push({ left: d.school }, { left: `${study}, ${d.year}` });
      stacked.push({ left: d.school }, { left: `${study}, ${d.year}` });
    }

    const skillStyle = int(3);
    const skillLines: Line[] =
      skillStyle === 0
        ? [{ left: skills.join(", ") }]
        : skillStyle === 1
          ? [{ left: skills.join(" | ") }]
          : skills.map((s) => ({ left: `${bulletMark} ${s}` }));

    const certLines: Line[] = [];
    const certExpected: NonNullable<LocaleFixture["certifications"]> = [];
    for (const cert of certs) {
      const year = 2020 + int(5);
      const m = 1 + int(12);
      if (cert.kind === 0) {
        certLines.push({ left: `${cert.name}, ${cert.issuer}, ${year}` });
        certExpected.push({ name: cert.name, issuer: cert.issuer, date: `${year}`, expires: "" });
      } else if (cert.kind === 1) {
        const issued = `${v.months[m - 1]} ${year}`;
        const expires = `${v.months[m - 1]} ${year + 3}`;
        certLines.push({
          left: `${cert.name} | ${cert.issuer} | ${v.issued} ${issued} | ${v.expires} ${expires}`,
        });
        certExpected.push({
          name: cert.name,
          issuer: cert.issuer,
          date: `${year}-${String(m).padStart(2, "0")}`,
          expires: `${year + 3}-${String(m).padStart(2, "0")}`,
        });
      } else {
        certLines.push({ left: `${cert.name} (${cert.issuer}), ${v.validUntil(year + 3)}` });
        certExpected.push({
          name: cert.name,
          issuer: cert.issuer,
          date: "",
          expires: `${year + 3}`,
        });
      }
    }

    const contact = [email, phone, ...(chance(0.5) ? [city] : [])];
    const headerStyle = int(3);
    const header: Line[] = [{ left: name }];
    if (headerStyle === 0) header.push({ left: contact.join(" | "), parts: contact });
    else if (headerStyle === 1) header.push({ left: contact.join("  "), parts: contact });
    else header.push(...contact.map((left) => ({ left })));
    if (links.length) header.push({ left: links.join(chance(0.5) ? " | " : "  "), parts: links });

    const blocks: Block[] = [];
    const sections: Array<Block["kind"]> = [
      "experience",
      "education",
      "skills",
      ...(certs.length ? (["certifications"] as const) : []),
    ];
    // Section order varies; a summary, when there is one, comes first.
    for (let i = sections.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      [sections[i], sections[j]] = [sections[j]!, sections[i]!];
    }
    if (chance(0.5))
      blocks.push({
        kind: "summary",
        heading: cased(pick(v.headings.summary)),
        lines: [{ left: v.summary }],
      });
    for (const kind of sections)
      blocks.push({
        kind,
        heading: cased(pick(v.headings[kind])),
        narrow: kind === "education" ? stacked : undefined,
        lines: {
          experience,
          education,
          skills: skillLines,
          certifications: certLines,
          summary: [],
        }[kind],
      });

    return {
      id: `gen-${language === "en" ? "" : `${language}-`}${String(index + 1).padStart(2, "0")}`,
      text: "",
      locale: { languages: language === "en" ? [] : [language], region: v.region },
      name,
      email,
      phone,
      links,
      roles: roles.map((r) => ({
        title: r.title,
        employer: r.employer,
        start: label(r.start),
        end: r.current ? "" : label(r.end),
        current: r.current,
      })),
      education: degrees.map((d) => ({
        school: d.school,
        isced: d.isced,
        credential: d.credential,
      })),
      skills,
      certifications: certExpected,
      header,
      blocks,
    };
  }
}

const joined = (line: Line) =>
  line.right === undefined ? line.left : `${line.left}${line.glue ?? "    "}${line.right}`;

/** Every line in page order, a heading on a line of its own. */
function lines(resume: GeneratedResume): string[] {
  return [
    ...resume.header.map(joined),
    ...resume.blocks.flatMap((block) => [block.heading, ...block.lines.map(joined)]),
  ];
}

/** Helvetica is not embedded; the standard encoding's bullet and dashes are bytes 0xB7, 0xB1, 0xD0. */
const pdfSafe = (value: string) =>
  value.replace(/•/g, "·").replace(/–/g, "±").replace(/—/g, "Ð").replace(/\t/g, "    ");

const wrap = (value: string, width: number): string[] => {
  const out: string[] = [];
  let current = "";
  for (const word of value.split(" ")) {
    if (current && current.length + 1 + word.length > width) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  return [...out, current];
};

/** Helvetica advance widths (AFM, per 1000 em) for characters 32 to 126, in order. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** The bytes `pdfSafe` writes for a bullet and the en and em dashes. */
const SPECIAL: Record<string, number> = { "·": 350, "±": 556, Ð: 1000 };
const width = (value: string, size = 10) =>
  ([...value].reduce(
    (sum, char) => sum + (SPECIAL[char] ?? WIDTHS[char.charCodeAt(0) - 32] ?? 556),
    0,
  ) *
    size) /
  1000;
/** Where a run starts so its right edge is exactly `edge`, as a right tab or justify-between does. */
const flushRight = (right: string, edge: number) => Math.round((edge - width(right)) * 100) / 100;

/** How a PDF shows, measures and writes its text: Helvetica, or `unicodeFont` for other scripts. */
type PdfFont = {
  show: (x: number, y: number, value: string) => string;
  width: (value: string) => number;
  pages: (contentStreams: string[]) => Buffer;
};
const HELVETICA: PdfFont = {
  show: (x, y, value) => text(x, y, pdfSafe(value)),
  width: (value) => width(pdfSafe(value)),
  pages: buildPdfPages,
};

/** One column, dates flush right, a new page when a page is full. */
function pdfOneColumn(resume: GeneratedResume, font: PdfFont = HELVETICA): Buffer {
  const pages: string[][] = [[]];
  let y = 750;
  const put = (x: number, value: string, step = 13) => {
    if (y < 60) {
      pages.push([]);
      y = 750;
    }
    pages[pages.length - 1]!.push(font.show(x, y, value));
    y -= step;
  };
  const row = (line: Line) => {
    if (line.right === undefined) return put(50, line.left);
    const at = y;
    put(50, line.left, 0);
    y = at;
    put(Math.round((562 - font.width(line.right)) * 100) / 100, line.right);
  };
  resume.header.forEach((line, i) => put(50, line.left, i === 0 ? 20 : 13));
  for (const block of resume.blocks) {
    y -= 8;
    put(50, block.heading, 16);
    block.lines.forEach(row);
  }
  return font.pages(pages.map((ops) => ops.join("\n")));
}

/**
 * A sidebar (contact, skills, education) beside a main column (summary, experience,
 * certifications). A job's dates go on a line of their own when they would not fit beside it.
 */
function pdfTwoColumn(resume: GeneratedResume): Buffer {
  const ops: string[] = [];
  ops.push(text(40, 750, pdfSafe(resume.header[0]!.left)));
  let side = 715;
  const putSide = (value: string, step = 13) => {
    for (const piece of wrap(value, 36)) {
      ops.push(text(40, side, pdfSafe(piece)));
      side -= step;
    }
  };
  for (const line of resume.header.slice(1))
    for (const part of line.parts ?? [line.left]) putSide(part);
  let main = 715;
  const putMain = (value: string, x = 262, step = 13) => {
    ops.push(text(x, main, pdfSafe(value)));
    main -= step;
  };
  for (const block of resume.blocks) {
    if (block.kind === "education" || block.kind === "skills") {
      side -= 8;
      putSide(block.heading, 16);
      for (const line of block.narrow ?? block.lines) putSide(joined(line));
      continue;
    }
    main -= 8;
    putMain(block.heading, 262, 16);
    for (const line of block.lines) {
      if (line.right === undefined) for (const piece of wrap(line.left, 62)) putMain(piece);
      else if (line.left.length + line.right.length > 56) {
        putMain(line.left);
        putMain(line.right);
      } else {
        const at = main;
        putMain(line.left, 262, 0);
        main = at;
        putMain(line.right, flushRight(pdfSafe(line.right), 580));
      }
    }
  }
  return buildPdfPages([ops.join("\n")]);
}

export type Rendered = {
  text: string;
  layout?: Awaited<ReturnType<typeof extractResume>>["layout"];
};

/** The text an ATS reads from the resume in a rendering, with the layout signals of a file. */
export async function renderResume(
  resume: GeneratedResume,
  rendering: Rendering,
): Promise<Rendered> {
  if (rendering === "text") return { text: lines(resume).join("\n") };
  const file =
    rendering === "pdf"
      ? // Helvetica has no Devanagari and no encoding for most accents: a Unicode font for the others.
        pdfOneColumn(resume, resume.locale.languages.length ? unicodeFont() : HELVETICA)
      : rendering === "pdf-2col"
        ? pdfTwoColumn(resume)
        : // In Word, the gap before a flush-right city or date is a tab, not a run of spaces.
          buildDocx(lines(resume).map((line) => line.replace(/ {2,}/g, "\t")));
  const { text: read, layout } = await extractResume(file, rendering === "docx" ? "docx" : "pdf");
  return { text: read, layout };
}
