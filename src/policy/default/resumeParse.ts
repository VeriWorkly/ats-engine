/**
 * What follows a bare two-letter form that is a US state code rather than a degree, when no
 * comma comes before it: a ZIP code, a year, or a month and year. A degree is followed by its
 * subject instead ("MS Computer Science, 2016"); "USA", "or" and "and" are not one.
 */
const STATE_CODE_AFTER = String.raw`\s+\d{5}(?!\d)|(?:,\s*|\s+)\d{4}(?!\d)|\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}(?!\d)`;
/**
 * After a comma, a bare form is a degree only when its subject follows ("University of Chicago,
 * MA Economics"); at the end of the line, or before a ZIP code, a year or another comma, it is
 * the state of the city before it ("Cambridge, MA").
 */
const SUBJECT_AFTER = String.raw`\s+(?!(?:or|and|usa?)(?![a-z]))\p{L}|\s*\(`;
/** "MS Excel", "MS Teams": Microsoft, not a Master's. */
const MS_PRODUCT_AFTER = String.raw`\s+(?:excel|office|word|access|teams|project|outlook|powerpoint|windows|azure|dynamics|sql|visio|sharepoint)\b`;

/** A law school or a university on the line: what makes a bare "LLM" or "J.D." a degree. */
const LAW_CONTEXT = String.raw`(?<!\p{L})(?:laws?|universit(?:y|ies)|college|school|faculty)(?!\p{L})`;
/** Where a credential stands on an education line: before a comma, a bracket, a year or the end. */
const DEGREE_POSITION = String.raw`\s*[,()]|\s+(?:19|20)\d{2}(?!\d)|\s*$`;

/**
 * "LLM" undotted is the Master of Laws only where a degree stands (before a comma, a bracket, a
 * year, "in" or the end of the line) and with a law school or university on the line, before or
 * after. Position alone would match "experience with LLM, RAG" and "LLM-based code review". Each
 * side's search is bounded.
 */
const LLM_DEGREE = String.raw`llm(?=${DEGREE_POSITION}|\s+in\s)(?:(?=[^\n]{0,80}?${LAW_CONTEXT})|(?<=${LAW_CONTEXT}[^\n]{0,80}llm))`;
/** "J.D." is a degree where one stands, or beside a law school; not "J. D. Salinger", "J.D. Power". */
const JD_DEGREE = String.raw`j\.\s?d\.?(?=${DEGREE_POSITION})|j\.d\.?(?:(?=[^\n]{0,80}?${LAW_CONTEXT})|(?<=${LAW_CONTEXT}[^\n]{0,80}j\.d\.?))`;

/** The community policy's parsing vocabulary. Month names and "still here" words are the schema's defaults. */
export const DEFAULT_RESUME_PARSE = {
  // Experience headings of every field (a nurse's "Clinical Experience", a fresher's
  // "Internships"). A heading the policy does not know is read as part of the section above it,
  // so "other" also holds academic and executive CV headings (grants, board seats) and "Contact".
  // Certification and language headings are the schema's defaults. "Top Skills" is a LinkedIn
  // export sidebar heading. Volunteer work is "other": it adds no months to the work history. A
  // word that is also a skill ("Leadership"), a role's title or a line of a role ("Tools:") is
  // not a heading alone.
  sections: {
    experience: String.raw`^(?:(?:work|professional|relevant|clinical|research|teaching|leadership|industry|internship|career|employment|selected|additional|other|military|freelance)\s+)?(?:experience|employment|history)|^internships?|^academic\s+(?:appointments|positions)|^professional\s+background`,
    education: String.raw`^educational\s+(?:background|qualifications?|history|details)|^education|^academic\s+(?:background|qualifications?|history|record|credentials)`,
    skills: String.raw`^(?:(?:technical|core|key|top)\s+)?skills|^technologies|^core\s+competenc(?:y|ies)|^areas\s+of\s+expertise|^technical\s+proficienc(?:y|ies)|^tech(?:nology)?\s+stack|^tools\s+(?:&|and)\s+technolog(?:y|ies)`,
    projects: String.raw`^(?:(?:personal|academic|side|selected|key)\s+)?projects|^open[\s-]source\s+(?:projects|contributions)`,
    other: String.raw`^(?:(?:summary\s+of\s+)?qualifications|(?:(?:professional|career|executive)\s+)?summary|accomplishments|leadership\s+(?:&|and)\s+(?:activities|involvement)|objective|profile|awards?|publications?|interests|volunteer(?:ing|\s+(?:experience|work))|references|links|online\s+profiles?|achievements|hobbies|contact(?:\s+(?:details|information|info))?|personal\s+(?:details|information|data)|honou?rs|grants|funding|fellowships|patents|presentations|invited\s+talks|talks|conferences|memberships|affiliations|professional\s+(?:affiliations|memberships|service|development)|editorial\s+(?:boards?|service|activities)|board\s+(?:memberships|positions|service|seats)|boards|courses(?:\s+taught)?|coursework|relevant\s+coursework|training|activities|extra[\s-]?curricular(?:\s+activities)?|declaration)`,
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
    // Beyond the office ("Deloitte, Accountant"). Words that are also surnames ("Nurse",
    // "Teacher", "Cook") are left out, or a name holding one was not taken as the name; those
    // roles are read by their employer's word instead (`organisationWords`).
    "instructor",
    "counsell?or",
    "therapist",
    "pharmacist",
    "physician",
    "accountant",
    "bookkeeper",
    "auditor",
    "attorney",
    "paralegal",
    "cashier",
    "receptionist",
    "secretary",
    "barista",
    "electrician",
    "programmer",
    "recruiter",
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
  // Bare MA and MS are also US state codes (see STATE_CODE_AFTER and SUBJECT_AFTER) and "MS"
  // before a product is Microsoft. Not a degree after a number ("900 ms"), before a hyphen
  // ("MS-Excel"), before a ZIP code, or as the salutation "Ms."; matched case-insensitively, so
  // the salutation is told by its dot. BA and BS read as degrees anywhere. Dotted and spelled-out
  // forms stay unconditional. "Associate" and "certificate" alone are not degrees; "Master Data
  // Management" is a discipline. "Secondary School Certificate" is India's Class X (level 2, the
  // IN region's), so neither it nor "High School (Class X)" is claimed at level 3.
  // J.D. and M.D. are level 7 in ISCED 2011, matched dotted only ("MD" is Maryland, "JD" a job
  // description); "MFA" undotted is multi-factor authentication.
  // Keyed by ISCED 2011 level. Level 4 is any diploma or certificate that is not a school one,
  // so its pattern steps around level 3's.
  degrees: {
    "3": String.raw`(?:\b|^)((?:high\s+school(?!\s*\(\s*class\s+(?:x|10)(?:th)?(?![a-z]))|secondary\s+school(?!\s+certificate))(?:\s+(?:diploma|certificate))?|g\.?e\.?d\.?|a[\s-]levels?)(?![\p{L}\p{M}])`,
    "4": String.raw`(?:\b|^)((?<!(?:high|secondary)\s+school\s+)diploma|(?:graduate\s+)?certificate\s+(?:in|of)\b)(?![\p{L}\p{M}])`,
    "5": String.raw`(?:\b|^)(associate(?:'?s)?\s+(?:degree|of\s+[a-z]+)|a\.a\.s?\.?|(?<!,\s*)aas?(?=\s+(?:in|of)\b))(?![\p{L}\p{M}])`,
    "6": String.raw`(?:\b|^)(bachelor(?:'?s)?(?:\s+of\s+[a-z]+)?|b\.s\.c?\.?|b\.?sc\.?|b\.a\.|b\.?eng\.?|b\.?tech\.?|b\.?b\.?a\.?|b\.?f\.?a\.?|b\.\s?ed\.?|ll\.?b\.?|b[as])(?![\p{L}\p{M}])`,
    "7": String.raw`(?:\b|^)(${JD_DEGREE}|juris\s+doctor|m\.\s?d\.|m\.\s?ed\.?|m\.f\.a\.|ll\.m\.?|${LLM_DEGREE}|(?<!scrum\s)master(?!\s+data(?![a-z]))(?:'?s)?(?:\s+of\s+[a-z]+)?|m\.s\.c?\.?|m\.?sc\.?|m\.a\.|m\.?eng\.?|m\.?b\.?a\.?|m\.?tech\.?|(?<=,\s*)m[as](?=${SUBJECT_AFTER})(?!${STATE_CODE_AFTER}|${MS_PRODUCT_AFTER})|(?<!,\s*|\d\s?)m[as](?!-|\.\s+\p{L}|${STATE_CODE_AFTER}|${MS_PRODUCT_AFTER}))(?![\p{L}\p{M}])`,
    "8": String.raw`(?:\b|^)(doctorate|ph\.?d\.?|d\.?phil\.?)(?![\p{L}\p{M}])`,
  },
};
