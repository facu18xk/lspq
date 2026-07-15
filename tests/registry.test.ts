import { describe, it, expect } from "vitest";
import { getServerCommand, getTimeout, listServers } from "../src/registry.js";

describe("registry — built-in server mapping", () => {
  it("maps .ts to typescript-language-server", () => {
    expect(getServerCommand("src/app.ts")).toBe(
      "typescript-language-server --stdio"
    );
  });

  it("maps .tsx to typescript-language-server", () => {
    expect(getServerCommand("Component.tsx")).toBe(
      "typescript-language-server --stdio"
    );
  });

  it("maps .js to typescript-language-server", () => {
    expect(getServerCommand("script.js")).toBe(
      "typescript-language-server --stdio"
    );
  });

  it("maps .css to vscode-css-language-server", () => {
    expect(getServerCommand("styles.css")).toBe(
      "vscode-css-language-server --stdio"
    );
  });

  it("maps .scss to vscode-css-language-server", () => {
    expect(getServerCommand("theme.scss")).toBe(
      "vscode-css-language-server --stdio"
    );
  });

  it("maps .py to pyright-langserver", () => {
    expect(getServerCommand("script.py")).toBe(
      "pyright-langserver --stdio"
    );
  });

  it("maps .rs to rust-analyzer", () => {
    expect(getServerCommand("main.rs")).toBe("rust-analyzer");
  });

  it("maps .go to gopls", () => {
    expect(getServerCommand("main.go")).toBe("gopls");
  });

  it("maps .html to vscode-html-language-server", () => {
    expect(getServerCommand("index.html")).toBe(
      "vscode-html-language-server --stdio"
    );
  });

  it("maps .json to vscode-json-language-server", () => {
    expect(getServerCommand("data.json")).toBe(
      "vscode-json-language-server --stdio"
    );
  });

  it("maps .md to marksman", () => {
    expect(getServerCommand("README.md")).toBe("marksman");
  });

  it("returns null for unknown extension", () => {
    expect(getServerCommand("file.xyz")).toBeNull();
    expect(getServerCommand("Makefile")).toBeNull();
  });

  it("returns default timeout", () => {
    expect(getTimeout()).toBe(15000);
  });

  it("lists builtin servers", () => {
    const servers = listServers();
    expect(servers[".ts"]).toBe("typescript-language-server --stdio");
    expect(servers[".tsx"]).toBe("typescript-language-server --stdio");
  });
});
