import { source, column, self, flow, prompt, inMemoryStorage } from "columnar";
import type { ContextInput, Column, Dependency, DerivedColumn, StorageProvider, Flow } from "columnar";
import type { ConfigDiff } from "./config.js";
import type { LanguageModel } from "ai";
import type { SessionConfig, ColumnConfig, ColumnContextRef } from "./types.js";

/** Topologically sort config entries by `row: 'current'` edges (Kahn's algorithm). */
function topoSortConfig(config: SessionConfig): SessionConfig {
  const names = new Set(config.map((c) => c.name));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const cfg of config) {
    inDegree.set(cfg.name, 0);
    dependents.set(cfg.name, []);
  }

  for (const cfg of config) {
    for (const ref of cfg.context) {
      if (ref.row === "current" && ref.column !== "input" && ref.column !== "self" && names.has(ref.column)) {
        dependents.get(ref.column)!.push(cfg.name);
        inDegree.set(cfg.name, inDegree.get(cfg.name)! + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(name);
    for (const dep of dependents.get(name)!) {
      const newDeg = inDegree.get(dep)! - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  // If cycle detected (shouldn't happen after validation), append remaining in original order
  if (sorted.length < config.length) {
    const sortedSet = new Set(sorted);
    for (const cfg of config) {
      if (!sortedSet.has(cfg.name)) sorted.push(cfg.name);
    }
  }

  const byName = new Map(config.map((c) => [c.name, c]));
  return sorted.map((name) => byName.get(name)!);
}

function reminder(text: string) {
  return (inputs: ContextInput[], step: number): ContextInput[] => [
    ...inputs,
    { role: "user", entries: [{ step, value: `<system-reminder>\n${text}\n</system-reminder>` }] },
  ];
}

function resolveDependency(
  ref: ColumnContextRef,
  columnMap: Map<string, Column>,
): Dependency {
  if (ref.column === "self") {
    return { column: self, row: "previous", count: ref.count };
  }
  const resolved = columnMap.get(ref.column);
  if (!resolved) {
    throw new Error(`Column references "${ref.column}" which doesn't exist or appears later in the config`);
  }
  return { column: resolved, row: ref.row, count: ref.count };
}

export function createColumnFromConfig(
  cfg: ColumnConfig,
  columnMap: Map<string, Column>,
  storage: StorageProvider,
  model: LanguageModel
): DerivedColumn {
  const deps: Dependency[] = cfg.context.map((ref) => resolveDependency(ref, columnMap));

  return column(cfg.name, {
    context: deps,
    transform: cfg.reminder ? reminder(cfg.reminder) : undefined,
    compute: prompt(model, cfg.systemPrompt, { stream: true }),
    storage,
  });
}

export function createSessionFromConfig(config: SessionConfig, model: LanguageModel, existingStorage?: StorageProvider) {
  const storage = existingStorage ?? inMemoryStorage();
  const input = source("input", { storage });

  const columnMap = new Map<string, Column>();
  columnMap.set("input", input);

  // Topo sort by row: 'current' edges so deps exist in columnMap when needed
  const sorted = topoSortConfig(config);

  // Track forward refs from row: 'previous' deps on not-yet-created columns
  const forwardRefs: Array<{ col: DerivedColumn; index: number; targetName: string }> = [];

  const leafColumns: DerivedColumn[] = [];
  for (const cfg of sorted) {
    const deps: Dependency[] = cfg.context.map((ref, i) => {
      if (ref.column === "self") {
        return { column: self, row: "previous" as const, count: ref.count };
      }
      const resolved = columnMap.get(ref.column);
      if (resolved) {
        return { column: resolved, row: ref.row, count: ref.count };
      }
      // Forward ref (row: 'previous' on a column not yet created) — use input as placeholder
      return { column: input, row: ref.row, count: ref.count };
    });

    const col = column(cfg.name, {
      context: deps,
      transform: cfg.reminder ? reminder(cfg.reminder) : undefined,
      compute: prompt(model, cfg.systemPrompt, { stream: true }),
      storage,
    });

    // Record any forward refs (col.context is the same array as deps)
    cfg.context.forEach((ref, i) => {
      if (ref.column !== "self" && ref.column !== "input" && !columnMap.has(ref.column)) {
        forwardRefs.push({ col, index: i, targetName: ref.column });
      }
    });

    columnMap.set(cfg.name, col);
    leafColumns.push(col);
  }

  // Fix up forward refs by mutating context arrays in place
  for (const { col, index, targetName } of forwardRefs) {
    const target = columnMap.get(targetName);
    if (!target) throw new Error(`Column "${targetName}" not found`);
    (col.context as Dependency[])[index] = { ...col.context[index], column: target };
  }

  const f = flow(...leafColumns);
  const columnOrder = config.map((c) => c.name);

  return { input, f, columnOrder, columnMap, storage };
}

export function applyConfigUpdate(
  session: { f: Flow; columnMap: Map<string, Column>; storage: StorageProvider },
  diff: ConfigDiff,
  newConfig: SessionConfig,
  createColumn: (cfg: ColumnConfig, columnMap: Map<string, Column>, storage: StorageProvider) => DerivedColumn,
): void {
  // Cascade removals (leaves-first using dependents + reverse topo order)
  const toRemove = new Set<string>();
  for (const name of diff.removed) {
    toRemove.add(name);
    for (const dep of session.f.dependents(name)) {
      toRemove.add(dep);
    }
  }
  const removeOrder: string[] = [];
  const removeVisited = new Set<string>();
  for (const name of diff.removed) {
    const deps = session.f.dependents(name);
    for (const dep of [...deps].reverse()) {
      if (toRemove.has(dep) && !removeVisited.has(dep)) {
        removeVisited.add(dep);
        removeOrder.push(dep);
      }
    }
    if (!removeVisited.has(name)) {
      removeVisited.add(name);
      removeOrder.push(name);
    }
  }
  for (const name of removeOrder) {
    session.f.removeColumn(name);
    session.columnMap.delete(name);
  }

  // Apply renames first (so columnMap is up-to-date for subsequent steps)
  const renamedOldNames = new Set<string>();
  for (const { oldName, newName, config } of diff.renamed) {
    renamedOldNames.add(oldName);
    const newCol = createColumn(config, session.columnMap, session.storage);
    session.f.replaceColumn(oldName, newCol);
    session.columnMap.delete(oldName);
    session.columnMap.set(newName, newCol);
  }

  // Reconcile modifications first (all referenced columns already exist)
  const modifiedSet = new Set(diff.modified.map(m => m.name));
  for (const cfg of newConfig) {
    if (renamedOldNames.has(cfg.name)) continue;
    if (session.columnMap.has(cfg.name) && modifiedSet.has(cfg.name)) {
      const newCol = createColumn(cfg, session.columnMap, session.storage);
      session.f.replaceColumn(cfg.name, newCol);
      session.columnMap.set(cfg.name, newCol);
    }
  }

  // Collect new columns and topo-sort by row: 'current' edges before adding
  const newConfigs = newConfig.filter(
    (cfg) => !renamedOldNames.has(cfg.name) && !session.columnMap.has(cfg.name),
  );
  for (const cfg of topoSortConfig(newConfigs)) {
    const newCol = createColumn(cfg, session.columnMap, session.storage);
    session.f.addColumn(newCol);
    session.columnMap.set(cfg.name, newCol);
  }
}
