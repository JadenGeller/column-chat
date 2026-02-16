import { source, column, self, flow, prompt, inMemoryStorage } from "columnar";
import type { ContextInput, ColumnView, DerivedColumn } from "columnar";
import { anthropic } from "@ai-sdk/anthropic";
import type { SessionConfig, ColumnContextRef } from "../shared/types.js";

const model = anthropic("claude-sonnet-4-5-20250929");

function footer(text: string) {
  return (inputs: ContextInput[], step: number): ContextInput[] => [
    ...inputs,
    { role: "user", entries: [{ step, value: text }] },
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

export function createSessionFromConfig(config: SessionConfig) {
  const storage = inMemoryStorage();
  const user = source("user", { storage });

  const columnMap = new Map<string, ColumnView>();
  columnMap.set("user", user);

  const leafColumns: DerivedColumn[] = [];

  for (const cfg of config) {
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

    const col = column(cfg.name, {
      context: contextViews,
      transform: cfg.footerText ? footer(cfg.footerText) : undefined,
      compute: prompt(model, cfg.systemPrompt, { stream: true }),
      storage,
    });

    columnMap.set(cfg.name, col);
    leafColumns.push(col);
  }

  const f = flow(...leafColumns);
  const columnOrder = config.map((c) => c.name);

  return { user, f, columnOrder };
}
