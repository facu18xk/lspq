import { stdin, stdout } from "node:process";

let buffer = "";

function writeMessage(msg: any): void {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  stdout.write(header + json);
}

function handleMessage(msg: any): void {
  if (msg.method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          documentSymbolProvider: true,
          documentFormattingProvider: true,
        },
      },
    });
  } else if (msg.method === "initialized") {
    // no response
  } else if (msg.method === "textDocument/didOpen") {
    const uri = msg.params?.textDocument?.uri ?? "";
    setTimeout(() => {
      writeMessage({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri,
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              severity: 1,
              message: "Mock error: unused variable",
              source: "mock-lsp",
            },
          ],
        },
      });
    }, 100);
  } else if (msg.method === "textDocument/definition") {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: [{
        uri: "file:///mock/other-file.ts",
        range: {
          start: { line: 5, character: 4 },
          end: { line: 5, character: 12 },
        },
      }],
    });
  } else if (msg.method === "textDocument/references") {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: [
        {
          uri: "file:///mock/a.ts",
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 6 },
          },
        },
        {
          uri: "file:///mock/b.ts",
          range: {
            start: { line: 3, character: 0 },
            end: { line: 3, character: 4 },
          },
        },
      ],
    });
  } else if (msg.method === "textDocument/hover") {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        contents: {
          kind: "markdown",
          value: "```typescript\nfunction greet(name: string): string\n```",
        },
      },
    });
  } else if (msg.method === "textDocument/documentSymbol") {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: [
        {
          name: "MyClass",
          kind: 5,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 10, character: 1 },
          },
          selectionRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 7 },
          },
          children: [
            {
              name: "methodA",
              kind: 6,
              range: {
                start: { line: 2, character: 2 },
                end: { line: 4, character: 3 },
              },
              selectionRange: {
                start: { line: 2, character: 2 },
                end: { line: 2, character: 9 },
              },
            },
          ],
        },
        {
          name: "topFunction",
          kind: 12,
          range: {
            start: { line: 12, character: 0 },
            end: { line: 14, character: 1 },
          },
          selectionRange: {
            start: { line: 12, character: 0 },
            end: { line: 12, character: 11 },
          },
        },
      ],
    });
  } else if (msg.method === "textDocument/formatting") {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: "formatted content here\n",
        },
      ],
    });
  } else if (msg.id !== undefined && msg.method) {
    // Unknown method — don't respond (simulates LSP server that doesn't support it)
    // This causes a timeout on the client side
  }
}

// State machine for parsing JSON-RPC over stdio
// States: "header" → reading Content-Length / Content-Type headers
//         "body"   → reading exactly contentLength bytes of JSON body
let state: "header" | "body" = "header";
let contentLength = 0;

stdin.setEncoding("utf-8");

stdin.on("data", (chunk: string) => {
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
      } else {
        state = "header";
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
