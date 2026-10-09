import { describe, expect, it } from "vitest";

import { quote } from "../../src/checks/finding.js";

describe("a sample quoted in a rule's evidence", () => {
  it("keeps a short line whole, on one line", () => {
    expect(quote("  Built the   payments\nledger  ")).toBe("Built the payments ledger");
  });

  it("cuts a long line at a word and says so", () => {
    const line =
      "Raised test coverage across the payments, ledger and reporting services from 52% to 91% in two quarters";
    const sample = quote(line);
    expect(sample.length).toBeLessThanOrEqual(80);
    expect(sample.endsWith("…")).toBe(true);
    expect(line.startsWith(sample.slice(0, -1))).toBe(true);
    // Never mid-word: what is kept ends where a word does.
    expect(line[sample.length - 1]).toBe(" ");
  });

  it("cuts a single unbroken run where it must", () => {
    const sample = quote("x".repeat(200));
    expect(sample).toBe(`${"x".repeat(79)}…`);
  });
});
