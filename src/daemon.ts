import { createServer, type Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startServer, ensureFileOpen, closeFile, type LspTransport } from "./transport.js";
import { getServerCommand, getTimeout } from "./registry.js";
import type { QueryRequest, QueryResponse, ServerInfo } from "./types.js";

const HOME = homedir();
const DATA_DIR = join(HOME, ".lspq");
const SOCKET_PATH = join(DATA_DIR, "daemon.sock");
const PID_PATH = join(DATA_DIR, "daemon.pid");
const IDLE_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 30 * 1000;

interface ServerEntry {
  transport: LspTransport;
  command: string;
  ext: string;
  root: string;
  pid: number | null;
  status: "starting" | "ready" | "error";
  lastUsed: number;
  initPromise?: Promise<void>;
  busy: boolean;
  queue: Array<() => void>;
}

class Daemon {
  private servers = new Map<string, ServerEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  async start(): Promise<void> {
    if (existsSync(SOCKET_PATH)) {
      try {
        unlinkSync(SOCKET_PATH);
      } catch {
        // stale socket, continue
      }
    }

    writeFileSync(PID_PATH, String(process.pid));

    const server = createServer((socket: Socket) => {
      this.handleConnection(socket);
    });

    server.listen(SOCKET_PATH, () => {
      process.stdout.write(JSON.stringify({ status: "started", socket: SOCKET_PATH, pid: process.pid }) + "\n");
    });

    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);

    const shutdown = () => {
      this.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    process.on("SIGHUP", shutdown);
  }

  stop(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const [, entry] of this.servers) {
      entry.transport.kill();
    }
    this.servers.clear();
    try { unlinkSync(SOCKET_PATH); } catch {}
    try { unlinkSync(PID_PATH); } catch {}
  }

  private handleConnection(socket: Socket): void {
    let data = "";
    const timeout = setTimeout(() => socket.destroy(), 30000);

    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf-8");
      try {
        const req: QueryRequest & { type?: string } = JSON.parse(data);
        clearTimeout(timeout);
        this.processRequest(socket, req);
      } catch {
        // More data coming
      }
    });

    socket.on("error", () => {
      clearTimeout(timeout);
    });
  }

  private async processRequest(socket: Socket, req: QueryRequest & { type?: string }): Promise<void> {
    const send = (res: QueryResponse) => {
      socket.write(JSON.stringify(res) + "\n");
      socket.end();
    };

    if (req.type === "status") {
      send({ result: { running: true, servers: this.servers.size } });
      return;
    }

    if (req.type === "stop") {
      send({ result: {} });
      this.stop();
      process.exit(0);
      return;
    }

    const { command, file, line, col, root } = req;
    const cmd = getServerCommand(file, root);
    if (!cmd) {
      send({ error: { code: "NO_SERVER", message: `No LSP server found for: ${file}` } });
      return;
    }

    const key = `${root}:${cmd}`;
    let entry = this.servers.get(key);

    if (!entry) {
      entry = {
        transport: null as any,
        command: cmd,
        ext: file.slice(file.lastIndexOf(".")),
        root,
        pid: null,
        status: "starting",
        lastUsed: Date.now(),
        busy: false,
        queue: [],
      };
      this.servers.set(key, entry);

      try {
        const rootUri = "file://" + root;
        entry.transport = await startServer(cmd, rootUri, getTimeout(root));
        entry.status = "ready";
        entry.pid = null;
        process.nextTick(() => this.drainQueue(key));
      } catch (err: any) {
        entry.status = "error";
        this.servers.delete(key);
        send({ error: { code: "SERVER_START_FAILED", message: err.message } });
        return;
      }
    }

    const execute = () => {
      this.executeQuery(socket, entry!, command, file, line, col, root);
    };

    if (entry.busy) {
      entry.queue.push(execute);
    } else {
      execute();
    }
  }

  private async executeQuery(
    socket: Socket,
    entry: ServerEntry,
    command: string,
    file: string,
    line: number,
    col: number,
    root: string
  ): Promise<void> {
    entry.busy = true;
    entry.lastUsed = Date.now();

    const send = (res: QueryResponse) => {
      socket.write(JSON.stringify(res) + "\n");
      socket.end();
      entry.busy = false;
      this.processQueue(entry);
    };

    try {
      const joinPath = (await import("node:path")).join;
      const fullPath = file.startsWith("/") ? file : joinPath(root, file);
      const rootUri = "file://" + root;

      await ensureFileOpen(entry.transport, fullPath, rootUri);

      let result: any;

      switch (command) {
        case "definition":
          result = await entry.transport.send("textDocument/definition", {
            textDocument: { uri: "file://" + fullPath },
            position: { line, character: col },
          });
          break;
        case "references":
          result = await entry.transport.send("textDocument/references", {
            textDocument: { uri: "file://" + fullPath },
            position: { line, character: col },
            context: { includeDeclaration: false },
          });
          break;
        case "hover":
          result = await entry.transport.send("textDocument/hover", {
            textDocument: { uri: "file://" + fullPath },
            position: { line, character: col },
          });
          break;
        case "symbols":
          result = await entry.transport.send("textDocument/documentSymbol", {
            textDocument: { uri: "file://" + fullPath },
          });
          break;
        case "diagnostics":
        case "diag": {
          const fullUri = "file://" + fullPath;
          const collected: Array<{
            line: number;
            col: number;
            message: string;
            severity: string;
            source?: string;
          }> = [];
          const sevNames = ["", "error", "warning", "info", "hint"];

          const orig = entry.transport.onNotification;
          entry.transport.onNotification = (method, params) => {
            if (method === "textDocument/publishDiagnostics" && params.uri === fullUri) {
              for (const d of params.diagnostics ?? []) {
                collected.push({
                  line: d.range.start.line,
                  col: d.range.start.character,
                  message: d.message,
                  severity: sevNames[d.severity] ?? "info",
                  source: d.source,
                });
              }
            }
            if (orig) orig(method, params);
          };

          await new Promise<void>((resolve) => setTimeout(resolve, 800));
          entry.transport.onNotification = orig;
          result = null;
          closeFile(entry.transport, fullPath, rootUri);
          send({
            result: {
              diagnostics: collected,
            },
          });
          return;
        }
        case "formatting":
          result = await entry.transport.send("textDocument/formatting", {
            textDocument: { uri: "file://" + fullPath },
            options: { tabSize: 2, insertSpaces: true },
          });
          break;
        default:
          send({ error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${command}` } });
          closeFile(entry.transport, fullPath, rootUri);
          return;
      }

      closeFile(entry.transport, fullPath, rootUri);

      send({ result: this.formatResult(command, result, root) });
    } catch (err: any) {
      send({ error: { code: "LSP_ERROR", message: err.message } });
    }
  }

  private formatResult(command: string, result: any, root: string): any {
    switch (command) {
      case "definition":
      case "references": {
        const rawLocs = Array.isArray(result) ? result : result ? [result] : [];
        const locations = [];
        for (const loc of rawLocs) {
          if (!loc) continue;
          const uri = loc.uri || loc.targetUri;
          const range = loc.range || loc.targetRange || loc.targetSelectionRange;
          if (!uri || !range) continue;
          const fp = uri.replace("file://", "");
          locations.push({
            file: fp.startsWith(root) ? fp.slice(root.length + 1) : fp,
            line: range.start?.line ?? range.start?.character ?? 0,
            col: range.start?.character ?? 0,
          });
        }
        return { locations };
      }
      case "hover": {
        if (!result) return { hover: { contents: "" } };
        let contents = "";
        if (typeof result.contents === "string") {
          contents = result.contents;
        } else if (Array.isArray(result.contents)) {
          contents = result.contents
            .map((c: any) => (typeof c === "string" ? c : c.value ?? ""))
            .join("\n");
        } else if (result.contents?.value) {
          contents = result.contents.value;
        } else if (result.contents?.language) {
          contents = result.contents.value;
        }
        return { hover: { contents } };
      }
      case "symbols": {
        const syms = Array.isArray(result) ? result : [];
        return {
          symbols: syms.map((s: any) => ({
            name: s.name,
            kind: kindName(s.kind),
            line: s.selectionRange?.start?.line ?? s.range?.start?.line,
            col: s.selectionRange?.start?.character ?? s.range?.start?.character,
            children: s.children?.map((c: any) => ({
              name: c.name,
              kind: kindName(c.kind),
              line: c.selectionRange?.start?.line ?? c.range?.start?.line,
              col: c.selectionRange?.start?.character ?? c.range?.start?.character,
            })),
          })),
        };
      }
      case "formatting": {
        const edits = Array.isArray(result) ? result : [];
        return {
          formatted: edits
            .map((e: any) => e.newText)
            .join(""),
        };
      }
      default:
        return {};
    }
  }

  private processQueue(entry: ServerEntry): void {
    const next = entry.queue.shift();
    if (next) next();
  }

  private drainQueue(key: string): void {
    const entry = this.servers.get(key);
    if (!entry) return;
    while (entry.queue.length > 0) {
      const next = entry.queue.shift()!;
      next();
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - IDLE_TIMEOUT;
    for (const [key, entry] of this.servers) {
      if (entry.lastUsed < cutoff && !entry.busy) {
        entry.transport.kill();
        this.servers.delete(key);
      }
    }
  }

  status(): ServerInfo[] {
    const infos: ServerInfo[] = [];
    for (const [, entry] of this.servers) {
      infos.push({
        ext: entry.ext,
        command: entry.command,
        pid: entry.pid,
        status: entry.status,
        lastUsed: entry.lastUsed,
      });
    }
    return infos;
  }
}

function kindName(kind: number): string {
  const names: Record<number, string> = {
    1: "File", 2: "Module", 3: "Namespace", 4: "Package",
    5: "Class", 6: "Method", 7: "Property", 8: "Field",
    9: "Constructor", 10: "Enum", 11: "Interface", 12: "Function",
    13: "Variable", 14: "Constant", 15: "String", 16: "Number",
    17: "Boolean", 18: "Array", 19: "Object", 20: "Key",
    21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
    25: "Operator", 26: "TypeParameter",
  };
  return names[kind] ?? "Unknown";
}

// ─── CLI entry when run directly ───
const cmd = process.argv[2];
if (cmd === "start") {
  const daemon = new Daemon();
  daemon.start();
} else if (cmd === "stop") {
  // Signal running daemon
  import("node:net").then((net) => {
    if (!existsSync(SOCKET_PATH)) {
      process.stdout.write(JSON.stringify({ status: "not-running" }) + "\n");
      process.exit(0);
    }
    const s = net.createConnection(SOCKET_PATH, () => {
      s.write(JSON.stringify({ type: "stop" }));
    });
    s.on("data", () => {
      s.destroy();
      process.exit(0);
    });
    s.on("error", () => {
      process.stdout.write(JSON.stringify({ status: "stopped" }) + "\n");
      process.exit(0);
    });
  });
} else if (cmd === "status") {
  import("node:net").then((net) => {
    if (!existsSync(SOCKET_PATH)) {
      process.stdout.write(JSON.stringify({ running: false, servers: [] }) + "\n");
      process.exit(0);
    }
    const s = net.createConnection(SOCKET_PATH, () => {
      s.write(JSON.stringify({ type: "status" }));
    });
    s.on("data", (d: Buffer) => {
      process.stdout.write(d.toString("utf-8"));
      s.destroy();
      process.exit(0);
    });
    s.on("error", () => {
      process.stdout.write(JSON.stringify({ running: false, servers: [] }) + "\n");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  });
}
