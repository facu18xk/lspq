import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { startServer, toUri, type LspTransport } from "../src/transport.js";

const TSX_BIN = fileURLToPath(import.meta.resolve("../node_modules/.bin/tsx"));
const MOCK_LSP_PATH = fileURLToPath(
  import.meta.resolve("./fixtures/mock-lsp.ts")
);

function startMockServer(timeout = 3000): Promise<LspTransport> {
  return startServer(
    `${TSX_BIN} ${MOCK_LSP_PATH}`,
    "file:///mock",
    timeout
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("transport — JSON-RPC framing", () => {
  it("starts an LSP server and completes init handshake", async () => {
    const t = await startMockServer(5000);
    expect(t).toBeDefined();
    t.kill();
  });

  it("rejects if server process fails to start", async () => {
    await expect(
      startServer("nonexistent-binary-xyz --stdio", "file:///mock", 3000)
    ).rejects.toThrow();
  });

  it("rejects on init timeout", async () => {
    // Use a very short timeout on a real command that won't respond as LSP
    await expect(
      startServer("sleep 10", "file:///mock", 500)
    ).rejects.toThrow(/timeout/i);
  }, 10000);
});

describe("transport — LSP queries", () => {
  let transport: LspTransport;

  beforeAll(async () => {
    transport = await startMockServer(10000);
  });

  afterAll(() => {
    transport.kill();
  });

  it("returns definition location", async () => {
    const result = await transport.send("textDocument/definition", {
      textDocument: { uri: "file:///mock/test.ts" },
      position: { line: 0, character: 0 },
    });
    expect(result).toHaveLength(1);
    expect(result[0].uri).toContain("other-file.ts");
  });

  it("returns references", async () => {
    const result = await transport.send("textDocument/references", {
      textDocument: { uri: "file:///mock/test.ts" },
      position: { line: 0, character: 0 },
      context: { includeDeclaration: false },
    });
    expect(result).toHaveLength(2);
  });

  it("returns hover info", async () => {
    const result = await transport.send("textDocument/hover", {
      textDocument: { uri: "file:///mock/test.ts" },
      position: { line: 0, character: 0 },
    });
    expect(result.contents.value).toContain("greet");
  });

  it("returns document symbols", async () => {
    const result = await transport.send("textDocument/documentSymbol", {
      textDocument: { uri: "file:///mock/test.ts" },
    });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("MyClass");
    expect(result[1].name).toBe("topFunction");
  });

  it("returns formatting edits", async () => {
    const result = await transport.send("textDocument/formatting", {
      textDocument: { uri: "file:///mock/test.ts" },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(result[0].newText).toBeDefined();
  });

  it("rejects on unknown method with timeout", async () => {
    await expect(
      transport.send("textDocument/unknownMethod", {})
    ).rejects.toThrow(/timeout/i);
  });
});

describe("transport — notifications", () => {
  it("captures publishDiagnostics notification", async () => {
    const transport = await startMockServer(10000);
    let diags: any = null;

    transport.onNotification = (method, params) => {
      if (method === "textDocument/publishDiagnostics") {
        diags = params;
      }
    };

    transport.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: "file:///mock/test.ts",
        languageId: "typescript",
        version: 1,
        text: "let x = 1",
      },
    });

    await wait(300);
    expect(diags).not.toBeNull();
    expect(diags.uri).toContain("test.ts");
    expect(diags.diagnostics).toHaveLength(1);
    expect(diags.diagnostics[0].message).toContain("unused variable");

    transport.kill();
  });
});

describe("transport — toUri", () => {
  it("converts relative path with rootUri", () => {
    const uri = toUri("src/app/page.tsx", "file:///home/user/project");
    expect(uri).toBe("file:///home/user/project/src/app/page.tsx");
  });

  it("converts absolute path", () => {
    const uri = toUri("/absolute/path/file.ts", "file:///home/user/project");
    expect(uri).toBe("file:///absolute/path/file.ts");
  });
});
