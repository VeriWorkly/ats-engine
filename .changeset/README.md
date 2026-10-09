# Changesets

Every change a user can notice gets a changeset: `npm run changeset`, pick the package and the
bump, describe the change for the person upgrading. `npm run version-packages` (run by the
Release workflow, see CONTRIBUTING.md) turns them into each package's CHANGELOG.md, which is not
edited by hand.

Name the package the change is in: `@veriworkly/ats-engine`, `@veriworkly/ats-engine-mcp`, or
both when both change. A changeset's text goes into the changelog of every package it names, so
write one per package when each needs its own words. The GitHub Action in `action/` is in neither
package and gets no changeset of its own.

**The rule:** a change to the report's shape, to the policy schema, or to the score or recovered
fields for the same input and policy is **breaking**. For the MCP server, so is a change to the
shape of a tool's result, or to the score it returns for the same file. While a package is 0.x a
breaking change is a minor bump, and its entry starts with **Breaking:**; from 1.0 it is a major.
