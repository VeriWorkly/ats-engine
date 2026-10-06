import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY } from "../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../src/locales/index.js";

const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const NOW = new Date("2024-10-01");

/** A German resume long enough to be read as German. */
const resume = (role: string[]) =>
  [
    "Name: Anna Schmidt",
    "anna.schmidt@example.de | +49 30 1234567",
    "",
    "Berufserfahrung",
    ...role,
    "- Entwicklung von Zahlungssystemen mit TypeScript und Go für den Handel",
    "- Verantwortung für das Team bei der Einführung von Kubernetes auf der Plattform",
    "",
    "Ausbildung",
    "B.Sc. Informatik, Universität Bonn, 2019",
  ].join("\n");

describe("German pack vocabulary for dates, durations and names", () => {
  it("strips a printed duration in German from the role", () => {
    const report = AtsScoringService.check(
      resume(["Acme GmbH", "Softwareentwicklerin", "01/2020 – heute · 4 Jahre 9 Monate"]),
      policy,
      { now: NOW },
    );
    expect(report.locale.languages).toContain("de");
    const [role] = report.parsed.roles;
    expect(role?.current).toBe(true);
    expect(`${role?.title} ${role?.employer}`).not.toMatch(/Jahre|Monate/);
  });

  it("reads a term dated by a German season", () => {
    const report = AtsScoringService.check(
      resume(["Praktikantin, Acme GmbH", "Sommer 2018"]),
      policy,
      { now: NOW },
    );
    expect(report.parsed.roles[0]?.start).toEqual({ year: 2018, month: 6 });
  });
});

describe("region codes from a region pack", () => {
  it("never takes an Indian city and state code for the name", () => {
    const text = [
      "Pune, MH | priya@example.in | +91 98765 43210",
      "Priya Raman",
      "Software Engineer",
      "",
      "Experience",
      "Software Engineer, Infosys",
      "Jan 2020 - Present",
      "- Built APIs.",
    ].join("\n");
    expect(AtsScoringService.check(text, policy, { region: "IN", now: NOW }).parsed.name).toBe(
      "Priya Raman",
    );
  });
});
