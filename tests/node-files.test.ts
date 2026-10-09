// Reading a resume or a posting from a path: shared by the CLI and the MCP server, so both refuse
// the same files with the same words.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli/main.js";
import { PLAIN } from "../src/cli/terminal.js";
import { printable } from "../src/format/index.js";
import {
  AtsFileError,
  MAX_FILE_BYTES,
  readFileBytes,
  readJobFile,
  readResumeFile,
} from "../src/node/files.js";
import * as node from "../src/node/index.js";

const dir = mkdtempSync(join(tmpdir(), "ats-files-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string | Buffer) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const RESUME = "Jane Doe\njane@example.com\nExperience\nEngineer at Acme, 2019 - 2022\n- Built it";

describe("readFileBytes", () => {
  it("names a missing file, a folder and a file over the limit", async () => {
    mkdirSync(join(dir, "folder.pdf"));
    await expect(readFileBytes(join(dir, "missing.pdf"))).rejects.toThrow(/^No such file: /);
    await expect(readFileBytes(join(dir, "folder.pdf"))).rejects.toThrow(/is a folder, not a/);
    const big = file("big.txt", "x".repeat(2048));
    const refused = readFileBytes(big, { maxBytes: 1024 });
    await expect(refused).rejects.toBeInstanceOf(AtsFileError);
    await expect(refused).rejects.toThrow(/big\.txt is 2 KB; files over 1 KB are not read\.$/);
    expect((await readFileBytes(big, { maxBytes: 4096 })).length).toBe(2048);
  });
});

describe("readResumeFile and readJobFile", () => {
  it("read text, refuse what is not a resume, and read a posting", async () => {
    expect((await readResumeFile(file("resume.txt", RESUME))).input).toBe(RESUME);
    await expect(readResumeFile(file("short.txt", "Jane"))).rejects.toThrow(/enough readable/);
    await expect(readResumeFile("resume.rtf")).rejects.toThrow(/Unsupported resume file type/);
    await expect(readResumeFile(file("bad.json", "{"))).rejects.toThrow(/is not valid JSON/);
    await expect(readResumeFile(file("other.json", "{}"))).rejects.toThrow(/neither a JSON/);
    expect(await readJobFile(file("job.txt", "Platform Engineer\n\n\nGo required"))).toContain(
      "Go required",
    );
  });

  it("are public on /node", () => {
    expect(node.readResumeFile).toBe(readResumeFile);
    expect(node.readJobFile).toBe(readJobFile);
    expect(node.AtsFileError).toBe(AtsFileError);
    expect(node.MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("the CLI", () => {
  it("refuses a resume file over MAX_FILE_BYTES before reading it", async () => {
    const err: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const big = file("huge.txt", Buffer.alloc(MAX_FILE_BYTES + 1, 0x61));
    expect(await main(["check", big], { terminal: PLAIN, env: {} })).toBe(1);
    expect(err.join("\n")).toMatch(/huge\.txt is 20 MB; files over 20 MB are not read\./);
  });
});

describe("printable on /format", () => {
  it("strips control characters at any depth and keeps line breaks and tabs", () => {
    expect(printable({ a: ["x\u001b[2Jy\u009b"], b: "ok\n\tfine" })).toEqual({
      a: ["x[2Jy"],
      b: "ok\n\tfine",
    });
  });
});
