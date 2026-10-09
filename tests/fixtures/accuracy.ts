import type { AtsParsedDate, AtsReport } from "../../src/index.js";
import type { LocaleFixture } from "./locale-resumes.js";

const month = (value: AtsParsedDate | null) =>
  value
    ? value.month
      ? `${value.year}-${String(value.month).padStart(2, "0")}`
      : `${value.year}`
    : "";

/** One field an ATS should recover, and whether it was. */
export type FieldCheck = { field: string; ok: boolean };

/**
 * Field by field, what the fixture says an ATS should recover against what was recovered. One
 * point per field: name, email, phone, each role's title, employer, start and current flag, each
 * education row's school and level, the skill list as a set, how many certification and
 * spoken-language rows were read, each certification's name, issuer and date, and each
 * language's name and CEFR level.
 */
export function fieldChecks(report: AtsReport, fixture: LocaleFixture): FieldCheck[] {
  const { parsed } = report;
  const checks: FieldCheck[] = [
    { field: "name", ok: parsed.name === fixture.name },
    { field: "email", ok: parsed.email === fixture.email },
    { field: "phone", ok: parsed.phone === fixture.phone },
  ];
  fixture.roles.forEach((role, index) => {
    const got = parsed.roles[index];
    checks.push(
      { field: "role.title", ok: got?.title === role.title },
      { field: "role.employer", ok: got?.employer === role.employer },
      { field: "role.start", ok: month(got?.start ?? null) === role.start },
      { field: "role.current", ok: got?.current === role.current },
    );
  });
  fixture.education.forEach((row, index) => {
    const got = parsed.education[index];
    checks.push(
      { field: "education.school", ok: got?.school === row.school },
      { field: "education.isced", ok: (got?.isced ?? null) === row.isced },
    );
  });
  checks.push({
    field: "skills",
    ok: JSON.stringify([...parsed.skills].sort()) === JSON.stringify([...fixture.skills].sort()),
  });
  // A resume without the section is held to having no rows: a row read from nothing is a miss.
  const certifications = fixture.certifications ?? [];
  checks.push({
    field: "certifications",
    ok: parsed.certifications.length === certifications.length,
  });
  certifications.forEach((row, index) => {
    const got = parsed.certifications[index];
    checks.push(
      { field: "cert.name", ok: got?.name === row.name },
      { field: "cert.issuer", ok: got?.issuer === row.issuer },
      { field: "cert.date", ok: month(got?.date ?? null) === row.date },
    );
  });
  const languages = fixture.spokenLanguages ?? [];
  checks.push({ field: "languages", ok: parsed.spokenLanguages.length === languages.length });
  languages.forEach((row, index) => {
    const got = parsed.spokenLanguages[index];
    checks.push(
      { field: "language.name", ok: got?.language === row.language },
      { field: "language.cefr", ok: (got?.cefr ?? null) === row.cefr },
    );
  });
  return checks;
}
