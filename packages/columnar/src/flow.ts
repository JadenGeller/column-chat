import type {
  Column,
  Dependency,
  DerivedColumn,
  SourceColumn,
  FlowEvent,
} from "./types.js";
import { SELF_MARKER } from "./types.js";
import { assembleMessages, resolveContextInputs } from "./context.js";

function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  return (
    value != null &&
    typeof value === "object" &&
    Symbol.asyncIterator in (value as object)
  );
}

async function* computeColumn(col: DerivedColumn, step: number): AsyncGenerator<FlowEvent> {
  yield { kind: "start" as const, column: col.name, step };
  let inputs = resolveContextInputs(col.context, col, step);
  if (col.transform) inputs = col.transform(inputs, step);
  const messages = assembleMessages(inputs);
  const result = col.compute({ messages });

  if (isAsyncIterable(result)) {
    let accumulated = "";
    for await (const delta of result) {
      accumulated += delta;
      yield { kind: "delta" as const, column: col.name, step, delta };
    }
    col.storage.push(accumulated);
    yield { kind: "value" as const, column: col.name, step, value: accumulated };
  } else {
    const value = await result;
    col.storage.push(value);
    yield { kind: "value" as const, column: col.name, step, value };
  }
}

async function* merge<T>(iterables: AsyncIterable<T>[]): AsyncGenerator<T> {
  const iterators = iterables.map(it => it[Symbol.asyncIterator]());
  const pending = new Map<number, Promise<{ index: number; result: IteratorResult<T> }>>();

  for (let i = 0; i < iterators.length; i++) {
    pending.set(i, iterators[i].next().then(result => ({ index: i, result })));
  }

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());
    pending.delete(index);
    if (!result.done) {
      yield result.value;
      pending.set(index, iterators[index].next().then(result => ({ index, result })));
    }
  }
}

export interface Flow {
  run(): AsyncIterable<FlowEvent> & PromiseLike<void>;
  get(name: string, step: number): string | undefined;
  dependents(name: string): string[];
  addColumn(col: DerivedColumn): void;
  removeColumn(name: string): void;
  replaceColumn(name: string, newCol: DerivedColumn): void;
}

// Discover the full DAG by tracing from leaf columns back through dependencies
function discoverDAG(leaves: Column[]): {
  sources: SourceColumn[];
  derived: DerivedColumn[];
  all: Column[];
} {
  const visited = new Set<Column>();
  const sources: SourceColumn[] = [];
  const derived: DerivedColumn[] = [];

  function visit(col: Column) {
    if (visited.has(col)) return;
    visited.add(col);

    if (col.kind === "source") {
      sources.push(col);
    } else {
      derived.push(col);
      for (const dep of col.context) {
        if (dep.column !== SELF_MARKER) {
          visit(dep.column as Column);
        }
      }
    }
  }

  for (const leaf of leaves) {
    visit(leaf);
  }

  return { sources, derived, all: [...visited] };
}

// Topological sort into levels using Kahn's algorithm.
// Only row: 'current' edges create ordering constraints.
// Columns connected only by row: 'previous' edges can run in parallel.
function topoSort(derived: DerivedColumn[], allColumns: Set<Column>): DerivedColumn[][] {
  const inDegree = new Map<DerivedColumn, number>();
  const dependents = new Map<Column, DerivedColumn[]>();

  for (const col of derived) {
    let deg = 0;
    for (const dep of col.context) {
      // Only row: 'current' edges create ordering constraints
      if (dep.column !== SELF_MARKER && dep.row === "current") {
        const target = dep.column as Column;
        if (target.kind === "derived" && allColumns.has(target)) {
          deg++;
          if (!dependents.has(target)) dependents.set(target, []);
          dependents.get(target)!.push(col);
        }
      }
    }
    inDegree.set(col, deg);
  }

  const queue: DerivedColumn[] = [];
  for (const [col, deg] of inDegree) {
    if (deg === 0) queue.push(col);
  }

  const levels: DerivedColumn[][] = [];
  let processed = 0;

  while (queue.length > 0) {
    const level = [...queue];
    queue.length = 0;
    levels.push(level);
    processed += level.length;

    for (const col of level) {
      const deps = dependents.get(col) || [];
      for (const dep of deps) {
        const newDeg = inDegree.get(dep)! - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) queue.push(dep);
      }
    }
  }

  if (processed !== derived.length) {
    throw new Error("Cycle detected in column dependencies");
  }

  return levels;
}

// Build a name -> column map
function buildNameMap(columns: Column[]): Map<string, Column> {
  const map = new Map<string, Column>();
  for (const col of columns) {
    if (map.has(col.name)) {
      throw new Error(`Duplicate column name: ${col.name}`);
    }
    map.set(col.name, col);
  }
  return map;
}

export function flow(...leaves: Column[]): Flow {
  const { sources, derived, all } = discoverDAG(leaves);
  const allSet = new Set(all);
  let sortedLevels = topoSort(derived, allSet);
  const nameMap = buildNameMap(all);

  // Track how many steps have been computed
  let computedSteps = 0;

  function run(): AsyncIterable<FlowEvent> & PromiseLike<void> {
    const iterable = {
      async *[Symbol.asyncIterator](): AsyncGenerator<FlowEvent> {
        // Determine how many steps we can compute
        const maxSteps = sources.length > 0
          ? Math.min(...sources.map((s) => s.storage.length))
          : 0;

        // Start from earliest dirty step (a cleared/new column has storage.length < computedSteps)
        const startStep = derived.length > 0
          ? Math.min(computedSteps, ...derived.map(col => col.storage.length))
          : computedSteps;

        // Process steps
        for (let step = startStep; step < maxSteps; step++) {
          for (const level of sortedLevels) {
            const ready = level.filter(col => step >= col.storage.length);
            if (ready.length === 0) continue;

            if (ready.length === 1) {
              yield* computeColumn(ready[0], step);
            } else {
              yield* merge(ready.map(col => computeColumn(col, step)));
            }
          }
        }

        computedSteps = maxSteps;
      },

      // Make it thenable so `await f.run()` works
      then<TResult1 = void, TResult2 = never>(
        onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
      ): Promise<TResult1 | TResult2> {
        const drain = async () => {
          for await (const _ of iterable) {
            // drain
          }
        };
        return drain().then(onfulfilled, onrejected);
      },
    };

    return iterable;
  }

  function get(name: string, step: number): string | undefined {
    const col = nameMap.get(name);
    if (!col) return undefined;
    return col.storage.get(step);
  }

  function dependentsOf(name: string): string[] {
    const col = nameMap.get(name);
    if (!col) return [];

    // Build reverse adjacency map (ALL edge types — both current and previous)
    const reverseDeps = new Map<Column, DerivedColumn[]>();
    for (const d of derived) {
      for (const dep of d.context) {
        if (dep.column !== SELF_MARKER) {
          const target = dep.column as Column;
          if (!reverseDeps.has(target)) reverseDeps.set(target, []);
          reverseDeps.get(target)!.push(d);
        }
      }
    }

    // BFS with visited set (handles cycles from row: 'previous' edges)
    const visited = new Set<Column>([col]);
    const queue: Column[] = [col];
    const resultSet = new Set<DerivedColumn>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const d of reverseDeps.get(current) ?? []) {
        if (!visited.has(d)) {
          visited.add(d);
          resultSet.add(d);
          queue.push(d);
        }
      }
    }

    // Return in topological order (by sortedLevels position)
    const result: string[] = [];
    for (const level of sortedLevels) {
      for (const d of level) {
        if (resultSet.has(d)) {
          result.push(d.name);
        }
      }
    }

    return result;
  }

  function addColumn(col: DerivedColumn): void {
    if (allSet.has(col)) return;

    // Auto-discover source dependencies; validate derived deps exist
    for (const dep of col.context) {
      if (dep.column !== SELF_MARKER) {
        const target = dep.column as Column;
        if (!allSet.has(target)) {
          if (target.kind === "source") {
            allSet.add(target);
            sources.push(target);
            nameMap.set(target.name, target);
          } else {
            throw new Error(
              `Dependency "${target.name}" not found in flow`
            );
          }
        }
      }
    }

    allSet.add(col);
    derived.push(col);
    nameMap.set(col.name, col);

    // Re-sort — run() will handle backfill since col.storage.length === 0
    sortedLevels = topoSort(derived, allSet);
  }

  function removeColumn(name: string): void {
    const col = nameMap.get(name);
    if (!col) throw new Error(`Column "${name}" not found in flow`);
    if (col.kind === "source") throw new Error(`Cannot remove source column "${name}"`);

    // Check no remaining derived column depends on it
    for (const d of derived) {
      if (d === col) continue;
      for (const dep of d.context) {
        if (dep.column !== SELF_MARKER && dep.column === col) {
          throw new Error(
            `Cannot remove "${name}": column "${d.name}" depends on it`
          );
        }
      }
    }

    allSet.delete(col);
    derived.splice(derived.indexOf(col as DerivedColumn), 1);
    nameMap.delete(name);
    sortedLevels = topoSort(derived, allSet);
  }

  function replaceColumn(name: string, newCol: DerivedColumn): void {
    const oldCol = nameMap.get(name);
    if (!oldCol) throw new Error(`Column "${name}" not found in flow`);
    if (oldCol.kind === "source") throw new Error(`Cannot replace source column "${name}"`);

    // Compute transitive dependents of old column (excluding itself)
    const depNames = dependentsOf(name);
    const deps = depNames.map(n => nameMap.get(n) as DerivedColumn);

    // Swap old for new
    allSet.delete(oldCol);
    allSet.add(newCol);
    const idx = derived.indexOf(oldCol as DerivedColumn);
    derived[idx] = newCol;
    nameMap.delete(name);
    nameMap.set(newCol.name, newCol);

    // Fix up context: dependent columns' deps that point to oldCol must point to newCol
    for (const depCol of deps) {
      const ctx = depCol.context as Dependency[];
      for (let i = 0; i < ctx.length; i++) {
        if (ctx[i].column !== SELF_MARKER && ctx[i].column === oldCol) {
          ctx[i] = { ...ctx[i], column: newCol };
        }
      }
    }

    // Validate new column's deps all exist in flow
    for (const dep of newCol.context) {
      if (dep.column !== SELF_MARKER && !allSet.has(dep.column as Column)) {
        throw new Error(
          `Dependency "${(dep.column as Column).name}" not found in flow`
        );
      }
    }

    // Re-sort
    sortedLevels = topoSort(derived, allSet);

    // Clear storage for the replaced column and all transitive dependents
    newCol.storage.clear();
    for (const dep of deps) {
      dep.storage.clear();
    }
  }

  return { run, get, dependents: dependentsOf, addColumn, removeColumn, replaceColumn };
}
