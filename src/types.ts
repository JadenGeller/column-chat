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
}) => string | Promise<string>;

// Events yielded by run()
export type FlowEvent = {
  column: string;
  step: number;
  value: string;
};

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
  push(value: string): void;
}

export interface DerivedColumn extends ColumnView {
  readonly kind: "derived";
  readonly context: ColumnView[];
  readonly compute: ComputeFunction;
}

export type Column = SourceColumn | DerivedColumn;

// Internal resolved view used by context.ts
export interface ResolvedView {
  column: Column;
  windowMode: WindowMode;
  name: string;
  isSelf: boolean;
}
