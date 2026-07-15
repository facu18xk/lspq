import { spawn, type ChildProcess } from "node:child_process";

export interface LspTransport {
  send(method: string, params?: any): Promise<any>;
  sendNotification(method: string, params?: any): void;
  kill(): void;
  onNotification: ((method: string, params: any) => void) | null;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

interface EnqueuedRequest {
  id: number;
  method: string;
  params: any;
}

export function startServer(
  command: string,
  rootUri: string,
  timeout: number
): Promise<LspTransport> {
  const parts = command.split(/\s+/);
  const bin = parts[0];
  const args = parts.slice(1);

  const proc = spawn(bin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  if (!proc.stdin || !proc.stdout) {
    throw new Error(`Failed to spawn: ${command}`);
  }

  let idCounter = 0;
  const pending = new Map<number | string, Pending>();
  let initialized = false;
  let onNote: ((method: string, params: any) => void) | null = null;

  // State machine for parsing JSON-RPC responses
  let buffer = "";
  let state: "header" | "body" = "header";
  let contentLength = 0;

  proc.stdout.setEncoding("utf-8");
  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;

    while (true) {
      if (state === "header") {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const headerBlock = buffer.slice(0, headerEnd);
        buffer = buffer.slice(headerEnd + 4);

        const lines = headerBlock.split("\r\n");
        for (const line of lines) {
          if (line.startsWith("Content-Length:")) {
            contentLength = parseInt(line.split(":")[1].trim(), 10);
          }
        }

        if (contentLength > 0) {
          state = "body";
        }
      }

      if (state === "body") {
        if (buffer.length < contentLength) return;

        const json = buffer.slice(0, contentLength);
        buffer = buffer.slice(contentLength);

        try {
          handleMessage(JSON.parse(json));
        } catch {
          // ignore parse errors
        }

        contentLength = 0;
        state = "header";
      }
    }
  });

  function writeMessage(msg: any): void {
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    proc.stdin!.write(header + json);
  }

  function handleMessage(msg: any): void {
    if (msg.id !== undefined && msg.method === undefined) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message));
        } else {
          p.resolve(msg.result);
        }
      }
    } else if (msg.method !== undefined && msg.id === undefined) {
      if (onNote) onNote(msg.method, msg.params);
    } else if (msg.method !== undefined && msg.id !== undefined) {
      writeMessage({
        jsonrpc: "2.0",
        id: msg.id,
        result: null,
      });
    }
  }

  const transport: LspTransport = {
    async send(method: string, params?: any): Promise<any> {
      const id = ++idCounter;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        writeMessage({ jsonrpc: "2.0", id, method, params });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`Timeout: ${method}`));
          }
        }, timeout);
      });
    },

    sendNotification(method: string, params?: any): void {
      writeMessage({ jsonrpc: "2.0", method, params });
    },

    kill(): void {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }, 3000);
    },

    get onNotification() {
      return onNote;
    },
    set onNotification(fn) {
      onNote = fn;
    },
  };

  return new Promise((resolve, reject) => {
    const timeoutTimer = setTimeout(() => {
      reject(new Error(`LSP server initialize timeout: ${command}`));
    }, timeout);

    const cleanup = () => clearTimeout(timeoutTimer);

    proc.on("error", (err) => {
      cleanup();
      reject(new Error(`Failed to start ${command}: ${err.message}`));
    });

    proc.on("exit", (code) => {
      if (!initialized) {
        cleanup();
        reject(new Error(`${command} exited with code ${code}`));
      }
    });

    proc.stderr?.on("data", () => {});

    writeMessage({
      jsonrpc: "2.0",
      id: ++idCounter,
      method: "initialize",
      params: {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ["plaintext", "markdown"] },
            definition: { linkSupport: true },
            references: {},
            documentSymbol: {},
            formatting: {},
          },
        },
      },
    });

    pending.set(idCounter, {
      resolve: (result: any) => {
        cleanup();
        initialized = true;
        transport.sendNotification("initialized", {});
        transport.sendNotification("textDocument/didChangeConfiguration", {
          settings: {},
        });
        resolve(transport);
      },
      reject: (err) => {
        cleanup();
        reject(err);
      },
    });
  });
}

export async function ensureFileOpen(
  transport: LspTransport,
  filePath: string,
  rootUri: string
): Promise<void> {
  const uri = toUri(filePath, rootUri);
  const { readFileSync } = await import("node:fs");
  const content = readFileSync(filePath, "utf-8");
  transport.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: languageId(filePath),
      version: 1,
      text: content,
    },
  });
}

export function closeFile(
  transport: LspTransport,
  filePath: string,
  rootUri: string
): void {
  const uri = toUri(filePath, rootUri);
  transport.sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });
}

export function toUri(filePath: string, rootUri: string): string {
  const root = rootUri.replace("file://", "");
  const abs = filePath.startsWith("/") ? filePath : root + "/" + filePath;
  return "file://" + abs;
}

function languageId(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".html": "html",
    ".md": "markdown",
  };
  return map[ext] ?? ext.slice(1);
}
