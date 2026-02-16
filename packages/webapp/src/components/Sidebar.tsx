import { useState } from "react";
import type { ColumnarState } from "../hooks/useColumnar.js";
import type { ColumnConfig, SessionConfig } from "../../shared/types.js";
import { PRESET_COLORS } from "../../shared/defaults.js";
import { ColumnConfigCard } from "./ColumnConfigCard.js";

interface SidebarProps {
  state: ColumnarState;
}

const RESERVED_NAMES = new Set(["input", "self"]);

function validateConfig(config: SessionConfig): string | null {
  if (config.length === 0) return "At least one column is required";

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

export function Sidebar({ state }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const { draftConfig, isDirty, isRunning, updateDraft, applyConfig, resetDraft } = state;

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
                onClick={applyConfig}
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
    </>
  );
}
