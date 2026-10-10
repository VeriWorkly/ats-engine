# ATS resume check (GitHub Action)

Scores a resume with [@veriworkly/ats-engine](https://github.com/VeriWorkly/ats-engine) in a workflow and fails the step below `min-score`. The job summary shows the readiness score and job match, each failed check with its fix, each requirement's status, the missing keywords and soft skills, and the advice, which is never scored. Usage, inputs and outputs are in the [main README](https://github.com/VeriWorkly/ats-engine#use-it-in-github-actions).

The step runs the published CLI with `npx`, at the engine version in the `version` input. It installs the PDF and DOCX readers (`pdf-parse`, `pdfjs-dist`, `mammoth`) alongside the engine, so a PDF or Word resume works with nothing set up. It needs no dependencies of its own and is not part of either npm package.

`test/` holds an invented resume and posting the engine's CI runs the action on.
