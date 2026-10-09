import type { LocaleFixture } from "./locale-resumes.js";

/**
 * Synthetic English resumes in the layouts real ones use, with the fields an ATS should recover.
 * Invented people and companies only. The base vocabulary reads them; no language pack applies.
 */
export const EN_FIXTURES: LocaleFixture[] = [
  {
    id: "en-us-classic",
    text: `Maria Gonzalez
maria.gonzalez@example.com | +1 415 555 0134 | San Francisco, CA
Summary
Backend engineer with eight years building payment systems.
Experience
Senior Software Engineer, Northwind Payments    Jan 2021 – Present
• Led the migration of 40 services to Kubernetes, cutting deploys from 2 hours to 10 minutes
• Designed an idempotent ledger handling 3 million transactions a day
Software Engineer, Contoso Labs    Jun 2017 – Dec 2020
• Built a PostgreSQL reporting pipeline used by 12 teams
Education
University of Michigan, B.S. Computer Science, 2017
Skills
Go, Python, PostgreSQL, Kubernetes, Terraform`,
    locale: { languages: [], region: "US" },
    name: "Maria Gonzalez",
    email: "maria.gonzalez@example.com",
    phone: "+1 415 555 0134",
    roles: [
      {
        title: "Senior Software Engineer",
        employer: "Northwind Payments",
        start: "2021-01",
        current: true,
      },
      { title: "Software Engineer", employer: "Contoso Labs", start: "2017-06", current: false },
    ],
    education: [{ school: "University of Michigan", isced: 6 }],
    skills: ["Go", "Python", "PostgreSQL", "Kubernetes", "Terraform"],
  },
  {
    id: "en-us-stacked",
    text: `David Kim
(212) 555-0187 · david.kim@example.com
EXPERIENCE
Fabrikam Health
Data Analyst
March 2019 - Present
- Automated weekly claims reporting in Python, saving 6 hours a week
- Reduced dashboard load time by 40%
Tailspin Toys
Junior Analyst
July 2016 - February 2019
- Maintained the sales forecasting model in Excel and SQL
EDUCATION
Rutgers University
Master of Science in Statistics, 2016
SKILLS
SQL, Python, Tableau, Excel`,
    locale: { languages: [], region: null },
    name: "David Kim",
    email: "david.kim@example.com",
    phone: "(212) 555-0187",
    roles: [
      { title: "Data Analyst", employer: "Fabrikam Health", start: "2019-03", current: true },
      { title: "Junior Analyst", employer: "Tailspin Toys", start: "2016-07", current: false },
    ],
    education: [{ school: "Rutgers University", isced: 7 }],
    skills: ["SQL", "Python", "Tableau", "Excel"],
  },
  {
    id: "en-uk-pipes",
    text: `Oliver Bennett
oliver.bennett@example.co.uk | +44 20 7946 0958 | London
Profile
Product manager for consumer fintech apps.
Work Experience
Product Manager | Monzo-like Bank Ltd | Sept 2020 – Present
- Launched savings pots used by 400,000 customers in the first quarter
- Ran 30 A/B tests a quarter with the growth team
Associate Product Manager | Woodgrove Insurance | Aug 2018 – Aug 2020
- Shipped the claims tracker, cutting support calls by 25%
Education
University of Leeds | BSc Economics | 2018
Skills
Roadmapping, SQL, Amplitude, Figma`,
    locale: { languages: [], region: null },
    name: "Oliver Bennett",
    email: "oliver.bennett@example.co.uk",
    phone: "+44 20 7946 0958",
    roles: [
      {
        title: "Product Manager",
        employer: "Monzo-like Bank Ltd",
        start: "2020-09",
        current: true,
      },
      {
        title: "Associate Product Manager",
        employer: "Woodgrove Insurance",
        start: "2018-08",
        current: false,
      },
    ],
    education: [{ school: "University of Leeds", isced: 6 }],
    skills: ["Roadmapping", "SQL", "Amplitude", "Figma"],
  },
  {
    id: "en-us-at-and-since",
    text: `Aisha Thompson
aisha.thompson@example.com | +1 312 555 0147
Experience
Staff Engineer at Umbrella Robotics since 2021
- Owned the fleet telemetry platform across 2,000 robots
Engineering Manager at Initech, 2015 – 2021
- Managed a team of 9 engineers and hired 5
Education
Northwestern University, Bachelor of Science in Electrical Engineering, 2015
Skills
C++, Rust, ROS, Kafka`,
    locale: { languages: [], region: "US" },
    name: "Aisha Thompson",
    email: "aisha.thompson@example.com",
    phone: "+1 312 555 0147",
    roles: [
      { title: "Staff Engineer", employer: "Umbrella Robotics", start: "2021", current: true },
      { title: "Engineering Manager", employer: "Initech", start: "2015", current: false },
    ],
    education: [{ school: "Northwestern University", isced: 6 }],
    skills: ["C++", "Rust", "ROS", "Kafka"],
  },
  {
    id: "en-us-employer-first",
    text: `Samuel Okafor
samuel.okafor@example.com | 617-555-0162
Professional Experience
Novartis — Senior Data Scientist — 2019 – Present
- Built demand forecasting models that cut stockouts by 18%
Marriott International — Data Scientist — 2016 – 2019
- Designed pricing experiments across 300 hotels
Education
Boston University, PhD Statistics, 2016
Technical Skills
Python, R, PyTorch, Spark`,
    locale: { languages: [], region: null },
    name: "Samuel Okafor",
    email: "samuel.okafor@example.com",
    phone: "617-555-0162",
    roles: [
      { title: "Senior Data Scientist", employer: "Novartis", start: "2019", current: true },
      {
        title: "Data Scientist",
        employer: "Marriott International",
        start: "2016",
        current: false,
      },
    ],
    education: [{ school: "Boston University", isced: 8 }],
    skills: ["Python", "R", "PyTorch", "Spark"],
  },
  {
    id: "en-us-certified-cloud",
    text: `Daniel Reyes
daniel.reyes@example.com | +1 206 555 0173 | Seattle, WA
Summary
Cloud engineer running AWS platforms for retail.
Experience
Cloud Engineer, Lakeside Retail    Mar 2022 – Present
• Moved 60 services to AWS ECS, cutting hosting costs by 35%
Systems Administrator, Contoso Labs    Jul 2018 – Feb 2022
• Automated patching for 400 Linux servers with Ansible
Education
University of Washington, B.S. Information Systems, 2018
Licenses & Certifications
AWS Certified Solutions Architect – Associate, Amazon Web Services, 2023
Certified Kubernetes Administrator (CKA) | The Linux Foundation | Issued Mar 2022 · Expires Mar 2025
PMP (PMI), expires 2027
Skills
AWS, Terraform, Kubernetes, Ansible, Linux
Languages
English (native), Spanish (professional working proficiency)`,
    locale: { languages: [], region: "US" },
    name: "Daniel Reyes",
    email: "daniel.reyes@example.com",
    phone: "+1 206 555 0173",
    roles: [
      { title: "Cloud Engineer", employer: "Lakeside Retail", start: "2022-03", current: true },
      {
        title: "Systems Administrator",
        employer: "Contoso Labs",
        start: "2018-07",
        current: false,
      },
    ],
    education: [{ school: "University of Washington", isced: 6 }],
    skills: ["AWS", "Terraform", "Kubernetes", "Ansible", "Linux"],
    certifications: [
      {
        name: "AWS Certified Solutions Architect – Associate",
        issuer: "Amazon Web Services",
        date: "2023",
      },
      {
        name: "Certified Kubernetes Administrator (CKA)",
        issuer: "The Linux Foundation",
        date: "2022-03",
      },
      { name: "PMP", issuer: "PMI", date: "" },
    ],
    spokenLanguages: [
      { language: "English", cefr: "C2" },
      { language: "Spanish", cefr: "C1" },
    ],
  },
  {
    id: "en-uk-languages-in-skills",
    text: `Hannah Clarke
hannah.clarke@example.co.uk | +44 161 496 0321 | Manchester
Profile
Data analyst for public health programmes.
Work Experience
Data Analyst | Northwind Health Trust | Feb 2021 – Present
- Built the vaccination uptake dashboard used by 30 clinics
Junior Analyst | Fabrikam Insights | Sep 2018 – Jan 2021
- Cleaned survey data for 12 client studies
Education
University of Manchester | BSc Mathematics | 2018
Certifications
Google Data Analytics Professional Certificate, Coursera
Issued Jun 2020
Microsoft Certified: Power BI Data Analyst Associate, Microsoft, 2022, Credential ID 7H2K9Q
Skills
SQL, R, Power BI, Excel
Languages: English (native), French (B2), Polish (A2)`,
    locale: { languages: [], region: null },
    name: "Hannah Clarke",
    email: "hannah.clarke@example.co.uk",
    phone: "+44 161 496 0321",
    roles: [
      {
        title: "Data Analyst",
        employer: "Northwind Health Trust",
        start: "2021-02",
        current: true,
      },
      {
        title: "Junior Analyst",
        employer: "Fabrikam Insights",
        start: "2018-09",
        current: false,
      },
    ],
    education: [{ school: "University of Manchester", isced: 6 }],
    skills: ["SQL", "R", "Power BI", "Excel"],
    certifications: [
      {
        name: "Google Data Analytics Professional Certificate",
        issuer: "Coursera",
        date: "2020-06",
      },
      {
        name: "Microsoft Certified: Power BI Data Analyst Associate",
        issuer: "Microsoft",
        date: "2022",
      },
    ],
    spokenLanguages: [
      { language: "English", cefr: "C2" },
      { language: "French", cefr: "B2" },
      { language: "Polish", cefr: "A2" },
    ],
  },
];
