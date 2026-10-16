---
"@veriworkly/ats-engine": minor
---

Fixes from an audit of 0.10.0.

- **Breaking:** a visible line is no longer set aside as hidden because the hidden text repeats it. Each stretch of hidden text sets aside one line, the longest claiming theirs first, so a resume with a visible "Kubernetes" skill and a hidden "Kubernetes Terraform Kafka" block keeps its Kubernetes in the job match (it fell from 100 to 0 and was reported missing). The job match, the requirements and the missing keywords change for such a resume.
- **Breaking:** the `languages` option is read in any case, and an id no attached pack has throws `AtsPolicyError` naming the attached ones. `languages: ["DE"]` or `["deu"]` was dropped without a word, so a German resume lost its roles and was judged by English writing rules. `[]`, or the policy's own language (`"en"`), still reads with the base only.
- **AI:** a provider's answer, an error's included, is read to 4 MB (`MAX_RESPONSE_BYTES`) and refused past it before it is parsed; a declared larger `content-length` is refused unread. The timeout bounded how long a call took, not how much it received.
- **`/node`:** `readResumeFile` and `readJobFile` take an `extract` option, the function that reads a PDF's or DOCX's bytes, so a host can run `/node/child` while keeping the path, type and size checks.
- **Action:** each run writes its report to its own file in `RUNNER_TEMP`, so a job checking two resumes keeps both reports.
- Docs: a report repeats for the same input, policy and reference date (`now`), as tenure and "present" are counted from it.
