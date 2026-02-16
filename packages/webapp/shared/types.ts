export interface ColumnContextRef {
  column: string; // "input", "self", or another column's name
  row: "current" | "previous";
  count: "single" | "all";
}

export interface ColumnConfig {
  name: string;
  systemPrompt: string;
  reminder: string;
  color: string;
  context: ColumnContextRef[];
}

export type SessionConfig = ColumnConfig[];

export interface Capabilities {
  mode: "cloud" | "local";
}
