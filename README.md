# lspq

**LSP-powered code intelligence from your terminal.**

Ask your LSP servers questions directly — go to definition, find references, show types, get diagnostics — from bash. Works with any editor or AI coding agent (`lspq` is just a CLI).

## Install

```bash
npm install -g lspq
```

You also need LSP servers for the languages you use:

```bash
npm install -g typescript-language-server typescript
npm install -g vscode-css-language-server
npm install -g vscode-json-language-server
# etc.
```

## Quick start

```bash
# Start the background daemon (auto-started on first query if not running)
lspq daemon start

# Jump to definition
lspq def src/app/page.tsx:42:10

# Find all references
lspq ref src/app/page.tsx:42:10

# Show type info
lspq hover src/app/page.tsx:42:10

# Show diagnostics (errors, warnings)
lspq diag src/app/page.tsx

# Show document outline
lspq symbols src/app/page.tsx

# Format code
lspq fmt src/app/page.tsx
```

## Commands

| Command | Alias | Description |
|---|---|---|
| `lspq daemon start` | — | Start the background daemon |
| `lspq daemon stop` | — | Stop the daemon |
| `lspq daemon status` | — | Show running LSP servers |
| `lspq def <file>:<line>:<col>` | `definition` | Go to definition |
| `lspq ref <file>:<line>:<col>` | `references` | Find all references |
| `lspq hover <file>:<line>:<col>` | — | Show type info and documentation |
| `lspq diag <file>` | `diagnostics` | Show errors and warnings |
| `lspq symbols <file>` | — | Show document outline |
| `lspq fmt <file>` | `format` | Format code (stdout) |

All query commands support `--json` for machine-readable output and `--root <dir>` to specify the project root.

## Supported languages (built-in)

| Extension | LSP server |
|---|---|
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | `typescript-language-server --stdio` |
| `.css`, `.scss` | `vscode-css-language-server --stdio` |
| `.json` | `vscode-json-language-server --stdio` |
| `.py`, `.pyi` | `pyright-langserver --stdio` |
| `.rs` | `rust-analyzer` |
| `.go` | `gopls` |
| `.html` | `vscode-html-language-server --stdio` |
| `.md` | `marksman` |

## Configuration

Override server commands or add new languages:

**`~/.config/lspq/config.json`** (user-level):
```json
{
  "servers": {
    ".tsx": "typescript-language-server --stdio --tsserver-path /custom/tsserver"
  },
  "timeout": 20000
}
```

**`lspq.json`** (project-level, merges with global):
```json
{
  "servers": {
    ".vue": "vue-language-server --stdio"
  }
}
```

## AI agent integration

lspq works with any agent that can run terminal commands. It gives agents **AST-aware code navigation** instead of blind regex search.

### OpenCode

1. Install lspq globally, then enable LSP in your project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": true
}
```

2. Add this to your project's `AGENTS.md`:

```markdown
## Code Intelligence

Use `lspq` (LSP-powered CLI) over raw grep/glob for structural code queries:

| Task | Command |
|---|---|
| Jump to definition | `lspq def <file>:<line>:<col>` |
| Find all references | `lspq ref <file>:<line>:<col>` |
| Show type/docs | `lspq hover <file>:<line>:<col>` |
| Show diagnostics | `lspq diag <file>` |
| Document outline | `lspq symbols <file>` |

**Fallback priority:**
1. `lspq` (AST-aware, structural)
2. `tsc --noEmit` (TypeScript errors only)
3. `grep` / `glob` (ripgrep, raw text) — only when lspq can't help (string literals, comments, non-code files)
```

That's it. OpenCode's built-in LSP handles diagnostics in-editor; `lspq` fills the gap for go-to-def, find-refs, and hover from the terminal.

### Codex (OpenAI)

Codex has no native LSP support, but can invoke `lspq` via bash. Add to your AGENTS.md or `.codex/config.yaml`:

```yaml
instructions: |
  ## Code Intelligence
  Prefer lspq for structural code queries:
  - lspq def <file>:<line>:<col> — go to definition
  - lspq ref <file>:<line>:<col> — find references
  - lspq hover <file>:<line>:<col> — type info + docs
  - lspq diag <file> — errors and warnings
  - lspq symbols <file> — document outline
  Fallback to rg/grep for string literals and comments.
```

### Claude Code

lspq works with Claude Code out of the box. Add to `CLAUDE.md`:

```markdown
## Code Intelligence
Prefer `lspq` over raw grep:
- `lspq def <file>:<line>:<col>` — jump to definition
- `lspq ref <file>:<line>:<col>` — find all usages
- `lspq hover <file>:<line>:<col>` — type/docs
- `lspq diag <file>` — diagnostics
- `lspq symbols <file>` — outline
Fallback: `rg` for text that lspq can't search (comments, strings).
```

### Cursor / Windsurf / any agent

Same pattern — add the lspq commands to your project's rules or instructions file. Since lspq is just a CLI tool, any agent that can run `bash` can use it. No plugins, no MCP servers, no extra config.

## How it works

lspq runs a persistent daemon process (`lspq daemon start`) that manages LSP server processes. When you run a query, a lightweight client connects to the daemon via a Unix socket, sends the query, and prints the result.

```
lspq def file.ts:42:10  ──►  daemon  ──►  typescript-language-server
                              (socket)      (JSON-RPC over stdio)
```

See [docs/architecture.md](docs/architecture.md) for details.

## Requirements

- Node.js >= 18
- LSP servers for the languages you use (install separately)
- Unix-like OS (macOS, Linux). Windows support via WSL.

## License

MIT
