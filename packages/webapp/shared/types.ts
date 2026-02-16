export interface ColumnContextRef {
  column: string; // "input", "self", or another column's name
  windowMode: "all" | "latest" | { window: number };
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
