import { describe, expect, it, vi } from "vitest";

import { createAtsAi } from "../../src/ai/index.js";
import { openAiCompatible } from "../../src/ai/openai-compatible.js";
import { createRedaction } from "../../src/ai/redact.js";
import { scriptedProvider } from "../../src/ai/testing/index.js";
import { DEFAULT_POLICY } from "../../src/policy/default.js";
import { mergeGrounded, needsRepair } from "../../src/repair/merge.js";
import { check } from "../../src/scoring/engine.js";

/** Regressions in the AI layer. */

const route = { model: "m", maxTokens: 100 };

describe("AI layer regressions", () => {
  it("keeps a URL the model wrote with a scheme the document left off", async () => {
    const source = "Jane Doe\nwww.linkedin.com/in/janedoe | github.com/janedoe";
    const provider = scriptedProvider(
      JSON.stringify({
        basics: { fullName: "Jane Doe" },
        links: [
          { label: "LinkedIn", url: "https://www.linkedin.com/in/janedoe" },
          { label: "GitHub", url: "https://github.com/janedoe/" },
          { label: "Site", url: "https://janedoe.dev" },
        ],
      }),
    );
    const ai = createAtsAi({ provider, routes: { convertResume: route } });
    const { result, rejected } = await ai.convertResume({ resumeText: source });

    expect(result.links.map((link) => link.url)).toEqual([
      "https://www.linkedin.com/in/janedoe",
      "https://github.com/janedoe/",
      "", // never in the document
    ]);
    expect(rejected.map((violation) => violation.path)).toEqual(["links[2].url"]);
  });

  // With its scheme taken off, a made-up address was two words of the document ("Fabrikam Ltd").
  it("rejects a link made of the document's words but not written in it", async () => {
    const source = "Jane Doe\nEngineer, Fabrikam Ltd\nProject: Ledger Tool";
    const provider = scriptedProvider(
      JSON.stringify({
        basics: { fullName: "Jane Doe" },
        links: [{ label: "Site", url: "https://fabrikam.ltd" }],
        projects: [{ name: "Ledger Tool", link: "https://ledger.tool" }],
      }),
    );
    const ai = createAtsAi({ provider, routes: { convertResume: route } });
    const { result, rejected } = await ai.convertResume({ resumeText: source });

    expect(result.links[0]!.url).toBe("");
    expect(result.projects[0]!.link).toBe("");
    expect(rejected.map((violation) => violation.path)).toEqual([
      "links[0].url",
      "projects[0].link",
    ]);
  });

  // Compared whole, an address glued to a bracket, a guillemet or a bullet was not found.
  it("keeps a link the document writes inside brackets, guillemets or after a bullet", async () => {
    const source = "Jane Doe\nSite: [janedoe.dev]\nBlog: «blog.janedoe.dev»\n•github.com/janedoe·";
    const provider = scriptedProvider(
      JSON.stringify({
        basics: { fullName: "Jane Doe" },
        links: [
          { label: "Site", url: "https://janedoe.dev" },
          { label: "Blog", url: "https://blog.janedoe.dev" },
          { label: "GitHub", url: "https://github.com/janedoe" },
        ],
      }),
    );
    const ai = createAtsAi({ provider, routes: { convertResume: route } });
    const { result, rejected } = await ai.convertResume({ resumeText: source });

    expect(result.links.map((link) => link.url)).toEqual([
      "https://janedoe.dev",
      "https://blog.janedoe.dev",
      "https://github.com/janedoe",
    ]);
    expect(rejected).toEqual([]);
  });

  // Split on those marks, an address holding one in its path was not found.
  it.each([
    ["https://janedoe.dev/a·b", "https://janedoe.dev/a·b"],
    ["janedoe.dev/[draft]", "https://janedoe.dev/[draft]"],
    ["Site:[janedoe.dev/a·b]", "https://janedoe.dev/a·b"],
    ["janedoe.dev·github.com/jdoe", "https://github.com/jdoe"],
  ])("keeps a link written %j", async (written, url) => {
    const provider = scriptedProvider(
      JSON.stringify({ basics: { fullName: "Jane Doe" }, links: [{ label: "Site", url }] }),
    );
    const ai = createAtsAi({ provider, routes: { convertResume: route } });
    const { result } = await ai.convertResume({ resumeText: `Jane Doe\n${written}\nEngineer` });
    expect(result.links[0]!.url).toBe(url);
  });

  it("does not support part of an address's path by its marks", async () => {
    const provider = scriptedProvider(
      JSON.stringify({
        basics: { fullName: "Jane Doe" },
        links: [{ label: "Site", url: "https://janedoe.dev/a" }],
      }),
    );
    const ai = createAtsAi({ provider, routes: { convertResume: route } });
    const { result } = await ai.convertResume({ resumeText: "Jane Doe\njanedoe.dev/a·b" });
    expect(result.links[0]!.url).toBe("");
  });

  it("does not sell a repair that the merge cannot apply", () => {
    // The merge never edits rows the parser found, so a repair here would change nothing.
    const parsed = check(
      ["Experience", "Senior Engineer", "Staff Engineer", "Principal Engineer"].join("\n"),
      DEFAULT_POLICY,
    ).parsed;
    const incomplete = {
      ...parsed,
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "415 555 0199",
      roles: [
        { title: "Senior Engineer", employer: "", start: null, end: null, current: false },
        { title: "Staff Engineer", employer: "", start: null, end: null, current: false },
      ],
    };

    const merged = mergeGrounded(
      incomplete,
      {
        name: "",
        email: "",
        phone: "",
        roles: [
          {
            title: "Senior Engineer",
            employer: "Acme",
            start: { year: 2020, month: 1 },
            end: null,
            current: false,
          },
        ],
        education: [],
        skills: [],
      },
      "Senior Engineer Acme 2020",
      { policy: DEFAULT_POLICY },
    ).merged;
    expect(merged.roles).toEqual(incomplete.roles); // the merge cannot help…
    expect(needsRepair({ parsed: incomplete, wordCount: 400 })).toBe(false); // …so do not offer it
  });

  it("redacts whole words only", () => {
    const redaction = createRedaction(
      { name: "Ana", email: "", phone: "", links: [], roles: [] },
      "",
    );
    expect(redaction.apply("Ana led Analytics at Banana Co.")).toBe(
      "[NAME] led Analytics at Banana Co.",
    );
  });

  it("does not redact a 'name' that is really a parsed job title", () => {
    const redaction = createRedaction(
      {
        name: "Senior Software Engineer",
        email: "",
        phone: "",
        links: [],
        roles: [
          {
            title: "Senior Software Engineer",
            employer: "Acme",
            start: null,
            end: null,
            current: false,
          },
        ],
      },
      "",
    );
    expect(redaction.apply("Senior Software Engineer, Acme")).toBe(
      "Senior Software Engineer, Acme",
    );
  });

  // A cut-off reply holding a whole inner object was read for it and retried as invalid output.
  it.each([
    '{"basics": {',
    '{"basics": {"fullName": "Jane Doe"}, "work": [{"company": "Acme", "position": "Eng',
    'Here: ```json\n{"basics": {"fullName": "Jane Doe"}, "skills": [{"name": "Go"}, {"na',
    // An example before an answer that was cut off.
    'Shape: {"basics": {"fullName": "Jane Doe"}}. Answer: {"basics": {"fullName": "Jan',
    '```json\n{"basics": {"fullName": "Jane Doe"}}\n```\nAnswer:\n```json\n{"basics": {"fu',
    // Cut off in its reasoning: an object there is an example, not the answer.
    '<think>The shape is {"basics": {"fullName": "Jane Doe"}} so I will',
    // A whole reply in another shape, cut off in the prose after it.
    '{"resume": {"basics": {"fullName": "Jane Doe"}}}\n\nNotes: I',
  ])("does not pay for the same truncation twice: %j", async (text) => {
    const provider = scriptedProvider({ text, finish: "length" });
    const ai = createAtsAi({ provider, routes: { convertResume: { ...route, retries: 2 } } });

    await expect(ai.convertResume({ resumeText: "x" })).rejects.toMatchObject({
      code: "truncated",
      attempts: 1,
    });
    expect(provider.calls).toHaveLength(1);
  });

  // A reply cut off in the prose after its answer was refused: one paid call, no result.
  const ANSWER = JSON.stringify({ basics: { fullName: "Jane Doe" } });
  it.each([
    `\`\`\`json\n${ANSWER}\n\`\`\`\n\nNotes: I focused on the`,
    `<think>ok</think>${ANSWER}\n\nAlso`,
    `Here is the analysis:\n${ANSWER}\nLet me know if you'd like`,
    `I kept {the order} as given. ${ANSWER}\nI could also`,
  ])("reads a whole answer cut off in the prose after it: %j", async (text) => {
    const provider = scriptedProvider({ text, finish: "length" });
    const ai = createAtsAi({ provider, routes: { convertResume: route } });
    const { result } = await ai.convertResume({ resumeText: "Jane Doe" });
    expect(result.basics.fullName).toBe("Jane Doe");
  });

  it("reports a non-object body as a bad response, not a crash", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => "null" }));
    const provider = openAiCompatible({ apiKey: "k", fetch });
    await expect(
      provider.complete({ model: "m", system: "", messages: [], maxTokens: 1 }),
    ).rejects.toMatchObject({ name: "LlmProviderError", retryable: true });
  });

  it("leaves usage unknown when the provider never reports it", async () => {
    const provider = scriptedProvider(JSON.stringify({ basics: {} }));
    const ai = createAtsAi({ provider, routes: { convertResume: route } });
    expect((await ai.convertResume({ resumeText: "x" })).usage).toBeUndefined();
  });
});
