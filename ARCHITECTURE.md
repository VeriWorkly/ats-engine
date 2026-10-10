# Architecture

How `@veriworkly/ats-engine` is built, for someone about to change it. What it does for a user
is in [README.md](./README.md); the rules for changing it are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Invariants

These hold everywhere, and each has a test:

- **Pure.** A report is a function of (input, policy, options incl. `now`), stamped with
  `report.engine = { version, policy fingerprint }`. `ENGINE_VERSION` equals package.json.
- **No I/O, no global state in the core** (`src/` minus `node/`, `cli/`). Caches are `memo` — a
  WeakMap on the object the value is derived from. `/document`, `/format` and `/job` have no
  dependencies; zod (`zod/mini`) is internal and never exported as a value.
- **Language is data.** Month names, headings, degrees, title and school words, stopwords, verbs
  and injection phrases live in the policy or a locale pack. Policy patterns compile in Unicode
  mode (`policyRegex`); word lists use `wordListPattern` (JS `\b` is ASCII-only). Text is
  normalised once (`normalizeText`: NFKC, digits of every script, invisible characters).
- **Evidence or nothing.** A rule whose evidence is absent (no geometry, no posting) is dropped
  from the report, never passed or failed. So is a rule limited to some `languages` (the writing
  rules: English) for a resume read in another. Integrity rules are penalties outside the
  denominator: an honest resume scores exactly as if they did not exist.
- **Linear time on hostile input**, with every input bounded (see [SECURITY.md](./SECURITY.md)).
- **AI output is grounded.** Resume text goes to a model as data; every identity value it returns
  must occur in the source. The tuned private policy and prompts never ship; `DEFAULT_POLICY` is
  the community policy.

## The `check()` pipeline

```
check(resume, policy, options)                                   check.ts, scoring/engine.ts
 1 prepareResume          input → text, document, hidden chars    input.ts
 2 localizePolicy         languages, region, date order           locales/resolve.ts
 3 readResume             lines, sections (once), parse, context  scoring/context.ts
     readResumeLines      rejoin wrapped lines, read spaced ones  parser/lines.ts
     readSections         headings → sections, cut at a late name parser/sections.ts, index.ts
     parseReadLines | parseResumeDocument                          parser/, document/parse.ts
       readCredentialRows certification and language rows         parser/certifications.ts, languages.ts
     checks               integrity, timeline, skills, writing    checks/
 4 scoreRules             applicable rules → results, score       scoring/score.ts, rules.ts
 5 computeJobMatch        posting terms, names left out, weights  matching/jobMatch.ts
 6 judgeRequirements      per-requirement status and evidence;    matching/requirements.ts
                          rows first for credentials, languages
 7 assemble               fixes, strengths, categories, stamp     scoring/engine.ts
 8 adviceFor              not scored: file, age, target ATS       advice/
```

The advice is read last, from the parsed record, the lines, the layout and the caller's `file`
and `targetAts`, after the score is final. Nothing the score reads comes back from it, so it
cannot move a number (`tests/scoring/advice-score.test.ts` holds that byte for byte). Its text
and thresholds are the policy's `advice` section; a region pack's `ageAdvice` turns the age
advice on. An unknown `targetAts` is refused before anything is read.

## Layout

One responsibility per folder. Most files stay under ~300 lines, and a dozen run to about 400.
The longest are data (`policy/default/rules.ts`, `policy/schema/keywordMatch.ts`,
`policy/schema/text.ts`, `locales/packs/de.ts`) and the places where one algorithm is kept whole:
`node/docx.ts` (zip walk, parts, measurement), `node/hidden.ts` (the visibility replay) and
`matching/requirements.ts` (one judge per requirement kind). Splitting those is welcome where a
seam is clear.

| Folder                               | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Public as              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `index.ts`, `version.ts`, `check.ts` | root re-exports, `ENGINE_VERSION`, the `check` function                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `.`                    |
| `types.ts`, `types/`                 | report types; `types/parsed.ts` (recovered record, ISCED, provenance), `types/layout.ts` (geometry signals)                                                                                                                                                                                                                                                                                                                                                                                                                    | `.`                    |
| `input.ts`                           | `prepareResume`: kind of input, flattening, size guards                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `.`                    |
| `text/`                              | `text.ts` normalisation, word lists, tokens, stemming, bullets; `characters.ts` invisible and tag characters                                                                                                                                                                                                                                                                                                                                                                                                                   | internal               |
| `policy/`                            | `schema.ts` (assembles `schema/rules`, `schema/resumeParse`, `schema/keywordMatch`, `schema/text`, `schema/writing`, `schema/advice`), `default.ts` (assembles `default/rules`, `default/keywordMatch`, `default/resumeParse`), `parse`, `primitives`, `regex`, `fingerprint`, `errors`                                                                                                                                                                                                                                        | `.`                    |
| `parser/`                            | `lines`, `sections`, `dates`, `experience` (roles), `education` (ISCED), `contact` (name, email, date of birth), `phone`, `certifications` and `languages` (rows, CEFR), `record` (derived fields, provenance), `tenure`, `index`                                                                                                                                                                                                                                                                                              | `.` (`parseResume`)    |
| `checks/`                            | `integrity/text` (injection, homoglyphs, copied posting, stuffing), `timeline`, `skills`, `bullets` (role body lines when list markers were lost, a list of works' citations), `writing` (style of the bullets and role dates, English), `finding`                                                                                                                                                                                                                                                                             | internal               |
| `scoring/`                           | `engine` (pipeline), `context` (what rules read), `score` (arithmetic), `rules` (per-kind evaluation and applicability, `languages` too), `categories` (`writing` apart), `rubric`, `verdict`                                                                                                                                                                                                                                                                                                                                  | `.`                    |
| `matching/`                          | `vocabulary` (terms, synonyms, phrases, soft skills), `alternation` ("Go or Java"), `jobSections`, `proseNames`, `jobMatch` (weights, hard and soft groups), `requirements`                                                                                                                                                                                                                                                                                                                                                    | internal               |
| `locales/`                           | `index` (`BUILT_IN_LOCALES`, the packs' JSON Schemas), `schema`, `languages` (language detection and vocabulary, no phone metadata), `resolve` (attach, region, date order, a region's rule changes and `ageAdvice`), `packs/` (`de`, `hi`, `regions`)                                                                                                                                                                                                                                                                         | `/locales`             |
| `document/`                          | structured input: `types`, `render`, `jsonResume` (public); `schema`, `parse` (internal)                                                                                                                                                                                                                                                                                                                                                                                                                                       | `/document`            |
| `advice/`                            | `index` (`adviceFor`, the target ATS), `file` (name, size, password, tracked changes, comments), `age` (graduation year, years of experience)                                                                                                                                                                                                                                                                                                                                                                                  | internal               |
| `report/`, `repair/`                 | `shape` (full / restricted); `grounding`, `merge` (AI repair acceptance)                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `.`                    |
| `format/`, `job/`                    | display helpers; job text from HTML (`html.ts` scanner, whole-page mode skipping navigation and hidden elements; `index.ts` JSON-LD)                                                                                                                                                                                                                                                                                                                                                                                           | `/format`, `/job`      |
| `ai/`                                | `run` (task runner, retries), `provider`, `http`, `schema`, `redact`, `tasks/`, adapters, `testing/`                                                                                                                                                                                                                                                                                                                                                                                                                           | `/ai`, `/ai/*`         |
| `node/`                              | `extract` (formats, normalisation), `files` (`readResumeFile`, `readJobFile`: a path, its limits, the file info), `pdf` (text + geometry in one pass, encryption), `lines` (PDF lines in reading order: by baseline, column by column, links, bullets drawn as shapes, running headers, footers and page numbers), `hidden` + `surroundings` (replay, grid), `tables` (grids), `layout` (columns), `docx` (zip, hidden runs, tracked changes and comments, bomb budget, what `mammoth` may parse), `peer`, `child`, `protocol` | `/node`, `/node/child` |
| `cli/`                               | `index` (the bin), `main` (`ats-engine check`, arguments, the text report), `terminal` (colour, banner, control-character stripping), `ai` (`--ai` provider presets over the two adapters), `usage`                                                                                                                                                                                                                                                                                                                            | bin                    |
| `util/`                              | `memo`, `own` (own-property lookup), `hash`, `issues` (zod's English messages, per parse)                                                                                                                                                                                                                                                                                                                                                                                                                                      | internal               |

Tests mirror `src/`: `tests/parser/`, `tests/matching/`, `tests/scoring/`, `tests/checks/`,
`tests/advice/`, `tests/node/`, `tests/ai/`, `tests/cli/`, `tests/locales/` and so on, one folder
per module, each file named for what it covers. `tests/action/` runs the GitHub Action's
`run.mjs` against the local build. `tests/integration/` holds what crosses modules: hostile input
(`adversarial`), generated-input properties (`properties`), Unicode, and end-to-end regressions.
`tests/fixtures/` builds PDFs, DOCX files and the labelled corpus. `generatedResumes.ts` writes a
seeded set of invented resumes (varied separators, date forms, city placement, headings and section
order) and renders each as text, a one-column PDF, a two-column PDF and a DOCX, labelled from its
inputs and never from what the engine reads. `npm run bench` (`bench/run.ts`) scores both that set
and the hand-written one per field and fails on any miss `bench/baseline.json` does not list; the
≥0.95 per-locale gate in `tests/locales/` runs on the hand-written set. `timing.ts` has
`expectFast`, which every time budget uses so a busy machine cannot fail a test. Work bounded by a
count is tested by the count (`tests/node/visibility-budget.test.ts`), not the clock.

`node/files` reads a resume or a posting from a path (`readResumeFile`, `readJobFile`) with the
limits and messages the CLI and the MCP server share — a regular file on this computer only, no
network path, pipe or device — and says what the file was (`file`: name,
size, format) for the file advice; `node/docx` counts tracked changes and comments while it
measures and checks every part `mammoth` will parse before it parses any (`checkParsedXml`), and
`node/pdf` notes an encrypted PDF that opened without a password. `printable` in
`/format` strips control characters from what either prints. `packages/mcp/` is a separate npm workspace,
`@veriworkly/ats-engine-mcp`: an MCP server over the public entry points, with tests in
`packages/mcp/tests/` that spawn the built server. The root is a workspace too
(`"workspaces": [".", "packages/*"]`), so the server links the local engine and changesets
versions both packages. `action/` is the GitHub Action, outside both packages: a composite step
whose `run.mjs` runs the published CLI with `npx` at the engine version the action pins
(`npm run version-packages` moves the pin), turns its `--json` report into step outputs and a job
summary, and needs no dependencies.

## Dependencies

No import cycles, value or type. Value closure per entry (internal modules / runtime externals):

| Entry                                    | Modules | Externals                                                     |
| ---------------------------------------- | ------: | ------------------------------------------------------------- |
| `.`                                      |      73 | zod/mini, libphonenumber-js                                   |
| `/document`                              |       4 | none                                                          |
| `/format`                                |       2 | none                                                          |
| `/job`                                   |       3 | none                                                          |
| `/locales`                               |      25 | zod/mini, libphonenumber-js                                   |
| `/ai`                                    |      47 | zod/mini, libphonenumber-js                                   |
| `/ai/openai-compatible`, `/ai/anthropic` |       4 | none                                                          |
| `/ai/testing`                            |       6 | zod/mini (imported by `ai/run.ts`; tree-shaken from a bundle) |
| `/node`                                  |      18 | node:\*, pdfjs-dist, pdf-parse, mammoth (optional peers)      |
| `/node/child`                            |      12 | node:\*, pdfjs-dist, pdf-parse, mammoth (optional peers)      |

Counted with esbuild's metafile, every bare import left external. "zod/mini" includes its
English locale (`zod/v4/locales/en.js`, see `util/issues.ts`). Bundle budgets per subpath are
enforced by `npm run size` (`scripts/size.mjs`, minified and gzipped: 95 KB for `.`, 70 KB
each for `/locales` and `/ai`, 20.9 KB for `/node`, under 4 KB for every other; the script
prints each entry's size against its budget, with the reason for each budget beside it);
`npm run smoke` bundles every runtime-agnostic subpath for the browser and runs the core in a
bare V8 context (edge).

## Decisions worth knowing

- **Report prose is English.** Rule evidence and fixes, and the advice, come from the policy; the
  few strings the engine writes into a report (a timeline sample, an ISCED label or a CEFR level
  in a requirement's detail, "Present" in a rendered document) are display text, not vocabulary
  the engine reads.
- **Writing style is weighed lightly, and in English only.** The `writing` rules carry 12 points
  against 190 for the rest, so the score still mostly says whether an ATS can read the resume.
  Their words (pronouns, auxiliaries, verb tenses) are English, so each rule carries
  `languages: ["en"]` and drops out for a resume read in another language rather than misjudge
  it. Tense is judged only in a role already left: the current role may use either.
- **Credentials and languages are rows.** A certification and a spoken language are parsed into
  `parsed.certifications` and `parsed.spokenLanguages`, and the requirements judge reads those
  rows before the resume's lines: "AWS certification" needs a certification naming AWS, and
  "fluent German" a German row at C1 or above. Without a row, the lines are read as before.
- **Soft skills are keywords, weighed less.** A posting's soft skills stay in the match, listed
  apart (`missingKeywordGroups.soft`), at `softSkillWeight` of an ordinary word: a resume claims
  "communication" far more often than it shows it.
- **Advice is not a rule.** File hygiene, age signals and target-ATS notes are worth saying but
  are not what an ATS scores, so they live in `report.advice`, outside the rubric. A target-ATS
  note states only what the vendor documents on a public page, linked as its `source`; the engine
  never claims to simulate a vendor's parser.
- **Policy types are inferred from zod.** `AtsEnginePolicy` is `z.infer` of the schema, so the
  published `.d.ts` references zod's types (zod is a dependency, `^4`). Hand-writing the types
  would duplicate the schema; revisit before 1.0 if a zod major changes them.
- **Schemas use `zod/mini`.** Its functional API tree-shakes where full `zod`'s methods cannot,
  which took 74–80 KB gzipped off each of `.`, `/locales` and `/ai` (`.`: 171.9 to 91.7 KB). It
  ships no locale, so every `safeParse` whose issues reach a caller passes `ENGLISH_ISSUES`
  (`util/issues.ts`): the messages are the ones `zod` gives, set per parse rather than in zod's
  global config. `tests/policy/zod-equivalence.test.ts` holds parsed policies, issues and JSON
  Schemas to what `zod` produced.
- **One file per private policy.** Hosts load a policy from one path or one JSON value; the code
  is split by area, the data file is not.
- **PDF text is assembled here**, not by pdf-parse, which loses the gap between a job title and
  its employer. Lines are ordered by where they sit on the page, not by the order the file paints
  them: browsers paint floated and positioned elements out of order, and reading in paint order
  scrambled whole sections. What a PDF prints at one height at the top or bottom of every page
  is read once, as a DOCX's header and footer are, and a page number not at all: between two
  pages, either parted a role's title from its dates.
- **Ruled tables are counted twice**, and the larger count kept. `node/tables.ts` reads the rules
  the visibility replay already walks: stroked lines and filled shapes up to 1.5pt thick, because
  a browser prints a CSS border as a thin filled rectangle; a table is at least two rows of two
  closed cells with text. pdf-parse's `getTable` sees stroked rules only and stays because it
  joins them its own way; it is the only reason pdf-parse is still a peer.

## Pre-1.0 API plan

Keep: everything exported today. Remove in 1.0: `level`, `highestDegree`, `AtsDegreeLevel`,
`DEGREE_LABELS`. Candidates to rename or make internal at 1.0, decided then rather than churned
now: `AtsScoringService` (today an alias of the documented `check()` function), `TaskRoute` → `AtsAiRoute`,
`AiEvalCase`/`AiEvalReport` → `AtsAi…`, and the accidental exports `chatCompletionBody`,
`messagesBody`, `localizePolicy`, `parseQuality`, the grounding helpers.
