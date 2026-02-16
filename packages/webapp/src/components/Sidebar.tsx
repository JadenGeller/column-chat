import { useState } from "react";
import type { ColumnarState } from "../hooks/useColumnar.js";
import type { ColumnConfig, SessionConfig } from "../../shared/types.js";
import { PRESET_COLORS, displayName } from "../../shared/defaults.js";
import { ColumnConfigCard } from "./ColumnConfigCard.js";

interface SidebarProps {
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

  // Find removed columns
  const removedNames: string[] = [];
  for (const name of appliedByName.keys()) {
    if (!draftByName.has(name)) removedNames.push(name);
  }

  // Find modified columns
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

  // Collect transitive dependents of removed columns (from applied config)
  const removedSet = new Set(removedNames);
  for (const name of removedNames) {
    if (!seen.has(name)) {
      seen.add(name);
      entries.push({ name, action: "deleted", reason: "direct" });
    }
  }
  // Forward-scan applied config for cascade deletions
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

  // Collect transitive dependents of modified columns (from draft config)
  const dirtySet = new Set(modifiedNames);
  for (const name of modifiedNames) {
    if (!seen.has(name)) {
      seen.add(name);
      entries.push({ name, action: "recomputed", reason: "direct" });
    }
  }
  // Forward-scan draft config for cascade recomputation
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

export function Sidebar({ state }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const [confirmEntries, setConfirmEntries] = useState<ImpactEntry[] | null>(null);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set());
  const { draftConfig, appliedConfig, steps, isDirty, isRunning, updateDraft, applyConfig, resetDraft } = state;

  const validationError = validateConfig(draftConfig);
  const canApply = isDirty && !isRunning && !validationError;

  const updateColumn = (index: number, updates: Partial<ColumnConfig>) => {
    const next = [...draftConfig];
    const old = next[index];
    const updated = { ...old, ...updates };

    // If name changed, update references in downstream columns
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
    // Cascade: remove any columns that reference this one
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

    // After reorder, strip any context refs that now point forward
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
    }
  };

  const confirmApply = () => {
    setConfirmEntries(null);
    setCheckedNames(new Set());
    applyConfig();
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
      <button
        className={`sidebar-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label="Toggle sidebar"
      >
        {open ? ">" : "<"}
      </button>

      {open && (
        <div className="sidebar">
          <div className="sidebar-header">
            <h3 className="sidebar-title">Columns</h3>
          </div>

          <div className="sidebar-body">
            {draftConfig.map((col, i) => (
              <ColumnConfigCard
                key={`${col.name}-${i}`}
                config={col}
                index={i}
                totalCount={draftConfig.length}
                fullConfig={draftConfig}
                onUpdate={(updates) => updateColumn(i, updates)}
                onDelete={() => deleteColumn(i)}
                onMoveUp={() => moveColumn(i, -1)}
                onMoveDown={() => moveColumn(i, 1)}
              />
            ))}

            <button className="sidebar-add-btn" onClick={addColumn}>
              + Add Column
            </button>
          </div>

          <div className="sidebar-footer">
            {validationError && (
              <div className="sidebar-error">{validationError}</div>
            )}
            <div className="sidebar-actions">
              <button
                className="sidebar-apply-btn"
                onClick={handleApply}
                disabled={!canApply}
              >
                Apply Changes
              </button>
              <button
                className="sidebar-reset-btn"
                onClick={resetDraft}
                disabled={!isDirty}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

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
                className="sidebar-apply-btn"
                onClick={confirmApply}
                disabled={!allChecked}
              >
                Confirm
              </button>
              <button className="sidebar-reset-btn" onClick={cancelConfirm}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
