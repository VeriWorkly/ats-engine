/**
 * What follows a bare two-letter form that is a US state code rather than a degree, when no
 * comma comes before it: a ZIP code ("Boston MA 02115"), a year ("Medford MA 2016", "Boston
 * MA, 2015") or a month and year ("Chestnut Hill, MA Sep 2014"). A degree is followed by its
 * subject instead ("MS Computer Science, 2016"); "USA", "or" and "and" are not one.
 */
const STATE_CODE_AFTER = String.raw`\s+\d{5}(?!\d)|(?:,\s*|\s+)\d{4}(?!\d)|\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}(?!\d)`;
/**
 * After a comma, a bare form is a degree only when its subject follows ("Stanford University, MS
 * in Computer Science", "University of Chicago, MA Economics", "Harvard, MA (Economics)"); at
 * the end of the line, or before a ZIP code, a year or another comma, it is the state of the
 * city before it ("Cambridge, MA", "Boston, MA 02115"). Decided by what follows, not by the comma.
 */
const SUBJECT_AFTER = String.raw`\s+(?!(?:or|and|usa?)(?![a-z]))\p{L}|\s*\(`;
/** "MS Excel", "MS Teams": Microsoft, not a Master's. */
const MS_PRODUCT_AFTER = String.raw`\s+(?:excel|office|word|access|teams|project|outlook|powerpoint|windows|azure|dynamics|sql|visio|sharepoint)\b`;

/** A law school or a university on the line: what makes a bare "LLM" or "J.D." a degree. */
const LAW_CONTEXT = String.raw`(?<!\p{L})(?:laws?|universit(?:y|ies)|college|school|faculty)(?!\p{L})`;
/** Where a credential stands on an education line: before a comma, a bracket, a year or the end. */
const DEGREE_POSITION = String.raw`\s*[,()]|\s+(?:19|20)\d{2}(?!\d)|\s*$`;

/**
 * "LLM" undotted is the Master of Laws only where a degree stands — before a comma, a bracket, a
 * year, "in" or the end of the line — and with a law school or university on the line, before it
 * or after ("LLM, National Law School", "Harvard Law School, LLM 2015"). Position alone was not
 * enough: "experience with LLM, RAG and vector search" and "deploying LLM in production" are a
 * large language model, and so is "LLM-based code review". Each side's search is bounded.
 */
const LLM_DEGREE = String.raw`llm(?=${DEGREE_POSITION}|\s+in\s)(?:(?=[^\n]{0,80}?${LAW_CONTEXT})|(?<=${LAW_CONTEXT}[^\n]{0,80}llm))`;
/**
 * "J.D." is a degree where one stands, or beside a law school; initials are not ("J. D.
 * Salinger", "J.D. Power").
 */
const JD_DEGREE = String.raw`j\.\s?d\.?(?=${DEGREE_POSITION})|j\.d\.?(?:(?=[^\n]{0,80}?${LAW_CONTEXT})|(?<=${LAW_CONTEXT}[^\n]{0,80}j\.d\.?))`;

/**
 * The community policy's parsing vocabulary. Month names and the words for "still here" are
 * the schema's defaults, so they are not repeated here.
 */
export const DEFAULT_RESUME_PARSE = {
  // The experience headings of every field, not only software's: a nurse's "Clinical
  // Experience", a fresher's "Internships", an academic's "Research Experience" and "Academic
  // Appointments". A heading the policy does not know is read as part of the section above it,
  // so a fresher's internships under an unknown heading after Education were read as education.
  // The "other" headings include the ones an academic or executive CV adds, so that grants,
  // courses and board seats below the work history are not read as jobs, and "Contact", which a
  // two-column resume prints above the name. Education goes by other names too ("Academic
  // Background", "Educational Qualifications"); unknown, its degrees were folded into the section
  // above and lost. Certifications and licences ("Licenses & Certifications", "Licensure") and
  // spoken languages have kinds of their own, read as rows; their headings are the schema's
  // defaults (`sections.certifications`, `sections.languages`), so a licence's dates are never
  // read as a job. "Top Skills" is the skills heading of a LinkedIn profile export's sidebar.
  // Unknown, a heading after Skills was read as skills too, with every line under it: "Selected
  // Experience", "Tech Stack", "Side Projects", "Professional Summary" and "Volunteer
  // Experience" are common enough to know. Volunteer work is "other", as "Volunteering" was, so
  // it adds no months to the work history.
  sections: {
    experience: String.raw`^(?:(?:work|professional|relevant|clinical|research|teaching|leadership|industry|internship|career|employment|selected|additional|other|military|freelance)\s+)?(?:experience|employment|history)|^internships?|^academic\s+(?:appointments|positions)|^professional\s+background`,
    education: String.raw`^educational\s+(?:background|qualifications?|history|details)|^education|^academic\s+(?:background|qualifications?|history|record|credentials)`,
    skills: String.raw`^(?:(?:technical|core|key|top)\s+)?skills|^technologies|^core\s+competenc(?:y|ies)|^areas\s+of\s+expertise|^technical\s+proficienc(?:y|ies)|^tech(?:nology)?\s+stack|^tools`,
    projects: String.raw`^(?:(?:personal|academic|side|selected|key)\s+)?projects|^open[\s-]source(?:\s+(?:projects|contributions))?`,
    other: String.raw`^(?:(?:summary\s+of\s+)?qualifications|(?:(?:professional|career|executive)\s+)?summary|accomplishments|leadership|objective|profile|awards?|publications?|interests|volunteer(?:ing|\s+(?:experience|work))?|references|links|online\s+profiles?|achievements|hobbies|contact(?:\s+(?:details|information|info))?|personal\s+(?:details|information|data)|honou?rs|grants|funding|fellowships|patents|presentations|invited\s+talks|talks|conferences|memberships|affiliations|professional\s+(?:affiliations|memberships|service|development)|editorial\s+(?:boards?|service|activities)|board\s+(?:memberships|positions|service|seats)|boards|courses(?:\s+taught)?|coursework|relevant\s+coursework|training|activities|extra[\s-]?curricular(?:\s+activities)?|declaration)`,
  },
  titleWords: [
    "engineer",
    "developer",
    "manager",
    "director",
    "designer",
    "analyst",
    "architect",
    "consultant",
    "lead",
    "head",
    "officer",
    "scientist",
    "specialist",
    "administrator",
    "intern",
    "president",
    "founder",
    "coordinator",
    "supervisor",
    "associate",
    "assistant",
    "technician",
    "trainer",
    "fellow",
    "professor",
    "lecturer",
    "researcher",
    // Beyond the office: without these, "Deloitte, Accountant" and "Mercy Hospital, Registered
    // Nurse" were read with the employer as the title. Words that are also common surnames
    // ("Driver", "Cook", "Baker") are left out: a name holding one is not taken as the name.
    "nurse",
    "teacher",
    "tutor",
    "instructor",
    "counsell?or",
    "therapist",
    "pharmacist",
    "physician",
    "accountant",
    "bookkeeper",
    "auditor",
    "attorney",
    "lawyer",
    "paralegal",
    "cashier",
    "teller",
    "clerk",
    "receptionist",
    "secretary",
    "barista",
    "mechanic",
    "electrician",
    "programmer",
    "recruiter",
    "writer",
    "editor",
    "representative",
    "executive",
    "[cs]?vp",
    "evp",
    "c[eftoi]o",
  ],
  schoolWords: [
    "university",
    "college",
    "institute",
    "school",
    "academy",
    "polytechnic",
    "seminary",
  ],
  // Bare MA and MS are the ambiguous two-letter forms: they are also US state codes ("Cambridge,
  // MA"; see STATE_CODE_AFTER and SUBJECT_AFTER above, which tell the two apart by what
  // follows), and "MS" before a product name is Microsoft. No state is BA or BS, so those read
  // as degrees wherever they stand. Dotted and
  // spelled-out forms stay unconditional. "Associate" alone is a job title, not a degree, and
  // "certificate" alone is as likely to be an SSL certificate as a credential.
  // A bare MS/MA is also not one after a number ("900 ms"), before a hyphen ("MS-Excel") or a ZIP
  // code ("Boston MA 02115"), or as a salutation before a name ("Ms. Priya"); the pattern is
  // matched case-insensitively, so the salutation is told apart by its dot, not its capital.
  // "Master Data Management" is a discipline, not a degree.
  // "Secondary School Certificate" is India's Class X (level 2, the IN region's), and "High
  // School (Class X)" names that same exam, so neither is claimed at level 3 here.
  // J.D. and M.D. are professional doctorates, which ISCED 2011 places at level 7 with the
  // master's, not at the research doctorate's 8. Both are matched dotted only, because
  // "MD" is Maryland and "JD" a job description. "MFA" undotted is multi-factor authentication.
  // Keyed by ISCED 2011 level. Level 3 is a school-leaving qualification; level 4 is any other
  // diploma or certificate, so its pattern steps around the school ones, which would otherwise
  // be recorded at the higher level.
  degrees: {
    "3": String.raw`(?:\b|^)((?:high\s+school(?!\s*\(\s*class\s+(?:x|10)(?:th)?(?![a-z]))|secondary\s+school(?!\s+certificate))(?:\s+(?:diploma|certificate))?|g\.?e\.?d\.?|a[\s-]levels?)(?![a-z])`,
    "4": String.raw`(?:\b|^)((?<!(?:high|secondary)\s+school\s+)diploma|(?:graduate\s+)?certificate\s+(?:in|of)\b)(?![a-z])`,
    "5": String.raw`(?:\b|^)(associate(?:'?s)?\s+(?:degree|of\s+[a-z]+)|a\.a\.s?\.?|(?<!,\s*)aas?(?=\s+(?:in|of)\b))(?![a-z])`,
    "6": String.raw`(?:\b|^)(bachelor(?:'?s)?(?:\s+of\s+[a-z]+)?|b\.s\.c?\.?|b\.?sc\.?|b\.a\.|b\.?eng\.?|b\.?tech\.?|b\.?b\.?a\.?|b\.?f\.?a\.?|b\.\s?ed\.?|ll\.?b\.?|b[as])(?![a-z])`,
    "7": String.raw`(?:\b|^)(${JD_DEGREE}|juris\s+doctor|m\.\s?d\.|m\.\s?ed\.?|m\.f\.a\.|ll\.m\.?|${LLM_DEGREE}|(?<!scrum\s)master(?!\s+data(?![a-z]))(?:'?s)?(?:\s+of\s+[a-z]+)?|m\.s\.c?\.?|m\.?sc\.?|m\.a\.|m\.?eng\.?|m\.?b\.?a\.?|m\.?tech\.?|(?<=,\s*)m[as](?=${SUBJECT_AFTER})(?!${STATE_CODE_AFTER}|${MS_PRODUCT_AFTER})|(?<!,\s*|\d\s?)m[as](?!-|\.\s+\p{L}|${STATE_CODE_AFTER}|${MS_PRODUCT_AFTER}))(?![a-z])`,
    "8": String.raw`(?:\b|^)(doctorate|ph\.?d\.?|d\.?phil\.?)(?![a-z])`,
  },
};
