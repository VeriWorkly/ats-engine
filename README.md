# ATS Engine

[![npm](https://img.shields.io/npm/v/@veriworkly/ats-engine)](https://www.npmjs.com/package/@veriworkly/ats-engine)
[![CI](https://github.com/VeriWorkly/ats-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/VeriWorkly/ats-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node 22.12+](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)

Read a resume the way an applicant tracking system (ATS) does, see what it would store, and get a score with a reason behind every point.

`@veriworkly/ats-engine` is an open-source resume checker from [VeriWorkly](https://veriworkly.com), a privacy-first resume builder. It parses a resume into the fields an ATS keeps, scores it against a [published rubric](./RUBRIC.md), and compares it with a job posting requirement by requirement. The same input always produces the same report. The core does no network calls and keeps no state, so it runs in a browser, at the edge, or on a server.

To try it without installing anything, upload a resume to the [VeriWorkly ATS checker](https://veriworkly.com/ats-checker), which runs on this engine.

[Install](#install) · [Quick start](#quick-start) · [MCP](#use-it-from-an-ai-assistant-mcp) · [GitHub Actions](#use-it-in-github-actions) · [Use it in your app](#use-it-in-your-app) · [AI features](#ai-features) · [Run from source](#run-from-source) · [Documentation](#documentation)

## What it does

- Recovers the fields an ATS stores: name, contact details, each job (title, employer, dates), education on the ISCED scale, skills, certifications (name, issuer, date earned, expiry) and spoken languages with their CEFR level, each group marked with how it was recovered: parsed from the text, read from structured input, or repaired by a model.
- Scores readiness from 0 to 100 across parsing, contact, structure, content, format and writing, minus any integrity penalties. Every failed check comes with evidence and a suggested fix.
- Notes writing style in English resumes: bullets in the first person or the passive voice, duties instead of actions ("Responsible for"), a role you have left written in the present tense, bullets over 40 words, fewer than 2 or more than 8 bullets in a role, three bullets in a row opening with the same word, and role dates written in more than one format. These rules have their own `writing` category and carry 12 points of weight against 190 for the rest of the rubric, so the score still mostly measures whether an ATS can read the resume. They are left out for resumes in other languages.
- Matches a resume to a job posting. Each requirement is marked met, partly met, missing or unverifiable, with the resume lines that support it. Years of experience, degrees and languages are compared as values, not as keywords: "Fluent German" asks for C1 and is met by German at C1 or above, and "AWS certification" is met by a certification row that names AWS. The posting's keywords are split into hard skills and soft skills ("communication", "teamwork"). A resume claims a soft skill more often than it shows one, so a soft skill counts for a tenth of a named skill in the match score.
- Flags integrity problems: hidden text (white, tiny, off-page or covered), instructions aimed at AI screeners, invisible and look-alike characters, a pasted job posting, and keyword stuffing.
- Gives advice that is never scored: a file name like `Resume_final_v3 (2).pdf`, a file over 2 MB, a password, tracked changes or comments left in a Word document, details that can invite age bias where the region calls for it, and what a named ATS (Greenhouse, Lever, Taleo) documents on its own public pages.
- Reads German and Hindi resumes, and applies US, German and Indian conventions for dates, phone numbers, degrees, and whether a photo or date of birth belongs on the page. [LOCALES.md](./LOCALES.md) explains how to add more.
- Adds optional AI analysis, parse repair and resume conversion with your own API key. Any name, employer, title, school, email, URL or skill a model returns is checked against the resume text and dropped if it is not there.

## Install

```sh
npm install @veriworkly/ats-engine
```

To read PDF and DOCX files on Node, also install the optional peer dependencies:

```sh
npm install pdf-parse@2 pdfjs-dist@5.4.296 mammoth
```

The core runs on Node 22.12 or later and in any modern browser or edge runtime.

The package is ESM only. From CommonJS on Node 22.12 or later, `require("@veriworkly/ats-engine")` loads it anyway (Node's `require(esm)`); with TypeScript, use `"module": "nodenext"` or `"moduleResolution": "bundler"`.

## Quick start

Score a file from the command line without writing any code. PDF and DOCX files need the optional readers, which `npx` does not install on its own, so install them once with the CLI:

```sh
npm install -g @veriworkly/ats-engine pdf-parse@2 pdfjs-dist@5.4.296 mammoth
ats-engine check resume.pdf --job posting.txt
```

For a one-off run without installing, name the readers to `npx`: `npx -p @veriworkly/ats-engine -p pdf-parse@2 -p pdfjs-dist@5.4.296 -p mammoth ats-engine check resume.pdf`. A `.txt`, `.md`, `.html` or `.json` resume needs none of them: `npx @veriworkly/ats-engine check resume.md`.

```text
Readiness  97/100 (good) — 32/35 checks passed
Job match  77/100
Verdict    strong
  Requirements met: 5 of 9
    [met]          3+ years of professional software engineering experience
    [met]          Bachelor's degree in Computer Science or a related field
    [met]          Strong experience with Go or Java
    [met]          Experience with Kafka or another event-streaming platform
    [partial]      Hands-on experience with Terraform and Kubernetes
    [missing]      Excellent communication and teamwork skills
    [partial]      Fluent Spanish — Spanish: B1 read, C1 asked
    [met]          AWS certification (preferred)
    [missing]      Experience with gRPC (preferred)
  Missing keywords: terraform, payments, grpc, event-streaming, platform, backend
  Missing soft skills (weigh less): communication, teamwork

What an ATS reads:
  Name     Mei Lin Chen
  Email    meilin.chen@example.com
  Phone    (512) 555-0193
  Role     Software Engineer, Globex Corporation (Jul 2022 – Present)
  Role     Software Developer Intern, Initech (May 2021 – Aug 2021)
  Role     Teaching Assistant, UT Austin Department of Computer Science (Jan 2020 – May 2022)
  Tenure   6 yr 9 mo
  Skills   Go, Java, Python, TypeScript, Kafka, Redis, PostgreSQL, Docker, Kubernetes, AWS, Git
  Cert     AWS Certified Developer - Associate, Amazon Web Services, Mar 2023, expires Mar 2026
  Speaks   English (native), Mandarin (fluent), Spanish (conversational)

Failed checks:
  [info] Writing: 1 bullet speaks in the first person, such as "I migrated 30 nightly reports from cron jobs to Airflow, saving 6 hours a week.".
      Fix: Leave out "I", "my" and "we": open each bullet with what you did ("Led the payments team").
  [warning] Writing: 1 bullet opens with a duty rather than an action, such as "Responsible for the internal reporting dashboard used by the finance team.".
      Fix: Replace "Responsible for", "Worked on" and the like with the verb for what you did, and say what came of it.
  ...

Advice (not scored):
  [File] The file name does not say whose resume it is, or reads as a draft. Recruiters see it in the ATS and in their downloads, beside everyone else's.
      The file is named "resume.pdf".
      Fix: Name it Mei-Lin-Chen-Resume.pdf.
```

| Option            | What it does                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `--job <file>`    | Match against a job posting (`.txt`, `.pdf`, `.docx` or a saved `.html`) and list each requirement |
| `--policy <file>` | Use your own scoring policy JSON instead of the bundled one                                        |
| `--json`          | Print the full report as JSON, `advice` included                                                   |
| `--min-score <n>` | Exit with code 2 when the readiness score is below `n`, for CI checks                              |
| `--region <code>` | Read the resume as from `US`, `DE` or `IN` instead of guessing                                     |
| `--text`          | Also print the text in the order an ATS reads it (with `--json`, as the report's `lines`)          |
| `--ats <name>`    | Add the documented notes on one ATS (`greenhouse`, `lever`, `taleo`), each with its source         |
| `-h`, `--help`    | Print the options                                                                                  |
| `-v`, `--version` | Print the engine version, for bug reports                                                          |

The resume can be a `.pdf`, `.docx`, `.html`, `.txt` or `.md` file, or a `.json` [JSON Resume](https://jsonresume.org) or `ats-resume@1` document. The exit code is 0 when the check ran, 1 on an error, and 2 when the score is below `--min-score`.

After the failed checks the CLI prints any **advice** under its own heading, "Advice (not scored)". Advice never changes a score. It covers the file itself: a name like `Resume_final_v3 (2).pdf` or `resume.pdf` (with a suggested `Firstname-Lastname-Resume.pdf`), a file over 2 MB (a common upload limit, not a universal one), a PDF that is encrypted, and tracked changes or comments left in a Word document. It also flags details that can invite age bias, such as a graduation year more than 20 years back or "30+ years of experience", where the region calls for it (the US; not Germany or India, where an age on a resume is customary). With `--ats` it adds what that vendor documents publicly, with a link to the page. The engine does not simulate any vendor's parser.

In a terminal the output is coloured and opens with a VeriWorkly banner. Output sent to a pipe, a file or a CI log is plain text, and `NO_COLOR=1` turns colour off everywhere.

### AI analysis from the command line

Add `--ai` to have a model explain the report and suggest what to fix first. The score itself never depends on the model.

```sh
# macOS and Linux (PowerShell: $env:GEMINI_API_KEY = "...")
export GEMINI_API_KEY=...
ats-engine check resume.pdf --ai --provider gemini --model <model-id>

# Ollama on your own machine needs no key, and the resume never leaves it
ats-engine check resume.pdf --ai --provider ollama --model llama3.1
```

| Option              | What it does                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--ai`              | Add the AI analysis to the report                                                                                          |
| `--provider <name>` | `anthropic`, `openai`, `openrouter`, `gemini`, `groq`, `together`, `ollama`, or `openai-compatible` for any other endpoint |
| `--model <id>`      | A model ID your provider lists                                                                                             |
| `--base-url <url>`  | Use a different endpoint; required with `openai-compatible`                                                                |
| `--max-tokens <n>`  | Output budget, thinking included (default 8000)                                                                            |
| `--timeout <s>`     | Longest wait for the analysis in seconds, retries included (default 120)                                                   |

The CLI reads the API key from the environment, never from a flag, so it stays out of your shell history. It looks for the provider's usual variable first (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` or `TOGETHER_API_KEY`), then the shared `ATS_AI_API_KEY`. A server on `localhost` needs no key, and the CLI refuses to send a key over plain `http` to any other host. `ATS_AI_PROVIDER`, `ATS_AI_MODEL`, `ATS_AI_BASE_URL`, `ATS_AI_MAX_TOKENS` and `ATS_AI_TIMEOUT` can replace the flags, which is handy in CI; a `--provider` flag ignores `ATS_AI_BASE_URL`.

Before the resume is sent, the CLI names the provider and host it is about to send to, and the candidate's name, email, phone number and links are replaced with placeholders. With `--json`, the analysis is added to the report as an `ai` field. If the provider call fails, the CLI still prints the report and exits with code 1, or 2 when the score is also below `--min-score`.

## Use it from an AI assistant (MCP)

[`@veriworkly/ats-engine-mcp`](https://github.com/VeriWorkly/ats-engine/tree/main/packages/mcp#readme) is an MCP server for checking your own resume from Claude, Cursor, VS Code or any other MCP client. Its tools are `check_resume`, `match_job`, `explain_rule` and `extract_text`; `check_resume` takes a `target_ats` and returns the advice too. It runs on your machine over stdio, makes no network requests and calls no model. The assistant explains the result, but the score still comes from the rubric.

```sh
claude mcp add ats-engine -- npx -y @veriworkly/ats-engine-mcp
```

The [package README](https://github.com/VeriWorkly/ats-engine/tree/main/packages/mcp#readme) has setup for Claude Desktop, Cursor and VS Code.

## Use it in GitHub Actions

Keep your resume in a repository and check it on every push. The step fails when the score drops below `min-score`. The run's job summary shows the readiness score and job match, each failed check with its fix, each requirement's status, the missing keywords and soft skills, and the advice.

```yaml
- uses: actions/checkout@v5
- uses: VeriWorkly/ats-engine/action@main
  with:
    resume: resume.pdf
    job: jobs/backend-engineer.txt # optional
    min-score: 80 # optional
```

| Input       | What it does                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `resume`    | Path to the resume (required)                                                                                                         |
| `job`       | Path to a job posting to match against                                                                                                |
| `min-score` | Fail the step below this readiness score (0–100)                                                                                      |
| `region`    | Read the resume as from this country (`US`, `DE`, `IN`)                                                                               |
| `version`   | Engine version to run. Defaults to the release the action ships with, so your score only moves when you change it                     |
| `ats`       | Add the documented notes for the ATS you apply through (`greenhouse`, `lever`, `taleo`) to the advice; needs `version` 0.3.0 or later |
| `summary`   | `false` to leave the job summary out                                                                                                  |

Outputs: `score`, `job-match`, `failed-checks` (JSON) and `report` (the path of the full JSON report). Pin `@main` to a commit SHA if you want the action itself fixed too.

## Use it in your app

### Score resume text

`check` takes resume text and returns a report. It scores with `DEFAULT_POLICY` unless you pass a policy of your own as the second argument.

```ts
import { check } from "@veriworkly/ats-engine";

const report = check(resumeText);

console.log(report.readinessScore); // 0-100
for (const failed of report.failedChecks) {
  console.log(`${failed.severity}: ${failed.evidence}\n  Fix: ${failed.fix}`);
}
```

Instead of plain text you can pass a structured document (`AtsResumeDocument`, built with the `/document` helpers) or a [JSON Resume](https://jsonresume.org). The engine then reads the fields directly instead of parsing them.

### Read a PDF or DOCX upload (Node)

Text alone cannot show columns, tables, photos or hidden text. `extractResume` returns that layout information alongside the text so the layout rules can run. Without it those rules are left out of the report rather than guessed.

```ts
import { readFile } from "node:fs/promises";
import { check, DEFAULT_POLICY } from "@veriworkly/ats-engine";
import { detectResumeFormat, extractResume } from "@veriworkly/ats-engine/node";

const bytes = new Uint8Array(await readFile("resume.pdf"));
const format = detectResumeFormat("resume.pdf"); // "pdf" | "docx" | "html" | "text" | null
if (!format) throw new Error("Unsupported file type");

const { text, layout } = await extractResume(bytes, format);
const report = check(text, DEFAULT_POLICY, {
  layout,
  file: { name: "resume.pdf", bytes: bytes.length, format }, // optional: advice on the file
  targetAts: "greenhouse", // optional: that vendor's documented notes, in report.advice
});
```

In a web server, pass the uploaded file's name and MIME type to `detectResumeFormat(fileName, mimeType)` and its bytes to `extractResume`, preferably in the forkable `/node/child` process (see [SECURITY.md](./SECURITY.md)). For a file on disk, `readResumeFile(path)` does all of this and returns `{ input, layout, file }`, ready for `check`; `readJobFile(path)` reads a posting the same way and returns `{ text, company? }`.

The `file` option (`name`, `bytes`, `format`, and `passwordProtected`, `trackedChanges` or `comments` when your host knows them) and `targetAts` are read only for `report.advice` and never change a score. The layout already carries what extraction measured for the advice: a PDF that is encrypted, and a Word document's tracked changes and comments. An unknown `targetAts` or `region` throws `AtsPolicyError`.

### Match against a job posting

Pass the posting's text as `jobDescription`. If you have a saved job page instead, `/job` pulls the posting out of the HTML (including JSON-LD job data).

```ts
import { check, DEFAULT_POLICY } from "@veriworkly/ats-engine";
import { extractJobPosting, jobTextFromHtml } from "@veriworkly/ats-engine/job";

const report = check(resumeText, DEFAULT_POLICY, {
  jobDescription: jobTextFromHtml(postingHtml),
  jobCompany: extractJobPosting(postingHtml)?.company, // optional: the employer, never a keyword
  now: new Date("2026-10-01"), // optional: fix the date so tenure is reproducible
});

report.jobMatchScore; // 0-100, or null without a posting
report.missingKeywords; // terms in the posting the resume never mentions, hard skills first, names left out
report.missingKeywordGroups; // the same terms by kind: { hard: [...], soft: ["communication"] }
report.requirements; // [{ text, status: "met" | "partial" | "missing" | "unverifiable", evidence }]
```

Soft skills ("communication", "teamwork", "attention to detail") come from the policy's `keywordMatch.softSkills` and the language packs. Each weighs `keywordMatch.softSkillWeight` (0.4) of an ordinary word, which is a tenth of a named skill.

### Read resumes in other languages

Attach the locale packs once at startup and reuse the policy. Language and region are detected per resume, or you can set them with the `languages` and `region` options.

```ts
import { check, DEFAULT_POLICY } from "@veriworkly/ats-engine";
import { BUILT_IN_LOCALES, withLocales } from "@veriworkly/ats-engine/locales";

const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);

check(resumeText, policy).locale; // { languages: ["de"], region: "DE" }
check(resumeText, policy, { region: "IN" });
```

### What's in a report

| Field                                          | Contents                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readinessScore`                               | Overall score, 0 to 100                                                                                                                                                     |
| `categories`                                   | Score per category: `parse`, `contact`, `structure`, `content`, `format`, `writing`, and `integrity` (penalties), each `{ category, score, passed, total, lost, possible }` |
| `checksPassed`, `checksTotal`                  | How many of the rules that applied passed                                                                                                                                   |
| `failedChecks`                                 | Each failed rule with `id`, `category`, `severity`, `evidence`, `scoreImpact` and `fix`                                                                                     |
| `rules`                                        | Every rule that applied, passed or failed, in the same shape                                                                                                                |
| `prioritizedFixes`                             | The fixes of the failed checks, costliest first, at most 6                                                                                                                  |
| `parsingWarnings`                              | Evidence of the failed checks that stop an ATS reading the file: parsing, and columns, tables or letter spacing                                                             |
| `strengths`                                    | Evidence of up to 5 passed checks, the ones worth the most points                                                                                                           |
| `wordCount`                                    | Words in the resume text                                                                                                                                                    |
| `parsed`                                       | What an ATS would store: name, email, phone, links, roles, education, skills, certifications, spoken languages, months of experience, highest ISCED level, provenance       |
| `jobMatchScore`                                | Job match, 0 to 100, or `null` without a posting                                                                                                                            |
| `requirements`                                 | Each requirement of the posting with its `status`, `importance`, `kind`, `terms`, `evidence` and `detail`; empty without a posting, at most 25                              |
| `matchedKeywords`, `missingKeywords`           | Posting terms found and not found in the resume, hard skills first, at most 12                                                                                              |
| `matchedKeywordGroups`, `missingKeywordGroups` | The same terms as `{ hard, soft }`, at most 12 each; soft skills weigh less in the match                                                                                    |
| `locale`                                       | The languages and region the resume was read as, `{ languages, region }`                                                                                                    |
| `version`, `engine`                            | The policy's `version`, and the engine version and policy fingerprint, to reproduce the result                                                                              |
| `advice`                                       | Not scored: `{ id, kind, message, evidence?, fix?, source? }`, see below                                                                                                    |
| `lines`                                        | The text as the engine read it, line by line, only with `includeLines: true`                                                                                                |

`advice` is always present and often empty. `kind` is `file` (name, size, password, tracked changes, comments; only for what the `file` option describes or the layout measured), `age` (an old graduation year or a long stated or dated career, only in regions whose pack asks for it) or `ats` (a named target ATS's documented notes, each with the vendor page as `source`). Its text comes from the policy's `advice` section. It is never part of `readinessScore`, `categories`, `failedChecks` or `prioritizedFixes`: the same resume scores the same with or without it.

`parsed.certifications` holds one row per certification or licence (`name`, `issuer`, `date`, `expires`) and `parsed.spokenLanguages` one per language (`language`, `level` as written, `cefr` from A1 to C2, or null). Both are read from their own sections, and from a "Languages:" or "Certifications:" line among the skills. A "Languages: Go, Rust" line stays skills. A JSON Resume's `certificates` and `languages`, and a document's `certifications` and `languages` sections, fill them from their fields. Each recovered group's `parsed.provenance` says where it came from: `parser`, `structured`, `ai` or `none`.

`shapeReport(report, "full" | "restricted")` trims a report before you send it to a client. A restricted report keeps the scores, the verdict, the top fix and the main warning, counts instead of keyword and role lists, and each advice item's `id`, `kind` and `message` without the quoted specifics. `computeVerdict(report)` gives the verdict (`strong`, `needs-work` or `weak`) the CLI prints.

`/format` has display helpers for these values: score bands, category and advice labels, date and tenure formatting, and one-line forms of a certification and a spoken-language row (`formatCertification`, `formatSpokenLanguage`).

### A full integration

VeriWorkly's own server is open source and uses most of the package: file uploads, PDF and DOCX extraction in a child process, fetching job pages, locale packs, AI analysis with provider routing, and parse repair. See [`apps/server/src/services/ats`](https://github.com/VeriWorkly/veriworkly/tree/master/apps/server/src/services/ats) in the VeriWorkly repo.

### Package entry points

| Import                                        | Contents                                             | Runs on               |
| --------------------------------------------- | ---------------------------------------------------- | --------------------- |
| `@veriworkly/ats-engine`                      | Scoring, parsing, policy, report shaping, rubric     | Anywhere              |
| `@veriworkly/ats-engine/document`             | Structured input and JSON Resume                     | Anywhere, no deps     |
| `@veriworkly/ats-engine/format`               | Score bands, labels, date formatting                 | Anywhere, no deps     |
| `@veriworkly/ats-engine/job`                  | Job text from a saved posting page                   | Anywhere, no deps     |
| `@veriworkly/ats-engine/locales`              | Language and region packs                            | Anywhere              |
| `@veriworkly/ats-engine/ai`                   | AI tasks and the provider interface                  | Anywhere with `fetch` |
| `@veriworkly/ats-engine/ai/anthropic`         | Anthropic adapter                                    | Anywhere with `fetch` |
| `@veriworkly/ats-engine/ai/openai-compatible` | OpenAI, OpenRouter, Gemini, Groq, Ollama and similar | Anywhere with `fetch` |
| `@veriworkly/ats-engine/ai/testing`           | Test doubles and an eval harness                     | Anywhere              |
| `@veriworkly/ats-engine/node`                 | PDF and DOCX extraction                              | Node                  |

## AI features

Scoring never needs a model. The AI tasks are optional extras that run on your own API key. The CLI's `--ai` runs `analyze`; the library has all three:

- `analyze` explains a report in plain language and suggests improvements.
- `repairParse` fills in fields the parser missed, using only values found in the resume.
- `convertResume` turns free text into a structured resume.

Each call returns the result together with the values that were dropped for not appearing in the resume, token usage, the number of attempts, and the prompt version, so you can bill and audit calls yourself.

```ts
import { check, DEFAULT_POLICY } from "@veriworkly/ats-engine";
import { createAtsAi } from "@veriworkly/ats-engine/ai";
import { anthropic } from "@veriworkly/ats-engine/ai/anthropic";

const ai = createAtsAi({
  provider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  routes: { analyze: { model: "claude-sonnet-5-5", maxTokens: 4000 } },
});

const report = check(resumeText, DEFAULT_POLICY, { jobDescription });
const { result, usage } = await ai.analyze({ resumeText, report, jobDescription });
```

### Choosing a provider

Two adapters cover most providers. `anthropic` talks to the Anthropic Messages API. `openAiCompatible` talks to any service that serves `POST {baseUrl}/chat/completions`. To switch providers, change the `provider` line; the rest of the code stays the same.

| Provider           | Adapter            | `baseUrl`                                                 |
| ------------------ | ------------------ | --------------------------------------------------------- |
| Anthropic          | `anthropic`        | Default                                                   |
| OpenAI             | `openAiCompatible` | Default (`https://api.openai.com/v1`)                     |
| OpenRouter         | `openAiCompatible` | `https://openrouter.ai/api/v1`                            |
| Google Gemini      | `openAiCompatible` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Groq               | `openAiCompatible` | `https://api.groq.com/openai/v1`                          |
| Together           | `openAiCompatible` | `https://api.together.xyz/v1`                             |
| Ollama (local)     | `openAiCompatible` | `http://localhost:11434/v1`                               |
| vLLM (self-hosted) | `openAiCompatible` | Your server's `/v1` URL                                   |

With Ollama or vLLM the model runs on your own hardware, so resume text never leaves it. For any other service, write your own adapter: `LlmProvider` is a single `complete(request)` method that returns text.

```ts
import { openAiCompatible } from "@veriworkly/ats-engine/ai/openai-compatible";

// OpenAI (the default base URL)
openAiCompatible({ apiKey: process.env.OPENAI_API_KEY! });

// OpenRouter
openAiCompatible({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseUrl: "https://openrouter.ai/api/v1",
  requireParameters: true, // with structuredOutputs, route only to models that honour the schema
});

// Google Gemini, through its OpenAI-compatible endpoint
openAiCompatible({
  apiKey: process.env.GEMINI_API_KEY!,
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
});

// Ollama on your own machine (any non-empty key)
openAiCompatible({ apiKey: "ollama", baseUrl: "http://localhost:11434/v1" });
```

Set the model per task in `routes`, using the model ID your provider lists. You can also override `maxTokens`, `retries`, `structuredOutputs` or the system prompt on a single call.

> [!TIP]
> `structuredOutputs` is off by default. When it is off, the engine asks for plain JSON and validates the reply against its own schema, which works with almost every model. Turn it on for providers and models that support JSON Schema output; it cuts down on invalid replies.

> [!NOTE]
> Models that think before answering (recent Claude, OpenAI and Gemini models) count those thinking tokens against `maxTokens`. If you get a `truncated` error, raise `maxTokens` rather than `retries`.

> [!WARNING]
> Keep API keys on your server. The AI code can run in a browser, but a key sent to the browser is visible to anyone using the page.

To check a provider and model against the engine's quality bar before you ship, run the live eval from a clone of this repo. It makes about 15 small, billed calls.

```sh
ATS_EVAL_API_KEY=... ATS_EVAL_MODEL=... ATS_EVAL_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai npm run eval:live
```

Set `ATS_EVAL_PROVIDER=anthropic` for the Anthropic adapter, `ATS_EVAL_STRUCTURED=false` to test without JSON Schema output, or `ATS_EVAL_RUNS` to change the number of runs per case (default 3). Instead of the shell, the variables can live in a `.env` file at the root of the clone, which git ignores: copy [`.env.example`](./.env.example) and fill it in. Variables set in the shell win over the file.

## Intended use

> [!IMPORTANT]
> This package is a tool for candidates who want to see their own resume as software sees it. It is not built or validated for decisions about other people. Using it to screen, rank or reject applicants may make it an automated employment decision tool under laws such as New York City Local Law 144, the EU AI Act (which treats recruitment as high risk), Illinois HB 3773 and Colorado SB 26-189. Those laws carry bias-audit, notice and documentation duties that this package does not meet for you.

A score measures how well a resume parses and reads. It says nothing about the person.

## Run from source

You need Node 22.12 or later.

```sh
git clone https://github.com/VeriWorkly/ats-engine.git
cd ats-engine
npm ci
npm run build
```

Then try the CLI on a resume of your own:

```sh
node dist/cli/index.js check path/to/resume.pdf --job path/to/posting.txt
```

| Command         | What it does                                                      |
| --------------- | ----------------------------------------------------------------- |
| `npm run dev`   | Rebuild on every change                                           |
| `npm test`      | Run the test suite                                                |
| `npm run lint`  | ESLint and Prettier checks                                        |
| `npm run bench` | Field accuracy over the labelled and generated synthetic resumes  |
| `npm run check` | Everything CI runs: build, types, lint, tests, sizes, smoke, pack |

## Documentation

- [RUBRIC.md](./RUBRIC.md): every rule, its weight and its fix, generated from the policy
- [LOCALES.md](./LOCALES.md): supported languages and regions, and how to add one
- [ARCHITECTURE.md](./ARCHITECTURE.md): how the code is organised
- [CONTRIBUTING.md](./CONTRIBUTING.md): the rules for a change, where to make it, and how a release goes out
- [SECURITY.md](./SECURITY.md): limits, prompt-injection handling, and reporting a vulnerability
- [CHANGELOG.md](./CHANGELOG.md): releases and breaking changes
- [llms.txt](./llms.txt): a short summary of the package for AI tools, in the llmstxt.org format; also served from the npm package (`https://cdn.jsdelivr.net/npm/@veriworkly/ats-engine/llms.txt`)
- [packages/mcp](https://github.com/VeriWorkly/ats-engine/tree/main/packages/mcp#readme): the MCP server, `@veriworkly/ats-engine-mcp`

The package is still 0.x. Any change to the report's shape, the policy schema, or the score for the same input is treated as breaking and called out in the changelog. `AtsParsedEducation.level`, `AtsParsedResume.highestDegree`, `AtsDegreeLevel` and `DEGREE_LABELS` are deprecated and will be removed in 1.0; use `isced`, `highestIsced` and `ISCED_LABELS` instead.

Built by [VeriWorkly](https://veriworkly.com).
