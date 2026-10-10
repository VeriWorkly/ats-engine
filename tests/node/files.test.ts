// Reading a resume or a posting from a path: shared by the CLI and the MCP server, so both refuse
// the same files with the same words.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/main.js";
import { PLAIN } from "../../src/cli/terminal.js";
import { printable } from "../../src/format/index.js";
import {
  AtsFileError,
  MAX_FILE_BYTES,
  readFileBytes,
  readJobFile,
  readResumeFile,
} from "../../src/node/files.js";
import * as node from "../../src/node/index.js";

// `open` as itself, watched: a path refused before it is opened is never passed to it.
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

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

describe("the size limit", () => {
  it("reads a file of exactly the limit and refuses one byte over", async () => {
    const exact = file("exact.txt", "x".repeat(1024));
    expect((await readFileBytes(exact, { maxBytes: 1024 })).length).toBe(1024);
    const over = file("over.txt", "x".repeat(1025));
    await expect(readFileBytes(over, { maxBytes: 1024 })).rejects.toThrow(
      /over\.txt is 1 KB; files over 1 KB are not read\.$/,
    );
  });
});

describe("what is not a file on this computer", () => {
  // A UNC path is read over SMB — a network request from a tool that makes none — and a device
  // (`\\.\pipe\…`) can stream without end; both are refused before the path is touched.
  it.each([
    String.raw`\\host\share\cv.txt`,
    "//host/share/cv.txt",
    String.raw`\\?\UNC\host\share\cv.txt`,
    String.raw`\\.\pipe\cv.txt`,
    "//./pipe/cv.txt",
    String.raw`\\?\GLOBALROOT\Device\cv.txt`,
  ])("refuses %s", async (path) => {
    const message = /is a network share or a device, not a file on this computer\.$/;
    await expect(readFileBytes(path)).rejects.toBeInstanceOf(AtsFileError);
    await expect(readFileBytes(path)).rejects.toThrow(message);
    await expect(readResumeFile(path)).rejects.toThrow(message);
    await expect(readJobFile(path)).rejects.toThrow(message);
  });

  it.skipIf(process.platform !== "win32")(
    "still reads a local file by its long-path form, \\\\?\\C:\\…",
    async () => {
      const path = `\\\\?\\${file("long.txt", RESUME)}`;
      expect((await readResumeFile(path)).input).toBe(RESUME);
    },
  );

  it.skipIf(process.platform !== "win32")(
    "never connects to a named pipe that would stream without end",
    async () => {
      const name = `\\\\.\\pipe\\ats-files-test-${process.pid}.txt`;
      let connections = 0;
      const server = createServer((socket) => {
        connections += 1;
        socket.on("error", () => {});
        const pump = () => {
          while (socket.writable && socket.write(Buffer.alloc(1 << 16, 0x61)));
          if (socket.writable) socket.once("drain", pump);
        };
        pump();
      });
      await new Promise<void>((done) => server.listen(name, done));
      try {
        await expect(readJobFile(name)).rejects.toBeInstanceOf(AtsFileError);
        expect(connections).toBe(0);
      } finally {
        server.close();
      }
    },
  );

  const fifo = join(dir, "fifo.txt");
  const hasFifo =
    process.platform !== "win32" &&
    (() => {
      try {
        execFileSync("mkfifo", [fifo]);
        return true;
      } catch {
        return false;
      }
    })();

  it.skipIf(!hasFifo)(
    "refuses a FIFO, which reports no size and reads until its writer stops",
    async () => {
      await expect(readJobFile(fifo)).rejects.toThrow(/fifo\.txt is not a regular file\.$/);
    },
  );

  it.skipIf(process.platform === "win32")("refuses a device that never ends", async () => {
    await expect(readFileBytes("/dev/zero")).rejects.toThrow(/is not a regular file\.$/);
  });

  it("never opens what it refuses: opening a device can act on it", async () => {
    // A watchdog arms when it is opened, a terminal can block; so the path is measured first.
    vi.mocked(open).mockClear();
    await expect(readFileBytes(dir)).rejects.toThrow(/is a folder, not a file\.$/);
    if (process.platform !== "win32")
      await expect(readFileBytes("/dev/zero")).rejects.toThrow(/is not a regular file\.$/);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("readResumeFile and readJobFile", () => {
  it("read text, refuse what is not a resume, and read a posting", async () => {
    expect((await readResumeFile(file("resume.txt", RESUME))).input).toBe(RESUME);
    await expect(readResumeFile(file("short.txt", "Jane"))).rejects.toThrow(/enough readable/);
    await expect(readResumeFile("resume.rtf")).rejects.toThrow(/Unsupported resume file type/);
    await expect(readResumeFile(file("bad.json", "{"))).rejects.toThrow(/is not valid JSON/);
    await expect(readResumeFile(file("other.json", "{}"))).rejects.toThrow(/neither a JSON/);
    expect(
      (await readJobFile(file("job.txt", "Platform Engineer\n\n\nGo required"))).text,
    ).toContain("Go required");
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
