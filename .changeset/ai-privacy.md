---
"@veriworkly/ats-engine": patch
---

The AI tasks keep the API key and the candidate's details where they belong.

- **Redirects are never followed.** The `anthropic` and `openAiCompatible` adapters followed an HTTP redirect from the provider's address, and `fetch` keeps the `x-api-key` header on a redirect to another origin while a 307 resends the body: a base URL that answered with a redirect handed the key and the resume to the address it named. The adapters now call `fetch` with `redirect: "error"` (a `fetch` you pass in receives it in `init.redirect`), and a redirect fails the call, without a retry, with "The provider at … answered with a redirect, which is never followed".
