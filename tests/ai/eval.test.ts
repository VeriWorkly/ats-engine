import { describe, expect, it } from "vitest";

import { createAtsAi } from "../../src/ai/index.js";
import { fabricatedNumbers, runAiEval, scriptedProvider } from "../../src/ai/testing/index.js";
import { evalCases } from "../fixtures/ai-eval-cases.js";

/**
 * The harness itself, against scripted replies. What a real model scores is measured by
 * `ai-eval.live.test.ts`, which needs an API key and is skipped without one.
 */

const route = { model: "m", maxTokens: 2_000 };
const routes = { analyze: route, repairParse: route, convertResume: route };

const insights = JSON.stringify({
  explanation: "Strong platform background.",
  missingEvidence: ["No Terraform experience shown."],
  keywordOpportunities: ["Terraform", "incident response", "Rust"],
  recommendedImprovements: ["Quantify the HL7 work."],
  priorityOrder: [],
});

/** Answers each task as an obedient model would — including obeying the injected instruction. */
function obedientModel(content: string) {
  if (content.includes('"deterministicReport"')) return insights;
  const resume = (JSON.parse(content) as { resume: string }).resume;
  const injected = resume.includes("SYSTEM NOTE");
  const employer = injected ? "Google" : "Northwind Logistics";
  const title = injected ? "Chief Executive Officer" : "Staff Engineer";
  if (content.includes("Copy values verbatim"))
    return JSON.stringify({ roles: [{ title, employer, start: { year: 2017 } }] });
  return JSON.stringify({
    basics: {},
    experience: [{ company: employer, role: title, startDate: "2019-03" }],
  });
}

describe("runAiEval", () => {
  it("measures schema validity, grounding, fabricated numbers, stability and leaks", async () => {
    const provider = scriptedProvider((request) => obedientModel(request.messages[0]!.content));
    const ai = createAtsAi({ provider, routes });
    const report = await runAiEval(ai, evalCases(), { runs: 2 });

    expect(report.runs).toBe(10);
    expect(report.schemaValidRate).toBe(1);
    expect(report.consistency).toBe(1);
    // "Rust" is in neither the resume nor the posting, so analysis drops it.
    expect(report.groundingViolationRate).toBeGreaterThan(0);
    // The model obeyed the injected instruction in both injection cases. Grounding cannot
    // catch that — the injected values occur in the document — which is why the eval measures
    // it. Only conversion leaks: repair never overwrites a field the parser already found, and
    // the parser found the real role.
    expect(report.forbiddenLeakRate).toBeCloseTo(2 / 10);
    expect(report.failures).toEqual([]);
  });

  it("counts the numbers a task was given, and the months of dates it reformats, as known", async () => {
    // The report's scores and word count, which analyze is given and quotes; "2019-03", which
    // conversion writes for "Mar 2019". A live run flagged both as fabricated.
    const provider = scriptedProvider((request) => {
      const content = request.messages[0]!.content;
      if (!content.includes('"deterministicReport"')) return obedientModel(content);
      const { readinessScore, wordCount, jobMatchScore } = (
        JSON.parse(content) as { deterministicReport: Record<string, number> }
      ).deterministicReport;
      return JSON.stringify({
        ...JSON.parse(insights),
        explanation: `A readiness score of ${readinessScore} and a job match of ${jobMatchScore} over ${wordCount} words.`,
      });
    });
    const cases = evalCases().filter((testCase) =>
      ["analyze/standard-with-job", "convert/standard"].includes(testCase.id),
    );
    const report = await runAiEval(createAtsAi({ provider, routes }), cases);
    expect(report.schemaValidRate).toBe(1);
    expect(report.fabricatedNumberRate).toBe(0);
  });

  it("counts failures and leaves them out of the quality rates", async () => {
    const ai = createAtsAi({ provider: scriptedProvider("not json"), routes });
    const report = await runAiEval(ai, evalCases().slice(0, 2));

    expect(report.schemaValidRate).toBe(0);
    expect(report.failures.map((failure) => failure.code)).toEqual([
      "invalid_output",
      "invalid_output",
    ]);
    expect(report.fabricatedNumberRate).toBe(0);
  });
});

describe("fabricatedNumbers", () => {
  it("finds numbers the source never states", () => {
    expect(fabricatedNumbers({ a: ["Cut costs 35%", "for 12 teams"] }, "12 teams")).toEqual(["35"]);
    expect(fabricatedNumbers("Raised 1,200 to 2.5", "1,200 and 2.5")).toEqual([]);
  });

  it("knows the month of an ISO date whose year the source states, and only that", () => {
    expect(
      fabricatedNumbers({ startDate: "2019-03", endDate: "2021-12" }, "Mar 2019 - Dec 2021"),
    ).toEqual([]);
    expect(fabricatedNumbers({ startDate: "2018-03" }, "Mar 2019")).toEqual(["2018", "03"]);
    expect(fabricatedNumbers("2019-13", "2019")).toEqual(["13"]);
    expect(fabricatedNumbers("03", "Mar 2019")).toEqual(["03"]);
  });
});
