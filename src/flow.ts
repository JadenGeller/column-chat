import type {
  Column,
  ColumnView,
  DerivedColumn,
  SourceColumn,
  FlowEvent,
} from "./types.js";
import { isSelfView } from "./column.js";
import { assembleMessages, resolveViews } from "./context.js";

interface Flow {
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

// Topological sort using Kahn's algorithm
function topoSort(derived: DerivedColumn[], allColumns: Set<Column>): DerivedColumn[] {
  // Build adjacency: for each derived column, find its non-self dependencies that are also derived
  const inDegree = new Map<DerivedColumn, number>();
  const dependents = new Map<Column, DerivedColumn[]>(); // column -> columns that depend on it

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

  const sorted: DerivedColumn[] = [];
  while (queue.length > 0) {
    const col = queue.shift()!;
    sorted.push(col);

    const deps = dependents.get(col) || [];
    for (const dep of deps) {
      const newDeg = inDegree.get(dep)! - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  if (sorted.length !== derived.length) {
    throw new Error("Cycle detected in column dependencies");
  }

  return sorted;
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
  let sortedDerived = topoSort(derived, allSet);
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
          for (const col of sortedDerived) {
            if (step < col.storage.length) continue; // already computed

            const resolved = resolveViews(col.context, col);
            const messages = assembleMessages(resolved, step);
            const value = await col.compute({ messages });

            col.storage.push(value);

            yield { column: col._name, step, value };
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
    sortedDerived = topoSort(derived, allSet);

    // Backfill all completed steps
    for (let step = 0; step < computedSteps; step++) {
      const resolved = resolveViews(col.context, col);
      const messages = assembleMessages(resolved, step);
      const value = await col.compute({ messages });
      col.storage.push(value);
    }
  }

  return { run, get, addColumn };
}
