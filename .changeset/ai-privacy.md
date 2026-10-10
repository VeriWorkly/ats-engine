---
"@veriworkly/ats-engine": patch
---

The AI tasks keep the API key and the candidate's details where they belong.

- **Redirects are never followed.** The `anthropic` and `openAiCompatible` adapters followed an HTTP redirect from the provider's address, and `fetch` keeps the `x-api-key` header on a redirect to another origin while a 307 resends the body: a base URL that answered with a redirect handed the key and the resume to the address it named. The adapters now call `fetch` with `redirect: "error"` (a `fetch` you pass in receives it in `init.redirect`), and a redirect fails the call, without a retry, with "The provider at … answered with a redirect, which is never followed".
- **`analyze` keeps the name and the phone out in every form they are written.** The report's `advice` is no longer sent: it quotes the file name, so "Jane_Doe_Resume_final_v3 (2).pdf" and its suggested "Jane-Doe-Resume.pdf" went to the provider though the name was redacted everywhere else. The candidate's phone is now caught by its national number: "+44 20 7946 0958" read from the header no longer leaves "020 7946 0958", "(020) 7946-0958", "0044 20 7946 0958" or "020–7946–0958" (an en or em dash) in the text sent. The analysis itself is unchanged; `advice` was never scored.
- A provider's error body is quoted in the error without the credentials a proxy may echo back: the request's own key, a `Bearer …` token, and keys in the usual `sk-…`, `sk-ant-…` and `AIza…` forms read "[redacted]".
