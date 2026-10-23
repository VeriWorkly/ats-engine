import * as z from "zod/mini";

import { regexString, term, wordList } from "../primitives.js";

/**
 * What follows a UK clearance level: "clearance", "vetting" or "cleared", after at most three
 * more levels in a list ("SC or DV clearance"). Bounded, so a run of levels costs few steps.
 */
const UK_LEVEL_BEFORE = String.raw`(?=(?:\s*(?:/|,|or|and)\s*(?:bpss|ctc|sc|dv)){0,3}\s+(?:clearance|vetting|cleared))`;
/** A UK level in brackets after the clearance it names: "security clearance (SC)". */
const UK_LEVEL_AFTER = String.raw`(?<=(?:clearance|vetting)\s{0,3}\()`;

/**
 * Heading patterns that split a posting into blocks, each running to the next heading.
 * `excluded` blocks (about-us, benefits, EEO boilerplate) are dropped from scoring entirely.
 */
const jobSectionSchema = z.object({
  required: regexString("sections.required"),
  preferred: regexString("sections.preferred"),
  responsibilities: regexString("sections.responsibilities"),
  excluded: regexString("sections.excluded"),
});

export const keywordMatchSchema = z
  .object({
    requiredWeight: z.number().check(z.gt(0), z.lte(1000)),
    preferredWeight: z.number().check(z.gt(0), z.lte(1000)),
    responsibilitiesWeight: z.number().check(z.gt(0), z.lte(1000)),
    defaultWeight: z.number().check(z.gt(0), z.lte(1000)),
    /**
     * Multiplier for terms that are not recognised skills and do not read as proper nouns or
     * acronyms in the posting, so ordinary words count but cannot outvote the skills asked for.
     */
    generalTermWeight: z.number().check(z.gte(0), z.lte(1)),
    /**
     * Weight multiplier for soft skills ("communication"): a resume claims them and seldom
     * evidences them. Each is weighed as an ordinary word (`generalTermWeight`) times this, and
     * the report lists them apart (`missingKeywordGroups`).
     */
    softSkillWeight: z._default(z.number().check(z.gte(0), z.lte(1)), 0.4),
    /**
     * The terms that are soft skills, folded as every term is (`synonyms`, `stemming`), never a
     * recognised hard skill even when `phrases` or `synonyms` name them. A multi-word entry is
     * matched as a phrase. Language packs add their own.
     */
    softSkills: z._default(z.array(term), []),
    sections: jobSectionSchema,
    /** The words a posting offers alternatives with ("Go or Java"), reused in the missing-keyword label. */
    alternationWords: z._default(wordList("alternationWords"), ["or"]),
    /**
     * Suffix rules that fold inflections together ("managing" to "manag"), applied to every token
     * on both sides of a match, in order, first match wins. One rule set per policy: a German
     * "-er" rule would fold "engineer" to "engine", so language packs do not change it.
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
      (
        [
          // "development", "developer" and "developed" fold together; a general "-ment" or "-er"
          // rule would fold "statement" to "state".
          ["elopments", 8, "elop"],
          ["elopment", 7, "elop"],
          ["elopers", 6, "elop"],
          ["eloper", 5, "elop"],
          // "-using" and "-used" fold as "-use" does below.
          ["using", 5, "u"],
          ["used", 4, "u"],
          // Returned unchanged, which keeps later rules off the word: "accounting" is not "account".
          ["accounting", 0, "accounting"],
          ["marketing", 0, "marketing"],
          // Kept whole ("Next.js" is no "next release"); `synonyms` map the ones named for a framework.
          [".js", 0, ".js"],
          // British spellings fold with American ones, as whole families. "-lling" only after
          // letters no one-syllable "-ell" word ends in ("selling" stays "sell"), and not after "c".
          ["delling", 0, "del"],
          ["delled", 0, "del"],
          ["belling", 0, "bel"],
          ["belled", 0, "bel"],
          ["velling", 0, "vel"],
          ["velled", 0, "vel"],
          ["isations", 0, "ization"],
          ["isation", 0, "ization"],
          ["isers", 5, "izer"],
          ["iser", 4, "izer"],
          ["ising", 6, "iz"],
          ["ised", 5, "iz"],
          ["ises", 5, "iz"],
          ["ise", 4, "iz"],
          ["yser", 4, "yzer"],
          ["ysing", 6, "yz"],
          ["ysed", 5, "yz"],
          ["yse", 4, "yz"],
          // Past four letters: "hour" and "four" stay.
          ["oural", 5, "oral"],
          ["ours", 5, "or"],
          ["our", 4, "or"],
          ["ing", 6, ""],
          ["ies", 5, "y"],
          ["ed", 5, ""],
          // "-es" is a plural only after s, x, ch and sh; elsewhere the "e" is the word's own.
          ["sses", 5, "ss"],
          ["xes", 4, "x"],
          ["ches", 5, "ch"],
          ["shes", 5, "sh"],
          // "cache" and "caches" fold together.
          ["che", 4, "ch"],
          // "-ses" is ambiguous ("buses", "cases"): singular and plural fold to one shorter form so
          // either reading meets. "uses" stays the stopword "use".
          ["uses", 4, "u"],
          ["use", 3, "u"],
          ["us", 2, "u"],
          ["ases", 4, "as"],
          ["ase", 3, "as"],
          // Greek "-is"/"-es" pairs only: a general "-ses" rule would part "response" from "responses".
          ["ysis", 5, "yz"],
          ["yses", 5, "yz"],
          ["thesis", 6, "thes"],
          ["theses", 6, "thes"],
          ["gnosis", 6, "gnos"],
          ["gnoses", 6, "gnos"],
          // A silent "e" goes, past four letters ("note" stays). "theme", "these" and "-ese" are
          // given back as they are.
          ["themes", 0, "theme"],
          ["es", 5, ""],
          ["theme", 0, "theme"],
          ["ese", 0, "ese"],
          ["e", 4, ""],
          // Three letters is enough ("apis"); "aws", "ios" and "css" stay.
          ["s", 3, "", "ss"],
        ] as Array<[string, number, string, string?]>
      ).map(([suffix, minLength, replacement, unless]) => ({
        suffix,
        minLength,
        replacement,
        ...(unless && { unless }),
      })),
    ),
    /** Endings a multi-word phrase may carry on its last word and still be the same phrase. */
    pluralSuffixes: z._default(wordList("pluralSuffixes"), ["s", "es"]),
    /**
     * Whether the language capitalises every noun, as German does, so a mid-sentence capital
     * says nothing and only acronyms and inner capitals ("PostgreSQL") count as proper nouns.
     */
    nounsCapitalized: z._default(z.boolean(), false),
    /**
     * Leave out a word the posting writes only as a name: always capitalised, mid-sentence, only
     * in prose, never in a list, not in this policy's vocabulary, and in a run of capitalised
     * words or after one of `cues`. `skills` are never left out. Applies to a posting with at
     * least `minListLines` list lines; never where `nounsCapitalized` holds, and off in a
     * language pack that says so.
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
     * How a posting states the requirements that filter before any reading: years, a degree, the
     * right to work, a clearance, a language. Each a pattern; years and language patterns capture
     * the number or language in group 1. Language packs add their own.
     */
    requirements: z.prefault(
      z.object({
        yearsPatterns: z._default(z.array(regexString("requirements.yearsPatterns")), [
          // Not an age ("18 years old"). `\s*(?:\+\s*)?`, not `\s*\+?\s*`: adjacent `\s*` is quadratic.
          // A range reads its lower end; "and" joins one only after "between" ("Python 3 and 5
          // years" asks for five), with the lookbehind after the "and" so it runs once per "and".
          String.raw`(?<!\d)(\d{1,2})\s*(?:\+\s*)?(?:(?:[-–]|to\s|and\s(?<=between\s+\d{1,2}\s*and\s))\s*\d{1,2}\s*)?(?:years?|yrs?)(?![\p{L}])(?![\s-]+(?:of\s+age|old|or\s+older)(?![\p{L}]))`,
          // In words, with or without the figure; group 1 is the word (`numberWords` gives its value).
          String.raw`(?<![\p{L}])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*(?:\(\s*\d{1,2}\s*(?:\+\s*)?\)\s*)?(?:\+\s*)?(?:years?|yrs?)(?![\p{L}])(?![\s-]+(?:of\s+age|old|or\s+older)(?![\p{L}]))`,
        ]),
        /** Words that let experience stand in for the stated degree ("or equivalent experience"). */
        equivalence: z._default(wordList("requirements.equivalence"), [
          String.raw`or\s+equivalent`,
          String.raw`equivalent\s+(?:practical\s+|work\s+)?experience`,
        ]),
        /**
         * Words widening the degree's field ("or a related field"): no equivalent experience, and
         * no alternative to the years beside the degree.
         */
        relatedField: z._default(wordList("requirements.relatedField"), [
          String.raw`or\s+(?:(?:an?|another|other)\s+)?related\s+(?:field|discipline|area|subject)s?`,
        ]),
        /**
         * Fields of study a posting abbreviates, each to the words it stands for: "CS" asked is
         * held by "Computer Science" in a degree's own words, never in its school's name. Not
         * "IT", "IS" or "ME", which are `stopwords` and so never a field asked, nor "CE", which is
         * civil engineering as often as computer engineering.
         */
        fieldAbbreviations: z._default(z.record(term, term), {
          cs: "computer science",
          ee: "electrical engineering",
          ai: "artificial intelligence",
          ml: "machine learning",
          hr: "human resources",
          ba: "business administration",
        }),
        authorization: z._default(wordList("requirements.authorization"), [
          String.raw`authori[sz]ed\s+to\s+work`,
          String.raw`work\s+authori[sz]ation`,
          String.raw`right\s+to\s+work`,
          // Visa sponsorship, not event sponsorship.
          String.raw`(?:visa|work|immigration|employment)\s+sponsorship`,
          String.raw`(?:requires?|requiring|needs?|needing)\s+sponsorship`,
          String.raw`work\s+permit`,
          String.raw`(?:us|u\.s\.)\s+citizen(?:ship)?`,
          String.raw`(?:british|uk|u\.k\.|eu|e\.u\.|(?<!(?:latin|south|central|north)\s)american|canadian|australian|irish|indian)\s+citizen(?:ship)?`,
          String.raw`green\s+card`,
          String.raw`permanent\s+resident`,
        ]),
        /**
         * The countries a right to work or a citizenship is stated for, each a name and the ways
         * of writing it. A statement naming only other countries than the posting asks about is
         * no evidence ("Authorized to work in the US" for a UK role); one naming none is read as
         * it stands. A citizenship meets a citizenship asked only of its own country.
         * `citizensWorkIn` names the other countries whose right to work its citizens hold: an
         * Irish citizen may work in the UK and the EU, but is no British citizen.
         */
        countries: z._default(
          z.array(
            z.object({
              name: z.string().check(z.minLength(1)),
              patterns: wordList("requirements.countries"),
              citizensWorkIn: z.optional(z.array(z.string().check(z.minLength(1)))),
            }),
          ),
          [
            {
              name: "US",
              patterns: [
                // Not "us" the pronoun ("Tell us"): dotted, "USA", after "the", "in" or "and",
                // beside "&" or "/" ("Canada/US"), or before a word about the right to work.
                String.raw`u\.s\.(?:a\.)?`,
                "usa",
                // Bounded, so a long run of spaces is not read back over at every position. After a
                // comma or a colon in a list ("Canada, US", "Work authorization: US").
                String.raw`(?<=(?:(?:the|in|and)\s{1,3}|[&/,:]\s{0,3}))us`,
                String.raw`us(?=\s{0,3}[&/-])`,
                String.raw`us(?=\s+(?:citizen|national|passport|(?:lawful\s+)?permanent\s+residen|green\s+card|work\s+(?:authori[sz]|permit|visa)))`,
                String.raw`(?:the\s+)?united\s+states(?:\s+of\s+america)?`,
                String.raw`the\s+states`,
                // Not Latin, South, Central or North America, nor "Bank of America".
                String.raw`(?<!(?:latin|south|central|north|of)\s)america`,
                // A citizen or a nationality, and not "Latin American".
                String.raw`(?<!(?:latin|south|central|north)\s)american(?=\s+(?:citizen|national|passport))`,
                String.raw`(?<=(?:citizenship|nationality)\s{0,3}:\s{0,3})american`,
                String.raw`green\s+card`,
              ],
            },
            {
              name: "UK",
              patterns: [
                String.raw`u\.?k\.?`,
                String.raw`(?:the\s+)?united\s+kingdom`,
                String.raw`(?:great\s+)?britain`,
                "british",
                "england",
                "scotland",
                // Not New South Wales.
                String.raw`(?<!south\s)wales`,
                String.raw`northern\s+ireland`,
              ],
              citizensWorkIn: ["Ireland"],
            },
            {
              name: "EU",
              patterns: [
                String.raw`e\.?u\.?`,
                String.raw`european\s+union`,
                "eea",
                // Its member states but Ireland, which has its own entry.
                String.raw`austria|belgium|bulgaria|croatia|cyprus|czechia|czech\s+republic|denmark|estonia|finland|france|germany|greece|hungary|italy|latvia|lithuania|luxembourg|malta|(?:the\s+)?netherlands|poland|portugal|romania|slovakia|slovenia|spain|sweden`,
              ],
              citizensWorkIn: ["Ireland"],
            },
            // In the EU, and sharing a right to work with the UK.
            {
              name: "Ireland",
              patterns: [String.raw`(?<!northern\s)ireland`, "irish"],
              citizensWorkIn: ["UK", "EU"],
            },
            { name: "Canada", patterns: ["canada", "canadian"] },
            { name: "Australia", patterns: ["australia", "australian"] },
            { name: "India", patterns: ["india", "indian"] },
          ],
        ),
        /**
         * Words joining the places a right to work is stated for, so a list of them runs on past
         * a comma: "Authorized to work in the US, Canada and the UK".
         */
        placeJoiners: z._default(wordList("requirements.placeJoiners"), [
          "and",
          "or",
          "in",
          "the",
          "both",
        ]),
        /**
         * What a statement about the right to work says. A line matching `noSponsorship` is read
         * without those words first, so their "no" and "not" are not its negation. `needsSponsorship`
         * never shows the right to work, and shows its absence where the posting rules sponsorship
         * out (`noSponsorship`, or `needsSponsorship` without `sponsorshipOffered`); what is left
         * with a `negation` shows nothing.
         */
        needsSponsorship: z._default(wordList("requirements.needsSponsorship"), [
          String.raw`(?:requires?|requiring|needs?|needing|will\s+(?:require|need))\s+(?:(?:an?|h-?1b|visa|work|employment|immigration|future)\s+){0,3}sponsorship`,
          String.raw`sponsorship\s+(?:is\s+)?(?:required|needed)`,
        ]),
        // Only words about sponsorship between the "not" and it.
        noSponsorship: z._default(wordList("requirements.noSponsorship"), [
          String.raw`(?:no|without)\s+(?:(?:an?|any|further|future|h-?1b|visa|work|employment|immigration)\s+){0,3}sponsorship`,
          String.raw`(?:not|never|\p{L}+n['’]t)\s+(?:(?:currently|presently|now|ever|be|been|eligible|for|offer\p{L}*|provid\p{L}*|requir\p{L}*|need\p{L}*|an?|any|h-?1b|visa|work|employment|immigration|future)\s+){0,4}sponsor(?:ship)?`,
          String.raw`(?:cannot|unable\s+to)\s+(?:(?:offer|provide)\s+)?(?:visa\s+)?sponsor(?:ship)?`,
          String.raw`sponsorship\s+(?:is\s+)?not\s+(?:required|needed|available|offered|provided)`,
        ]),
        /**
         * Words saying a posting offers sponsorship to who needs it, read in the clause naming the
         * need. Without one there, or with a `negation` in the line, a posting naming a need for
         * sponsorship turns it away.
         */
        sponsorshipOffered: z._default(wordList("requirements.sponsorshipOffered"), [
          "available",
          "welcome",
          String.raw`provid(?:e|es|ed|ing)`,
          // Not "offer" alone: "ineligible for offer".
          String.raw`offer(?:s|ed|ing)`,
          String.raw`(?:will|can|may|do|does)\s+sponsor`,
        ]),
        /** Words that say a statement is not so ("Not authorized to work", "no active clearance"). */
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
         * Words that say a clearance or citizenship is not held yet, or any more ("eligible for",
         * "pending", "former"). Not for the right to work itself. Read past a semicolon about a
         * clearance, where a `negation` is not.
         */
        notHeld: z._default(wordList("requirements.notHeld"), [
          "eligible",
          "pending",
          "inactive",
          "expired",
          "lapsed",
          String.raw`able\s+to\s+obtain`,
          String.raw`former(?:ly)?`,
        ]),
        /**
         * Negated words that say a clearance is not held, read in its own sentence (up to a
         * semicolon), past a comma or a bracket: "Secret clearance (not active)", "TS/SCI
         * clearance, not yet granted". Not further: "Active Top Secret clearance; not active duty
         * military" holds Top Secret.
         */
        notHeldNearby: z._default(wordList("requirements.notHeldNearby"), [
          String.raw`not\s+(?:(?:currently|yet)\s+)?(?:active|current|valid|held|obtained|renewed|cleared|granted|issued|approved|in\s+use)`,
          String.raw`no\s+longer`,
        ]),
        /**
         * Words that say a certification is being studied for, not held: "AWS Solutions Architect
         * (in progress)". A row naming one is partial for a certification asked for.
         */
        inProgress: z._default(wordList("requirements.inProgress"), [
          String.raw`in\s+progress`,
          "pursuing",
          String.raw`studying\s+for`,
          String.raw`working\s+towards?`,
        ]),
        /**
         * Citizenship, and the permanent residence that is not it: an ask for `citizenship` that
         * does not also accept `residence` is not met by a green card. Whose citizenship is told
         * by `countries`.
         */
        citizenship: z._default(wordList("requirements.citizenship"), [
          String.raw`(?:us|u\.s\.|united\s+states)\s+citizen(?:ship)?`,
          String.raw`citizen\s+of\s+(?:the\s+)?(?:us|u\.s\.(?:a\.)?|usa|united\s+states)`,
          String.raw`(?:british|uk|u\.k\.|eu|e\.u\.|(?<!(?:latin|south|central|north)\s)american|canadian|australian|irish|indian)\s+citizen(?:ship)?`,
          String.raw`citizen\s+of\s+(?:the\s+)?(?:uk|u\.k\.|united\s+kingdom|eu|european\s+union|canada|australia|ireland|india)`,
          String.raw`citizen\s+of\s+an?\s+(?:eu|e\.u\.|european\s+union)\s+(?:member\s+)?(?:state|country|nation)`,
          // A nationality: "Citizenship: Indian", "British national", "EU passport holder"; not
          // "the Indian national team".
          String.raw`(?:citizenship|nationality)\s{0,3}:\s{0,3}(?:the\s+)?(?:us|u\.s\.(?:a\.)?|usa|united\s+states|uk|u\.k\.|united\s+kingdom|eu|e\.u\.|british|american|canadian|australian|irish|indian|canada|australia|ireland|india)`,
          String.raw`(?:us|u\.s\.|british|uk|u\.k\.|eu|e\.u\.|(?<!(?:latin|south|central|north)\s)american|canadian|australian|irish|indian)\s+national(?![\s-]*\p{L})`,
          String.raw`(?:us|u\.s\.|british|uk|u\.k\.|eu|e\.u\.|(?<!(?:latin|south|central|north)\s)american|canadian|australian|irish|indian)\s+passport(?:\s+holder)?`,
        ]),
        residence: z._default(wordList("requirements.residence"), [
          String.raw`green\s+card`,
          String.raw`(?:lawful\s+)?permanent\s+residen(?:t|cy|ce)`,
        ]),
        // Qualified, never bare: "customs clearance" is logistics.
        clearance: z._default(wordList("requirements.clearance"), [
          String.raw`(?:security|confidential|secret|top\s+secret|ts/sci|ts|sci|dv|sc|ctc|bpss|government|federal)\s+clearance`,
          String.raw`ts(?:\s*/\s*|-)sci`,
        ]),
        /**
         * Clearance levels, lowest first. A level asked is met by it or any above it; the lowest a
         * posting names is its bar. The first pattern list that matches, from the highest down,
         * names a line's level. "TS" is Top Secret only beside "clearance". UK levels come before
         * US ones, a ladder of their own: a US level asked is not met by a UK one, a UK level asked
         * is met by a US one.
         */
        clearanceLevels: z._default(
          z.array(
            z.object({
              name: z.string().check(z.minLength(1)),
              patterns: wordList("requirements.clearanceLevels"),
            }),
          ),
          [
            {
              name: "BPSS",
              patterns: ["bpss", String.raw`baseline\s+personnel\s+security\s+standard`],
            },
            // "CTC", "SC" and "DV" only beside what they name, not "Charleston, SC" or "CTC up to 30 LPA".
            {
              name: "CTC",
              patterns: [
                `ctc${UK_LEVEL_BEFORE}`,
                String.raw`${UK_LEVEL_AFTER}ctc(?=\))`,
                String.raw`ctc(?=\s+check)`,
                String.raw`counter[\s-]+terrorist\s+check`,
              ],
            },
            {
              name: "SC",
              patterns: [
                `sc${UK_LEVEL_BEFORE}`,
                String.raw`${UK_LEVEL_AFTER}sc(?=\))`,
                String.raw`security\s+check`,
              ],
            },
            {
              name: "DV",
              patterns: [
                `dv${UK_LEVEL_BEFORE}`,
                String.raw`${UK_LEVEL_AFTER}dv(?=\))`,
                String.raw`developed\s+vetting`,
              ],
            },
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
        /**
         * Seniority levels, lowest first, each with the years of work it usually takes. A
         * posting's title names the level asked ("Senior Backend Engineer"); the resume's latest
         * title and its years show the level held. The highest level a title names is its level.
         * Manager and director titles are a ladder of their own and name none.
         */
        seniorityLevels: z._default(
          z.array(
            z.object({
              name: z.string().check(z.minLength(1)),
              years: z.number().check(z.int(), z.gte(0)),
              patterns: wordList("requirements.seniorityLevels"),
            }),
          ),
          [
            {
              name: "entry",
              years: 0,
              patterns: [
                String.raw`intern(?:ship)?`,
                "trainee",
                "apprentice",
                "graduate",
                "junior",
                "jr",
                String.raw`entry[\s-]+level`,
              ],
            },
            { name: "mid", years: 2, patterns: [String.raw`mid[\s-]+level`, "intermediate"] },
            // Not "Senior Living Coordinator", a care home's.
            { name: "senior", years: 5, patterns: [String.raw`senior(?![\s-]+living)`, "sr"] },
            // Not "Lead Generation Specialist" (sales) or "Lead Paint Inspector". "Staff" is a level only before an
            // engineering or science noun: a Staff Accountant or Staff Nurse is a regular post.
            {
              name: "lead",
              years: 8,
              patterns: [
                String.raw`lead(?![\s-]+(?:gen\p{L}*|paint))`,
                String.raw`staff(?=\s+(?:(?:software|data|machine\s+learning|ml|research|security|site\s+reliability|platform|backend|frontend|full[\s-]?stack|product|ux)\s+)?(?:engineer|scientist|developer|architect|designer|researcher)s?(?![\p{L}]))`,
                "principal",
              ],
            },
          ],
        ),
        languagePatterns: z._default(z.array(regexString("requirements.languagePatterns")), [
          String.raw`(?:fluent|fluency|proficien(?:t|cy)|native|business[\s-]level|working\s+proficiency|professional\s+proficiency)\s+(?:in\s+|with\s+)?(\p{L}+)`,
        ]),
        /**
         * A language's name in other languages, keyed to its English name, lowercase ("Englisch" to
         * "english"). Language packs fill it in. Also the list of what is a language: a
         * `languagePatterns` capture is a language requirement only when it is a key or value
         * here, so "proficient in Python" stays a skill. English names map to themselves.
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
    /** Number words a years pattern may capture instead of a figure. Never keywords. */
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
     * Words that make an activity or credential part of a requirement, so its object alone does
     * not meet it ("mentoring engineers", "AWS certification"). Each group is one ask, met by any
     * of its words; a `sameLine` group must share a resume line with the requirement's skill.
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
        // Not "management": "project management tools" is a field.
        { words: ["managing", "manage", "managed", "manager"], sameLine: false },
        {
          words: ["certification", "certified", "certificate", "certifications", "certificates"],
          sameLine: true,
        },
        { words: ["license", "licence", "licensed", "licensure"], sameLine: true },
      ],
    ),
    /** What marks a clause of a requirement as optional ("MBA a plus"): read as preferred, it does not raise the level asked. */
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
    /** Text in a posting that is never a keyword (a "City, ST" location). Compiled case-sensitively and globally; each must be linear on hostile input. */
    ignorePatterns: z._default(z.array(regexString("ignorePatterns")), [
      String.raw`(?<![\p{L}])\p{Lu}[\p{L}'.-]{0,30}(?:\s\p{Lu}[\p{L}'.-]{0,30}){0,2},\s{0,3}(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?![\p{L}\p{N}/+#])`,
      // Without the comma, only where an address ends (line, stop or ZIP); not "Requires MS in CS".
      String.raw`(?<![\p{L}])\p{Lu}\p{Ll}[\p{L}'.-]{0,30}(?:\s\p{Lu}\p{Ll}[\p{L}'.-]{0,30}){0,2}\s(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?=\s{0,3}(?:$|[.,;:)|]|\d{5}(?!\d)))`,
    ]),
    /**
     * What a posting offers rather than asks ("Salary range $175,000", "Benefits:"). A line opening
     * with one as its label, or naming one beside an amount of money, is not a requirement.
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
     * The last labels of a web address written without a scheme or "www." (lower case): a host of
     * three labels or more ending in one is a link, not a keyword ("System.Text.Json" stays one).
     */
    linkDomains: z._default(wordList("linkDomains"), [
      "com",
      "org",
      "co",
      "dev",
      // Also a package name's last word: a link only with a path of two parts or more after it.
      String.raw`(?:net|io|ai|app)(?=/[^\s/]+/)`,
      "edu",
      "gov",
      "info",
      "jobs",
      "us",
      "uk",
      "ca",
      "de",
      "fr",
      "in",
      "au",
      "eu",
      "nl",
    ]),
    /** Labels of a line that states a nationality, never a language ("Nationality: German"). */
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
     * values (Terraform implies infrastructure as code). Not symmetric.
     */
    implies: z.record(term, z.array(term)),
    phrases: z.array(term),
    buzzwords: z.array(term),
  })
  .check(
    z.superRefine((km, ctx) => {
      // A multi-word term only becomes one token by matching `phrases`, so one in `implies` or
      // `synonyms` but not in `phrases` never resolves; softSkills are matched as phrases too.
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
