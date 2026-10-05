## What this changes

<!-- What and why, in a few lines. Link the issue it closes: "Closes #123". -->

## Checklist

- [ ] A test that failed before this change and passes now (or a reason none is needed)
- [ ] `npm run check` passes locally
- [ ] A changeset (`npm run changeset`) if users can notice the change, marked breaking if it changes the report's shape, the policy schema, or the score for the same input
- [ ] `npm run rubric` was run if the default policy changed
- [ ] Words such as months, headings and degree names live in the policy or a locale pack, not in source
- [ ] Any new regex over input runs in linear time, with a case in the adversarial tests
- [ ] Every resume in fixtures and tests describes an invented person

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the reasoning behind each rule.
