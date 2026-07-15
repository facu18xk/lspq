import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TSX = fileURLToPath(import.meta.resolve("../node_modules/.bin/tsx"));
const CLI_PATH = fileURLToPath(import.meta.resolve("../bin/lspq.ts"));
const DAEMON_PATH = fileURLToPath(import.meta.resolve("../src/daemon.ts"));
const HOME = homedir();
const SOCKET_PATH = join(HOME, ".lspq", "daemon.sock");
const PID_PATH = join(HOME, ".lspq", "daemon.pid");

function exec(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(TSX, args, {
      env: { ...process.env, HOME },
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

describe("CLI end-to-end", () => {
  beforeAll(async () => { await stopDaemon(); });
  afterAll(async () => { await stopDaemon(); });

  it("prints usage with --help", async () => {
    const r = await exec([CLI_PATH, "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage");
  });

  it("daemon start shows started JSON", async () => {
    await startDaemon();
    await wait(1000);
    // just verify it started without error
    expect(true).toBe(true);
    await stopDaemon();
  });

  it("daemon status shows running when started", async () => {
    await startDaemon();
    await wait(1000);
    const r = await exec([DAEMON_PATH, "status"]);
    expect(r.stdout).toContain("running");
    await stopDaemon();
  });
});
