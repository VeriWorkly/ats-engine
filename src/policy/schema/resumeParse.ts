import * as z from "zod/mini";

import {
  cefrLevels,
  credentialWords,
  iscedDegrees,
  monthNumber,
  regexString,
  seasonRanges,
  wordList,
} from "../primitives.js";

/** Vocabulary the resume parser needs. */
export const resumeParseSchema = z.object({
  sections: z.object({
    experience: regexString("sections.experience"),
    education: regexString("sections.education"),
    skills: regexString("sections.skills"),
    projects: regexString("sections.projects"),
    /**
     * Certifications and licences, each line read as a row: name, issuer, dates. Tried before
     * `other`; "Education and Certifications" stays education, which is tried first.
     */
    certifications: z._default(
      regexString("sections.certifications"),
      String.raw`^(?:(?:professional\s+)?certifications?|certificates|licen[cs]es?|licensure|credentials)`,
    ),
    /**
     * Spoken languages, each read as a row with its level. Not "Programming Languages"; a
     * "Languages: Go, Rust" line among the skills stays a skills line.
     */
    languages: z._default(
      regexString("sections.languages"),
      String.raw`^(?:(?:spoken|foreign)\s+)?languages|^language\s+(?:skills|proficienc(?:y|ies)|competenc(?:y|ies))`,
    ),
    /** Any other heading. Classified only so that it terminates the block above it. */
    other: regexString("sections.other"),
  }),
  /**
   * Words that state how well a language is spoken (whole words or small patterns, ignoring
   * case) and the CEFR level each stands for. An explicit level ("B2") needs no entry and wins
   * over a word beside it. The same words read a posting's ask. Packs add their own.
   */
  languageLevels: z._default(cefrLevels("languageLevels"), {
    [String.raw`native\s+or\s+bilingual(?:\s+proficiency)?`]: "C2",
    [String.raw`full\s+professional(?:\s+proficiency)?`]: "C2",
    [String.raw`native(?:\s+speaker)?`]: "C2",
    [String.raw`mother\s+tongue`]: "C2",
    [String.raw`first\s+language`]: "C2",
    bilingual: "C1",
    [String.raw`professional\s+working(?:\s+proficiency)?`]: "C1",
    professional: "C1",
    fluent: "C1",
    fluency: "C1",
    proficient: "C1",
    advanced: "C1",
    [String.raw`business\s+fluent`]: "C1",
    [String.raw`business[\s-]level`]: "B2",
    [String.raw`upper[\s-]intermediate`]: "B2",
    [String.raw`limited\s+working(?:\s+proficiency)?`]: "B1",
    // Alone, "limited" claims less than "limited working proficiency".
    [String.raw`limited(?:\s+proficiency)?`]: "A2",
    [String.raw`working\s+knowledge`]: "B1",
    conversational: "B1",
    intermediate: "B1",
    [String.raw`elementary(?:\s+proficiency)?`]: "A2",
    basic: "A2",
    [String.raw`school[\s-]level`]: "A2",
    beginner: "A1",
    // Not "learning" alone: "machine learning".
    [String.raw`(?:currently|still)\s+learning`]: "A1",
  }),
  /**
   * The words around a certification's dates and issuer ("Issued Mar 2022", "expires 2027",
   * "Credential ID 9X7Y"). A date after an `expires` word is the expiry; a part opening with an
   * `id` word is dropped.
   */
  credentialWords: z.prefault(credentialWords, {}),
  /**
   * Month name to month number. Each key is a whole word, matched with an optional full stop:
   * list every spelling to read, "jan" and "january" alike.
   */
  months: z._default(z.record(z.string(), monthNumber), {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }),
  /**
   * Seasons a resume dates a term by ("Spring 2020 - Fall 2021"), as the first and last month
   * each covers. A range runs from its first season's first month to its last season's last.
   */
  seasons: z._default(seasonRanges, {
    spring: [3, 5],
    summer: [6, 8],
    fall: [9, 11],
    autumn: [9, 11],
    winter: [1, 3],
  }),
  /** The ways a resume says a role is still current. */
  openEnded: z._default(z.array(z.string().check(z.minLength(1))).check(z.minLength(1)), [
    "present",
    "current",
    // A JSON Resume end written out: "Current role".
    "current role",
    "current position",
    "now",
    "ongoing",
    "to date",
    "till date",
    "till now",
    "today",
    "continuing",
    // After the start alone: "Jun 2021 onwards".
    "onwards",
    "onward",
  ]),
  /**
   * Units of a duration written beside a date range ("4 yrs 9 mos"). A number before one is the
   * role's duration, not its title or employer.
   */
  durationUnits: z._default(wordList("durationUnits"), [
    "yr",
    "yrs",
    "year",
    "years",
    "mo",
    "mos",
    "month",
    "months",
  ]),
  /** Labels a resume writes its owner's name under: "Name: Jane Doe". */
  nameLabels: z._default(wordList("nameLabels"), ["name", "full name"]),
  /** Words between the two ends of a date range besides a dash: "2019 to 2022", "2019 bis 2022". */
  rangeWords: z._default(wordList("rangeWords"), ["to", "until", "through", "thru"]),
  /** Words before a lone start date that make it a current role: "since 2019", "seit 03/2019". */
  sinceWords: z._default(wordList("sinceWords"), ["since"]),
  /**
   * Open ends and since words that are also everyday words, listed there too: one dates a role
   * only where its date ends the line or a column ("Jun 2021 onwards", "Jun 2021 - Continuing |
   * Remote"), not in a sentence ("2020 onwards, growth of 30%").
   */
  lineEndDateWords: z._default(wordList("lineEndDateWords"), ["continuing", "onwards", "onward"]),
  /**
   * Time off a work history dates like a role ("Parental leave, 03/2024 – Present", "Career
   * break 2019 – 2020"). An entry whose whole title is one of these is no role: it adds no months
   * of experience and no title. Matched whole, ignoring case; a bracket after it is allowed
   * ("Sabbatical (travel)"), but not a title around it ("Visiting Professor (sabbatical)").
   */
  leaveWords: z._default(wordList("leaveWords"), [
    String.raw`(?:parental|maternity|paternity|family|medical|sick|study)\s+leave`,
    String.raw`leave\s+of\s+absence`,
    String.raw`career\s+break`,
    "sabbatical",
  ]),
  /** Words joining a job title to its employer on one line: "Engineer at Acme". */
  employerWords: z._default(wordList("employerWords"), ["at"]),
  /** What the top of a resume says in place of a name; never taken as the candidate's name. */
  documentTitles: z._default(wordList("documentTitles"), [
    "resume",
    "résumé",
    "curriculum vitae",
    "cv",
  ]),
  /**
   * Taglines a resume may open with that have a name's shape ("Open Source | Software Engineer"):
   * never read as the name, though the email or a link spells them. Matched whole, ignoring case,
   * with each hyphen or run of spaces read as one space. Read only to find the name; job matching
   * never sees this list.
   */
  notNames: z._default(wordList("notNames"), [
    "open source",
    "data science",
    "cloud native",
    "machine learning",
    "deep learning",
    "artificial intelligence",
    "full stack",
    "big data",
  ]),
  /** Lowercase words a name may hold between its capitalised ones ("Ludwig van Beethoven"), for every language. */
  nameParticles: z._default(wordList("nameParticles"), [
    "van",
    "von",
    "der",
    "den",
    "de",
    "del",
    "della",
    "la",
    "le",
    "da",
    "di",
    "du",
    "dos",
    "das",
    "y",
    "ter",
    "ten",
    "bin",
    "binti",
    "ibn",
    "al",
    "el",
  ]),
  /** Credentials written after a name ("Jane Doe, MD"); a name cut from one is the name. Matched whole, ignoring case. */
  postNominals: z._default(wordList("postNominals"), [
    String.raw`ph\.?d\.?`,
    String.raw`m\.?d\.?`,
    String.raw`d\.?o\.?`,
    String.raw`j\.?d\.?`,
    String.raw`esq\.?`,
    "mba",
    "msc",
    "bsc",
    "cpa",
    "cfa",
    "cma",
    "acca",
    "pmp",
    "cissp",
    "csm",
    String.raw`p\.?e\.?`,
    String.raw`r\.?n\.?`,
    "bsn",
    "msn",
    "np",
    "rd",
    "dds",
    "dmd",
    "dvm",
    "pharmd",
    "lcsw",
    "frcs",
    "mrcp",
  ]),
  /**
   * Two-letter state and province codes written in capitals after a city ("New York, NY"). A
   * name cut from one is a place, unless it is also in `postNominals` ("MD"). Matched whole and
   * case-sensitively.
   */
  regionCodes: z._default(
    wordList("regionCodes"),
    (
      "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ " +
      "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY " +
      "AB BC MB NB NL NS NT NU ON PE QC SK YT"
    ).split(" "),
  ),
  /**
   * Countries and short forms, and the states, provinces and territories of the United States,
   * Canada, India and Australia and the nations of the United Kingdom, in full: what a city is
   * written with ("Berlin, Germany"). No cities. Matched whole, ignoring case. Each entry is a
   * pattern for one name and its spellings ("u[.]?k[.]?"), written as one string cut at its bars.
   */
  placeNames: z._default(
    wordList("placeNames"),
    // Countries.
    (
      "afghanistan|albania|algeria|andorra|angola|antigua and barbuda|argentina|armenia|" +
      "australia|austria|azerbaijan|(?:the )?bahamas|bahrain|bangladesh|barbados|belarus|" +
      "belgium|belize|benin|bhutan|bolivia|bosnia and herzegovina|botswana|brazil|brunei|" +
      "bulgaria|burkina faso|burundi|cabo verde|cape verde|cambodia|cameroon|canada|" +
      "central african republic|chad|chile|china|colombia|comoros|congo|dr congo|" +
      "democratic republic of the congo|costa rica|c[ôo]te d['’]ivoire|ivory coast|croatia|cuba|cyprus|" +
      "czechia|czech republic|denmark|djibouti|dominica|dominican republic|ecuador|egypt|" +
      "el salvador|equatorial guinea|eritrea|estonia|eswatini|ethiopia|fiji|finland|france|" +
      "gabon|(?:the )?gambia|georgia|germany|ghana|greece|grenada|guatemala|guinea|" +
      "guinea-bissau|guyana|haiti|honduras|hong kong|hungary|iceland|india|indonesia|iran|" +
      "iraq|ireland|israel|italy|jamaica|japan|jordan|kazakhstan|kenya|kiribati|kosovo|kuwait|" +
      "kyrgyzstan|laos|latvia|lebanon|lesotho|liberia|libya|liechtenstein|lithuania|" +
      "luxembourg|maca[uo]|madagascar|malawi|malaysia|maldives|mali|malta|" +
      "marshall islands|mauritania|mauritius|mexico|micronesia|moldova|monaco|mongolia|" +
      "montenegro|morocco|mozambique|myanmar|namibia|nauru|nepal|(?:the )?netherlands|" +
      "new zealand|nicaragua|niger|nigeria|north korea|north macedonia|norway|oman|pakistan|" +
      "palau|palestine|panama|papua new guinea|paraguay|peru|(?:the )?philippines|poland|" +
      "portugal|puerto rico|qatar|romania|russia|rwanda|saint kitts and nevis|saint lucia|" +
      "saint vincent and the grenadines|samoa|san marino|s[ãa]o tom[ée] and pr[íi]ncipe|" +
      "saudi arabia|senegal|serbia|seychelles|sierra leone|singapore|" +
      "slovakia|slovenia|solomon islands|somalia|south africa|(?:south )?korea|south sudan|" +
      "spain|sri lanka|sudan|suriname|sweden|switzerland|syria|taiwan|tajikistan|tanzania|" +
      "thailand|timor-leste|togo|tonga|trinidad and tobago|tunisia|turkey|türkiye|" +
      "turkmenistan|tuvalu|uganda|ukraine|(?:the )?united arab emirates|u[.]?a[.]?e[.]?|" +
      "(?:the )?united kingdom|great britain|u[.]?k[.]?|(?:the )?united states(?: of america)?|" +
      "u[.]?s[.]?(?:a[.]?)?|uruguay|uzbekistan|vanuatu|vatican city|venezuela|viet ?nam|yemen|" +
      "zambia|zimbabwe|" +
      // The United States.
      "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|" +
      "hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|" +
      "massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|" +
      "new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|" +
      "oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|" +
      "utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|" +
      "d[.]c[.]|" +
      // Canada.
      "alberta|british columbia|manitoba|new brunswick|newfoundland and labrador|" +
      "northwest territories|nova scotia|nunavut|ontario|prince edward island|qu[ée]bec|" +
      "saskatchewan|yukon|" +
      // India.
      "andhra pradesh|arunachal pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|" +
      "himachal pradesh|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|" +
      "meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil nadu|telangana|" +
      "tripura|uttar pradesh|uttarakhand|west bengal|andaman and nicobar islands|chandigarh|" +
      "dadra and nagar haveli and daman and diu|delhi|jammu and kashmir|ladakh|lakshadweep|" +
      "puducherry|" +
      // Australia.
      "new south wales|victoria|queensland|south australia|western australia|tasmania|" +
      "australian capital territory|northern territory|" +
      // The United Kingdom.
      "england|scotland|wales|northern ireland"
    ).split("|"),
  ),
  /** Words that say how or where a role is worked rather than for whom: "Remote", "Hybrid". */
  workplaceWords: z._default(wordList("workplaceWords"), [
    "remote",
    "hybrid",
    "on-?site",
    "in-office",
    "work from home",
    "wfh",
  ]),
  /**
   * Words that name an organisation rather than a job title, besides `schoolWords`: a legal form
   * ("Corp", "GmbH") or an institution's kind ("Hospital"). They tell an employer from a title's
   * qualifier. "Co" counts only when no hyphen follows ("Co-Founder" is a title).
   */
  organisationWords: z._default(wordList("organisationWords"), [
    String.raw`inc\.?`,
    "incorporated",
    String.raw`l\.?l\.?c\.?`,
    String.raw`l\.?l\.?p\.?`,
    String.raw`ltd\.?`,
    "limited",
    "plc",
    "gmbh",
    String.raw`corp\.?`,
    "corporation",
    String.raw`co(?!-)\.?`,
    "company",
    String.raw`pvt\.?`,
    String.raw`pty\.?`,
    "hospital",
    "clinic",
    "bank",
    "foundation",
    "ministry",
  ]),
  /**
   * Words naming a department or function, not an employer ("Director, Product Management |
   * Google"). A part made only of these and `headingConnectors` stays with the title before it.
   * Not "security": "Security Finance" can be a company.
   */
  departmentWords: z._default(
    wordList("departmentWords"),
    (
      "management engineering product marketing sales operations finance research development " +
      "design platform infrastructure strategy technology data analytics growth " +
      "partnerships communications business team"
    ).split(" "),
  ),
  /** Lowercase words a capitalised heading may join its words with ("Skills and Tools"); any other reads as prose. */
  headingConnectors: z._default(wordList("headingConnectors"), ["and"]),
  /** Labels a resume states a date of birth under: "Date of birth: 4 May 1990". */
  dateOfBirthLabels: z._default(wordList("dateOfBirthLabels"), [
    "date of birth",
    String.raw`d\.o\.b\.?`,
    "dob",
    "born",
  ]),
  /**
   * How an all-numeric date with a day is ordered ("03/04/2021" is 4 March in the US, 3 April in
   * Germany). A part over 12 settles it either way. Set by a region pack.
   */
  dateOrder: z._default(z.enum(["MDY", "DMY", "YMD"]), "MDY"),
  /**
   * ISO 3166 countries a phone number without a country code is tried as, in order. Set by a
   * region pack.
   */
  phoneRegions: z._default(
    z
      .array(z.string().check(z.regex(/^[A-Z]{2}$/, "a two-letter ISO 3166 country code")))
      .check(z.minLength(1)),
    ["US"],
  ),
  /** Words that mark a fragment as a job title rather than an employer name. */
  titleWords: wordList("titleWords"),
  /** Words that mark a fragment as an institution. */
  schoolWords: wordList("schoolWords"),
  /**
   * One pattern per ISCED 2011 level (see `AtsIscedLevel`), naming the credentials at it. Levels
   * are tried highest first, so a level's pattern must not match a lower level's credential
   * ("high school diploma" is level 3).
   */
  degrees: iscedDegrees.check(
    z.refine((degrees) => Object.values(degrees).some(Boolean), {
      message: "degrees must name at least one level",
    }),
  ),
});
