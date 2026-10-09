# Contributing

Thanks for helping. A few rules keep this engine something people can trust with their resume.

## Setup

```sh
npm ci
npm run check   # build, types, lint, tests, bundle sizes, browser/edge smoke, pack
```

Node 20.19 or later. `npm run bench` prints field accuracy over the labelled corpus.

## The rules

1. **A failing test first.** Every bug fix starts with a test that fails without it and stays as a
   regression. Every behaviour change says, in the test, what it protects. Tests live in the
   folder that mirrors the module they cover (`src/parser/` → `tests/parser/`), in a file named
   for the behaviour, never for a review or a date; what crosses modules goes in
   `tests/integration/`.
2. **Language lives in data.** No month name, heading, title word or stopword in source: they
   belong in the policy (`src/policy/default/`) or a locale pack (`src/locales/packs/`). Policy
   patterns compile in Unicode mode; word lists go through `wordListPattern` (JS `\b` is
   ASCII-only).
3. **Linear time.** Any new regex over input must be linear on adversarial input. Add your shape
   to the adversarial suites if it is new. No nested quantifiers over the same characters; bound
   repetition; prefer a scan to a clever pattern.
4. **No I/O, no globals in the core.** Caches are `memo` (a WeakMap on the object the value comes
   from), never module-level maps keyed by strings.
5. **Pure reports.** A report is a function of (input, policy, options incl. `now`). Anything that
   reads the clock takes `now`.
6. **Rules without evidence are dropped**, never passed or failed. Integrity rules are penalties
   outside the denominator: an honest resume must score exactly as if they did not exist.
7. **Edits with backslashes** (regexes, `String.raw`) are made in an editor, not with `sed`.

## Changes users can see

Run `npm run changeset`. A change to the report's shape, the policy schema, or the score or
recovered fields for the same input is **breaking** (see `.changeset/README.md`). If the community
policy changes, `npm run rubric` regenerates RUBRIC.md and its fingerprint.

## Locale packs

See [LOCALES.md](LOCALES.md): packs are data, held to a field-accuracy target on synthetic
fixtures in `tests/fixtures/locale-resumes.ts` — invented people only.

## Where to change what

| To change…                                    | Start in                                                                                        | Notes                                                                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a job title, employer or date is read     | `src/parser/experience.ts`, `src/parser/dates.ts`; words in `src/policy/default/resumeParse.ts` | First check the text the parser received: `ats-engine check file --text` or `includeLines: true`.                                                                                              |
| Which headings start a section                | `src/policy/default/resumeParse.ts` (`sections`)                                                | Data, not code.                                                                                                                                                                                |
| A scoring rule's weight, threshold or wording | `src/policy/default/rules.ts`                                                                   | Then `npm run rubric` to regenerate RUBRIC.md.                                                                                                                                                 |
| Writing-style words and limits                | `src/policy/schema/writing.ts`; the `writing` rules in `src/policy/default/rules.ts`            | English only: the rules carry `languages: ["en"]` and drop out for a resume read in another language. Their checks are in `src/checks/writing.ts`.                                             |
| A new kind of rule (a new metric)             | `src/policy/schema/rules.ts`, `src/scoring/rules.ts`, `src/scoring/context.ts`, `src/checks/`   | Ask in an issue first: a new metric changes the policy schema.                                                                                                                                 |
| Job matching and requirement judgements       | `src/matching/`; vocabulary in `src/policy/default/keywordMatch.ts`                             |                                                                                                                                                                                                |
| A language or a country                       | `src/locales/packs/`                                                                            | See [LOCALES.md](LOCALES.md).                                                                                                                                                                  |
| An AI prompt                                  | The `DEFAULT_*_PROMPT` constants in `src/ai/tasks/`                                             | Changes every result's `promptVersion`. `tests/ai/prompts.test.ts` checks each prompt names its schema's keys; `npm run eval:live` measures quality against a real model and needs a paid key. |
| What is kept from a model's answer            | `src/repair/grounding.ts`, `src/repair/merge.ts`                                                |                                                                                                                                                                                                |
| PDF reading order, columns, hidden text       | `src/node/pdf.ts`, `src/node/lines.ts`, `src/node/layout.ts`, `src/node/hidden.ts`              | Build test PDFs in code with `tests/fixtures/buildPdf.ts`; never check in a real resume.                                                                                                       |
| DOCX reading                                  | `src/node/docx.ts`, `src/node/extract.ts`                                                       | `tests/fixtures/buildDocx.ts` builds test files.                                                                                                                                               |
| Text taken from a job page                    | `src/job/`                                                                                      |                                                                                                                                                                                                |
| The command line                              | `src/cli/`                                                                                      |                                                                                                                                                                                                |

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md).
