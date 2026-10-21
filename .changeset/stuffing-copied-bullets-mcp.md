---
"@veriworkly/ats-engine-mcp": minor
---

- **Breaking:** `check_resume` no longer fails the keyword-stuffing check, and returns a higher score, for a resume that copies one bullet into three or four roles, once each. In five or more, it is still stuffing.
