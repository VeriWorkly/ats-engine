import { describe, expect, it } from "vitest";

import {
  categoryLabel,
  formatCertification,
  formatParsedDate,
  formatSpokenLanguage,
  formatRoleDates,
  formatTenure,
  roleSpanMonths,
  SCORE_BANDS,
  scoreTone,
  sortByCategoryOrder,
} from "../../src/format/index.js";
import { VERDICT_BANDS } from "../../src/scoring/verdict.js";

describe("format helpers", () => {
  it("bands scores for display", () => {
    expect([100, 75, 74, 45, 44, 0].map(scoreTone)).toEqual([
      "good",
      "good",
      "warn",
      "warn",
      "bad",
      "bad",
    ]);
  });

  it("bands scores exactly as the verdict does, so the CLI and a report never disagree", () => {
    expect(SCORE_BANDS).toEqual({ good: VERDICT_BANDS.strong, warn: VERDICT_BANDS.needsWork });
  });

  it("orders known categories and keeps unknown ones after them", () => {
    const sorted = sortByCategoryOrder([
      { category: "custom" },
      { category: "format" },
      { category: "parse" },
    ]);
    expect(sorted.map((item) => item.category)).toEqual(["parse", "format", "custom"]);
    expect(categoryLabel("custom")).toBe("Custom");
    expect(categoryLabel("content")).toBe("Evidence");
  });

  it("labels writing and places it after every category about whether the ATS reads the resume", () => {
    expect(categoryLabel("writing")).toBe("Writing");
    const sorted = sortByCategoryOrder(
      ["writing", "format", "content", "integrity"].map((category) => ({ category })),
    );
    expect(sorted.map((item) => item.category)).toEqual([
      "integrity",
      "content",
      "format",
      "writing",
    ]);
  });

  it("formats dates, spans and tenure", () => {
    expect(formatParsedDate({ year: 2021, month: 3 })).toBe("Mar 2021");
    expect(formatParsedDate({ year: 2021, month: null })).toBe("2021");
    expect(formatParsedDate(null)).toBeNull();
    expect(formatRoleDates({ start: { year: 2021, month: 3 }, end: null, current: true })).toBe(
      "Mar 2021 – Present",
    );
    expect(formatRoleDates({ start: null, end: null, current: false })).toBeNull();
    expect(formatTenure(38)).toBe("3 yr 2 mo");
    expect(formatTenure(36)).toBe("3 yr");
    expect(formatTenure(7)).toBe("7 mo");
  });

  it("measures a role span inclusively and generously", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(
      roleSpanMonths(
        { start: { year: 2020, month: 1 }, end: { year: 2020, month: 12 }, current: false },
        now,
      ),
    ).toBe(12);
    expect(
      roleSpanMonths(
        { start: { year: 2020, month: null }, end: { year: 2020, month: null }, current: false },
        now,
      ),
    ).toBe(12);
    expect(roleSpanMonths({ start: { year: 2026, month: 1 }, end: null, current: true }, now)).toBe(
      9,
    );
    expect(roleSpanMonths({ start: null, end: null, current: true }, now)).toBe(0);
  });

  it("formats a certification row and a spoken-language row", () => {
    expect(
      formatCertification({
        name: "PMP",
        issuer: "PMI",
        date: { year: 2021, month: 3 },
        expires: { year: 2027, month: null },
      }),
    ).toBe("PMP, PMI, Mar 2021, expires 2027");
    expect(formatCertification({ name: "CKA", issuer: "", date: null, expires: null })).toBe("CKA");
    expect(formatSpokenLanguage({ language: "German", level: "B2", cefr: "B2" })).toBe(
      "German (B2)",
    );
    expect(formatSpokenLanguage({ language: "German", level: "fluent", cefr: "C1" })).toBe(
      "German (fluent)",
    );
    expect(formatSpokenLanguage({ language: "Hindi", level: "", cefr: null })).toBe("Hindi");
  });
});
