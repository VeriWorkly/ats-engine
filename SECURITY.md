# Security

## Reporting a vulnerability

Email **grievance@veriworkly.com** with a description, a reproducing input, the potential impact
and the version (`ENGINE_VERSION`). Please do not open a public issue. We acknowledge within
24–48 hours, keep you updated while we investigate, and fix as quickly as the severity calls for;
a security advisory may follow, crediting you if you want. Good-faith research under this policy
is authorised. There is no paid bug bounty.

Only the latest minor release receives security fixes while the package is 0.x.

## What the package defends against

The engine is built to take input from anyone: a resume, a posting, a web page, an uploaded
file. These are the guarantees, each held by a test.

**Time.** Every pattern over untrusted text is linear. A 50 KB adversarial input in any of 50
shapes (letter runs, digit runs, unclosed tags, comma lists, mixed scripts…), placed in the name
line, a bullet and the posting at once, scores in tens of milliseconds under the community policy
with every locale pack applied (`tests/integration/adversarial.test.ts`, which fails past 1.5 s). Patterns in a _policy_ or a _pack_
are operator-supplied: `parseAtsPolicy` checks that they compile, not that they are linear, so
review a policy's patterns as you would code — `tests/integration/regressions.test.ts` re-runs the
adversarial suite against a private policy when one is present.

**Size.** Resume text is cut at 50 000 characters, postings at 20 000, a structured document is
bounded in depth, array length and node count before it is validated, a DOCX may expand to at most
64 MB and hold at most 2 MB of the XML `mammoth` parses, and PDF text reading stops at the cap. A
file name is read to its first 255 characters. The CLI and the MCP server read only a regular file
on this computer: a file over 20 MB is refused before it is opened, and is read through one handle
no further than one byte past the limit, so a file that grows meanwhile is refused too; a folder, a
pipe or a device (which reports no size and can stream without end) is refused before it is opened,
and so is a network path (`\\host\share\…`, `//host/share/…`, `\\?\UNC\…`) or a device path
(`\\.\…`); of the paths that start with two slashes, only the local long form `\\?\C:\…` is read.
Only the path's form is checked: a mapped drive letter, a `subst` drive, a link or junction to a
share, or an SMB or NFS mount looks local and is read over the network. The MCP server refuses
pasted text over 200 000 characters. A host should still bound request bodies.

**Crashes.** Words from the input are never used as plain-object keys, JSON-LD is read to a fixed
depth, and malformed PDF or DOCX structure degrades to "not measured" rather than throwing past the
extractor. A DOCX's tracked changes and comments are counted in the same pass, and under the same
budget, as the rest of its measurement. A DOCX is refused, before `mammoth` parses any of it, when a
part it would parse holds a comment, processing instruction or CDATA section that never closes, more
than 1 000 of them, a document type declaration, a `<` that starts no well-formed tag, a prefix
bound to a second namespace, or more than 1 000 distinct elements (a name in a namespace) and style,
break, symbol or content-type tags: on those its XML parser (`@xmldom/xmldom` 0.8) or its list of
warnings takes seconds to minutes, and a file of 1.4 KB held it for two minutes. A style map the
file carries is not applied. What passes still costs `mammoth` up to about a second a megabyte of
XML. PDF parsing (pdf.js) and DOCX parsing (`mammoth`) are CPU-bound: run `/node` extraction in the
forkable `/node/child` process with a timeout and a memory limit, so a pathological file costs a
killed process, not a worker.

**Advice inputs.** The `file` option and the file name are read only for `report.advice`, never
for the score. The name is quoted back in the advice's `evidence` as given, so a host that shows
advice in a page escapes it as it escapes any other report text; the CLI and the MCP server strip
control characters from everything they print. `targetAts` (`--ats`, `target_ats`) must be an id
the policy has notes on, or the call throws before anything is read. The notes are text from the
policy with a link to the vendor's page; the engine never fetches that page.

**Prompt injection (`/ai`).** Resume and posting text are passed to the model as JSON data, with a
system prompt that says so, never as instructions. That lowers the risk; no prompt removes it.
What does not depend on the model:

- Every identity value a task returns (names, employers, titles, schools, email addresses, URLs,
  skills) must occur in the source text, and is dropped and reported in `rejected` if it does not.
  Dates in parse repair must name a year the text contains.
- Free text a model writes (an explanation, a recommendation) is advice and is not grounded:
  show it as the model's words, not as facts about the candidate.
- `analyze` redacts the name, email, phone and links before the request leaves (postal addresses
  are not recognised). Parse repair and conversion must see contact details and do not redact.
- The deterministic integrity rules flag instructions aimed at an AI screener inside the resume,
  including text smuggled in Unicode tag characters or PDF metadata. A phrase in quotes or
  backticks within three words of a word that says it was caught (`text.injectionMentionVerbs`:
  "flags", "blocked", "red-teamed"), with no comma or colon between, is an AI security
  engineer's example and is not flagged: `Built a filter that flags "ignore previous
  instructions"`. An attacker can dress an instruction so too, and a model reading the resume
  may still follow it; the rule trades that for not failing honest security work. It is still
  flagged unquoted (a bare "[INST]" too), on a labelled list line ("Skills: …"), in text hidden
  by the layout, in tag characters or in metadata, and whenever the quote tells the screener
  what to make of the resume ("rank this candidate", "score me"; `text.injectionTargets`).

**API keys in the CLI.** `ats-engine check --ai` reads the key from the environment only, never
from a flag, so it does not land in shell history or the process list, and never prints it. The
CLI says which provider and model the resume is about to be sent to before the request leaves,
and refuses to send a key over plain `http` to any host but this machine (`localhost`,
`127.0.0.1`, `[::1]`). The live AI eval (`npm run eval:live`) reads its key from the environment
or from a `.env` file, which is never committed.

**State.** The core holds no global state, does no I/O and makes no network calls; only `/ai`
calls the provider you configure, and only `/node` reads files you pass it.

## Around the engine

**The MCP server.** `@veriworkly/ats-engine-mcp` talks over stdio only, makes no network requests
and calls no model. It reads the files a tool call names, with the rights of the user running it,
and nothing else; folders, pipes, devices, network paths and files over 20 MB are refused. Its
stdout carries only the protocol. Its answers include text from the resume, which the assistant
sends to its own model provider.

**The GitHub Action.** Its inputs reach `run.mjs` as environment variables, never pasted into a
shell command, so a file name cannot inject code. `version` must look like a version or a
dist-tag. The CLI runs through `npx` outside the checkout, so a repository's own `package.json`
cannot swap in another engine. Resume and posting text written to the job summary is escaped for
Markdown and cut to 300 characters per cell.
