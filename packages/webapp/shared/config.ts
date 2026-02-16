import type { ColumnConfig, SessionConfig } from "./types.js";

export interface ConfigDiff {
  removed: string[];
  added: ColumnConfig[];
  modified: { name: string; config: ColumnConfig }[];
  renamed: { oldName: string; newName: string; config: ColumnConfig }[];
  colorOnly: string[];
}

export function diffConfigs(oldConfig: SessionConfig, newConfig: SessionConfig): ConfigDiff {
  const oldById = new Map(oldConfig.map((c) => [c.id, c]));
  const newById = new Map(newConfig.map((c) => [c.id, c]));

  const removed: string[] = [];
  const added: ColumnConfig[] = [];
  const modified: { name: string; config: ColumnConfig }[] = [];
  const renamed: { oldName: string; newName: string; config: ColumnConfig }[] = [];
  const colorOnly: string[] = [];

  // Find removed columns (ID in old but not in new)
  for (const [id, oldCol] of oldById) {
    if (!newById.has(id)) removed.push(oldCol.name);
  }

  // Find added, renamed, and modified columns
  for (const [id, newCol] of newById) {
    const oldCol = oldById.get(id);
    if (!oldCol) {
      added.push(newCol);
    } else {
      const nameChanged = oldCol.name !== newCol.name;
      const promptChanged = oldCol.systemPrompt !== newCol.systemPrompt;
      const reminderChanged = oldCol.reminder !== newCol.reminder;
      const contextChanged =
        JSON.stringify(oldCol.context) !== JSON.stringify(newCol.context);
      const colorChanged = oldCol.color !== newCol.color;

      if (nameChanged) {
        // Rename (possibly with other changes too)
        renamed.push({ oldName: oldCol.name, newName: newCol.name, config: newCol });
      } else if (promptChanged || reminderChanged || contextChanged) {
        modified.push({ name: newCol.name, config: newCol });
      } else if (colorChanged) {
        colorOnly.push(newCol.name);
      }
    }
  }

  return { removed, added, modified, renamed, colorOnly };
}
