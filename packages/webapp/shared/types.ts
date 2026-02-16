export interface ColumnContextRef {
  column: string; // "input", "self", or another column's name
  row: "current" | "previous";
  count: "single" | "all";
}

export interface ColumnConfig {
  id: string;
  name: string;
  systemPrompt: string;
  reminder: string;
  color: string;
  context: ColumnContextRef[];
}

export type SessionConfig = ColumnConfig[];

export type Mutation =
  | { type: "add"; config: ColumnConfig }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; changes: Partial<Omit<ColumnConfig, "id">> }
  | { type: "move"; id: string; direction: -1 | 1 };

export function overlay(base: SessionConfig, mutations: Mutation[]): SessionConfig {
  let config = base.map((c) => ({ ...c, context: [...c.context] }));
  for (const mut of mutations) {
    switch (mut.type) {
      case "add":
        config.push({ ...mut.config, context: [...mut.config.context] });
        break;
      case "remove":
        config = config.filter((c) => c.id !== mut.id);
        break;
      case "update": {
        const idx = config.findIndex((c) => c.id === mut.id);
        if (idx === -1) break;
        const old = config[idx];
        config[idx] = { ...old, ...mut.changes };
        if (mut.changes.name && mut.changes.name !== old.name) {
          for (let i = 0; i < config.length; i++) {
            if (i === idx) continue;
            config[i] = {
              ...config[i],
              context: config[i].context.map((ref) =>
                ref.column === old.name ? { ...ref, column: mut.changes.name! } : ref
              ),
            };
          }
        }
        break;
      }
      case "move": {
        const idx = config.findIndex((c) => c.id === mut.id);
        const target = idx + mut.direction;
        if (idx !== -1 && target >= 0 && target < config.length) {
          [config[idx], config[target]] = [config[target], config[idx]];
        }
        break;
      }
    }
  }
  return config;
}

const RESERVED_NAMES = new Set(["input", "self"]);

export function validateConfig(config: SessionConfig): string | null {
  const seen = new Set<string>();
  for (const col of config) {
    if (!col.name) return "Column name cannot be empty";
    if (!col.systemPrompt) return `${col.name}: system prompt cannot be empty`;
    if (RESERVED_NAMES.has(col.name)) return `"${col.name}" is reserved`;
    if (seen.has(col.name)) return `Duplicate name: "${col.name}"`;
    seen.add(col.name);

    for (const ref of col.context) {
      if (ref.column === "input" || ref.column === "self") continue;
      if (!seen.has(ref.column)) {
        return `${col.name}: references "${ref.column}" which doesn't exist or appears later`;
      }
    }
  }

  const cycle = detectCurrentCycle(config);
  if (cycle) return `Cycle: ${cycle.join(" \u2192 ")}`;

  return null;
}

function detectCurrentCycle(config: SessionConfig): string[] | null {
  const adj = new Map<string, string[]>();
  for (const col of config) {
    const currentDeps = col.context
      .filter((ref) => ref.row === "current" && ref.column !== "input" && ref.column !== "self")
      .map((ref) => ref.column);
    adj.set(col.name, currentDeps);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): string[] | null {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      return [...path.slice(cycleStart), node];
    }
    if (visited.has(node)) return null;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const dep of adj.get(node) ?? []) {
      const cycle = dfs(dep, path);
      if (cycle) return cycle;
    }

    path.pop();
    stack.delete(node);
    return null;
  }

  for (const col of config) {
    const cycle = dfs(col.name, []);
    if (cycle) return cycle;
  }
  return null;
}

export interface Capabilities {
  mode: "cloud" | "local";
}
