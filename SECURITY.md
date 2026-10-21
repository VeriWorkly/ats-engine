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

**Time.** Every pattern over untrusted text is linear. A 50 KB adversarial input in any of 110
shapes, 105 written on one line or under one heading (letter runs, digit runs, unclosed tags,
comma lists, mixed scripts…) and 5 as 25,000 short lines ("1", "12", "1.", "a", "क" on each),
placed in the name line, a bullet and the posting at once (under each region: DE, FR, GB, IN),
and again under the certification and language headings, scores under the community policy
with every language pack applied in tens of milliseconds for most
one-line shapes and a few hundred at most, short lines included, on a developer machine
(`tests/integration/adversarial.test.ts`, which fails any shape past 1.5 s). The analysis's
redaction (`/ai`) takes milliseconds on 150 000 characters. Patterns in a _policy_ or a _pack_
are operator-supplied: `parseAtsPolicy` checks that they compile, not that they are linear, so
review a policy's patterns as you would code — `tests/integration/regressions.test.ts` re-runs the
adversarial suite against a private policy when one is present.

**Size.** Resume text is cut at 50 000 characters, postings at 20 000, a structured document is
bounded in depth, array length and node count before it is validated, a policy or a locale pack
nested deeper than 5 000 levels (or one that contains itself) is refused as invalid with
`AtsPolicyError` rather than overflowing the stack, a DOCX may expand to at most
64 MB and hold at most 2 MB of the XML `mammoth` parses, 2 MB of page headers and footers and
8 MB of embedded HTML pages (`w:altChunk`, each read once however often it is named; a part past
these is neither read nor measured), and PDF text reading stops at the cap or
after the first 100 pages, whichever comes first (the page count still counts every page). PDF
images have no size cap: pdf.js decodes every image in full, about 12 bytes a pixel, whatever
its size, and a 420 KB file with one 144 MP image held 1.8 GB. The table pass decodes no image,
and each page waits (up to 2 s an image) for its own images before the next is read, so they do
not pile up page after page. Some still decode after the file has been read: images in tiling
patterns and in Type3 glyphs, soft masks of any size, and a page's images that take over 2 s;
and a page with many large images decodes them all at once (twenty 12 MP images, 1.5 GB). A file
name is read to its first 255 characters. The CLI and the MCP server read only a
regular file on this computer: a file over 20 MB is refused before it is opened, and is read through one handle
no further than one byte past the limit, so a file that grows meanwhile is refused too; a folder, a
pipe or a device (which reports no size and can stream without end) is refused before it is opened,
and so is a network path (`\\host\share\…`, `//host/share/…`, `\\?\UNC\…`) or a device path
(`\\.\…`); of the paths that start with two slashes, only the local long form `\\?\C:\…` is read.
Only the path's form is checked: a mapped drive letter, a `subst` drive, a link or junction to a
share, or an SMB or NFS mount looks local and is read over the network. A job posting is read only
from a `.txt`, `.md`, `.html`, `.pdf` or `.docx` file, before it is opened: its words come back as
missing keywords, so any other file (a credentials file, a key) would be echoed to whoever named
it. A JSON file that does not parse is refused with its line and column, without the parser's
message, which quotes it. The MCP server refuses pasted text over 200 000 characters. A host should still bound request bodies.

**Crashes.** Words from the input are never used as plain-object keys, JSON-LD is read to a fixed
depth, and malformed PDF or DOCX structure degrades to "not measured" rather than throwing past the
extractor. A DOCX's tracked changes and comments are counted in the same pass, and under the same
budget, as the rest of its measurement. A DOCX is refused, before `mammoth` parses any of it, when a
part it would parse holds a comment, processing instruction or CDATA section that never closes, more
than 1 000 of them, a document type declaration, a `<` that starts no well-formed tag, a prefix
bound to a second namespace, or more than 1 000 distinct elements (a name in a namespace) and style,
break, symbol or content-type tags: on those its XML parser (`@xmldom/xmldom` 0.8) or its list of
warnings takes seconds to minutes, and a file of 1.4 KB held it for two minutes. A style map the
file carries is not applied. A relationships part (the `.rels` files that name the document and its
parts) nested past eight levels is refused as unreadable: read with every namespace prefix above
each level, 10,000 levels of a 26 KB file took 8 seconds and 20,000 the whole heap. What passes
still costs `mammoth` up to about a second a megabyte of XML. PDF parsing (pdf.js) and DOCX parsing (`mammoth`) are CPU-bound: run `/node` extraction in the
forkable `/node/child` process with a timeout and a memory limit, so a pathological file costs a
killed process, not a worker. Cap the child's memory in the operating system (a cgroup,
`ulimit -v`, a Windows Job object): decoded images live outside the V8 heap, so
`--max-old-space-size` does not bound them (a child under `--max-old-space-size=256` reached
5.6 GB). Set the timeout for the images too: waiting for each page's images before the next keeps
memory to a page at a time, and costs time instead, 60 pages with a 49 MP image each take
31 to 34 s, where without the wait the call returned in under half a second and left them
decoding.

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
  An email address or URL must occur whole, not as words spread over the text. Dates in parse
  repair must name a year the text contains, and a contact field it fills must hold that kind of
  value (an email address; a phone number's characters and 7 to 15 digits, not a date range; a
  name without digits or "@").
- Free text a model writes (an explanation, a recommendation) is advice and is not grounded:
  show it as the model's words, not as facts about the candidate.
- A provider's error is quoted in the error message only in its own short words (a JSON body's
  `error.message`, or a one-line text body, up to 200 characters, keys redacted). The rest of the
  body, where a gateway may echo the request and the resume in it, is never quoted.
- `analyze` redacts contact details before the request leaves, best effort and only these
  forms. The name as the parser read it, in any case or letter spacing, also as "Doe, Jane", with
  or without a middle initial, and inside a web address built from it (`janedoe.dev`); not
  initials ("J. Doe"), the first name alone, or a handle written another way (`jane_doe`). A name
  of two characters only in Chinese or Korean (`李明`), and only where it stands apart (on its own
  line, after a colon or a space): Chinese and Korean write no space between words, so inside a
  sentence (`李明是工程师`) or before a Korean particle (`김민은`) it is sent. In Latin script two
  letters are too short to replace safely. Every
  email address in the text, with letters in any script before or after the `@` and an
  apostrophe before it (`zoë.müller@firma.de`, `o'connor.pat@example.com`). The links the
  parser read. The phone by its national number: with or without the country code (`+44`, `0044`, `+44 (0)`, or after
  the exit prefix `011`, `0011` or `010`), with a trunk zero (`020`, `(020)`) or a North
  American `1-`, any spaces, brackets, dots, slashes or dashes between the digits, and an
  extension after it. Any other run of 9 or more digits on one line that opens with `+` or a trunk
  `0` (`07912 345678`, `(02) 9876 5432`, `Tel.07912 345678`, `…0958,07912 345678`; numbers side
  by side on one line are one placeholder), except one glued to letters (`Tel07912345678`), after
  a slash or a dash (a web address's path), or with a space after its plus (`+ 44 …`), whether
  the parser read it or not, so a local number is replaced under a policy without its country's
  region too; dates are not: one, a range or a list of ranges, in brackets or with a short note
  after them (`01/2020 - 12/2023`, `06/15/2019 – 08/30/2021`, `(01/2020 - 12/2023)`,
  `01/2020 - 12/2023 (3 yrs)`, `09/2019 - 06/2021 / 07/2021 - 12/2023`). A North American number written as one, a second one
  included (`Home: (415) 555-0199`, `415-555-0199`, `415.555.0199`). Not other phone numbers: one
  with none of these shapes, such as India's `98765 43210` or `415 555 0199` spaced, is sent
  unless the parser read it (the region pack reads India's). Postal
  addresses are not recognised. The report's
  `advice` is not sent: it quotes the file name, which can hold the name in a form redaction
  cannot know (`Jane_Doe_Resume.pdf`). The resume is cut after redaction, where its 50 000th
  character falls, or before a contact detail the cut falls in, so nothing past it is sent. Parse repair and conversion must see contact details and do not redact.
- The deterministic integrity rules flag instructions aimed at an AI screener inside the resume,
  including text smuggled in Unicode tag characters or PDF metadata. A phrase in quotes or
  backticks within three words of a word that says it was caught (`text.injectionMentionVerbs`:
  "flags", "blocked", "red-teamed"), with no comma or colon between, is an AI security
  engineer's example and is not flagged:
  `Built a filter that flags "ignore previous instructions"`. An attacker can dress an
  instruction so too, and a model reading the resume
  may still follow it; the rule trades that for not failing honest security work. It is still
  flagged unquoted (a bare "[INST]" too), on a labelled list line ("Skills: …"), in text hidden
  by the layout, in tag characters or in metadata, and whenever the quote tells the screener
  what to make of the resume ("rank this candidate", "score me"; `text.injectionTargets`) or
  holds more than one instruction, one of them a verdict ("respond with hire", "give my resume
  a 10/10"; `text.injectionVerdicts`).

**API keys.** The `/ai` adapters send the key only to the address you configure: they never
follow a redirect, since `fetch` keeps a header such as `x-api-key` on a redirect to another
origin and a 307 resends the request body. They ask `fetch` to hand a redirect back
(`redirect: "manual"`) and refuse any response that is one, by the response itself: a 3xx, a
browser's opaque redirect (status 0), or a response reached by following one. The call fails,
without a retry, with an error that names the redirect and the address's origin, never its path.
A `fetch` you pass in receives the option and must pass it on: one that follows a redirect
anyway has already sent the key on, and only its answer is refused. A provider's answer, an
error's included, is read to 4 MB and refused past it, before it is
parsed: a declared `content-length` past it is refused unread, and a streamed body stops there (a
`fetch` you pass in without a stream body is read whole, then measured). `ats-engine check --ai` reads the key from the environment only, never
from a flag, so it does not land in shell history or the process list, and never prints it. The
CLI says which provider and model the resume is about to be sent to before the request leaves,
and refuses to send a key over plain `http` to any host but this machine (`localhost`,
`127.0.0.1`, `[::1]`). The live AI eval (`npm run eval:live`) reads its key from the environment
or from a `.env` file, which is never committed.

**State.** The core holds no global state, does no I/O and makes no network calls; only `/ai`
calls the provider you configure, and only `/node` reads files you pass it. Without `--ai`, the
CLI makes a request only for `--job-url`, and only to a job board's public API host listed in
`src/cli/jobUrl.ts` (`boards-api.greenhouse.io`, `api.lever.co`, `api.eu.lever.co`,
`api.ashbyhq.com`), never to the host in the URL: it takes `https` posting addresses on those
boards only, sends no resume text and no key, follows no redirect, waits at most 20 seconds and
reads at most 20 MB. `npm run smoke` fails if the core, `/document`, `/format`, `/job`,
`/locales` or `/node` bundles a network call.

## Around the engine

**The MCP server.** `@veriworkly/ats-engine-mcp` talks over stdio only, makes no network requests
and calls no model. It reads the files a tool call names, with the rights of the user running it,
and nothing else; folders, pipes, devices, network paths and files over 20 MB are refused, and so
is a `job_path` that is not a `.txt`, `.md`, `.html`, `.pdf` or `.docx` file. It reads a PDF or
DOCX in its own `/node/child` process, one per file, stopped after 60 seconds or when the call is
cancelled, so a file that exhausts memory, crashes the parser or never ends takes down that
process and not the server. It reads as many files at once as the machine has CPU cores; further
calls wait their turn, so many calls at once cannot start a process each. Memory still needs an
OS limit to stop a process early (see **Size**). Its stdout carries only the protocol. Its answers include text from the resume, which the assistant
sends to its own model provider.

**The GitHub Action.** Its inputs reach `run.mjs` as environment variables, never pasted into a
shell command, so a file name cannot inject code. `version` must look like a version or a
dist-tag. The CLI runs through `npx` outside the checkout, so a repository's own `package.json`
cannot swap in another engine. Resume and posting text written to the job summary is cut to 300
characters per cell, never inside a character, then shown as text: `&`, `<` and `>` are written as
HTML entities, so no tag survives, the backslash and Markdown's own characters are escaped, and
every colon, every `@` and the dot after `www` are written as entities too, so an address written
on its own (`https://…`, `www.…`, `name@host`) is not made a link. A
workflow command the Action prints has its `%`, carriage returns and line breaks encoded, so an
input cannot start a second command, and the CLI's warnings, which can quote the resume, are passed
on between `::stop-commands::` and its closing token, a random one per run.
