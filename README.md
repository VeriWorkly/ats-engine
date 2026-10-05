# ATS Engine

[![npm](https://img.shields.io/npm/v/@veriworkly/ats-engine)](https://www.npmjs.com/package/@veriworkly/ats-engine)
[![CI](https://github.com/VeriWorkly/ats-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/VeriWorkly/ats-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node 20.19+](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)

Read a resume the way an applicant tracking system (ATS) does, see what it would store, and get a score with a reason behind every point.

`@veriworkly/ats-engine` is an open-source resume checker from [VeriWorkly](https://veriworkly.com), a privacy-first resume builder. It parses a resume into the fields an ATS keeps, scores it against a [published rubric](./RUBRIC.md), and compares it with a job posting requirement by requirement. The same input always produces the same report. The core does no network calls and keeps no state, so it runs in a browser, at the edge, or on a server.

To try it without installing anything, upload a resume to the [VeriWorkly ATS checker](https://veriworkly.com/ats-checker), which runs on this engine.

[Install](#install) · [Quick start](#quick-start) · [Use it in your app](#use-it-in-your-app) · [AI features](#ai-features) · [Run from source](#run-from-source) · [Documentation](#documentation)

## What it does

- Recovers the fields an ATS stores: name, contact details, each job (title, employer, dates), education on the ISCED scale, and skills, each with a note on where in the resume it came from.
- Scores readiness from 0 to 100 across parsing, contact, structure, content and format, minus any integrity penalties. Every failed check comes with evidence and a suggested fix.
- Matches a resume to a job posting. Each requirement is marked met, partly met, missing or unverifiable, with the resume lines that support it. Years of experience, degrees and languages are compared as values, not as keywords.
- Flags integrity problems: hidden text (white, tiny, off-page or covered), instructions aimed at AI screeners, invisible and look-alike characters, a pasted job posting, and keyword stuffing.
- Reads German and Hindi resumes, and applies US, German and Indian conventions for dates, phone numbers, degrees, and whether a photo or date of birth belongs on the page. [LOCALES.md](./LOCALES.md) explains how to add more.
- Adds optional AI analysis, parse repair and resume conversion with your own API key. Any name, employer, title, school, email, URL or skill a model returns is checked against the resume text and dropped if it is not there.

## Install

```sh
npm install @veriworkly/ats-engine
```

To read PDF and DOCX files on Node, also install the optional peer dependencies:

```sh
npm install pdf-parse pdfjs-dist@5.4.296 mammoth
```

The core runs on Node 20.19 or later and in any modern browser or edge runtime.

The package is ESM only. From CommonJS on Node 20.19 or later, `require("@veriworkly/ats-engine")` loads it anyway (Node's `require(esm)`); with TypeScript, use `"module": "nodenext"` or `"moduleResolution": "bundler"`.

## Quick start

Score a file from the command line without writing any code:

```sh
npx @veriworkly/ats-engine check resume.pdf --job posting.txt
```

```text
Readiness  95/100 (good) — 26/27 checks passed
Job match  67/100
Verdict    needs work
  Requirements met: 4 of 10
    [partial]      5+ years of professional software engineering experience — 0 years in roles naming software, engineering, 5 asked
    [met]          Bachelor's degree in Computer Science or a related field
    [met]          Strong experience with Go or Java
    [missing]      Experience with Kafka or another event-streaming platform
    [partial]      AWS certification (preferred)
    ...

What an ATS reads:
  Name     Mei Lin Chen
  Email    meilin.chen@example.edu
  Role     Software Engineering Intern, Globex Corporation (May 2025 – Aug 2025)
  Role     Software Developer Intern, Initech (Jun 2024 – Aug 2024)
  Skills   Python, Java, JavaScript, TypeScript, React, Node.js, SQL, PostgreSQL, Git, Docker, AWS

Failed checks:
  [warning] Format risk: The resume is 192 words, too short to show what you did.
      Fix: Add to it: a few bullets for each recent role saying what you did and what came of it.
```

| Option            | What it does                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `--job <file>`    | Match against a job posting (`.txt`, `.pdf`, `.docx` or a saved `.html`) and list each requirement |
| `--json`          | Print the full report as JSON                                                                      |
| `--min-score <n>` | Exit with code 2 when the score is below `n`, for CI checks                                        |
| `--region <code>` | Read the resume as from `US`, `DE` or `IN` instead of guessing                                     |
| `--text`          | Print the text in the order an ATS reads it                                                        |
| `--policy <file>` | Use your own scoring policy JSON                                                                   |
| `--version`       | Print the engine version, for bug reports                                                          |

In a terminal the output is coloured and opens with a VeriWorkly banner. Output sent to a pipe, a file or a CI log is plain text, and `NO_COLOR=1` turns colour off everywhere.

### AI analysis from the command line

Add `--ai` to have a model explain the report and suggest what to fix first. The score itself never depends on the model.

```sh
# macOS and Linux (PowerShell: $env:GEMINI_API_KEY = "...")
export GEMINI_API_KEY=...
npx @veriworkly/ats-engine check resume.pdf --ai --provider gemini --model <model-id>

# Ollama on your own machine needs no key, and the resume never leaves it
npx @veriworkly/ats-engine check resume.pdf --ai --provider ollama --model llama3.1
```

| Option              | What it does                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--ai`              | Add the AI analysis to the report                                                                                          |
| `--provider <name>` | `anthropic`, `openai`, `openrouter`, `gemini`, `groq`, `together`, `ollama`, or `openai-compatible` for any other endpoint |
| `--model <id>`      | A model ID your provider lists                                                                                             |
| `--base-url <url>`  | Use a different endpoint; required with `openai-compatible`                                                                |
| `--max-tokens <n>`  | Output budget, thinking included (default 8000)                                                                            |

The CLI reads the API key from the environment, never from a flag, so it stays out of your shell history. It looks for the provider's usual variable first (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` or `TOGETHER_API_KEY`), then the shared `ATS_AI_API_KEY`. A server on `localhost` needs no key, and the CLI refuses to send a key over plain `http` to any other host. `ATS_AI_PROVIDER`, `ATS_AI_MODEL`, `ATS_AI_BASE_URL` and `ATS_AI_MAX_TOKENS` can replace the flags, which is handy in CI; a `--provider` flag ignores `ATS_AI_BASE_URL`.

Before the resume is sent, the CLI names the provider and host it is about to send to, and the candidate's name, email, phone number and links are replaced with placeholders. With `--json`, the analysis is added to the report as an `ai` field. If the provider call fails, the CLI still prints the report and exits with code 1, or 2 when the score is also below `--min-score`.

## Use it in your app

### Score resume text

`AtsScoringService.check` takes resume text and a policy and returns a report. Use `DEFAULT_POLICY` unless you have written your own.

```ts
import { AtsScoringService, DEFAULT_POLICY } from "@veriworkly/ats-engine";

const report = AtsScoringService.check(resumeText, DEFAULT_POLICY);

console.log(report.readinessScore); // 0-100
for (const check of report.failedChecks) {
  console.log(`${check.severity}: ${check.evidence}\n  Fix: ${check.fix}`);
}
```

Instead of plain text you can pass a structured document (`AtsResumeDocument`, built with the `/document` helpers) or a [JSON Resume](https://jsonresume.org). The engine then reads the fields directly instead of parsing them.

### Read a PDF or DOCX upload (Node)

Text alone cannot show columns, tables, photos or hidden text. `extractResume` returns that layout information alongside the text so the layout rules can run. Without it those rules are left out of the report rather than guessed.

```ts
import { readFile } from "node:fs/promises";
import { AtsScoringService, DEFAULT_POLICY } from "@veriworkly/ats-engine";
import { detectResumeFormat, extractResume } from "@veriworkly/ats-engine/node";

const bytes = new Uint8Array(await readFile("resume.pdf"));
const format = detectResumeFormat("resume.pdf"); // "pdf" | "docx" | "text" | null
if (!format) throw new Error("Unsupported file type");

const { text, layout } = await extractResume(bytes, format);
const report = AtsScoringService.check(text, DEFAULT_POLICY, { layout });
```

In a web server, pass the uploaded file's name and MIME type to `detectResumeFormat(fileName, mimeType)` and its bytes to `extractResume`.

### Match against a job posting

Pass the posting's text as `jobDescription`. If you have a saved job page instead, `/job` pulls the posting out of the HTML (including JSON-LD job data).

```ts
import { jobTextFromHtml } from "@veriworkly/ats-engine/job";

const report = AtsScoringService.check(resumeText, DEFAULT_POLICY, {
  jobDescription: jobTextFromHtml(postingHtml),
  now: new Date("2026-10-01"), // optional: fix the date so tenure is reproducible
});

report.jobMatchScore; // 0-100, or null without a posting
report.missingKeywords; // terms in the posting the resume never mentions
report.requirements; // [{ text, status: "met" | "partial" | "missing" | "unverifiable", evidence }]
```

### Read resumes in other languages

Attach the locale packs once at startup and reuse the policy. Language and region are detected per resume, or you can set them with the `languages` and `region` options.

```ts
import { BUILT_IN_LOCALES, withLocales } from "@veriworkly/ats-engine/locales";

const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);

AtsScoringService.check(resumeText, policy).locale; // { languages: ["de"], region: "DE" }
AtsScoringService.check(resumeText, policy, { region: "IN" });
```

### What's in a report

| Field                                | Contents                                                          |
| ------------------------------------ | ----------------------------------------------------------------- |
| `readinessScore`                     | Overall score, 0 to 100                                           |
| `categories`                         | Score per category (parsing, contact, structure, content, format) |
| `failedChecks`                       | Each failed rule with `severity`, `evidence` and `fix`            |
| `prioritizedFixes`                   | Fixes in the order the rubric ranks them                          |
| `parsed`                             | The fields an ATS would store: contact, roles, education, skills  |
| `jobMatchScore`, `requirements`      | Job match results, when a posting was given                       |
| `matchedKeywords`, `missingKeywords` | Posting terms found and not found in the resume                   |
| `engine`                             | Engine version and policy fingerprint, to reproduce the result    |

`/format` has display helpers for these values: score bands, category labels, and date and tenure formatting. `shapeReport` trims a report to a chosen level of detail before you send it to a client.

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
import { AtsScoringService, DEFAULT_POLICY } from "@veriworkly/ats-engine";
import { createAtsAi } from "@veriworkly/ats-engine/ai";
import { anthropic } from "@veriworkly/ats-engine/ai/anthropic";

const ai = createAtsAi({
  provider: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  routes: { analyze: { model: "claude-sonnet-5-5", maxTokens: 4000 } },
});

const report = AtsScoringService.check(resumeText, DEFAULT_POLICY, { jobDescription });
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

Set `ATS_EVAL_PROVIDER=anthropic` for the Anthropic adapter, or `ATS_EVAL_STRUCTURED=false` to test without JSON Schema output.

## Intended use

> [!IMPORTANT]
> This package is a tool for candidates who want to see their own resume as software sees it. It is not built or validated for decisions about other people. Using it to screen, rank or reject applicants may make it an automated employment decision tool under laws such as New York City Local Law 144, the EU AI Act (which treats recruitment as high risk), Illinois HB 3773 and Colorado SB 26-189. Those laws carry bias-audit, notice and documentation duties that this package does not meet for you.

A score measures how well a resume parses and reads. It says nothing about the person.

## Run from source

You need Node 20.19 or later.

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
| `npm run bench` | Field accuracy over the labelled corpus of synthetic resumes      |
| `npm run check` | Everything CI runs: build, types, lint, tests, sizes, smoke, pack |

## Documentation

- [RUBRIC.md](./RUBRIC.md): every rule, its weight and its fix, generated from the policy
- [LOCALES.md](./LOCALES.md): supported languages and regions, and how to add one
- [ARCHITECTURE.md](./ARCHITECTURE.md): how the code is organised
- [SECURITY.md](./SECURITY.md): limits, prompt-injection handling, and reporting a vulnerability
- [CHANGELOG.md](./CHANGELOG.md): releases and breaking changes

The package is still 0.x. Any change to the report's shape, the policy schema, or the score for the same input is treated as breaking and called out in the changelog. `AtsParsedEducation.level`, `AtsParsedResume.highestDegree`, `AtsDegreeLevel` and `DEGREE_LABELS` are deprecated and will be removed in 1.0; use `isced`, `highestIsced` and `ISCED_LABELS` instead.

Built by [VeriWorkly](https://veriworkly.com).
