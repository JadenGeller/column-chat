import type { ColumnContextRef } from "../../shared/types.js";
import { displayName } from "../../shared/defaults.js";

interface ContextEditorProps {
  context: ColumnContextRef[];
  availableColumns: string[]; // columns appearing before this one
  onChange: (context: ColumnContextRef[]) => void;
}

export function ContextEditor({ context, availableColumns, onChange }: ContextEditorProps) {
  const columnOptions = ["user", "self", ...availableColumns];

  const updateRef = (index: number, updates: Partial<ColumnContextRef>) => {
    const next = context.map((ref, i) =>
      i === index ? { ...ref, ...updates } : ref
    );
    onChange(next);
  };

  const removeRef = (index: number) => {
    onChange(context.filter((_, i) => i !== index));
  };

  const addRef = () => {
    onChange([...context, { column: "user", windowMode: "all" }]);
  };

  return (
    <div className="context-editor">
      <label className="context-editor-label">Context Dependencies</label>
      {context.map((ref, i) => (
        <div key={i} className="context-row">
          <select
            className="context-select"
            value={ref.column}
            onChange={(e) => updateRef(i, { column: e.target.value })}
          >
            {columnOptions.map((col) => (
              <option key={col} value={col}>
                {col === "self" ? "self" : displayName(col)}
              </option>
            ))}
          </select>
          <select
            className="context-select context-mode"
            value={
              typeof ref.windowMode === "object"
                ? "window"
                : ref.windowMode
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "window") {
                updateRef(i, { windowMode: { window: 3 } });
              } else {
                updateRef(i, { windowMode: v as "all" | "latest" });
              }
            }}
          >
            <option value="all">all</option>
            <option value="latest">latest</option>
            <option value="window">window</option>
          </select>
          {typeof ref.windowMode === "object" && (
            <input
              type="number"
              className="context-window-input"
              min={1}
              value={ref.windowMode.window}
              onChange={(e) =>
                updateRef(i, {
                  windowMode: { window: Math.max(1, parseInt(e.target.value) || 1) },
                })
              }
            />
          )}
          <button
            className="context-remove"
            onClick={() => removeRef(i)}
            aria-label="Remove dependency"
          >
            x
          </button>
        </div>
      ))}
      <button className="context-add" onClick={addRef}>
        + Add dependency
      </button>
    </div>
  );
}
