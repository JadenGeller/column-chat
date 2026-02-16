// Window modes for column views
export type WindowMode =
  | { kind: "all" }
  | { kind: "latest" }
  | { kind: "window"; n: number };

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
  readonly length: number;
}

// A factory that returns a ColumnStorage for a given column name
export type StorageProvider = (name: string) => ColumnStorage;

// Events yielded by run()
export type FlowEvent =
  | { kind: "delta"; column: string; step: number; delta: string }
  | { kind: "value"; column: string; step: number; value: string };

// Internal sentinel for self-reference
export const SELF_MARKER = Symbol("self");

// A view on a column: windowing + optional name override
// Public API: .latest, .window(n), .as(name)
export interface ColumnView {
  readonly _column: SourceColumn | DerivedColumn | typeof SELF_MARKER;
  readonly _windowMode: WindowMode;
  readonly _name: string;
  readonly latest: ColumnView;
  window(n: number): ColumnView;
  as(name: string): ColumnView;
}

export interface SourceColumn extends ColumnView {
  readonly kind: "source";
  readonly storage: ColumnStorage;
  push(value: string): void;
}

// Transform function: modify resolved inputs before assembly
export type TransformFunction = (inputs: ContextInput[], step: number) => ContextInput[];

export interface DerivedColumn extends ColumnView {
  readonly kind: "derived";
  readonly storage: ColumnStorage;
  readonly context: ColumnView[];
  readonly compute: ComputeFunction;
  readonly transform?: TransformFunction;
}

export type Column = SourceColumn | DerivedColumn;

// Plain-data types for the public assembleMessages API
export type ContextEntry = { step: number; value: string };
export type ContextInput = {
  role: "user" | "assistant";
  entries: ContextEntry[];
};
