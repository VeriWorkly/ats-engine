import type { AtsParsedDate, AtsReport } from "../../src/index.js";
import type { LocaleFixture } from "./locale-resumes.js";

const month = (value: AtsParsedDate | null | undefined) =>
  value
    ? value.month
      ? `${value.year}-${String(value.month).padStart(2, "0")}`
      : `${value.year}`
    : "";

/**
 * One field an ATS should recover, whether it was, and what was read against what was labelled.
 * `row`: which role, education, certification or language row, for a field of one.
 */
export type FieldCheck = { field: string; row?: number; ok: boolean; got: string; want: string };

const text = (value: unknown) => JSON.stringify(value) ?? "undefined";
const sorted = (values: readonly string[]) => [...values].sort();

/**
 * Field by field, what the fixture says an ATS should recover against what was recovered. One
 * point per field: name, email, phone, the links as a set, how many roles and education rows were
 * read (a row the labels do not have costs a point, and so does a missing one), each role's
 * title, employer, start, end (where labelled) and current flag, each education row's school,
 * level and credential (where labelled), the skill list as a set, how many certification and
 * spoken-language rows were read, each certification's name, issuer, date and expiry (where
 * labelled), and each language's name and CEFR level.
 */
export function fieldChecks(report: AtsReport, fixture: LocaleFixture): FieldCheck[] {
  const { parsed } = report;
  const checks: FieldCheck[] = [];
  const expect = (field: string, got: unknown, want: unknown, row?: number) =>
    checks.push({ field, row, ok: text(got) === text(want), got: text(got), want: text(want) });

  expect("name", parsed.name, fixture.name);
  expect("email", parsed.email, fixture.email);
  expect("phone", parsed.phone, fixture.phone);
  expect("links", sorted(parsed.links), sorted(fixture.links ?? []));
  expect("roles", parsed.roles.length, fixture.roles.length);
  expect("education", parsed.education.length, fixture.education.length);
  fixture.roles.forEach((role, index) => {
    const got = parsed.roles[index];
    expect("role.title", got?.title, role.title, index);
    expect("role.employer", got?.employer, role.employer, index);
    expect("role.start", month(got?.start), role.start, index);
    if (role.end !== undefined) expect("role.end", month(got?.end), role.end, index);
    expect("role.current", got?.current, role.current, index);
  });
  fixture.education.forEach((row, index) => {
    const got = parsed.education[index];
    expect("education.school", got?.school, row.school, index);
    expect("education.isced", got?.isced ?? null, row.isced, index);
    if (row.credential !== undefined)
      expect("education.credential", got?.credential, row.credential, index);
  });
  expect("skills", sorted(parsed.skills), sorted(fixture.skills));
  // A resume without the section is held to having no rows: a row read from nothing is a miss.
  const certifications = fixture.certifications ?? [];
  expect("certifications", parsed.certifications.length, certifications.length);
  certifications.forEach((row, index) => {
    const got = parsed.certifications[index];
    expect("cert.name", got?.name, row.name, index);
    expect("cert.issuer", got?.issuer, row.issuer, index);
    expect("cert.date", month(got?.date), row.date, index);
    if (row.expires !== undefined) expect("cert.expires", month(got?.expires), row.expires, index);
  });
  const languages = fixture.spokenLanguages ?? [];
  expect("languages", parsed.spokenLanguages.length, languages.length);
  languages.forEach((row, index) => {
    const got = parsed.spokenLanguages[index];
    expect("language.name", got?.language, row.language, index);
    expect("language.cefr", got?.cefr ?? null, row.cefr, index);
  });
  return checks;
}
