import { source, column, self, flow, prompt, inMemoryStorage } from "columnar";
import type { ContextInput, ColumnView, DerivedColumn, StorageProvider } from "columnar";
import { anthropic } from "@ai-sdk/anthropic";
import type { SessionConfig, ColumnConfig, ColumnContextRef } from "../shared/types.js";

const model = anthropic("claude-sonnet-4-5-20250929");

function reminder(text: string) {
  return (inputs: ContextInput[], step: number): ContextInput[] => [
    ...inputs,
    { role: "user", entries: [{ step, value: `<system-reminder>\n${text}\n</system-reminder>` }] },
  ];
}

function resolveWindowMode(
  view: ColumnView,
  mode: ColumnContextRef["windowMode"]
): ColumnView {
  if (mode === "latest") return view.latest;
  if (mode === "all") return view;
  return view.window(mode.window);
}

export function createColumnFromConfig(
  cfg: ColumnConfig,
  columnMap: Map<string, ColumnView>,
  storage: StorageProvider
): DerivedColumn {
  const contextViews: ColumnView[] = cfg.context.map((ref) => {
    if (ref.column === "self") return resolveWindowMode(self, ref.windowMode);
    const resolved = columnMap.get(ref.column);
    if (!resolved) {
      throw new Error(
        `Column "${cfg.name}" references "${ref.column}" which doesn't exist or appears later in the config`
      );
    }
    return resolveWindowMode(resolved, ref.windowMode);
  });

  return column(cfg.name, {
    context: contextViews,
    transform: cfg.reminder ? reminder(cfg.reminder) : undefined,
    compute: prompt(model, cfg.systemPrompt, { stream: true }),
    storage,
  });
}

export function createSessionFromConfig(config: SessionConfig) {
  const storage = inMemoryStorage();
  const input = source("input", { storage });

  const columnMap = new Map<string, ColumnView>();
  columnMap.set("input", input);

  const leafColumns: DerivedColumn[] = [];

  for (const cfg of config) {
    const col = createColumnFromConfig(cfg, columnMap, storage);
    columnMap.set(cfg.name, col);
    leafColumns.push(col);
  }

  const f = flow(...leafColumns);
  const columnOrder = config.map((c) => c.name);

  return { input, f, columnOrder, columnMap, storage };
}
