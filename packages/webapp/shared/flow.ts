import { source, column, self, flow, prompt, inMemoryStorage } from "columnar";
import type { ContextInput, Column, Dependency, DerivedColumn, StorageProvider, Flow } from "columnar";
import type { ConfigDiff } from "./config.js";
import type { LanguageModel } from "ai";
import type { SessionConfig, ColumnConfig, ColumnContextRef } from "./types.js";

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

  const leafColumns: DerivedColumn[] = [];

  for (const cfg of config) {
    const col = createColumnFromConfig(cfg, columnMap, storage, model);
    columnMap.set(cfg.name, col);
    leafColumns.push(col);
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

  // Reconcile: single pass in config order
  const modifiedSet = new Set(diff.modified.map(m => m.name));
  for (const cfg of newConfig) {
    const inFlow = session.columnMap.has(cfg.name);
    if (inFlow && modifiedSet.has(cfg.name)) {
      const newCol = createColumn(cfg, session.columnMap, session.storage);
      session.f.replaceColumn(cfg.name, newCol);
      session.columnMap.set(cfg.name, newCol);
    } else if (!inFlow) {
      const newCol = createColumn(cfg, session.columnMap, session.storage);
      session.f.addColumn(newCol);
      session.columnMap.set(cfg.name, newCol);
    }
  }
}
