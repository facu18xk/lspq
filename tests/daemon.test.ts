import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TSX = fileURLToPath(import.meta.resolve("../node_modules/.bin/tsx"));
const CLI_PATH = fileURLToPath(import.meta.resolve("../bin/lspq.ts"));
const DAEMON_PATH = fileURLToPath(import.meta.resolve("../src/daemon.ts"));
const HOME = homedir();
const SOCKET_PATH = join(HOME, ".lspq", "daemon.sock");
const PID_PATH = join(HOME, ".lspq", "daemon.pid");

let tmpDir: string;

function exec(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(TSX, args, {
      env: { ...process.env, HOME },
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

async function startDaemon(): Promise<void> {
  const p = spawn(TSX, [DAEMON_PATH, "start"], {
    env: { ...process.env, HOME },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let data = "";
  return new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error("daemon start timeout")), 15000);
    p.stdout?.on("data", (d: Buffer) => {
      data += d.toString();
      if (data.includes("started")) {
        p.unref();
        resolve();
      }
    });
    p.on("error", reject);
  });
}

describe("daemon lifecycle", () => {
  beforeAll(async () => {
    await stopDaemon();
    tmpDir = mkdtempSync(join(tmpdir(), "lspq-daemon-"));
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    writeFileSync(join(tmpDir, "test.ts"), "export const x = 1;\n");
  });

  afterAll(async () => {
    await stopDaemon();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("start creates socket and pid file", async () => {
    await startDaemon();
    await wait(500);
    expect(existsSync(SOCKET_PATH)).toBe(true);
    expect(existsSync(PID_PATH)).toBe(true);
    await stopDaemon();
  });

  it("stop removes socket and pid file", async () => {
    await startDaemon();
    await wait(500);
    await stopDaemon();
    await wait(500);
    expect(existsSync(SOCKET_PATH)).toBe(false);
    expect(existsSync(PID_PATH)).toBe(false);
  });

  it("status reports running when started", async () => {
    await startDaemon();
    await wait(1000);
    const r = await exec([DAEMON_PATH, "status"]);
    expect(r.stdout).toContain("running");
    await stopDaemon();
  });
});
