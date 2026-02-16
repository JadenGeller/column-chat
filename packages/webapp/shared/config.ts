import type { ColumnConfig, SessionConfig } from "./types.js";

export interface ConfigDiff {
  removed: string[];
  added: ColumnConfig[];
  modified: { name: string; config: ColumnConfig }[];
  colorOnly: string[];
}

export function diffConfigs(oldConfig: SessionConfig, newConfig: SessionConfig): ConfigDiff {
  const oldByName = new Map(oldConfig.map((c) => [c.name, c]));
  const newByName = new Map(newConfig.map((c) => [c.name, c]));

  const removed: string[] = [];
  const added: ColumnConfig[] = [];
  const modified: { name: string; config: ColumnConfig }[] = [];
  const colorOnly: string[] = [];

  // Find removed columns
  for (const name of oldByName.keys()) {
    if (!newByName.has(name)) removed.push(name);
  }

  // Find added and modified columns
  for (const [name, newCol] of newByName) {
    const oldCol = oldByName.get(name);
    if (!oldCol) {
      added.push(newCol);
    } else {
      const promptChanged = oldCol.systemPrompt !== newCol.systemPrompt;
      const reminderChanged = oldCol.reminder !== newCol.reminder;
      const contextChanged =
        JSON.stringify(oldCol.context) !== JSON.stringify(newCol.context);
      const colorChanged = oldCol.color !== newCol.color;

      if (promptChanged || reminderChanged || contextChanged) {
        modified.push({ name, config: newCol });
      } else if (colorChanged) {
        colorOnly.push(name);
      }
    }
  }

  return { removed, added, modified, colorOnly };
}
