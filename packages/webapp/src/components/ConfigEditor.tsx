import { useState } from "react";
import type { ColumnarState } from "../hooks/useColumnar.js";
import type { ColumnConfig, SessionConfig } from "../../shared/types.js";
import { PRESET_COLORS, displayName } from "../../shared/defaults.js";
import { ColumnConfigCard } from "./ColumnConfigCard.js";

interface ConfigEditorProps {
  state: ColumnarState;
}

const RESERVED_NAMES = new Set(["input", "self"]);

function validateConfig(config: SessionConfig): string | null {
  const seen = new Set<string>();
  for (const col of config) {
    if (!col.name) return "Column name cannot be empty";
    if (RESERVED_NAMES.has(col.name)) return `"${col.name}" is reserved`;
    if (seen.has(col.name)) return `Duplicate name: "${col.name}"`;
    seen.add(col.name);

    for (const ref of col.context) {
      if (ref.column === "input" || ref.column === "self") continue;
      if (!seen.has(ref.column)) {
        return `"${col.name}" references "${ref.column}" which appears after it`;
      }
    }
  }
  return null;
}

interface ImpactEntry {
  name: string;
  action: "deleted" | "recomputed";
  reason: "direct" | "cascade";
}

function computeImpact(
  appliedConfig: SessionConfig,
  draftConfig: SessionConfig,
  stepCount: number
): ImpactEntry[] | null {
  const appliedByName = new Map(appliedConfig.map((c) => [c.name, c]));
  const draftByName = new Map(draftConfig.map((c) => [c.name, c]));

  const entries: ImpactEntry[] = [];
  const seen = new Set<string>();

  const removedNames: string[] = [];
  for (const name of appliedByName.keys()) {
    if (!draftByName.has(name)) removedNames.push(name);
  }

  const modifiedNames: string[] = [];
  for (const [name, newCol] of draftByName) {
    const oldCol = appliedByName.get(name);
    if (!oldCol) continue;
    const changed =
      oldCol.systemPrompt !== newCol.systemPrompt ||
      oldCol.reminder !== newCol.reminder ||
      JSON.stringify(oldCol.context) !== JSON.stringify(newCol.context);
    if (changed) modifiedNames.push(name);
  }

  if (removedNames.length === 0 && modifiedNames.length === 0) return null;

  const removedSet = new Set(removedNames);
  for (const name of removedNames) {
    if (!seen.has(name)) {
      seen.add(name);
      entries.push({ name, action: "deleted", reason: "direct" });
    }
  }
  for (const col of appliedConfig) {
    if (seen.has(col.name)) continue;
    const depsOnRemoved = col.context.some(
      (ref) => ref.column !== "input" && ref.column !== "self" && removedSet.has(ref.column)
    );
    if (depsOnRemoved) {
      seen.add(col.name);
      removedSet.add(col.name);
      entries.push({ name: col.name, action: "deleted", reason: "cascade" });
    }
  }

  const dirtySet = new Set(modifiedNames);
  for (const name of modifiedNames) {
    if (!seen.has(name)) {
      seen.add(name);
      entries.push({ name, action: "recomputed", reason: "direct" });
    }
  }
  for (const col of draftConfig) {
    if (seen.has(col.name)) continue;
    const depsOnDirty = col.context.some(
      (ref) => ref.column !== "input" && ref.column !== "self" && dirtySet.has(ref.column)
    );
    if (depsOnDirty) {
      seen.add(col.name);
      dirtySet.add(col.name);
      entries.push({ name: col.name, action: "recomputed", reason: "cascade" });
    }
  }

  return entries.length > 0 ? entries : null;
}

export function ConfigEditor({ state }: ConfigEditorProps) {
  const [confirmEntries, setConfirmEntries] = useState<ImpactEntry[] | null>(null);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set());
  const { draftConfig, appliedConfig, steps, isDirty, isRunning, updateDraft, applyConfig, resetDraft } = state;

  const validationError = validateConfig(draftConfig);
  const canApply = isDirty && !isRunning && !validationError;

  const changeSummary = (() => {
    if (!isDirty) return [];
    const appliedByName = new Map(appliedConfig.map((c) => [c.name, c]));
    const draftByName = new Map(draftConfig.map((c) => [c.name, c]));
    const items: string[] = [];

    for (const name of draftByName.keys()) {
      if (!appliedByName.has(name)) items.push(`${displayName(name)} added`);
    }
    for (const name of appliedByName.keys()) {
      if (!draftByName.has(name)) items.push(`${displayName(name)} deleted`);
    }
    for (const [name, col] of draftByName) {
      const old = appliedByName.get(name);
      if (!old) continue;
      const diffs: string[] = [];
      if (old.systemPrompt !== col.systemPrompt) diffs.push("prompt");
      if (old.reminder !== col.reminder) diffs.push("reminder");
      if (old.color !== col.color) diffs.push("color");
      if (JSON.stringify(old.context) !== JSON.stringify(col.context)) diffs.push("context");
      if (diffs.length > 0) items.push(`${displayName(name)} \u2014 ${diffs.join(", ")}`);
    }

    // Detect reorder (same names, different order)
    const appliedOrder = appliedConfig.map((c) => c.name);
    const draftOrder = draftConfig.map((c) => c.name);
    if (
      appliedOrder.length === draftOrder.length &&
      appliedOrder.every((n) => draftByName.has(n)) &&
      appliedOrder.some((n, i) => n !== draftOrder[i])
    ) {
      items.push("reordered");
    }

    return items;
  })();

  const updateColumn = (index: number, updates: Partial<ColumnConfig>) => {
    const next = [...draftConfig];
    const old = next[index];
    const updated = { ...old, ...updates };

    if (updates.name && updates.name !== old.name) {
      for (let i = index + 1; i < next.length; i++) {
        next[i] = {
          ...next[i],
          context: next[i].context.map((ref) =>
            ref.column === old.name ? { ...ref, column: updates.name! } : ref
          ),
        };
      }
    }

    next[index] = updated;
    updateDraft(next);
  };

  const deleteColumn = (index: number) => {
    const name = draftConfig[index].name;
    const next = draftConfig.filter((col, i) => {
      if (i === index) return false;
      return !col.context.some((ref) => ref.column === name);
    });
    updateDraft(next);
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draftConfig.length) return;

    const next = [...draftConfig];
    [next[index], next[target]] = [next[target], next[index]];

    for (let i = 0; i < next.length; i++) {
      const preceding = new Set(next.slice(0, i).map((c) => c.name));
      next[i] = {
        ...next[i],
        context: next[i].context.filter(
          (ref) => ref.column === "input" || ref.column === "self" || preceding.has(ref.column)
        ),
      };
    }

    updateDraft(next);
  };

  const addColumn = () => {
    let n = 1;
    const names = new Set(draftConfig.map((c) => c.name));
    while (names.has(`column_${n}`)) n++;

    const usedColors = new Set(draftConfig.map((c) => c.color));
    const color = PRESET_COLORS.find((c) => !usedColors.has(c)) ?? PRESET_COLORS[0];

    const newCol: ColumnConfig = {
      name: `column_${n}`,
      systemPrompt: "",
      reminder: "",
      color,
      context: [
        { column: "input", windowMode: "all" },
        { column: "self", windowMode: "all" },
      ],
    };
    updateDraft([...draftConfig, newCol]);
  };

  const handleApply = () => {
    const impact = computeImpact(appliedConfig, draftConfig, steps.length);
    if (impact && steps.length > 0) {
      setConfirmEntries(impact);
      setCheckedNames(new Set());
    } else {
      applyConfig();
      state.setEditing(false);
    }
  };

  const confirmApply = () => {
    setConfirmEntries(null);
    setCheckedNames(new Set());
    applyConfig();
    state.setEditing(false);
  };

  const cancelConfirm = () => {
    setConfirmEntries(null);
    setCheckedNames(new Set());
  };

  const toggleCheck = (name: string) => {
    setCheckedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allChecked =
    confirmEntries !== null && confirmEntries.every((e) => checkedNames.has(e.name));

  return (
    <>
      <div className="config-editor">
        <div className="config-editor-row">
          {draftConfig.map((col, i) => (
            <ColumnConfigCard
              key={`${col.name}-${i}`}
              config={col}
              index={i}
              totalCount={draftConfig.length}
              fullConfig={draftConfig}
              onUpdate={(updates) => updateColumn(i, updates)}
              onDelete={() => deleteColumn(i)}
              onMoveLeft={() => moveColumn(i, -1)}
              onMoveRight={() => moveColumn(i, 1)}
            />
          ))}

          <button className="config-add-btn" onClick={addColumn} aria-label="Add column">
            +
          </button>
        </div>

        <div className="config-editor-footer">
          <div className="config-status-bar">
            <div className="config-status-box">
              {validationError ? (
                <span className="config-editor-error">{validationError}</span>
              ) : changeSummary.length > 0 ? (
                <span className="config-status-changes">
                  {changeSummary.join(" \u00b7 ")}
                </span>
              ) : (
                <span className="config-status-empty">No changes</span>
              )}
            </div>
            <button
              className="config-apply-btn"
              onClick={handleApply}
              disabled={!canApply}
            >
              Apply
            </button>
          </div>
          <div className="composer-links">
            <button
              className="clear-button"
              onClick={() => state.setEditing(false)}
            >
              Stash
            </button>
            <button
              className="clear-button"
              onClick={() => { resetDraft(); state.setEditing(false); }}
            >
              Abandon
            </button>
          </div>
        </div>
      </div>

      {confirmEntries && (
        <div className="confirm-overlay" onClick={cancelConfirm}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-header">Confirm Changes</div>
            <div className="confirm-body">
              <p className="confirm-description">
                The following columns will be affected across {steps.length} message{steps.length !== 1 ? "s" : ""}:
              </p>
              <div className="confirm-entries">
                {confirmEntries.map((entry) => (
                  <label key={entry.name} className="confirm-entry">
                    <input
                      type="checkbox"
                      checked={checkedNames.has(entry.name)}
                      onChange={() => toggleCheck(entry.name)}
                    />
                    <span className="confirm-entry-name">{displayName(entry.name)}</span>
                    <span className={`confirm-entry-action confirm-action-${entry.action}`}>
                      {entry.action}
                    </span>
                    {entry.reason === "cascade" && (
                      <span className="confirm-entry-cascade">(cascade)</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="confirm-footer">
              <button
                className="config-apply-btn"
                onClick={confirmApply}
                disabled={!allChecked}
              >
                Confirm
              </button>
              <button className="config-reset-btn" onClick={cancelConfirm}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
