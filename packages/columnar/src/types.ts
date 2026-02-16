// AI SDK compatible message
export type Message = {
  role: "user" | "assistant";
  content: string;
};

// Compute function signature
export type ComputeFunction = (args: {
  messages: Message[];
}) => string | Promise<string> | AsyncIterable<string>;

// Pluggable storage for column values
export interface ColumnStorage {
  get(step: number): string | undefined;
  push(value: string): void;
  clear(): void;
  readonly length: number;
}

// A factory that returns a ColumnStorage for a given column name
export type StorageProvider = (name: string) => ColumnStorage;

// Events yielded by run()
export type FlowEvent =
  | { kind: "start"; column: string; step: number }
  | { kind: "delta"; column: string; step: number; delta: string }
  | { kind: "value"; column: string; step: number; value: string };

// Internal sentinel for self-reference
export const SELF_MARKER = Symbol("self");

export interface SourceColumn {
  readonly kind: "source";
  readonly name: string;
  readonly storage: ColumnStorage;
  push(value: string): void;
}

// A dependency declaration: { column, row, count }
export type Dependency = {
  column: SourceColumn | DerivedColumn | typeof SELF_MARKER;
  row: "current" | "previous";
  count: "single" | "all";
};

// Plain-data types for the public assembleMessages API
export type ContextEntry = { step: number; value: string };
export type ContextInput = {
  role: "user" | "assistant";
  entries: ContextEntry[];
};

// Transform function: modify resolved inputs before assembly
export type TransformFunction = (inputs: ContextInput[], step: number) => ContextInput[];

export interface DerivedColumn {
  readonly kind: "derived";
  readonly name: string;
  readonly storage: ColumnStorage;
  readonly context: Dependency[];
  readonly compute: ComputeFunction;
  readonly transform?: TransformFunction;
}

export type Column = SourceColumn | DerivedColumn;
