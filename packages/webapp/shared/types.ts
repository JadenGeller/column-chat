export interface ColumnContextRef {
  column: string; // "user", "self", or another column's name
  windowMode: "all" | "latest" | { window: number };
}

export interface ColumnConfig {
  name: string;
  systemPrompt: string;
  footerText: string;
  color: string;
  context: ColumnContextRef[];
}

export type SessionConfig = ColumnConfig[];
