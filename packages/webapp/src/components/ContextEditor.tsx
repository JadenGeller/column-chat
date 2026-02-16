import type { ColumnContextRef } from "../../shared/types.js";
import { displayName } from "../../shared/defaults.js";

interface ContextEditorProps {
  context: ColumnContextRef[];
  availableColumns: string[]; // columns appearing before this one
  onChange: (context: ColumnContextRef[]) => void;
}

export function ContextEditor({ context, availableColumns, onChange }: ContextEditorProps) {
  const columnOptions = ["input", "self", ...availableColumns];

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
    onChange([...context, { column: "input", row: "current", count: "all" }]);
  };

  return (
    <div className="context-editor">
      <label className="context-editor-label">Context Dependencies</label>
      {context.map((ref, i) => (
        <div key={i} className="context-row">
          <select
            className="context-select"
            value={ref.column}
            onChange={(e) => {
              const col = e.target.value;
              if (col === "self") {
                updateRef(i, { column: col, row: "previous" });
              } else {
                updateRef(i, { column: col });
              }
            }}
          >
            {columnOptions.map((col) => (
              <option key={col} value={col}>
                {col === "self" ? "self" : displayName(col)}
              </option>
            ))}
          </select>
          <select
            className="context-select context-mode"
            value={ref.row}
            onChange={(e) => updateRef(i, { row: e.target.value as "current" | "previous" })}
            disabled={ref.column === "self"}
          >
            <option value="current">current</option>
            <option value="previous">previous</option>
          </select>
          <select
            className="context-select context-mode"
            value={ref.count}
            onChange={(e) => updateRef(i, { count: e.target.value as "single" | "all" })}
          >
            <option value="all">all</option>
            <option value="single">single</option>
          </select>
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
