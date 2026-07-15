# lspq architecture

lspq is a CLI tool that bridges Language Server Protocol (LSP) servers to the terminal. It consists of two processes: a persistent daemon and short-lived CLI clients.

## Overview

```
┌──────────────────────────────────────────────────────┐
│  lspq daemon (persistent background process)          │
│                                                       │
│  Unix socket: ~/.lspq/daemon.sock                     │
│  PID file:    ~/.lspq/daemon.pid                      │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Server Pool                                       │ │
│  │                                                   │ │
│  │  .tsx  → typescript-language-server --stdio       │ │
│  │  .css  → vscode-css-language-server --stdio       │ │
│  │  .py   → pyright-langserver --stdio               │ │
│  │                                                   │ │
│  │  Each: { process, transport, status, lastUsed }   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  Idle servers shut down after 5 minutes of inactivity  │
└──────────────────────────────────────────────────────┘
        ▲                    ▲
        │ Unix socket        │
   ┌────┴────┐         ┌────┴────┐
   │ Client  │         │ Client  │
   │ def ... │         │ ref ... │
   └─────────┘         └─────────┘
```

## Processes

### Daemon (`src/daemon.ts`)

A persistent Node.js process that:
- Listens on a Unix socket at `~/.lspq/daemon.sock`
- Manages a pool of LSP server processes (one per language + project root combination)
- Lazily spawns LSP servers on first query
- Serializes concurrent queries to the same server (one at a time)
- Cleans up idle servers after 5 minutes

Start via `lspq daemon start` or automatically on first query.

### Client (`src/client.ts`)

A short-lived process that:
- Connects to the daemon socket
- Sends a single JSON query
- Reads the JSON response
- Prints the result and exits

If the daemon isn't running, the client auto-starts it before retrying.

## Protocol

### Client → Daemon

```json
{
  "command": "definition",
  "file": "src/app/page.tsx",
  "line": 42,
  "col": 10,
  "root": "/home/user/project"
}
```

Valid commands: `definition`, `references`, `hover`, `diagnostics`, `symbols`, `formatting`.

### Daemon → Client

Success:
```json
{
  "result": {
    "locations": [
      { "file": "src/lib/utils.ts", "line": 15, "col": 8 }
    ]
  }
}
```

Error:
```json
{
  "error": {
    "code": "NO_SERVER",
    "message": "No LSP server found for: unknown.xyz"
  }
}
```

## LSP communication

### JSON-RPC 2.0 over stdio (`src/transport.ts`)

Each LSP process communicates via standard JSON-RPC 2.0 framed with HTTP-like headers:

```
Content-Length: 123\r\n
Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"textDocument/definition","params":{...}}
```

### Server initialization flow

1. Spawn process (e.g., `typescript-language-server --stdio`)
2. Send `initialize` request with capabilities declaration
3. Receive `initialize` response with server capabilities
4. Send `initialized` notification
5. Send `workspace/didChangeConfiguration` notification
6. Server is now ready for queries

### Per-query flow

1. Send `textDocument/didOpen` with file content
2. Send the query request (definition, references, hover, etc.)
3. Receive the response
4. Send `textDocument/didClose`

This ensures every query uses the latest file content from disk.

### Diagnostics (special case)

The LSP server pushes diagnostics asynchronously via `textDocument/publishDiagnostics` notifications. For the diagnostics command:
1. Send `didOpen`
2. Listen for `publishDiagnostics` notifications for 800ms
3. Collect all diagnostics received
4. Return them
5. Send `didClose`

## Request serialization

Multiple clients can query the same LSP server concurrently. The daemon serializes requests per server entry — one query at a time, with subsequent queries queued until the current one completes.

## Error handling

| Scenario | Behavior |
|---|---|
| LSP server not installed | Daemon returns `SERVER_START_FAILED` with install hint |
| LSP server crashes mid-query | Daemon removes the entry, returns `SERVER_START_FAILED`. Next query re-spawns. |
| Query timeout (15s default) | `LSP_ERROR: Timeout: textDocument/definition` |
| Daemon socket not found | Client auto-starts daemon, retries |
| Malformed client request | Daemon closes socket after 30s timeout |

## Configuration

### Server registry

Built-in mappings for 14 languages. Overridable via:

- `~/.config/lspq/config.json` — user-level overrides
- `./lspq.json` — project-level overrides (merges with global)

```json
{
  "servers": {
    ".tsx": "typescript-language-server --stdio --tsserver-path /custom/tsserver",
    ".custom": "my-custom-lsp --stdio"
  },
  "timeout": 20000
}
```

### Adding a new language

Add the extension → command mapping to your config. The server must support stdio-based LSP communication.

## File structure

```
lspq/
├── bin/lspq.ts            # CLI entry point
├── src/
│   ├── types.ts           # Shared type definitions
│   ├── transport.ts       # JSON-RPC transport layer
│   ├── registry.ts        # File extension → LSP command map
│   ├── daemon.ts          # Background daemon process
│   ├── client.ts          # Socket client + daemon lifecycle
│   └── commands/
│       └── index.ts       # Command implementations
├── docs/
│   └── architecture.md    # This file
├── README.md
├── LICENSE
├── package.json
└── tsconfig.json
```

## Design decisions

**Zero dependencies** — LSP protocol framing, Unix sockets, arg parsing, and JSON handling are all implemented using only Node.js built-in modules. This keeps the package lightweight and avoids dependency churn.

**Daemon-based architecture** — Spawning an LSP server and waiting for initialization takes 1-3 seconds. By keeping servers alive in a daemon, subsequent queries on the same language + project complete in milliseconds.

**Unix socket IPC** — Faster than TCP, no port conflicts, and automatically cleaned up when the daemon exits. The socket path is tied to the user's home directory.

**Fresh file content per query** — Instead of tracking file changes via `didChange` notifications (complex and error-prone), each query reads the file from disk and sends a fresh `didOpen`. This is slightly wasteful for the LSP (re-parses the file) but guarantees correctness.
