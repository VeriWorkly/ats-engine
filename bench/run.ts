// Parsing benchmark: field accuracy and time per resume over the labelled synthetic corpus in
// tests/fixtures (invented people only), read as text. `npm run bench`; add a resume there to grow
// the corpus.
//
// bench/baseline.json lists every field the corpus misses today. The run fails on a miss that is
// not in it, so one field read better cannot hide another read worse; `npm run bench -- --update`
// rewrites it, in the change that earns the difference.
import { readFileSync, writeFileSync } from "node:fs";

import { AtsScoringService, DEFAULT_POLICY } from "../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../src/locales/index.js";
import { fieldChecks, type FieldCheck } from "../tests/fixtures/accuracy.js";
import { LOCALE_FIXTURES } from "../tests/fixtures/locale-resumes.js";

const BASELINE = new URL("./baseline.json", import.meta.url);
const update = process.argv.includes("--update");

const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const now = new Date("2026-10-01T00:00:00Z");
/** Per printed set, per field, how many were read right of how many. */
const tallies = new Map<string, Map<string, { ok: number; total: number }>>();
/** Per corpus, each miss as "resume: field[row]", with what was read against what was labelled. */
const misses = new Map<string, Map<string, string>>();
const timings: number[] = [];

function record(set: string, corpus: string, id: string, checks: FieldCheck[]) {
  const tally = tallies.get(set) ?? new Map<string, { ok: number; total: number }>();
  tallies.set(set, tally);
  const missed = misses.get(corpus) ?? new Map<string, string>();
  misses.set(corpus, missed);
  for (const { field, row, ok, got, want } of checks) {
    const entry = tally.get(field) ?? { ok: 0, total: 0 };
    entry.ok += Number(ok);
    entry.total += 1;
    tally.set(field, entry);
    if (!ok)
      missed.set(
        `${id}: ${field}${row === undefined ? "" : `[${row}]`}`,
        `got ${got}, want ${want}`,
      );
  }
}

function checkTimed(text: string) {
  const started = performance.now();
  const report = AtsScoringService.check(text, policy, { now });
  timings.push(performance.now() - started);
  return report;
}

// The first call pays for compiling the policy's patterns; it is not what a server pays per resume.
AtsScoringService.check("Jane Doe\nExperience\nEngineer, Acme 2020 - 2022", policy, { now });

for (const [locale, fixtures] of Object.entries(LOCALE_FIXTURES))
  for (const fixture of fixtures)
    record(
      "hand-written",
      "hand-written",
      `${locale}/${fixture.id}`,
      fieldChecks(checkTimed(fixture.text), fixture),
    );

const percent = (ratio: number) => `${(100 * ratio).toFixed(1).padStart(5)}%`;
for (const [set, tally] of tallies) {
  const all = [...tally.values()].reduce(
    (sum, t) => ({ ok: sum.ok + t.ok, total: sum.total + t.total }),
    { ok: 0, total: 0 },
  );
  console.log(`\n${set}`);
  for (const [field, { ok, total }] of tally)
    console.log(`  ${field.padEnd(22)} ${percent(ok / total)}  (${ok}/${total})`);
  console.log(`  ${"overall".padEnd(22)} ${percent(all.ok / all.total)}`);
}

timings.sort((a, b) => a - b);
const at = (q: number) => timings[Math.min(timings.length - 1, Math.floor(q * timings.length))]!;
console.log(
  `\n${timings.length} parses after one warm-up: median ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms`,
);

const list = (title: string, corpus: string) => {
  const rows = [...(misses.get(corpus) ?? [])].map(([key, detail]) => `  ${key}: ${detail}`);
  if (rows.length) console.log(["", `${title}:`, ...rows].join("\n"));
};
list("missed in hand-written", "hand-written");

const current = Object.fromEntries([...misses].map(([corpus, keys]) => [corpus, [...keys.keys()]]));
if (update) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log("\nbaseline updated: review the diff of bench/baseline.json");
} else {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string[]>;
  const known = new Set(Object.values(baseline).flat());
  const missed = new Set(Object.values(current).flat());
  const added = [...missed].filter((key) => !known.has(key));
  const fixed = [...known].filter((key) => !missed.has(key));
  // Above the baseline: worth recording, so the gate holds the gain from now on.
  if (fixed.length)
    console.log(
      `\n${fixed.length} misses in bench/baseline.json are now read right; ` +
        `\`npm run bench -- --update\` records them:\n  ${fixed.join("\n  ")}`,
    );
  if (added.length) {
    console.error(
      `\n${added.length} misses not in bench/baseline.json:\n  ${added.join("\n  ")}\n` +
        "If the change earns it, run `npm run bench -- --update` and review the diff.",
    );
    process.exitCode = 1;
  } else console.log("\nno miss beyond bench/baseline.json");
}
