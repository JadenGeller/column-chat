import type {
  WindowMode,
  ColumnView,
  ColumnStorage,
  StorageProvider,
  SourceColumn,
  DerivedColumn,
  ComputeFunction,
} from "./types.js";
import { SELF_MARKER } from "./types.js";

export function inMemoryStorage(
  store: Record<string, string>[] = []
): StorageProvider {
  return (name: string): ColumnStorage => {
    function computeLength(): number {
      let n = 0;
      while (n < store.length && store[n]?.[name] !== undefined) {
        n++;
      }
      return n;
    }

    let cachedLength: number | null = null;

    return {
      get(step: number): string | undefined {
        return store[step]?.[name];
      },
      push(value: string): void {
        const step = cachedLength ?? computeLength();
        while (store.length <= step) {
          store.push({});
        }
        store[step][name] = value;
        cachedLength = step + 1;
      },
      get length(): number {
        if (cachedLength === null) {
          cachedLength = computeLength();
        }
        return cachedLength;
      },
    };
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
  options?: { storage?: StorageProvider }
): SourceColumn {
  const storage = (options?.storage ?? inMemoryStorage())(name);
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
  options: { context: ColumnView[]; compute: ComputeFunction; storage?: StorageProvider }
): DerivedColumn {
  const storage = (options.storage ?? inMemoryStorage())(name);
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
