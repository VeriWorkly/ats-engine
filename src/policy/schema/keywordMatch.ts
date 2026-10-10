import * as z from "zod/mini";

import { regexString, term, wordList } from "../primitives.js";

/**
 * Heading patterns used to split a posting into blocks. Each block runs to the next heading, so
 * these replace the old fixed-length windows, which overshot the requirements list and promoted
 * nice-to-haves to the required weight. `excluded` blocks (about-us, benefits, EEO boilerplate)
 * are dropped from scoring entirely rather than down-weighted.
 */
const jobSectionSchema = z.object({
  required: regexString("sections.required"),
  preferred: regexString("sections.preferred"),
  responsibilities: regexString("sections.responsibilities"),
  excluded: regexString("sections.excluded"),
});

export const keywordMatchSchema = z
  .object({
    requiredWeight: z.number().check(z.gt(0)),
    preferredWeight: z.number().check(z.gt(0)),
    responsibilitiesWeight: z.number().check(z.gt(0)),
    defaultWeight: z.number().check(z.gt(0)),
    /**
     * Multiplier applied to terms that are not recognised skills and do not read as proper nouns
     * or acronyms in the posting. Ordinary English still counts — a posting can name a real
     * requirement in lowercase prose — but it cannot outvote the skills the role actually asks for.
     */
    generalTermWeight: z.number().check(z.gte(0), z.lte(1)),
    /**
     * Soft skills ("communication", "teamwork"): what a posting asks of a person rather than of
     * their work. A resume claims them and seldom evidences them, and an ATS's keyword match
     * gives them little value, so each is weighed as an ordinary word (`generalTermWeight`)
     * whatever its capitals, times this. The report lists them apart (`missingKeywordGroups`).
     */
    softSkillWeight: z._default(z.number().check(z.gte(0), z.lte(1)), 0.4),
    /**
     * The terms that are soft skills, folded as every term is (`synonyms`, `stemming`): "soft
     * skills" in the report, weighed by `softSkillWeight`, never a recognised hard skill even
     * when `phrases` or `synonyms` name them. A multi-word entry is matched as a phrase. Language
     * packs add their own.
     */
    softSkills: z._default(z.array(term), []),
    sections: jobSectionSchema,
    /**
     * The words a posting offers alternatives with: "Go or Java". The missing-keyword label
     * joins the alternatives with the word the posting itself used.
     */
    alternationWords: z._default(wordList("alternationWords"), ["or"]),
    /**
     * Suffix rules that fold inflections together ("managing" → "manag", like "managed"),
     * applied to every token on both sides of a match, in order, first match wins. One rule set
     * per policy, not per language: a German rule stripping "-er" would fold "engineer" into
     * "engine" on every English token too, so language packs do not change it.
     */
    stemming: z._default(
      z.array(
        z.object({
          suffix: z.string().check(z.minLength(1)),
          minLength: z.number().check(z.int(), z.gte(0)),
          replacement: z.string(),
          /** Skip the rule when the word ends in this instead: "s" but not "ss". */
          unless: z.optional(z.string().check(z.minLength(1))),
        }),
      ),
      [
        // One family whose noun and agent forms fold with the verb: "development", "developer"
        // and "developed" are all "develop". A general "-ment" or "-er" rule would fold
        // "statement" into "state" and "user" into "us".
        { suffix: "elopments", minLength: 8, replacement: "elop" },
        { suffix: "elopment", minLength: 7, replacement: "elop" },
        { suffix: "elopers", minLength: 6, replacement: "elop" },
        { suffix: "eloper", minLength: 5, replacement: "elop" },
        // "-using" and "-used" fold as "-use" does below: "housing", "housed" and "house" to
        // "hou", "focused" and "focus" to "focu".
        { suffix: "using", minLength: 5, replacement: "u" },
        { suffix: "used", minLength: 4, replacement: "u" },
        // A rule that gives a word back unchanged keeps the rules after it off that word: a
        // field is not named for its object, "accounting" is not "account" nor "marketing"
        // "market".
        { suffix: "accounting", minLength: 0, replacement: "accounting" },
        { suffix: "marketing", minLength: 0, replacement: "marketing" },
        // A name with ".js" is kept whole; the "s" rule below left "vue.j". It is not folded onto
        // its plain word: "Next.js" is no "next release", "Express.js" no "expressed concerns".
        // `synonyms` name the ones whose plain name is the framework ("Vue").
        { suffix: ".js", minLength: 0, replacement: ".js" },
        // British spellings fold with American ones, each as its whole family: "modelling" and
        // "modeling", "optimisation" and "optimization", "analysed" and "analyzed", "behaviours"
        // and "behaviors". Every "-ise" word folds so, its own forms with it ("enterprise",
        // "enterprises"); "-lling" only after the letters no one-syllable "-ell" word ends in,
        // so "selling" stays "sell", and not after "c", or "excelled" would be "Excel".
        { suffix: "delling", minLength: 0, replacement: "del" },
        { suffix: "delled", minLength: 0, replacement: "del" },
        { suffix: "belling", minLength: 0, replacement: "bel" },
        { suffix: "belled", minLength: 0, replacement: "bel" },
        { suffix: "velling", minLength: 0, replacement: "vel" },
        { suffix: "velled", minLength: 0, replacement: "vel" },
        { suffix: "isations", minLength: 0, replacement: "ization" },
        { suffix: "isation", minLength: 0, replacement: "ization" },
        { suffix: "isers", minLength: 5, replacement: "izer" },
        { suffix: "iser", minLength: 4, replacement: "izer" },
        { suffix: "ising", minLength: 6, replacement: "iz" },
        { suffix: "ised", minLength: 5, replacement: "iz" },
        { suffix: "ises", minLength: 5, replacement: "iz" },
        { suffix: "ise", minLength: 4, replacement: "iz" },
        { suffix: "yser", minLength: 4, replacement: "yzer" },
        { suffix: "ysing", minLength: 6, replacement: "yz" },
        { suffix: "ysed", minLength: 5, replacement: "yz" },
        { suffix: "yse", minLength: 4, replacement: "yz" },
        // Past four letters: "hour" and "four" stay as they are.
        { suffix: "oural", minLength: 5, replacement: "oral" },
        { suffix: "ours", minLength: 5, replacement: "or" },
        { suffix: "our", minLength: 4, replacement: "or" },
        { suffix: "ing", minLength: 6, replacement: "" },
        { suffix: "ies", minLength: 5, replacement: "y" },
        { suffix: "ed", minLength: 5, replacement: "" },
        // "-es" is a plural ending only after s, x, ch and sh ("processes", "indexes",
        // "searches"); elsewhere the "e" is the word's own ("databases", "pipelines"), and
        // stripping it left "databas" beside "database".
        { suffix: "sses", minLength: 5, replacement: "ss" },
        { suffix: "xes", minLength: 4, replacement: "x" },
        { suffix: "ches", minLength: 5, replacement: "ch" },
        { suffix: "shes", minLength: 5, replacement: "sh" },
        // A singular in "-che" folds as its plural does: "cache" and "caches" to "cach".
        { suffix: "che", minLength: 4, replacement: "ch" },
        // "-ses" is ambiguous: "buses" is "bus" + "es", "cases" is "case" + "s". Singular and
        // plural fold to one shorter form, so either reading meets: "bus", "buses" and "status",
        // "statuses" lose the "s" as "cpus" does ("bu", "statu"); "cause" and "causes" fold to
        // "cau"; "case", "cases", "gas" and "gases" to "cas" and "gas". "uses" (four letters)
        // stays the stopword "use".
        { suffix: "uses", minLength: 4, replacement: "u" },
        { suffix: "use", minLength: 3, replacement: "u" },
        { suffix: "us", minLength: 2, replacement: "u" },
        { suffix: "ases", minLength: 4, replacement: "as" },
        { suffix: "ase", minLength: 3, replacement: "as" },
        // Greek plurals in "-es" for "-is": "analysis" and "analyses" both to "analyz", as
        // "analyse" and "analyze" are. Only the endings that are always such a pair: a general
        // "-ses" rule would part "response" from "responses", and "-oses" "close" from "closes".
        { suffix: "ysis", minLength: 5, replacement: "yz" },
        { suffix: "yses", minLength: 5, replacement: "yz" },
        { suffix: "thesis", minLength: 6, replacement: "thes" },
        { suffix: "theses", minLength: 6, replacement: "thes" },
        { suffix: "gnosis", minLength: 6, replacement: "gnos" },
        { suffix: "gnoses", minLength: 6, replacement: "gnos" },
        // A silent "e" goes, as "-ing" and "-ed" drop it: "nurse", "nurses", "nursing" and
        // "nursed" all to "nurs", "price" and "pricing" to "pric", "machines" and "machine" to
        // "machin". Only past four letters, so "note" does not become "not", nor "code" "cod".
        // "theme" would become the stopword "them", and "these" the "thes" of "theses", so they
        // and "-ese" ("chinese") are given back as they are.
        { suffix: "themes", minLength: 0, replacement: "theme" },
        { suffix: "es", minLength: 5, replacement: "" },
        { suffix: "theme", minLength: 0, replacement: "theme" },
        { suffix: "ese", minLength: 0, replacement: "ese" },
        { suffix: "e", minLength: 4, replacement: "" },
        // Three letters is enough: "apis" is "api". "aws", "ios" and "css" stay as they are.
        { suffix: "s", minLength: 3, replacement: "", unless: "ss" },
      ],
    ),
    /** Endings a multi-word phrase may carry on its last word and still be the same phrase. */
    pluralSuffixes: z._default(wordList("pluralSuffixes"), ["s", "es"]),
    /**
     * Whether the language capitalises every noun, as German does. A capital letter
     * mid-sentence then says nothing about a word being a product or a skill, so only acronyms
     * and inner capitals ("PostgreSQL") count as proper nouns.
     */
    nounsCapitalized: z._default(z.boolean(), false),
    /**
     * Leave out a word the posting writes only as a name: always capitalised, mid-sentence, only
     * in its prose, never in a list, not in this policy's vocabulary, and written the way a name
     * is — in a run of capitalised words ("Harbor Point", "Cedar Valley Health") or after one of
     * `cues` ("At Freightways", "the Sunbelt", "our depot"). "Written in Rust" has no such sign
     * and keeps its word. `skills` are tools and languages spelled like ordinary words, never
     * left out even beside a cue ("Apache Spark", "the Rust compiler").
     *
     * Applies to a posting with at least `minListLines` list lines (bullets, or lines under a
     * required or preferred heading) to compare with; never where `nounsCapitalized` holds, and
     * off in a language pack that says so.
     */
    proseNames: z.prefault(
      z.object({
        enabled: z._default(z.boolean(), true),
        minListLines: z._default(z.number().check(z.int(), z.gt(0)), 3),
        cues: z._default(z.array(term), ["the", "our", "at", "join", "across", "near"]),
        skills: z._default(
          z.array(term),
          [
            // Languages
            "rust swift ruby scala kotlin julia dart elixir haskell erlang clojure groovy " +
              "perl fortran cobol pascal lua crystal ocaml prolog python java javascript " +
              "typescript solidity verilog",
            // Frameworks, libraries and runtimes
            "spark flutter rails django flask laravel symfony spring angular react vue " +
              "svelte ember express gatsby remix astro nuxt node deno pandas numpy pytorch " +
              "tensorflow keras jupyter selenium cypress playwright jest mocha gradle maven " +
              "webpack vite babel unity unreal",
            // Data, infrastructure and cloud
            "hadoop hive kafka airflow flink cassandra redis mongo postgres oracle " +
              "snowflake databricks elasticsearch kibana grafana prometheus datadog splunk " +
              "nginx apache tomcat docker kubernetes terraform ansible puppet chef jenkins " +
              "git linux azure heroku vercel netlify firebase supabase fivetran informatica " +
              "talend alteryx",
            // Business, design and clinical tools
            "excel salesforce hubspot marketo zendesk jira confluence figma sketch " +
              "photoshop illustrator indesign premiere lightroom canva tableau looker shopify " +
              "magento wordpress drupal workday netsuite quickbooks xero stripe twilio epic " +
              "cerner meditech blender maya houdini solidworks autocad revit catia ansys " +
              "stata minitab matlab simulink labview visio outlook powerpoint airtable notion " +
              "asana trello slack",
          ].flatMap((group) => group.split(" ")),
        ),
      }),
      {},
    ),
    /**
     * How a posting states the requirements that filter before any reading: years, a degree,
     * the right to work, a clearance, a language. Each a pattern; years and language patterns
     * capture the number and the language in group 1. Language packs add their own.
     */
    requirements: z.prefault(
      z.object({
        yearsPatterns: z._default(z.array(regexString("requirements.yearsPatterns")), [
          // Not an age: "at least 18 years of age", "21 years or older", "18 years old".
          // `\s*(?:\+\s*)?`, not `\s*\+?\s*`: two adjacent `\s*` split a long run of spaces
          // every possible way, which is quadratic.
          // A range reads its lower end: "3-5 years", "3 to 5 years", "between 3 and 5 years".
          // "and" joins a range only after "between": "Python 3 and 5 years" asks for five. The
          // lookbehind follows the "and", so it runs once per "and", not once per space before it.
          String.raw`(?<!\d)(\d{1,2})\s*(?:\+\s*)?(?:(?:[-–]|to\s|and\s(?<=between\s+\d{1,2}\s*and\s))\s*\d{1,2}\s*)?(?:years?|yrs?)(?![\p{L}])(?![\s-]+(?:of\s+age|old|or\s+older)(?![\p{L}]))`,
          // In words, with or without the figure: "five (5) years", "Five years", "ten (10)+
          // years". Group 1 is the word; `numberWords` gives its value.
          String.raw`(?<![\p{L}])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*(?:\(\s*\d{1,2}\s*(?:\+\s*)?\)\s*)?(?:\+\s*)?(?:years?|yrs?)(?![\p{L}])(?![\s-]+(?:of\s+age|old|or\s+older)(?![\p{L}]))`,
        ]),
        /** Words that let experience stand in for the stated degree: "or equivalent experience". */
        equivalence: z._default(wordList("requirements.equivalence"), [
          String.raw`or\s+equivalent`,
          String.raw`equivalent\s+(?:practical\s+|work\s+)?experience`,
          String.raw`or\s+related\s+field`,
        ]),
        authorization: z._default(wordList("requirements.authorization"), [
          String.raw`authori[sz]ed\s+to\s+work`,
          String.raw`work\s+authori[sz]ation`,
          String.raw`right\s+to\s+work`,
          // Sponsorship of a visa, not of an event: "securing event sponsorship" is sales.
          String.raw`(?:visa|work|immigration|employment)\s+sponsorship`,
          String.raw`(?:requires?|requiring|needs?|needing)\s+sponsorship`,
          String.raw`work\s+permit`,
          String.raw`(?:us|u\.s\.)\s+citizen(?:ship)?`,
          String.raw`green\s+card`,
          String.raw`permanent\s+resident`,
        ]),
        /**
         * What a statement about the right to work says, beyond that it is one. A line that
         * `noSponsorship` ("no sponsorship required", "does not require visa sponsorship") is
         * read without those words first, so their "no" and "not" are not its negation. What is
         * left `needsSponsorship` ("will require H-1B sponsorship") never shows the right to
         * work, and shows its absence where the posting rules sponsorship out (a line of the
         * posting either list matches); what is left with a `negation` shows nothing.
         */
        needsSponsorship: z._default(wordList("requirements.needsSponsorship"), [
          String.raw`(?:requires?|requiring|needs?|needing|will\s+(?:require|need))\s+(?:(?:an?|h-?1b|visa|work|employment|immigration|future)\s+){0,3}sponsorship`,
          String.raw`sponsorship\s+(?:is\s+)?(?:required|needed)`,
        ]),
        // Only words about sponsorship between the "not" and it: "not authorized to work without
        // sponsorship" keeps its "not".
        noSponsorship: z._default(wordList("requirements.noSponsorship"), [
          String.raw`(?:no|without)\s+(?:(?:an?|any|further|future|h-?1b|visa|work|employment|immigration)\s+){0,3}sponsorship`,
          String.raw`(?:not|never|\p{L}+n['’]t)\s+(?:(?:currently|presently|now|ever|be|been|eligible|for|offer\p{L}*|provid\p{L}*|requir\p{L}*|need\p{L}*|an?|any|h-?1b|visa|work|employment|immigration|future)\s+){0,4}sponsor(?:ship)?`,
          String.raw`(?:cannot|unable\s+to)\s+(?:(?:offer|provide)\s+)?(?:visa\s+)?sponsor(?:ship)?`,
          String.raw`sponsorship\s+(?:is\s+)?not\s+(?:required|needed|available|offered|provided)`,
        ]),
        /** Words that say a statement is not so: "Not authorized to work", "no active clearance". */
        negation: z._default(wordList("requirements.negation"), [
          "not",
          "no",
          "without",
          String.raw`lack(?:ing)?`,
          "inactive",
          "expired",
          "cannot",
          "unable",
          String.raw`\p{L}+n['’]t`,
        ]),
        /**
         * Words that say a clearance or a citizenship is not held yet, or any more: "eligible
         * for", "pending", "able to obtain", "former". Not for the right to work itself:
         * "eligible to work in the US" states it.
         */
        notHeld: z._default(wordList("requirements.notHeld"), [
          "eligible",
          "pending",
          String.raw`able\s+to\s+obtain`,
          String.raw`former(?:ly)?`,
        ]),
        /**
         * Citizenship, and the permanent residence that is not it: an ask for `citizenship`
         * that does not also accept `residence` is met by citizenship alone, and a green card
         * says the candidate does not hold it. Only U.S. citizenship by default.
         */
        citizenship: z._default(wordList("requirements.citizenship"), [
          String.raw`(?:us|u\.s\.|united\s+states)\s+citizen(?:ship)?`,
          String.raw`citizen\s+of\s+the\s+(?:us|u\.s\.|united\s+states)`,
        ]),
        residence: z._default(wordList("requirements.residence"), [
          String.raw`green\s+card`,
          String.raw`(?:lawful\s+)?permanent\s+residen(?:t|cy|ce)`,
        ]),
        // Qualified, never bare: "customs clearance" is logistics, not a security vetting.
        clearance: z._default(wordList("requirements.clearance"), [
          String.raw`(?:security|confidential|secret|top\s+secret|ts/sci|ts|sci|dv|sc|government|federal)\s+clearance`,
          String.raw`ts(?:\s*/\s*|-)sci`,
        ]),
        /**
         * Clearance levels, lowest first. A level asked is met by it or any above it; the lowest
         * a posting names is its bar ("Secret or Top Secret"). The first pattern list that
         * matches, from the highest down, names a line's level: "Top Secret" is not also
         * "Secret". "TS" is Top Secret only beside "clearance".
         */
        clearanceLevels: z._default(
          z.array(
            z.object({
              name: z.string().check(z.minLength(1)),
              patterns: wordList("requirements.clearanceLevels"),
            }),
          ),
          [
            { name: "Confidential", patterns: ["confidential"] },
            { name: "Secret", patterns: ["secret"] },
            {
              name: "Top Secret",
              patterns: [String.raw`top[\s-]+secret`, String.raw`ts\s+clearance`],
            },
            {
              name: "TS/SCI",
              patterns: [
                String.raw`ts(?:\s*/\s*|[\s-]+)sci`,
                String.raw`top[\s-]+secret(?:\s*/\s*|[\s-]+)sci`,
              ],
            },
          ],
        ),
        languagePatterns: z._default(z.array(regexString("requirements.languagePatterns")), [
          String.raw`(?:fluent|fluency|proficien(?:t|cy)|native|business[\s-]level|working\s+proficiency|professional\s+proficiency)\s+(?:in\s+|with\s+)?(\p{L}+)`,
        ]),
        /**
         * A language's name in other languages, keyed to its English name, lowercase: a German
         * posting asks for "Englisch", the resume says "English". Language packs fill it in.
         *
         * Also the list of what *is* a language: a `languagePatterns` capture becomes a language
         * requirement only when it is a key or a value here, so "proficient in Python" is judged
         * as the skill it names. The English names map to themselves.
         */
        languageNames: z._default(
          z.record(z.string().check(z.minLength(1)), z.string().check(z.minLength(1))),
          Object.fromEntries(
            [
              "arabic",
              "bengali",
              "bulgarian",
              "cantonese",
              "chinese",
              "croatian",
              "czech",
              "danish",
              "dutch",
              "english",
              "filipino",
              "finnish",
              "french",
              "german",
              "greek",
              "gujarati",
              "hebrew",
              "hindi",
              "hungarian",
              "indonesian",
              "italian",
              "japanese",
              "kannada",
              "korean",
              "malay",
              "malayalam",
              "mandarin",
              "marathi",
              "norwegian",
              "persian",
              "polish",
              "portuguese",
              "punjabi",
              "romanian",
              "russian",
              "serbian",
              "slovak",
              "spanish",
              "swahili",
              "swedish",
              "tagalog",
              "tamil",
              "telugu",
              "thai",
              "turkish",
              "ukrainian",
              "urdu",
              "vietnamese",
            ].map((name) => [name, name]),
          ),
        ),
      }),
      {},
    ),
    /**
     * Number words a years pattern may capture instead of a figure: "five years". Also never
     * keywords: "five" is not a skill a candidate is missing.
     */
    numberWords: z._default(z.record(term, z.number().check(z.int(), z.gt(0))), {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      fifteen: 15,
      twenty: 20,
    }),
    /**
     * Words that make an activity or a credential part of a requirement, so a requirement is not
     * met by its object alone: "mentoring engineers" by an engineering title, "AWS
     * certification" by "deployed on AWS". Each group is one ask, met by any of its words; a
     * `sameLine` group must appear on a resume line that also names the requirement's skill
     * (the certificate *in* AWS).
     */
    qualifiers: z._default(
      z.array(
        z.object({
          words: z.array(term).check(z.minLength(1)),
          sameLine: z._default(z.boolean(), false),
        }),
      ),
      [
        {
          words: ["mentoring", "mentor", "mentored", "mentorship", "coaching", "coached"],
          sameLine: false,
        },
        { words: ["leading", "lead", "led", "leadership"], sameLine: false },
        // Not "management": "project management tools" names a field, not managing people.
        { words: ["managing", "manage", "managed", "manager"], sameLine: false },
        {
          words: ["certification", "certified", "certificate", "certifications", "certificates"],
          sameLine: true,
        },
        { words: ["license", "licence", "licensed", "licensure"], sameLine: true },
      ],
    ),
    /**
     * What marks a clause of a requirement as optional: "Bachelor's degree required; MBA a
     * plus". The clause is read as preferred and does not raise the level the line asks for.
     */
    preferredMarkers: z._default(wordList("preferredMarkers"), [
      String.raw`a\s+plus`,
      String.raw`is\s+a\s+plus`,
      "preferred",
      String.raw`nice\s+to\s+have`,
      String.raw`(?:a\s+)?bonus`,
      "desirable",
      "ideally",
      String.raw`an\s+advantage`,
    ]),
    /**
     * Text in a posting that is never a keyword: a "City, ST" location. Compiled
     * case-sensitively and globally; each must be linear on hostile input.
     */
    ignorePatterns: z._default(z.array(regexString("ignorePatterns")), [
      String.raw`(?<![\p{L}])\p{Lu}[\p{L}'.-]{0,30}(?:\s\p{Lu}[\p{L}'.-]{0,30}){0,2},\s{0,3}(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?![\p{L}\p{N}/+#])`,
      // Without the comma, only where an address ends — the line, a stop or a ZIP code: "Office
      // in Boston MA", "Cambridge MA 02139". Not "Requires MS in Computer Science", where the
      // state code is a degree.
      String.raw`(?<![\p{L}])\p{Lu}\p{Ll}[\p{L}'.-]{0,30}(?:\s\p{Lu}\p{Ll}[\p{L}'.-]{0,30}){0,2}\s(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?=\s{0,3}(?:$|[.,;:)|]|\d{5}(?!\d)))`,
    ]),
    /**
     * What a posting offers rather than asks: "Salary range $175,000 – $215,000", "Benefits:
     * health, dental". A line that opens with one of these as its label ("Benefits:", "Pay
     * range"), or names one beside an amount of money, is not a requirement. Only then, so
     * "Compensation analysis experience" and "Equity research" stay requirements.
     */
    offerWords: z._default(wordList("offerWords"), [
      "salary",
      "compensation",
      String.raw`pay\s+range`,
      String.raw`base\s+pay`,
      "wage",
      "wages",
      "benefits",
      "perks",
      "equity",
      String.raw`stock\s+options`,
    ]),
    /**
     * Labels of a line that states a nationality, never a language: "Nationality: German",
     * "Staatsangehörigkeit: deutsch". Such a line is no evidence of speaking the language.
     */
    nationalityLabels: z._default(wordList("nationalityLabels"), [
      "nationality",
      "citizenship",
      String.raw`staatsangeh(?:ö|oe)rigkeit`,
      String.raw`nationalit(?:ä|ae)t`,
    ]),
    stopwords: z.array(term),
    synonyms: z.record(term, term),
    /**
     * One-way skill implications, applied to the resume only: holding the key demonstrates the
     * values. Terraform *is* infrastructure as code; PostgreSQL *is* a relational database. Plain
     * token equality reported those as gaps and told the candidate to add words describing work
     * the resume already evidenced.
     *
     * Deliberately not symmetric. "Terraform" implies "infrastructure as code"; the reverse does
     * not hold, and inferring it would credit the candidate with a tool they never named.
     */
    implies: z.record(term, z.array(term)),
    phrases: z.array(term),
    buzzwords: z.array(term),
  })
  .check(
    z.superRefine((km, ctx) => {
      /**
       * A multi-word term only ever becomes a single token by matching the phrase list first. One
       * that appears in `implies` or `synonyms` but not in `phrases` therefore never resolves: the
       * posting scatters it into unrelated single words and the implication silently does nothing.
       * Catching it here turns a quiet scoring hole into a startup failure naming the term.
       */
      // A multi-word soft skill is matched as a phrase too.
      const phrases = new Set([...km.phrases, ...km.softSkills]);
      const multiWord = new Set<string>();

      for (const [skill, capabilities] of Object.entries(km.implies)) {
        if (skill.includes(" ")) multiWord.add(skill);
        for (const capability of capabilities)
          if (capability.includes(" ")) multiWord.add(capability);
      }
      for (const canonical of Object.values(km.synonyms))
        if (canonical.includes(" ")) multiWord.add(canonical);

      for (const term of multiWord)
        if (!phrases.has(term))
          ctx.addIssue({
            code: "custom",
            path: ["phrases"],
            message: `multi-word term "${term}" is referenced by implies/synonyms but missing from phrases and softSkills, so it can never match`,
          });
    }),
  );
