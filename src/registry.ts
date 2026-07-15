import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "./types.js";

const HOME = homedir();

const BUILTIN: Record<string, string> = {
  ".ts": "typescript-language-server --stdio",
  ".tsx": "typescript-language-server --stdio",
  ".js": "typescript-language-server --stdio",
  ".jsx": "typescript-language-server --stdio",
  ".mjs": "typescript-language-server --stdio",
  ".cjs": "typescript-language-server --stdio",
  ".mts": "typescript-language-server --stdio",
  ".cts": "typescript-language-server --stdio",
  ".css": "vscode-css-language-server --stdio",
  ".scss": "vscode-css-language-server --stdio",
  ".json": "vscode-json-language-server --stdio",
  ".py": "pyright-langserver --stdio",
  ".pyi": "pyright-langserver --stdio",
  ".rs": "rust-analyzer",
  ".go": "gopls",
  ".html": "vscode-html-language-server --stdio",
  ".md": "marksman",
};

function loadConfig(projectRoot?: string): ServerConfig {
  const globalPath = join(HOME, ".config", "lspq", "config.json");
  const localPath = projectRoot ? join(projectRoot, "lspq.json") : null;

  let global: ServerConfig = { servers: {}, timeout: 15000 };
  let local: ServerConfig | null = null;

  if (existsSync(globalPath)) {
    try {
      global = JSON.parse(readFileSync(globalPath, "utf-8"));
    } catch {
      // ignore malformed config
    }
  }

  if (localPath && existsSync(localPath)) {
    try {
      local = JSON.parse(readFileSync(localPath, "utf-8"));
    } catch {
      // ignore malformed config
    }
  }

  return {
    servers: { ...BUILTIN, ...global.servers, ...(local?.servers ?? {}) },
    timeout: local?.timeout ?? global.timeout ?? 15000,
  };
}

export function getServerCommand(
  filePath: string,
  projectRoot?: string
): string | null {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  const config = loadConfig(projectRoot);
  return config.servers[ext] ?? null;
}

export function getTimeout(projectRoot?: string): number {
  return loadConfig(projectRoot).timeout;
}

export function listServers(projectRoot?: string): Record<string, string> {
  return loadConfig(projectRoot).servers;
}
