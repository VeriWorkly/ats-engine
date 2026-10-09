---
"@veriworkly/ats-engine": minor
---

The CLI can ask a model to explain the report: `ats-engine check resume.pdf --ai --provider <name> --model <id>`. Presets cover Anthropic, OpenAI, OpenRouter, Gemini, Groq, Together and Ollama, and `openai-compatible` with `--base-url` covers any other Chat Completions endpoint. The key is read from the environment only (the provider's own variable, then `ATS_AI_API_KEY`) and never sent over plain http to another machine; the CLI names the provider and host before sending, contact details are redacted first, and `--json` adds the analysis as an `ai` field. `--timeout <seconds>` (or `ATS_AI_TIMEOUT`, default 120) bounds the whole wait, retries included, so a provider that never answers fails with "No answer from <provider> at <host> within N s" instead of after about 4 minutes. The score does not depend on it.

With `--job`, the text output now lists every requirement with its status and, when it is not met, why. A posting may be a `.pdf` or `.docx` file as well as text or a saved web page, and a verdict line appears beside the job match.

In a terminal the report is coloured and opens with a VeriWorkly banner. Output to a pipe, a file or CI is plain text, `NO_COLOR` turns colour off, and control characters from a resume or a model never reach the terminal.

Clearer messages for a missing file, a folder, an unsupported file type, JSON that is not a resume, an unknown option or command, and a score below `--min-score`, which keeps exit code 2 even when `--ai` fails. `ats-engine --version` (also `check --version`) prints the engine version.

`/format`: `formatTenure` reads odd input as whole, non-negative months, and `formatParsedDate` reads a month outside 1–12 as the year alone.
