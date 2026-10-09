import { describe, expect, it } from "vitest";

import {
  bulletsPerRole,
  dateFormats,
  firstPersonLines,
  longBullets,
  passiveVoice,
  repeatedOpeners,
  roleBlocks,
  tenseMismatches,
  weakOpeners,
} from "../../src/checks/writing.js";
import { AtsScoringService, DEFAULT_POLICY } from "../../src/index.js";
import { segmentResume } from "../../src/parser/sections.js";
import { expectFast } from "../fixtures/timing.js";

const P = DEFAULT_POLICY;
const blocksOf = (text: string) => roleBlocks(segmentResume(text.split("\n"), P), P);

describe("role blocks", () => {
  it("reads each dated role with its bullets, its dates and whether it is current", () => {
    const blocks = blocksOf(`Jane Doe
Experience
Engineer, Acme Corp    Jan 2022 – Present
• Lead the payments team
• Own the ledger
Analyst
Globex
Mar 2019 – Dec 2021
- Built the warehouse
Education
State University, B.S., 2019
• Graduated with honours`);
    expect(blocks).toEqual([
      {
        header: "Engineer, Acme Corp    Jan 2022 – Present",
        dates: "Jan 2022 – Present",
        current: true,
        bullets: ["Lead the payments team", "Own the ledger"],
      },
      {
        header: "Mar 2019 – Dec 2021",
        dates: "Mar 2019 – Dec 2021",
        current: false,
        bullets: ["Built the warehouse"],
      },
    ]);
  });

  it("reads sentences under a role when the list markers were lost", () => {
    const [block] = blocksOf(`Experience
Engineer, Acme Corp    Jan 2022 – Present
Lead the payments team of eight engineers
Own the ledger service for every market`);
    expect(block.bullets).toEqual([
      "Lead the payments team of eight engineers",
      "Own the ledger service for every market",
    ]);
  });

  it("finds none without an experience section", () => {
    expect(blocksOf("Jane Doe\nSkills\nGo, Rust")).toEqual([]);
  });
});

describe("each check", () => {
  it("is null when there is nothing to judge", () => {
    expect(firstPersonLines([], P)).toBeNull();
    expect(passiveVoice([], P)).toBeNull();
    expect(weakOpeners([], P)).toBeNull();
    expect(longBullets([], P)).toBeNull();
    expect(tenseMismatches([], P)).toBeNull();
    expect(bulletsPerRole([], P)).toBeNull();
    expect(repeatedOpeners([], P)).toBeNull();
    expect(dateFormats([], P)).toBeNull();
  });

  it("reads its words from the policy", () => {
    const policy = {
      ...P,
      writing: { ...P.writing, weakOpeners: ["in charge of"], firstPersonPronouns: ["moi"] },
    };
    expect(weakOpeners(["Responsible for billing", "In charge of payroll"], policy)).toEqual({
      value: 1,
      sample: "In charge of payroll",
    });
    expect(firstPersonLines(["I lead billing", "moi"], policy)?.value).toBe(1);
  });

  it("classes dates by format family, not by month", () => {
    const block = (dates: string) => ({ header: dates, dates, current: false, bullets: [] });
    expect(
      dateFormats([block("Jan 2020 – Mar 2021"), block("June 2017 – Dec 2019")], P)?.value,
    ).toBe(1);
    expect(dateFormats([block("2021-03 – 2022-04"), block("03/2017 – 12/2019")], P)?.value).toBe(2);
    expect(dateFormats([block("2019 – 2021"), block("Jan 2016 – Dec 2018")], P)?.value).toBe(2);
    // "2019-21" is a year range, not March of 2019's twenty-first month.
    expect(dateFormats([block("2019-21"), block("2015 – 2018")], P)?.value).toBe(1);
  });
});

const N = 50_000;
const rep = (unit: string) => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
const SHAPES: Record<string, string> = {
  "passive run": rep("was used "),
  "auxiliary run": rep("was "),
  "adverb run": rep("was quickly "),
  "pronoun run": rep("I "),
  "I/O run": rep("I/"),
  "opener run": rep("responsible for "),
  letters: rep("a"),
  "ed run": rep("ed"),
  "dates run": rep("Jan 2020 – 03/2021 "),
  spaces: `x${rep(" ")}x`,
};

describe("50 KB adversarial input", () => {
  it.each(Object.entries(SHAPES))("%s, as a bullet, in bounded time", (_, input) => {
    const lines = [input, `• ${input}`];
    const blocks = [{ header: input, dates: input, current: true, bullets: lines }];
    expectFast(() => {
      firstPersonLines(lines, P);
      passiveVoice(lines, P);
      weakOpeners(lines, P);
      longBullets(lines, P);
      tenseMismatches(blocks, P);
      bulletsPerRole(blocks, P);
      repeatedOpeners(blocks, P);
      dateFormats([...blocks, ...blocks], P);
    }, 500);
  });

  it.each(Object.entries(SHAPES))(
    "%s, through check() read as English, in bounded time",
    (_, input) => {
      const resume = `Jane Doe\njane@example.com\nExperience\nEngineer at Acme Jan 2019 - Present\n• ${input}\n• ${input}\nEngineer at Globex 2015 - 2018\n• ${input}`;
      expectFast(() => {
        AtsScoringService.check(resume, P, {
          now: new Date("2026-10-01T00:00:00Z"),
          languages: [],
        });
      }, 1_500);
    },
  );
});
