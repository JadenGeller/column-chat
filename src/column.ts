import type {
  WindowMode,
  ColumnView,
  ColumnStorage,
  SourceColumn,
  DerivedColumn,
  ComputeFunction,
} from "./types.js";
import { SELF_MARKER } from "./types.js";

export function createInMemoryStorage(): ColumnStorage {
  const values: string[] = [];
  return {
    get(step: number): string | undefined {
      return step < values.length ? values[step] : undefined;
    },
    push(value: string): void {
      values.push(value);
    },
    get length(): number {
      return values.length;
    },
  };
}

// Create a view object with chaining methods
function createView(
  column: ColumnView["_column"],
  windowMode: WindowMode,
  name: string
): ColumnView {
  return {
    _column: column,
    _windowMode: windowMode,
    _name: name,
    get latest(): ColumnView {
      return createView(column, { kind: "latest" }, name);
    },
    window(n: number): ColumnView {
      return createView(column, { kind: "window", n }, name);
    },
    as(newName: string): ColumnView {
      return createView(column, windowMode, newName);
    },
  };
}

export function source(
  name: string,
  options?: { storage?: ColumnStorage }
): SourceColumn {
  const storage = options?.storage ?? createInMemoryStorage();
  const col = {
    ...createView(null as any, { kind: "all" }, name),
    kind: "source" as const,
    storage,
    push(value: string): void {
      storage.push(value);
    },
  } as SourceColumn;

  // Fix self-reference: _column points to itself
  (col as any)._column = col;

  // Fix view methods to reference the correct column
  Object.defineProperty(col, "latest", {
    get(): ColumnView {
      return createView(col, { kind: "latest" }, name);
    },
  });
  col.window = (n: number) => createView(col, { kind: "window", n }, name);
  col.as = (newName: string) => createView(col, { kind: "all" }, newName);

  return col;
}

export function column(
  name: string,
  options: { context: ColumnView[]; compute: ComputeFunction; storage?: ColumnStorage }
): DerivedColumn {
  const storage = options.storage ?? createInMemoryStorage();
  const col = {
    ...createView(null as any, { kind: "all" }, name),
    kind: "derived" as const,
    storage,
    context: options.context,
    compute: options.compute,
  } as DerivedColumn;

  // Fix self-reference
  (col as any)._column = col;

  Object.defineProperty(col, "latest", {
    get(): ColumnView {
      return createView(col, { kind: "latest" }, name);
    },
  });
  col.window = (n: number) => createView(col, { kind: "window", n }, name);
  col.as = (newName: string) => createView(col, { kind: "all" }, newName);

  return col;
}

// The `self` sentinel — a column view whose _column is SELF_MARKER
export const self: ColumnView = createView(SELF_MARKER, { kind: "all" }, "self");

// Helper to check if a view references self
export function isSelfView(view: ColumnView): boolean {
  return view._column === SELF_MARKER;
}
