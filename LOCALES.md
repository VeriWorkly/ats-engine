# Locales

The engine reads resumes in more than English through **locale packs**: plain data that adds a
language's or a country's vocabulary to whatever policy you score with.

```ts
import { check, DEFAULT_POLICY } from "@veriworkly/ats-engine";
import { BUILT_IN_LOCALES, withLocales } from "@veriworkly/ats-engine/locales";

const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES); // once, at startup
const report = check(resume, policy);
report.locale; // { languages: ["de"], region: "DE" }
```

## How a resume is read

- **English is the base.** The policy's own vocabulary applies to every resume. Language packs
  add to it; they never replace it, because resumes everywhere carry English terms.
- **Languages are detected per resume and per posting**, separately; a pack applies when either
  is written in its language, so a long English posting can't hide a German resume. A pack with
  a `script` applies when that script covers a fair share of the letters. A Latin-script pack
  applies when at least three _different_ `detectionWords` appear and make up 3% of the words,
  so a German company name in an English resume doesn't make the resume German, and neither
  does a surname like "Das". Words inside email addresses and URLs don't count. A blind union
  of every pack would let German stopwords like "die" and "am" eat English keywords.
- **One region applies**, chosen in this order:
  1. The `region` option (any case). A region that is not attached throws `AtsPolicyError`
     naming the attached ones, rather than being dropped; the CLI reports it as a usage error.
  2. The country of a phone number written with a country code.
  3. The `defaultRegion` of a language the _resume_ is written in. A language only the posting
     is written in doesn't choose the region, so a US resume applying to a German posting keeps
     its month-first dates.

  Without a region, a national phone number is still recovered if any attached region reads
  it. The region is not _inferred_ from such a number, because nearly any 10-digit run is a
  valid German or Indian number.

- Pass `languages` or `region` to `check` to override detection. A host that knows the user's
  country should pass it.

## Built-in packs

| Pack | Kind     | Status    | Notes                                                                                                                                                                                                                                                               |
| ---- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `de` | language | community | Compounds ("Softwareentwickler"), noun-style bullets count as action verbs, capitals carry no proper-noun signal; "Zertifikate" and "Sprachen" headings, level words ("Muttersprache" C2, "fließend" and "verhandlungssicher" C1), 32 soft skills ("Teamfähigkeit") |
| `hi` | language | community | Detected by Devanagari script; verb-final, so action verbs count anywhere in a line; "प्रमाणपत्र" and "भाषाएँ" headings, level words ("मातृभाषा" C2, "धाराप्रवाह" C1), 14 soft skills ("संचार", "नेतृत्व")                                                          |
| `US` | region   | verified  | Date of birth and photo are warnings; age advice (`ageAdvice`: graduation year or experience past 20 years)                                                                                                                                                         |
| `DE` | region   | community | `DD.MM.YYYY`; Abitur, Diplom (FH = 6, otherwise 7), Meister and staatlich geprüfter Techniker (6); date of birth and photo not judged                                                                                                                               |
| `IN` | region   | community | `DD/MM/YYYY`; Class X/SSC (2), Class XII (3), B.Com, B.E., MCA, PGDM, MBBS; date of birth and photo not judged                                                                                                                                                      |

**Status.** `verified` means two things: a named maintainer reads the language natively, and the
pack meets the field-accuracy target (0.95) on its fixture set. `community` means it was
contributed and tested but not signed off. A pack can't verify itself, so `de` and `hi` stay
`community` until a native-speaking maintainer reviews them.

## Writing a pack

A language pack is a fragment of a policy's vocabulary. Every field is optional:

- Lists (`titleWords`, `stopwords`, `openEnded`, …) are added to the policy's lists.
- Patterns (`sections.*`, `degrees.*`, `jobSections.*`) are added as alternatives. `withLocales`
  compiles the combinations, so a named group your pattern shares with the policy's or another
  pack's (a duplicate in one alternation) is an `AtsPolicyError` at startup, not at scoring time.
- Attached packs don't enter the policy fingerprint; the vocabulary they apply to a resume does.

See `src/locales/packs/de.ts` for a complete example. `atsLanguagePackJsonSchema` and
`atsRegionPackJsonSchema` validate a pack written as JSON.

### Pack fields

A language pack names itself with these fields:

| Field            | Required | What it is                                                                                                                       | Example                    |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `id`             | yes      | ISO 639 code, two or three lowercase letters                                                                                     | `"de"`                     |
| `name`           | yes      | The language's own name                                                                                                          | `"Deutsch"`                |
| `status`         | yes      | `"verified"` or `"community"`; see **Status** above                                                                              | `"community"`              |
| `maintainers`    | no       | Who reviews the pack                                                                                                             | `[]`                       |
| `script`         | either   | The Unicode script it is written in, when not Latin; text with a fair share of it is read as the language                        | `"Devanagari"`             |
| `detectionWords` | or       | At least ten words common in the language and rare in English, by which a Latin-script text is recognised. Not the stopword list | `["und", "der", "für", …]` |
| `defaultRegion`  | no       | The region a resume in the language is read as when nothing more specific says                                                   | `"DE"`                     |

A language pack needs a `script` or at least ten `detectionWords`.

A region pack names itself with these:

| Field          | Required | What it is                                                                                                                                                                                         | Example                                            |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `id`           | yes      | ISO 3166-1 alpha-2 code, uppercase                                                                                                                                                                 | `"DE"`                                             |
| `name`         | yes      | The country's name                                                                                                                                                                                 | `"Deutschland"`                                    |
| `status`       | yes      | `"verified"` or `"community"`                                                                                                                                                                      | `"community"`                                      |
| `maintainers`  | no       | Who reviews the pack                                                                                                                                                                               | `[]`                                               |
| `phoneCountry` | yes      | The country a phone number without a country code is read as; one libphonenumber supports                                                                                                          | `"DE"`                                             |
| `dateOrder`    | yes      | How an all-numeric date is ordered: `"MDY"`, `"DMY"` or `"YMD"`                                                                                                                                    | `"DMY"`                                            |
| `rules`        | no       | Changes to the policy's rules by id: `weight` replaces the weight (every non-zero band of a banded rule), `severity` the severity. `weight: 0` turns a rule off; an id the policy lacks is ignored | `{ "ats-v2.format.photo": { "weight": 0 } }`       |
| `ageAdvice`    | no       | Turns on the age advice; see **`ageAdvice`** below                                                                                                                                                 | `{ "graduationYears": 20, "experienceYears": 20 }` |

Both kinds carry any of the vocabulary fields below. Each is added to the policy field it names:
lists are joined, patterns become alternatives, and maps are merged, a key in the pack replacing
the policy's.

| Field                | Added to                          | What it holds                                                                                                                                       | Example                                         |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `sections.*`         | `resumeParse.sections`            | Heading patterns for `experience`, `education`, `skills`, `projects`, `certifications`, `languages` and `other`                                     | `experience: "^(?:berufserfahrung\|werdegang)"` |
| `languageLevels`     | `resumeParse.languageLevels`      | Words that state how well a language is spoken, and the CEFR level each stands for                                                                  | `{ "fließend": "C1", "grundkenntnisse": "A2" }` |
| `credentialWords.*`  | `resumeParse.credentialWords`     | Words around a certification's dates and issuer: `issued`, `expires`, `issuer`, `id`                                                                | `expires: ["gültig\\s+bis"]`                    |
| `months`             | `resumeParse.months`              | Month names and abbreviations, each a whole word                                                                                                    | `{ "märz": 3, "mrz": 3 }`                       |
| `seasons`            | `resumeParse.seasons`             | Seasons a term is dated by, as their first and last month                                                                                           | `{ "sommer": [6, 8] }`                          |
| `durationUnits`      | `resumeParse.durationUnits`       | Units of a printed duration beside a date range ("4 Jahre 9 Monate")                                                                                | `["jahre", "monate"]`                           |
| `nameLabels`         | `resumeParse.nameLabels`          | Labels a name is written under                                                                                                                      | `["vor- und nachname"]`                         |
| `postNominals`       | `resumeParse.postNominals`        | Letters written after a name, never part of it                                                                                                      | `["dipl\\.-ing\\."]`                            |
| `regionCodes`        | `resumeParse.regionCodes`         | Codes of states and provinces written after a city, matched case-sensitively                                                                        | `["MH", "KA"]`                                  |
| `workplaceWords`     | `resumeParse.workplaceWords`      | Words for how or where a role is worked, never the employer                                                                                         | `["homeoffice"]`                                |
| `openEnded`          | `resumeParse.openEnded`           | Words for a role that is still current                                                                                                              | `["heute", "aktuell"]`                          |
| `rangeWords`         | `resumeParse.rangeWords`          | Words between the ends of a date range, besides a dash                                                                                              | `["bis"]`                                       |
| `sinceWords`         | `resumeParse.sinceWords`          | Words before a lone start date that make the role current                                                                                           | `["seit"]`                                      |
| `employerWords`      | `resumeParse.employerWords`       | Words joining a job title to its employer on one line                                                                                               | `["bei"]`                                       |
| `titleWords`         | `resumeParse.titleWords`          | Words that mark a job title                                                                                                                         | `["praktikant(?:in)?"]`                         |
| `schoolWords`        | `resumeParse.schoolWords`         | Words that mark a school or university                                                                                                              | `["universität", "vidyalaya"]`                  |
| `documentTitles`     | `resumeParse.documentTitles`      | What the top of a resume says in place of a name                                                                                                    | `["lebenslauf"]`                                |
| `nameParticles`      | `resumeParse.nameParticles`       | Lowercase words a name may hold between its capitalised ones                                                                                        | `["zu"]`                                        |
| `dateOfBirthLabels`  | `resumeParse.dateOfBirthLabels`   | Labels a date of birth is stated under                                                                                                              | `["geburtsdatum"]`                              |
| `headingConnectors`  | `resumeParse.headingConnectors`   | Lowercase words a capitalised heading joins its words with                                                                                          | `["und"]`                                       |
| `degrees`            | `resumeParse.degrees`             | One pattern per ISCED level, `"2"` to `"8"`                                                                                                         | `{ "3": "abitur\|fachabitur" }`                 |
| `contentLineVerbs`   | `text.contentLineVerbs`           | Verbs that make a line count as content, the lines the content ratios divide by                                                                     | `["entwickelte", "leitete"]`                    |
| `actionVerbs`        | `text.actionVerbs`                | Verbs, or nouns of doing, that a bullet scores for opening with                                                                                     | `["leitung", "entwickelte"]`                    |
| `actionVerbAnywhere` | `text.actionVerbAnywhere`         | `true` for a verb-final language: an action verb counts anywhere in a line                                                                          | `true`                                          |
| `injectionPhrases`   | `text.injectionPhrases`           | Instructions aimed at an AI screener                                                                                                                | `["ignoriere alle vorherigen anweisungen"]`     |
| `requirements.*`     | `keywordMatch.requirements`       | How a posting asks for years, equivalence, the right to work, a clearance and a language; `languageNames` maps a language's name to its English one | `languageNames: { "englisch": "english" }`      |
| `jobSections.*`      | `keywordMatch.sections`           | Posting heading patterns for `required`, `preferred`, `responsibilities` and `excluded` blocks                                                      | `required: "^(?:anforderungen\|ihr\\s+profil)"` |
| `alternationWords`   | `keywordMatch.alternationWords`   | Words a posting offers alternatives with                                                                                                            | `["oder"]`                                      |
| `stopwords`          | `keywordMatch.stopwords`          | Words that are never keywords                                                                                                                       | `["und", "mit", "kenntnisse"]`                  |
| `softSkills`         | `keywordMatch.softSkills`         | Soft skills a posting asks for; see below                                                                                                           | `["teamfähigkeit", "belastbar"]`                |
| `buzzwords`          | `keywordMatch.buzzwords`          | Filler the buzzword rule counts                                                                                                                     | `["hoch motiviert"]`                            |
| `pluralSuffixes`     | `keywordMatch.pluralSuffixes`     | Endings the last word of a multi-word phrase may carry                                                                                              | `["en"]`                                        |
| `nounsCapitalized`   | `keywordMatch.nounsCapitalized`   | `true` when every noun is capitalised, so a capital says nothing about a product name                                                               | `true`                                          |
| `proseNames`         | `keywordMatch.proseNames.enabled` | `false` to keep the job match from leaving out names written in a posting's prose (scripts without case)                                            | `false`                                         |

Everything else in a policy stays the policy's: `phrases`, `synonyms`, `implies`, `stemming`,
what a right-to-work or clearance statement says (`requirements.needsSponsorship`,
`noSponsorship`, `negation`, `notHeld`, `citizenship`, `residence`, `clearanceLevels`),
`numberWords`, `qualifiers`, `offerWords`, the `writing` and `advice` sections, and the rules
and their weights, which only a region pack's `rules` and `ageAdvice` adjust.

Things to know:

- **Patterns compile in Unicode mode** (`u` flag). `\p{L}` works. An escape that needs no escaping
  is an error, such as `\-` outside a character class.
- **`\b` is ASCII-only** in JavaScript, even in Unicode mode. Word lists are wrapped in Unicode
  boundaries for you. In a raw pattern, use `(?<![\p{L}\p{M}])…(?![\p{L}\p{M}])` instead.
- **Strings are NFKC-normalised** when the pack is attached, and digits of every script read as
  ASCII, exactly as resume text is.
- **Degrees are keyed by ISCED 2011 level** (2–8). Levels are tried highest first, so a pattern
  must not also match a credential of a lower level.
- **Rules, weights and stemming belong to the policy.** A language pack can't change them, because
  a German suffix rule would fold "engineer" into "engine". A region pack may adjust named rules
  (`weight`, `severity`). `weight: 0` turns a rule off for the region.
- **`ageAdvice`** (region packs only) turns on the age advice in `report.advice`, which is never
  scored: `graduationYears` (a graduation year more than this many years before `now`) and
  `experienceYears` (more than this many years of experience, stated as in "30+ years of
  experience" or dated across the roles). Set it where an age on a resume invites bias and
  recruiters expect none; leave it out where a date of birth is customary. `US` sets both to 20.
  `DE` and `IN` leave it out: a German Lebenslauf and an Indian resume customarily state a date
  of birth, so advising to hide a graduation year would contradict the convention the pack
  already keeps (date of birth and photo not judged).
- **`headingConnectors`** lists the lowercase words a capitalised heading joins its words with
  ("Ausbildung und Weiterbildung"). Without them, any lowercase word after a heading word reads
  as prose, and the heading is missed. Scripts without case don't need them.
- **Credentials are regional, not linguistic.** "Abitur" and "Class XII" go in the region pack,
  because English resumes from those countries carry them too.
- **Certifications and spoken languages** have headings of their own (`sections.certifications`,
  `sections.languages`: "Zertifikate", "भाषाएँ"), read as rows. `languageLevels` maps the words
  a resume or a posting states a level with to a CEFR level: "fließend" to C1, "Muttersprache"
  to C2. Its keys may be small patterns, for inflections. `credentialWords` lists the words
  around a certification's dates and issuer (`issued`, `expires` such as "gültig bis", `issuer`,
  `id`). A language is recognised by `requirements.languageNames`, so a pack that adds level
  words for its language also names the languages in it ("Englisch").
- **`softSkills`** lists the soft skills a posting in the language asks for ("Teamfähigkeit",
  "नेतृत्व"), added to the policy's. The job match lists them apart from the hard skills
  (`missingKeywordGroups.soft`) and weighs them by the policy's `softSkillWeight`. They are
  folded as every keyword is, and a multi-word one ("समस्या समाधान") is matched as a phrase. Put
  a language's word for "skills" in `stopwords`, as English does, so "संचार कौशल" asks for "संचार".

## Testing a pack

Add synthetic resumes to `tests/fixtures/locale-resumes.ts`, each with the fields an ATS should
recover. Use invented people and companies, never a real person's resume. `tests/locales/locales.test.ts`
then holds the set to:

- the expected locale;
- every section heading found;
- field accuracy of at least 0.95.

Cover the layouts real resumes in that language use (stacked headers, dates on their own line,
letter-spaced headings), not just one tidy example.
