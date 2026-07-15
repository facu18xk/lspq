export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface Diagnostic {
  range: Range;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface DocumentSymbol {
  name: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface Hover {
  contents: MarkupContent | MarkedString | (MarkupContent | MarkedString)[];
  range?: Range;
}

export interface MarkupContent {
  kind: string;
  value: string;
}

export type MarkedString = string | { language: string; value: string };

export interface ServerInfo {
  ext: string;
  command: string;
  pid: number | null;
  status: "starting" | "ready" | "error";
  lastUsed: number;
}

export interface QueryRequest {
  command: "definition" | "references" | "hover" | "diagnostics" | "symbols" | "format";
  file: string;
  line: number;
  col: number;
  root: string;
}

export interface QueryResponse {
  result?: QueryResult;
  error?: QueryError;
}

export interface QueryResult {
  locations?: Array<{ file: string; line: number; col: number }>;
  hover?: { contents: string; range?: Range };
  diagnostics?: Array<{ line: number; col: number; message: string; severity: string; source?: string }>;
  symbols?: Array<{ name: string; kind: string; line: number; col: number; children?: any[] }>;
  formatted?: string;
}

export interface QueryError {
  code: string;
  message: string;
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface DaemonConfig {
  socketPath: string;
  pidPath: string;
  idleTimeout: number;
  dataDir: string;
}

export interface ServerConfig {
  servers: Record<string, string>;
  timeout: number;
}
