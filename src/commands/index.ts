import { query } from "../client.js";
import { cwd } from "node:process";

export async function definition(
  file: string,
  line: number,
  col: number,
  json: boolean,
  root?: string
): Promise<void> {
  const res = await query("definition", file, line, col, root ?? cwd());
  if (res.error) {
    process.stderr.write(`lspq: ${res.error.message}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(res.result) + "\n");
    return;
  }
  const locs = res.result?.locations ?? [];
  if (locs.length === 0) {
    process.stderr.write("No definition found\n");
    process.exit(1);
  }
  for (const loc of locs) {
    process.stdout.write(`${loc.file}:${loc.line}:${loc.col}\n`);
  }
}

export async function references(
  file: string,
  line: number,
  col: number,
  json: boolean,
  root?: string
): Promise<void> {
  const res = await query("references", file, line, col, root ?? cwd());
  if (res.error) {
    process.stderr.write(`lspq: ${res.error.message}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(res.result) + "\n");
    return;
  }
  const locs = res.result?.locations ?? [];
  if (locs.length === 0) {
    process.stderr.write("No references found\n");
    process.exit(1);
  }
  for (const loc of locs) {
    process.stdout.write(`${loc.file}:${loc.line}:${loc.col}\n`);
  }
}

export async function hover(
  file: string,
  line: number,
  col: number,
  json: boolean,
  root?: string
): Promise<void> {
  const res = await query("hover", file, line, col, root ?? cwd());
  if (res.error) {
    process.stderr.write(`lspq: ${res.error.message}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(res.result) + "\n");
    return;
  }
  const contents = res.result?.hover?.contents ?? "";
  if (!contents) {
    process.stderr.write("No hover info\n");
    process.exit(1);
  }
  process.stdout.write(contents + "\n");
}

export async function diagnostics(
  file: string,
  json: boolean,
  root?: string
): Promise<void> {
  const res = await query("diagnostics", file, 0, 0, root ?? cwd());
  if (res.error) {
    process.stderr.write(`lspq: ${res.error.message}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(res.result) + "\n");
    return;
  }
  const diags = res.result?.diagnostics ?? [];
  if (diags.length === 0) {
    process.stdout.write("No diagnostics\n");
    process.exit(0);
  }
  for (const d of diags) {
    const sev = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
    process.stdout.write(`${d.line}:${d.col}: ${sev}: ${d.message}\n`);
  }
}

export async function symbols(
  file: string,
  json: boolean,
  root?: string
): Promise<void> {
  const res = await query("symbols", file, 0, 0, root ?? cwd());
  if (res.error) {
    process.stderr.write(`lspq: ${res.error.message}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(res.result) + "\n");
    return;
  }
  const syms = res.result?.symbols ?? [];
  if (syms.length === 0) {
    process.stderr.write("No symbols found\n");
    process.exit(1);
  }
  printSymbols(syms, 0);
}

function printSymbols(
  syms: Array<{ name: string; kind: string; line: number; children?: any[] }>,
  depth: number
): void {
  const indent = "  ".repeat(depth);
  for (const s of syms) {
    process.stdout.write(`${indent}${s.kind.padEnd(12)} ${s.name}  (line ${s.line})\n`);
    if (s.children?.length) {
      printSymbols(s.children as any[], depth + 1);
    }
  }
}

export async function format(
  file: string,
  json: boolean,
  root?: string
): Promise<void> {
  const res = await query("formatting", file, 0, 0, root ?? cwd());
  if (res.error) {
    process.stderr.write(`lspq: ${res.error.message}\n`);
    process.exit(1);
  }
  if (json) {
    process.stdout.write(JSON.stringify(res.result) + "\n");
    return;
  }
  process.stdout.write(res.result?.formatted ?? "");
}
