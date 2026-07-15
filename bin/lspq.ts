#!/usr/bin/env node

import { existsSync } from "node:fs";
import { cwd } from "node:process";
import { resolve, isAbsolute } from "node:path";
import { daemonAction } from "../src/client.js";
import {
  definition,
  references,
  hover,
  diagnostics,
  symbols,
  format,
} from "../src/commands/index.js";

const args = process.argv.slice(2);
const help = () => {
  process.stdout.write(`lspq — LSP-powered code intelligence from the terminal

Usage:
  lspq daemon start|stop|status
  lspq def|ref|hover|diag|symbols|fmt <file>:<line>:<col> [--json] [--root <dir>]

Commands:
  daemon start      Start the background daemon
  daemon stop       Stop the daemon
  daemon status     Show running LSP servers

  def <file>:<line>:<col>   Go to definition
  ref <file>:<line>:<col>   Find references
  hover <file>:<line>:<col>  Show type info and docs
  diag <file>               Show diagnostics (errors, warnings)
  symbols <file>            Show document symbols (outline)
  fmt <file>                Format document (output to stdout)

Options:
  --json            Output raw JSON (for scripting)
  --root <dir>      Project root directory (default: cwd)
  --help, -h        Show this help
`);
};

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  help();
  process.exit(0);
}

const cmd = args[0];

// ─── Daemon commands ───
if (cmd === "daemon") {
  const action = args[1];
  if (!action || !["start", "stop", "status"].includes(action)) {
    process.stderr.write("lspq: daemon requires start, stop, or status\n");
    process.exit(1);
  }
  try {
    const out = await daemonAction(action as "start" | "stop" | "status");
    if (out) process.stdout.write(out + "\n");
  } catch (err: any) {
    process.stderr.write(`lspq: ${err.message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ─── Query commands ───
const queryCommands: Record<string, Function> = {
  def: definition,
  definition,
  ref: references,
  references,
  hover,
  diag: diagnostics,
  diagnostics,
  symbols,
  fmt: format,
  format,
};

const handler = queryCommands[cmd];
if (!handler) {
  process.stderr.write(`lspq: unknown command '${cmd}'. Run lspq --help.\n`);
  process.exit(1);
}

// Parse <file>:<line>:<col>
let target = args[1];
let json = false;
let root = "";

for (let i = 2; i < args.length; i++) {
  if (args[i] === "--json") json = true;
  else if (args[i] === "--root" && args[i + 1]) {
    root = resolve(args[++i]);
  }
}

if (!target) {
  process.stderr.write(`lspq: missing file argument. Run lspq --help.\n`);
  process.exit(1);
}

const match = target.match(/^(.+?):(\d+):(\d+)$/);
let file: string;
let line = 0;
let col = 0;

if (match) {
  file = match[1];
  line = parseInt(match[2], 10);
  col = parseInt(match[3], 10);
} else {
  file = target;
  line = 0;
  col = 0;
}

if (!isAbsolute(file)) {
  const full = resolve(root || cwd(), file);
  if (existsSync(full)) {
    file = full;
  } else {
    file = resolve(root || cwd(), file);
  }
}

try {
  if (cmd === "diag" || cmd === "diagnostics") {
    await diagnostics(file, json, root || undefined);
  } else {
    await handler(file, line, col, json, root || undefined);
  }
} catch (err: any) {
  process.stderr.write(`lspq: ${err.message}\n`);
  process.exit(1);
}
