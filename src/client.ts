import { createConnection, type Socket } from "node:net";
import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryRequest, QueryResponse } from "./types.js";

const HOME = homedir();
const DATA_DIR = join(HOME, ".lspq");
const SOCKET_PATH = join(DATA_DIR, "daemon.sock");

function resolveDaemonPath(): string {
  const clientUrl = import.meta.url;
  const clientDir = clientUrl.slice(0, clientUrl.lastIndexOf("/"));
  return fileURLToPath(clientDir + "/daemon.ts");
}

function resolveTsx(): string {
  return fileURLToPath(
    import.meta.url.slice(0, import.meta.url.lastIndexOf("/src/")) + "/node_modules/.bin/tsx"
  );
}

function spawnDaemon(action: string): ReturnType<typeof spawn> {
  return spawn(resolveTsx(), [resolveDaemonPath(), action], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    detached: true,
  });
}

export function query(
  command: QueryRequest["command"],
  file: string,
  line: number,
  col: number,
  root: string
): Promise<QueryResponse> {
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket: Socket = createConnection(SOCKET_PATH, () => {
        const req: QueryRequest = { command, file, line, col, root };
        socket.write(JSON.stringify(req));
      });

      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString("utf-8");
        try {
          const res: QueryResponse = JSON.parse(data);
          socket.destroy();
          resolve(res);
        } catch {
          // more data coming
        }
      });

      socket.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
          startDaemon()
            .then(() => {
              setTimeout(() => tryConnect(), 500);
            })
            .catch(reject);
        } else {
          reject(err);
        }
      });

      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
          reject(new Error("Connection timeout"));
        }
      }, 5000);
    };

    tryConnect();
  });
}

export function daemonAction(
  action: "start" | "stop" | "status"
): Promise<string> {
  if (action === "stop" || action === "status") {
    return new Promise((resolve, reject) => {
      const proc = spawn(resolveTsx(), [resolveDaemonPath(), action], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let output = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf-8");
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          resolve(output.trim() || JSON.stringify({ status: "stopped" }));
        }
      });

      proc.on("error", (err) => {
        if (action === "stop") {
          resolve(JSON.stringify({ status: "stopped" }));
        } else {
          reject(err);
        }
      });

      setTimeout(() => resolve(output.trim()), 10000);
    });
  }

  return new Promise((resolve, reject) => {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    const proc = spawnDaemon(action);

    let output = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
      try {
        JSON.parse(output.trim());
        resolve(output.trim());
      } catch {
        // wait for full JSON
      }
    });

    proc.on("error", reject);
    proc.unref();

    setTimeout(() => {
      if (!proc.killed) resolve(output.trim());
    }, 10000);
  });
}

function startDaemon(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    const proc = spawnDaemon("start");

    let output = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
      try {
        JSON.parse(output.trim());
        resolve();
      } catch {
        // wait for full JSON
      }
    });

    proc.on("error", reject);
    proc.unref();

    setTimeout(() => {
      if (!proc.killed) resolve();
    }, 10000);
  });
}
