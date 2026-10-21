---
"@veriworkly/ats-engine-mcp": minor
---

- **Breaking:** `check_resume` fails the keyword-stuffing check, and returns a lower score, for a resume with a line that names a few skills again and again, each under five times ("Python Kubernetes AWS Docker Go Kafka" written four times).
