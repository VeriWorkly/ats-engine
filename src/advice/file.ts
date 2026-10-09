import type { AtsEnginePolicy } from "../policy/schema.js";
import { formatTemplate, wordListRegex } from "../text/text.js";
import type { AtsAdvice, AtsFileInfo, AtsLayoutSignals } from "../types.js";
import { memo } from "../util/memo.js";

/**
 * File hygiene: what the file says before anyone reads it. Each piece of advice needs what it
 * reads — a name, a size, a measured signal — and is not given without it.
 */

type Messages = AtsEnginePolicy["advice"]["messages"];
type Text = Messages["fileName"];

/** A file name past this is not one a person typed; the rest is not read. */
const MAX_NAME = 255;

const EXTENSIONS: Record<NonNullable<AtsFileInfo["format"]>, string> = {
  pdf: ".pdf",
  docx: ".docx",
  html: ".html",
  text: ".txt",
};

const namePatterns = memo((file: AtsEnginePolicy["advice"]["file"]) => ({
  generic: wordListRegex(file.genericNames, "gi"),
  draft: wordListRegex(file.draftMarks, "gi"),
}));

/** A piece of advice from its policy text and the values its templates fill in. */
export function adviceItem(
  id: string,
  kind: AtsAdvice["kind"],
  text: Text,
  values: Record<string, string | number>,
  /** `null`: nothing to quote. */
  evidence: string | null = text.evidence ?? null,
): AtsAdvice {
  return {
    id,
    kind,
    message: formatTemplate(text.message, values),
    ...(evidence !== null && { evidence: formatTemplate(evidence, values) }),
    fix: formatTemplate(text.fix, values),
  };
}

/** "2.4 MB", "640 KB": one decimal at most. */
function size(bytes: number): string {
  const [value, unit] = bytes >= 1024 * 1024 ? [bytes / 1024 / 1024, "MB"] : [bytes / 1024, "KB"];
  return `${Math.round(value * 10) / 10} ${unit}`;
}

/**
 * The name to suggest: the candidate's name as the parser read it, its words joined by "-", in
 * the policy's template with the file's own extension.
 */
function suggestion(policy: AtsEnginePolicy, candidate: string, extension: string) {
  const words = candidate.split(/[^\p{L}\p{M}\p{N}'’]+/u).filter(Boolean);
  const name = words.length ? words.join("-") : policy.advice.file.placeholderName;
  return formatTemplate(policy.advice.file.suggestedName, { name, ext: extension });
}

/**
 * Whether a file name says whose resume it is and reads as final. Flagged: a draft mark anywhere
 * ("final", "v3", "(2)", "Copy"), or nothing but generic words and digits ("resume", "CV",
 * "Document1", "scan0001"). A name in any script with a word the lists do not know is someone's.
 */
function nameAdvice(policy: AtsEnginePolicy, file: AtsFileInfo, candidate: string) {
  const full = file.name!.slice(0, MAX_NAME);
  const dot = full.lastIndexOf(".");
  const extension =
    dot > 0 && /^\.[\p{L}\p{N}]{1,5}$/u.test(full.slice(dot))
      ? full.slice(dot)
      : file.format
        ? EXTENSIONS[file.format]
        : "";
  const stem = (extension && full.endsWith(extension) ? full.slice(0, -extension.length) : full)
    .replace(/[_.\-–—]/g, " ")
    .replace(/\(/g, " (");
  const { generic, draft } = namePatterns(policy.advice.file);
  const marks = [...stem.matchAll(draft)].map(([mark]) => mark.trim());
  const rest = stem.replace(draft, " ").replace(generic, " ");
  if (!marks.length && /\p{L}/u.test(rest)) return null;
  const { messages } = policy.advice;
  return adviceItem(
    "file.name",
    "file",
    messages.fileName,
    {
      name: full,
      marks: marks.map((mark) => `"${mark}"`).join(", "),
      suggestion: suggestion(policy, candidate, extension),
    },
    marks.length ? messages.fileNameDraft : (messages.fileName.evidence ?? null),
  );
}

/** The file advice, in a fixed order: name, size, password, tracked changes, comments. */
export function fileAdvice(
  policy: AtsEnginePolicy,
  file: AtsFileInfo | undefined,
  layout: AtsLayoutSignals | undefined,
  candidate: string,
): AtsAdvice[] {
  const { messages, file: limits } = policy.advice;
  const advice: AtsAdvice[] = [];
  if (typeof file?.name === "string" && file.name.trim()) {
    const item = nameAdvice(policy, file, candidate);
    if (item) advice.push(item);
  }
  if (typeof file?.bytes === "number" && file.bytes > limits.maxBytes)
    advice.push(
      adviceItem("file.size", "file", messages.fileSize, {
        size: size(file.bytes),
        limit: size(limits.maxBytes),
      }),
    );
  if (file?.passwordProtected === true || layout?.encrypted === true)
    advice.push(adviceItem("file.passwordProtected", "file", messages.passwordProtected, {}));
  // A count measured from the file quotes it; the caller's word alone has nothing to quote.
  for (const [id, text, count, said] of [
    ["file.trackedChanges", messages.trackedChanges, layout?.trackedChanges, file?.trackedChanges],
    ["file.comments", messages.comments, layout?.comments, file?.comments],
  ] as const) {
    if (typeof count === "number" && count > 0)
      advice.push(adviceItem(id, "file", text, { n: count }));
    else if (said === true) advice.push(adviceItem(id, "file", text, {}, null));
  }
  return advice;
}
