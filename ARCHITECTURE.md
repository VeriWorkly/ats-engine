# Architecture

How `@veriworkly/ats-engine` is built, for someone about to change it. What it does for a user
is in [README.md](./README.md); the rules for changing it are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Invariants

These hold everywhere, and each has a test:

- **Pure.** A report is a function of (input, policy, options incl. `now`), stamped with
  `report.engine = { version, policy fingerprint }`. `ENGINE_VERSION` equals package.json.
- **No I/O, no global state in the core** (`src/` minus `node/`, `cli/`). Caches are `memo` — a
  WeakMap on the object the value is derived from. `/document`, `/format` and `/job` have no
  dependencies; zod is internal and never exported as a value.
- **Language is data.** Month names, headings, degrees, title and school words, stopwords, verbs
  and injection phrases live in the policy or a locale pack. Policy patterns compile in Unicode
  mode (`policyRegex`); word lists use `wordListPattern` (JS `\b` is ASCII-only). Text is
  normalised once (`normalizeText`: NFKC, digits of every script, invisible characters).
- **Evidence or nothing.** A rule whose evidence is absent (no geometry, no posting) is dropped
  from the report, never passed or failed. Integrity rules are penalties outside the denominator:
  an honest resume scores exactly as if they did not exist.
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
     segmentResume        headings → sections                     parser/sections.ts
     parseReadLines | parseResumeDocument                          parser/, document/parse.ts
     checks               integrity, timeline, skills             checks/
 4 scoreRules             applicable rules → results, score       scoring/score.ts, rules.ts
 5 computeJobMatch        posting terms, alternatives, weights    matching/jobMatch.ts
 6 judgeRequirements      per-requirement status and evidence     matching/requirements.ts
 7 assemble               fixes, strengths, categories, stamp     scoring/engine.ts
```

## Layout

One responsibility per folder. Most files stay under ~300 lines. The longer ones are data
(`policy/default/rules.ts`, `policy/schema/text.ts`, `locales/packs/de.ts`) and the places where one
algorithm is kept whole: `node/docx.ts` (zip walk, parts, measurement), `node/hidden.ts` (the
visibility replay), `matching/requirements.ts` (one judge per requirement kind) and `cli/main.ts`.
Splitting those is welcome where a seam is clear.

| Folder                   | Holds                                                                                                                                                                                                                                                                                                                             | Public as              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `index.ts`, `version.ts` | root re-exports, `ENGINE_VERSION`                                                                                                                                                                                                                                                                                                 | `.`                    |
| `types.ts`, `types/`     | report types; `types/parsed.ts` (recovered record, ISCED, provenance), `types/layout.ts` (geometry signals)                                                                                                                                                                                                                       | `.`                    |
| `input.ts`               | `prepareResume`: kind of input, flattening, size guards                                                                                                                                                                                                                                                                           | `.`                    |
| `text/`                  | `text.ts` normalisation, word lists, tokens, stemming, bullets; `characters.ts` invisible and tag characters                                                                                                                                                                                                                      | internal               |
| `policy/`                | `schema.ts` (assembles `schema/rules`, `schema/resumeParse`, `schema/keywordMatch`, `schema/text`), `default.ts` (assembles `default/rules`, `default/keywordMatch`, `default/resumeParse`), `parse`, `primitives`, `regex`, `fingerprint`, `errors`                                                                              | `.`                    |
| `parser/`                | `lines`, `sections`, `dates`, `experience` (roles), `education` (ISCED), `contact` (name, email, date of birth), `phone`, `record` (derived fields, provenance), `tenure`, `index`                                                                                                                                                | `.` (`parseResume`)    |
| `checks/`                | `integrity/text` (injection, homoglyphs, copied posting, stuffing), `timeline`, `skills`, `bullets` (role body lines when list markers were lost), `finding`                                                                                                                                                                      | internal               |
| `scoring/`               | `engine` (pipeline), `context` (what rules read), `score` (arithmetic), `rules` (per-kind evaluation and applicability), `categories`, `rubric`, `verdict`                                                                                                                                                                        | `.`                    |
| `matching/`              | `vocabulary` (terms, synonyms, phrases), `alternation` ("Go or Java"), `jobSections`, `jobMatch`, `requirements`                                                                                                                                                                                                                  | internal               |
| `locales/`               | `schema`, `languages` (language detection and vocabulary, no phone metadata), `resolve` (attach, region, date order), `packs/` (`de`, `hi`, `regions`)                                                                                                                                                                            | `/locales`             |
| `document/`              | structured input: `types`, `render`, `jsonResume` (public); `schema`, `parse` (internal)                                                                                                                                                                                                                                          | `/document`            |
| `report/`, `repair/`     | `shape` (full / restricted); `grounding`, `merge` (AI repair acceptance)                                                                                                                                                                                                                                                          | `.`                    |
| `format/`, `job/`        | display helpers; job text from HTML (`html.ts` scanner, whole-page mode skipping navigation and hidden elements; `index.ts` JSON-LD)                                                                                                                                                                                              | `/format`, `/job`      |
| `ai/`                    | `run` (task runner, retries), `provider`, `http`, `schema`, `redact`, `tasks/`, adapters, `testing/`                                                                                                                                                                                                                              | `/ai`, `/ai/*`         |
| `node/`                  | `extract` (formats, normalisation), `pdf` (text + geometry in one pass), `lines` (PDF lines in reading order: by baseline, column by column, links, bullets drawn as shapes), `hidden` + `surroundings` (replay, grid), `tables` (grids), `layout` (columns), `docx` (zip, hidden runs, bomb budget), `peer`, `child`, `protocol` | `/node`, `/node/child` |
| `cli/`                   | `main` (`ats-engine check`, arguments, the text report), `terminal` (colour, banner, control-character stripping), `ai` (`--ai` provider presets over the two adapters), `usage`                                                                                                                                                  | bin                    |
| `util/`                  | `memo`, `own` (own-property lookup), `hash`                                                                                                                                                                                                                                                                                       | internal               |

Tests mirror `src/`: `tests/parser/`, `tests/matching/`, `tests/scoring/`, `tests/node/`,
`tests/ai/`, `tests/cli/`, `tests/locales/` and so on, one folder per module, each file named
for what it covers. `tests/integration/` holds what crosses modules: hostile input
(`adversarial`), generated-input properties (`properties`), Unicode, and end-to-end regressions.
`tests/fixtures/` builds PDFs, DOCX files and the labelled corpus; `timing.ts` has `expectFast`,
which every time budget uses so a busy machine cannot fail a test. Work bounded by a count is
tested by the count (`tests/node/visibility-budget.test.ts`), not the clock.

`node/files` reads a resume or a posting from a path (`readResumeFile`, `readJobFile`) with the
limits and messages the CLI and the MCP server share; `printable` in `/format` strips control
characters from what either prints. `packages/mcp/` is a separate npm workspace,
`@veriworkly/ats-engine-mcp`: an MCP server over the public entry points, with tests in
`packages/mcp/tests/` that spawn the built server. The root is a workspace too
(`"workspaces": [".", "packages/*"]`), so the server links the local engine and changesets
versions both packages.

## Dependencies

No import cycles, value or type. Value closure per entry (internal modules / runtime externals):

| Entry                                                   | Modules | Externals                                                |
| ------------------------------------------------------- | ------: | -------------------------------------------------------- |
| `.`                                                     |      62 | zod, libphonenumber-js                                   |
| `/document`                                             |       4 | none                                                     |
| `/format`                                               |       2 | none                                                     |
| `/job`                                                  |       3 | none                                                     |
| `/locales`                                              |      22 | zod, libphonenumber-js                                   |
| `/ai`                                                   |      41 | zod, libphonenumber-js                                   |
| `/ai/openai-compatible`, `/ai/anthropic`, `/ai/testing` |     4–5 | none                                                     |
| `/node`                                                 |      18 | node:\*, pdfjs-dist, pdf-parse, mammoth (optional peers) |

Bundle budgets per subpath are enforced by `npm run size`; `npm run smoke` bundles every
runtime-agnostic subpath for the browser and runs the core in a bare V8 context (edge).

## Decisions worth knowing

- **Report prose is English.** Rule evidence and fixes come from the policy; the few strings the
  engine writes into a report (a timeline sample, an ISCED label in a requirement's detail,
  "Present" in a rendered document) are display text, not vocabulary the engine reads.
- **Policy types are inferred from zod.** `AtsEnginePolicy` is `z.infer` of the schema, so the
  published `.d.ts` references zod's types (zod is a dependency, `^4`). Hand-writing the types
  would duplicate the schema; revisit before 1.0 if a zod major changes them.
- **One file per private policy.** Hosts load a policy from one path or one JSON value; the code
  is split by area, the data file is not.
- **PDF text is assembled here**, not by pdf-parse, which loses the gap between a job title and
  its employer. Lines are ordered by where they sit on the page, not by the order the file paints
  them: browsers paint floated and positioned elements out of order, and reading in paint order
  scrambled whole sections.
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
