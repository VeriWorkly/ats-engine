import * as z from "zod/mini";

import { cut, normalizeText } from "../text/text.js";
import { ATS_DOCUMENT_FORMAT, DOCUMENT_LIMITS as L, type AtsResumeDocument } from "./types.js";

/**
 * Validation for `AtsResumeDocument`, which reaches the engine from untrusted callers.
 *
 * Strings are cut to length rather than rejected: a description one character over is still the
 * user's resume. Arrays are bounded and rejected past their limit. The cost of walking a huge
 * array is stopped earlier than this, by the size pre-check in `prepareResume`.
 */

// Normalised as text input is (see `normalizeText`), so a field and the page rendered from it
// read the same: a fullwidth "２０２０" date or a ligature in a title would otherwise differ.
const text = (max: number = L.field) =>
  z.pipe(
    z.string(),
    z.transform((value) => cut(normalizeText(value), max)),
  );
const optional = (max?: number) => z.optional(text(max));
const list = (max: number, itemMax: number = L.line) =>
  z.optional(z.array(text(itemMax)).check(z.maxLength(max)));
const flag = z.optional(z.boolean());
const date = optional(32);

const role = z.object({
  title: text(),
  employer: text(),
  location: optional(),
  start: date,
  end: date,
  current: flag,
  summary: optional(L.line),
  highlights: list(L.lines),
});

const education = z.object({
  school: text(),
  credential: optional(),
  field: optional(),
  start: date,
  end: date,
  current: flag,
  summary: optional(L.line),
});

const project = z.object({
  name: text(),
  role: optional(),
  url: optional(2_048),
  summary: optional(L.line),
  highlights: list(L.lines),
  skills: list(L.keywords, 200),
});

const skillGroup = z.object({
  name: optional(200),
  keywords: z.array(text(200)).check(z.maxLength(L.keywords)),
});
const entry = z.object({ heading: optional(), lines: list(L.lines) });
const certification = z.object({
  name: text(),
  issuer: optional(),
  date,
  expires: date,
  url: optional(2_048),
});
const language = z.object({ language: text(200), level: optional(200) });

const items = <T extends z.ZodMiniType>(item: T) => z.array(item).check(z.maxLength(L.items));
const title = text(200);

const section = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary"), title, text: text(L.text) }),
  z.object({ kind: z.literal("experience"), title, items: items(role) }),
  z.object({ kind: z.literal("education"), title, items: items(education) }),
  z.object({ kind: z.literal("projects"), title, items: items(project) }),
  z.object({ kind: z.literal("skills"), title, items: items(skillGroup) }),
  z.object({ kind: z.literal("certifications"), title, items: items(certification) }),
  z.object({ kind: z.literal("languages"), title, items: items(language) }),
  z.object({ kind: z.literal("other"), title, items: items(entry) }),
]);

export const resumeDocumentSchema = z.object({
  format: z.literal(ATS_DOCUMENT_FORMAT),
  basics: z.object({
    name: text(200),
    headline: optional(),
    email: optional(320),
    phone: optional(64),
    location: optional(300),
    links: list(L.links, 2_048),
  }),
  sections: z.array(section).check(z.maxLength(L.sections)),
}) satisfies z.ZodMiniType<AtsResumeDocument, unknown>;
