import type {
  Column,
  ColumnView,
  DerivedColumn,
  SourceColumn,
  FlowEvent,
} from "./types.js";
import { isSelfView } from "./column.js";
import { assembleMessages, resolveContextInputs } from "./context.js";

function isAsyncIterable(value: unknown): value is AsyncIterable<string> {
  return (
    value != null &&
    typeof value === "object" &&
    Symbol.asyncIterator in (value as object)
  );
}

async function* computeColumn(col: DerivedColumn, step: number): AsyncGenerator<FlowEvent> {
  yield { kind: "start" as const, column: col._name, step };
  let inputs = resolveContextInputs(col.context, col, step);
  if (col.transform) inputs = col.transform(inputs, step);
  const messages = assembleMessages(inputs);
  const result = col.compute({ messages });

  if (isAsyncIterable(result)) {
    let accumulated = "";
    for await (const delta of result) {
      accumulated += delta;
      yield { kind: "delta" as const, column: col._name, step, delta };
    }
    col.storage.push(accumulated);
    yield { kind: "value" as const, column: col._name, step, value: accumulated };
  } else {
    const value = await result;
    col.storage.push(value);
    yield { kind: "value" as const, column: col._name, step, value };
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
      for (const view of col.context) {
        if (!isSelfView(view)) {
          visit(view._column as Column);
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
// Columns within the same level have no dependencies on each other and can run in parallel.
function topoSort(derived: DerivedColumn[], allColumns: Set<Column>): DerivedColumn[][] {
  const inDegree = new Map<DerivedColumn, number>();
  const dependents = new Map<Column, DerivedColumn[]>();

  for (const col of derived) {
    let deg = 0;
    for (const view of col.context) {
      if (!isSelfView(view)) {
        const dep = view._column as Column;
        if (dep.kind === "derived" && allColumns.has(dep)) {
          deg++;
          if (!dependents.has(dep)) dependents.set(dep, []);
          dependents.get(dep)!.push(col);
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
    if (map.has(col._name)) {
      throw new Error(`Duplicate column name: ${col._name}`);
    }
    map.set(col._name, col);
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

  function dependents(name: string): string[] {
    const col = nameMap.get(name);
    if (!col) return [];

    // Collect transitive dependents using the topologically sorted levels
    const dirty = new Set<Column>([col]);
    const result: string[] = [];

    for (const level of sortedLevels) {
      for (const d of level) {
        if (dirty.has(d)) continue;
        for (const view of d.context) {
          if (!isSelfView(view) && dirty.has(view._column as Column)) {
            dirty.add(d);
            result.push(d._name);
            break;
          }
        }
      }
    }

    return result;
  }

  function addColumn(col: DerivedColumn): void {
    if (allSet.has(col)) return;

    // Auto-discover source dependencies; validate derived deps exist
    for (const view of col.context) {
      if (!isSelfView(view)) {
        const dep = view._column as Column;
        if (!allSet.has(dep)) {
          if (dep.kind === "source") {
            allSet.add(dep);
            sources.push(dep);
            nameMap.set(dep._name, dep);
          } else {
            throw new Error(
              `Dependency "${dep._name}" not found in flow`
            );
          }
        }
      }
    }

    allSet.add(col);
    derived.push(col);
    nameMap.set(col._name, col);

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
      for (const view of d.context) {
        if (!isSelfView(view) && view._column === col) {
          throw new Error(
            `Cannot remove "${name}": column "${d._name}" depends on it`
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
    if (newCol._name !== name) {
      throw new Error(`Replacement column name "${newCol._name}" must match "${name}"`);
    }

    // Compute transitive dependents of old column (excluding itself)
    const depNames = dependents(name);
    const deps = depNames.map(n => nameMap.get(n) as DerivedColumn);

    // Swap old for new
    allSet.delete(oldCol);
    allSet.add(newCol);
    const idx = derived.indexOf(oldCol as DerivedColumn);
    derived[idx] = newCol;
    nameMap.set(name, newCol);

    // Fix up context views: dependent columns' views that point to oldCol must point to newCol
    for (const dep of deps) {
      const ctx = dep.context as ColumnView[];
      for (let i = 0; i < ctx.length; i++) {
        if (!isSelfView(ctx[i]) && ctx[i]._column === oldCol) {
          const mode = ctx[i]._windowMode;
          const viewName = ctx[i]._name;
          let view: ColumnView;
          if (mode.kind === "latest") view = newCol.latest;
          else if (mode.kind === "window") view = newCol.window(mode.n);
          else view = newCol as ColumnView;
          if (viewName !== view._name) view = view.as(viewName);
          ctx[i] = view;
        }
      }
    }

    // Validate new column's deps all exist in flow
    for (const view of newCol.context) {
      if (!isSelfView(view) && !allSet.has(view._column as Column)) {
        throw new Error(
          `Dependency "${(view._column as Column)._name}" not found in flow`
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

  return { run, get, dependents, addColumn, removeColumn, replaceColumn };
}
