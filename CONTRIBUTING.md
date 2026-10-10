# Contributing

Thanks for helping. A few rules keep this engine something people can trust with their resume.

## Setup

```sh
npm ci
npm run check   # build, types, lint, tests, bundle sizes, browser/edge smoke, pack
```

Node 22.12 or later. `npm run bench` prints field accuracy over two labelled corpora (the
hand-written resumes, and a seeded generated set rendered as text, PDF, two-column PDF and DOCX) and
fails on any miss `bench/baseline.json` does not list (a resume, a field and its row), so a field
read better elsewhere cannot hide one read worse. The baseline is not a goal and is not tuned to
pass: it records what the engine misses today, and the run says when a listed miss is read right.
Update it with `npm run bench -- --update` only in the change that earns the difference (a parser
fix removes misses; a deliberate trade-off adds them, and the commit says why), and review the diff
of `bench/baseline.json` like any other change. A new field or label that misses also needs an
update. `npm run bench -- --verbose` lists each generated miss with what was read against what was
labelled.

## The rules

1. **A failing test first.** Every bug fix starts with a test that fails without it and stays as a
   regression. Every behaviour change says, in the test, what it protects. Tests live in the
   folder that mirrors the module they cover (`src/parser/` → `tests/parser/`), in a file named
   for the behaviour, never for a review or a date; what crosses modules goes in
   `tests/integration/`. The GitHub Action's tests are in `tests/action/`, the MCP server's in
   `packages/mcp/tests/`; both run against the build, so run `npm run build` first.
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
policy changes, `npm run rubric` regenerates RUBRIC.md and its fingerprint, and the policy snapshots in `tests/policy/__snapshots__/` (check their diff is only your change). A change to the
MCP server gets a changeset for `@veriworkly/ats-engine-mcp`. The GitHub Action in `action/` is
in neither package: a change there needs no changeset unless the engine changes with it.

## Releasing

Releases go out from `main` through changesets and `.github/workflows/release.yml`:

1. Each pull request with a user-visible change adds its changeset (`.changeset/*.md`).
2. On a push to `main` with changesets pending, the Release workflow opens or updates a
   "Version Packages" pull request. It runs `npm run version-packages`: `changeset version` (new
   versions and CHANGELOG.md entries, consuming the changesets), `scripts/sync-version.mjs`
   (`ENGINE_VERSION`, the GitHub Action's default `version`, and `packages/mcp/server.json`),
   the lockfile, and `npm run rubric`.
3. Merging that pull request leaves no changesets pending, so the workflow runs
   `npm run release` (`npm run check`, then `changeset publish`): each new version is published
   to npm with provenance and tagged `<name>@<version>`, and a new engine version is published to
   GitHub Packages too (`.github/workflows/github-packages.yml`). A new MCP server version is
   then listed in the official MCP Registry with `mcp-publisher` over GitHub OIDC, under
   `io.github.VeriWorkly/ats-engine` (the registry compares the casing). Nothing publishes
   without that pull request.

If the organisation does not let GitHub Actions create pull requests, the workflow fails at
step 2. Open the pull request by hand instead: on a branch from `main`, run
`npm run version-packages` with npm 11 (`npm install -g npm@11` first if `npm --version` says
10: npm 10 drops the `libc` fields from `package-lock.json`), commit, push, and open it against
`main`. Merging it publishes as above.

Dependencies are updated by hand. Dependabot alerts stay on, so a vulnerable dependency shows in
the repository's Security tab, but Dependabot opens no pull requests.

## Locale packs

See [LOCALES.md](LOCALES.md): packs are data, held to a field-accuracy target on synthetic
fixtures in `tests/fixtures/locale-resumes.ts` — invented people only.

## Where to change what

| To change…                                    | Start in                                                                                          | Notes                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a job title, employer or date is read     | `src/parser/experience.ts`, `src/parser/dates.ts`; words in `src/policy/default/resumeParse.ts`   | First check the text the parser received: `ats-engine check file --text` or `includeLines: true`. Which part of a header is the title and which the employer: `titleWords`, `schoolWords`, and `organisationWords` (a legal form or an institution's kind, in `src/policy/schema/resumeParse.ts`). |
| Which headings start a section                | `src/policy/default/resumeParse.ts` (`sections`)                                                  | Data, not code.                                                                                                                                                                                                                                                                                    |
| A scoring rule's weight, threshold or wording | `src/policy/default/rules.ts`                                                                     | Then `npm run rubric` to regenerate RUBRIC.md.                                                                                                                                                                                                                                                     |
| Writing-style words and limits                | `src/policy/schema/writing.ts`; the `writing` rules in `src/policy/default/rules.ts`              | English only: the rules carry `languages: ["en"]` and drop out for a resume read in another language. Their checks are in `src/checks/writing.ts`.                                                                                                                                                 |
| A new kind of rule (a new metric)             | `src/policy/schema/rules.ts`, `src/scoring/rules.ts`, `src/scoring/context.ts`, `src/checks/`     | Ask in an issue first: a new metric changes the policy schema.                                                                                                                                                                                                                                     |
| Job matching and requirement judgements       | `src/matching/`; vocabulary in `src/policy/default/keywordMatch.ts`                               |                                                                                                                                                                                                                                                                                                    |
| The right to work, a clearance's level        | `requirements` in `src/policy/schema/keywordMatch.ts`                                             | Data, not code: what a statement says (`needsSponsorship`, `noSponsorship`, `negation`, `notHeld`, `citizenship`, `residence`) and `clearanceLevels`, lowest first.                                                                                                                                |
| A term written with a slash                   | `phrases` in `src/policy/default/keywordMatch.ts`                                                 | A slash joins skills asked together ("HTML/CSS" asks for both); list a name written with one ("CI/CD", "TCP/IP") in `phrases` to keep it whole.                                                                                                                                                    |
| Which words are soft skills                   | `softSkills` and `softSkillWeight` in `src/policy/default/keywordMatch.ts`; a pack's `softSkills` | A multi-word soft skill is matched as a phrase. Fold its other spellings in `synonyms` ("problem-solving"). A skill a resume shows with an outcome (mentoring, negotiation) stays hard.                                                                                                            |
| How words fold together (plurals, "-ing")     | `stemming` in `src/policy/schema/keywordMatch.ts`                                                 | One rule set for every language; packs cannot change it. A new rule must not part a word from its plural ("response", "responses"); an exception is a rule above it that gives the word back.                                                                                                      |
| Certification and language rows               | `src/parser/certifications.ts`, `src/parser/languages.ts`                                         | Headings (`sections.certifications`, `sections.languages`) and CEFR level words (`languageLevels`) in `src/policy/schema/resumeParse.ts`; `credentialWords` in `src/policy/primitives.ts`.                                                                                                         |
| Advice (file, age, target ATS)                | `src/advice/`; words, limits, messages and vendor notes in `src/policy/schema/advice.ts`          | Never scored, and no rule may read it. A target-ATS note needs a `source`: the vendor's own public page that says it.                                                                                                                                                                              |
| Where the age advice applies                  | `ageAdvice` of a region pack in `src/locales/packs/regions.ts`                                    | Only where an age on a resume invites bias and is not customary (US). See [LOCALES.md](LOCALES.md).                                                                                                                                                                                                |
| A language or a country                       | `src/locales/packs/`                                                                              | See [LOCALES.md](LOCALES.md).                                                                                                                                                                                                                                                                      |
| An AI prompt                                  | The `DEFAULT_*_PROMPT` constants in `src/ai/tasks/`                                               | Changes every result's `promptVersion`. `tests/ai/prompts.test.ts` checks each prompt names its schema's keys; `npm run eval:live` measures quality against a real model and needs a paid key.                                                                                                     |
| What is kept from a model's answer            | `src/repair/grounding.ts`, `src/repair/merge.ts`                                                  |                                                                                                                                                                                                                                                                                                    |
| PDF reading order, columns, hidden text       | `src/node/pdf.ts`, `src/node/lines.ts`, `src/node/layout.ts`, `src/node/hidden.ts`                | Build test PDFs in code with `tests/fixtures/buildPdf.ts`; never check in a real resume.                                                                                                                                                                                                           |
| DOCX reading                                  | `src/node/docx.ts`, `src/node/extract.ts`                                                         | `tests/fixtures/buildDocx.ts` builds test files.                                                                                                                                                                                                                                                   |
| Text taken from a job page                    | `src/job/`                                                                                        |                                                                                                                                                                                                                                                                                                    |
| Reading a file from a path                    | `src/node/files.ts`                                                                               | Shared by the CLI and the MCP server: the limits, the messages, and the `file` info for the advice.                                                                                                                                                                                                |
| The command line                              | `src/cli/`                                                                                        | Keep `--help` (`USAGE` in `src/cli/main.ts`) and the option table in README.md in step.                                                                                                                                                                                                            |
| The MCP server                                | `packages/mcp/src/`                                                                               | Tests in `packages/mcp/tests/`; its README lists the tools and their inputs.                                                                                                                                                                                                                       |
| The GitHub Action                             | `action/action.yml`, `action/run.mjs`                                                             | Tests in `tests/action/`. Keep the inputs table in README.md in step.                                                                                                                                                                                                                              |

## Layout

See [ARCHITECTURE.md](ARCHITECTURE.md).
