import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TSX = fileURLToPath(import.meta.resolve("../node_modules/.bin/tsx"));
const CLI_PATH = fileURLToPath(import.meta.resolve("../bin/lspq.ts"));
const HOME = homedir();
const SOCKET_PATH = join(HOME, ".lspq", "daemon.sock");
const PID_PATH = join(HOME, ".lspq", "daemon.pid");

let tmpDir: string;

function exec(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(TSX, args, {
      env: { ...process.env, HOME, PATH: process.env.PATH },
      cwd: cwd || tmpDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let resolved = false;
    const done = (ec: number) => {
      if (resolved) return; resolved = true;
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: ec });
    };
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString("utf-8"); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString("utf-8"); });
    proc.on("close", (code) => { done(code ?? -1); });
    proc.on("error", () => { done(-1); });
    setTimeout(() => { if (!resolved) done(-1); }, 20000);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function stopDaemon(): Promise<void> {
  try { await exec([CLI_PATH, "daemon", "stop"]); } catch {}
  await wait(500);
  try { unlinkSync(SOCKET_PATH); } catch {}
  try { unlinkSync(PID_PATH); } catch {}
}

describe("error handling", () => {
  beforeAll(async () => {
    await stopDaemon();
    tmpDir = mkdtempSync(join(tmpdir(), "lspq-err-"));
  });

  afterAll(async () => {
    await stopDaemon();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unknown extension shows helpful message", async () => {
    writeFileSync(join(tmpDir, "test.xyz"), "hello");
    const r = await exec([CLI_PATH, "def", "test.xyz:0:0", "--root", tmpDir], tmpDir);
    expect(r.stderr.toLowerCase()).toMatch(/no lsp server|NO_SERVER/i);
  });

  it("shows usage with no arguments", async () => {
    const r = await exec([CLI_PATH]);
    expect(r.stdout).toContain("Usage");
    expect(r.exitCode).toBe(0);
  });

  it("unknown command shows error", async () => {
    const r = await exec([CLI_PATH, "invalidcmd", "file.ts:1:1"]);
    expect(r.stderr).toContain("unknown command");
    expect(r.exitCode).toBe(1);
  });
});
