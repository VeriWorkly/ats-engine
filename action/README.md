# ATS resume check (GitHub Action)

Scores a resume with [@veriworkly/ats-engine](https://github.com/VeriWorkly/ats-engine) in a workflow, writes the report to the job summary and fails the step below `min-score`. Usage, inputs and outputs are in the [main README](https://github.com/VeriWorkly/ats-engine#use-it-in-github-actions).

`test/` holds an invented resume and posting the engine's CI runs the action on.
