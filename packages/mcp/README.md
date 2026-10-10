# ATS Engine MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude, Cursor, VS
Code Copilot and others) read **your own resume** the way an applicant tracking system (ATS)
does, and score it with [`@veriworkly/ats-engine`](https://github.com/VeriWorkly/ats-engine#readme)'s published, deterministic
rubric.

Ask your assistant things like "check my resume at ~/Documents/cv.pdf", "how well does it match
this job posting?", "why did it fail the date check?" or "show me how an ATS reads my resume".

The score comes from the rubric ([RUBRIC.md](https://github.com/VeriWorkly/ats-engine/blob/main/RUBRIC.md)), not from a model. The same file
always gets the same score. The assistant explains the result and helps you fix what failed.

## Install

You need Node.js 22.12 or later. Every client below runs the server with
`npx -y @veriworkly/ats-engine-mcp`.

### Claude Code

```sh
claude mcp add ats-engine -- npx -y @veriworkly/ats-engine-mcp
```

On native Windows (not WSL), wrap `npx` in `cmd /c`:

```sh
claude mcp add ats-engine -- cmd /c npx -y @veriworkly/ats-engine-mcp
```

### Claude Desktop

Open Settings → Developer → Edit Config, add the server to `claude_desktop_config.json`, and
restart Claude Desktop:

```json
{
  "mcpServers": {
    "ats-engine": {
      "command": "npx",
      "args": ["-y", "@veriworkly/ats-engine-mcp"]
    }
  }
}
```

### Cursor

Add it to `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "ats-engine": {
      "command": "npx",
      "args": ["-y", "@veriworkly/ats-engine-mcp"]
    }
  }
}
```

### VS Code

Add it to `.vscode/mcp.json` in your workspace, or run **MCP: Add Server** from the Command
Palette:

```json
{
  "servers": {
    "ats-engine": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@veriworkly/ats-engine-mcp"]
    }
  }
}
```

## Tools

| Tool           | Input                                                                                         | Returns                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_resume` | `path` or `text`; optional `job_path` or `job_text`; optional `region`; optional `target_ats` | Readiness score (0–100), verdict, category scores (writing style included), every failed check with its evidence and fix, and the fields an ATS stores (name, contact, roles, education, skills; the structured `parsed` also holds certifications and spoken languages with their CEFR level). With a posting: job match, requirements and keywords too. Then `advice`, which is not scored. |
| `match_job`    | `path` or `text`; `job_path` or `job_text` (required); optional `region`                      | Job match score, each requirement judged met / partial / missing / unverifiable with evidence, and the missing keywords, hard skills and soft skills apart (soft skills weigh less).                                                                                                                                                                                                          |
| `explain_rule` | `rule_id`                                                                                     | One rubric rule: category, severity, what it checks, points, how to fix it. An unknown id lists the valid ones.                                                                                                                                                                                                                                                                               |
| `extract_text` | `path` or `text`; optional `region`                                                           | The text in the order an ATS reads it, line by line, plus what the layout measured (columns, tables, hidden text). For "why did it read my resume like this?"                                                                                                                                                                                                                                 |

Every tool returns readable text for the assistant and its result as structured JSON
(`structuredContent`, described by each tool's `outputSchema`).

The resource `rubric://default` is the whole rubric as JSON.

**Inputs.**

- Resume files: `.pdf`, `.docx`, `.html`, `.txt`, `.md`, or a `.json` JSON Resume or
  ats-resume document. Postings: `.txt`, `.md`, `.pdf`, `.docx`, or a saved `.html` page.
- Give absolute paths. `~/` is read as your home folder; any other relative path is read from
  the folder the server was started in.
- Pasted `text` and `job_text` may be up to 200 000 characters.
- Files over 20 MB are refused, and so are folders. So is a PDF with no text layer: an ATS
  cannot read a scan either.
- `region` is `US`, `DE` or `IN`. Without it, the region is inferred from the resume.
- `target_ats` is `greenhouse`, `lever` or `taleo`. It adds what that vendor documents publicly,
  each note with a link to the vendor's page. It never changes the score.

**Advice.** `check_resume` ends with `advice`, a list that is never scored. For a file (not
pasted text) it covers the name (`Resume_final_v3 (2).pdf` reads as a draft; a `Firstname-Lastname-Resume.pdf` name is
suggested), a size over 2 MB, a password, and tracked changes or comments left in a Word
document. For a US resume it also covers details that can invite age bias. With `target_ats` it
adds the vendor's notes.

## Privacy

The server runs on your computer, over stdio. It makes no network requests and calls no AI
model. It reads only the files you name in a request, and nothing leaves your machine except
what your assistant itself sends to its model provider: the tool results it reads, which include
text from your resume.

## Intended use

> [!IMPORTANT]
> This is a tool for candidates to check their own resume. Do not use it to screen, rank or
> reject other people. Using it that way may make it an automated employment decision tool under
> laws such as New York City Local Law 144 and the EU AI Act, which carry duties this package does
> not meet for you. See [Intended use](https://github.com/VeriWorkly/ats-engine#intended-use).

A score measures how well a resume parses and reads. It says nothing about the person.

## From source

```sh
git clone https://github.com/VeriWorkly/ats-engine.git
cd ats-engine
npm ci
npm run build
claude mcp add ats-engine -- node "$PWD/packages/mcp/dist/index.js"
```

## License

MIT
