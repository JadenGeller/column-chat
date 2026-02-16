import type {
  ColumnStorage,
  StorageProvider,
  SourceColumn,
  DerivedColumn,
  Dependency,
  ComputeFunction,
  TransformFunction,
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
      clear(): void {
        for (const record of store) {
          delete record[name];
        }
        cachedLength = 0;
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

export function source(
  name: string,
  options?: { storage?: StorageProvider }
): SourceColumn {
  const storage = (options?.storage ?? inMemoryStorage())(name);
  return {
    kind: "source",
    name,
    storage,
    push(value: string): void {
      storage.push(value);
    },
  };
}

export function column(
  name: string,
  options: { context: Dependency[]; compute: ComputeFunction; transform?: TransformFunction; storage?: StorageProvider }
): DerivedColumn {
  if (options.context.length === 0) {
    throw new Error(`Column "${name}" must have at least one dependency`);
  }
  for (const dep of options.context) {
    if (dep.column === SELF_MARKER && dep.row !== "previous") {
      throw new Error(`Column "${name}": self dependency must have row: 'previous'`);
    }
  }

  const storage = (options.storage ?? inMemoryStorage())(name);
  return {
    kind: "derived",
    name,
    storage,
    context: options.context,
    compute: options.compute,
    transform: options.transform,
  };
}

// The `self` sentinel — use in dependency declarations: { column: self, row: 'previous', count: 'all' }
export const self: typeof SELF_MARKER = SELF_MARKER;
