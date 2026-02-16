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
  addColumn(col: DerivedColumn): Promise<void>;
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
        const maxSteps = Math.min(
          ...sources.map((s) => s.storage.length)
        );

        // Process new steps
        for (let step = computedSteps; step < maxSteps; step++) {
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

  async function addColumn(col: DerivedColumn): Promise<void> {
    if (allSet.has(col)) return;

    // Validate all deps exist in the flow
    for (const view of col.context) {
      if (!isSelfView(view) && !allSet.has(view._column as Column)) {
        throw new Error(
          `Dependency "${(view._column as Column)._name}" not found in flow`
        );
      }
    }

    allSet.add(col);
    derived.push(col);
    nameMap.set(col._name, col);

    // Re-sort
    sortedLevels = topoSort(derived, allSet);

    // Backfill all completed steps
    for (let step = 0; step < computedSteps; step++) {
      let inputs = resolveContextInputs(col.context, col, step);
      if (col.transform) inputs = col.transform(inputs, step);
      const messages = assembleMessages(inputs);
      const result = col.compute({ messages });

      if (isAsyncIterable(result)) {
        let accumulated = "";
        for await (const delta of result) {
          accumulated += delta;
        }
        col.storage.push(accumulated);
      } else {
        const value = await result;
        col.storage.push(value);
      }
    }
  }

  return { run, get, addColumn };
}
