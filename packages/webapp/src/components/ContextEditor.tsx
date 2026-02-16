import type { ColumnContextRef } from "../../shared/types.js";
import { displayName } from "../../shared/defaults.js";

interface ContextEditorProps {
  context: ColumnContextRef[];
  availableColumns: string[]; // columns appearing before this one
  onChange: (context: ColumnContextRef[]) => void;
}

export function ContextEditor({ context, availableColumns, onChange }: ContextEditorProps) {
  const allOptions = ["input", "self", ...availableColumns];
  const refByColumn = new Map(context.map((ref) => [ref.column, ref]));

  const toggle = (col: string) => {
    if (refByColumn.has(col)) {
      onChange(context.filter((ref) => ref.column !== col));
    } else {
      const defaults: ColumnContextRef = col === "self"
        ? { column: col, row: "previous", count: "all" }
        : { column: col, row: "current", count: "all" };
      onChange([...context, defaults]);
    }
  };

  const updateRef = (col: string, updates: Partial<ColumnContextRef>) => {
    onChange(context.map((ref) => ref.column === col ? { ...ref, ...updates } : ref));
  };

  return (
    <div className="context-editor">
      <label className="context-editor-label">Dependencies</label>
      {allOptions.map((col) => {
        const ref = refByColumn.get(col);
        const checked = !!ref;
        const isSelf = col === "self";

        return (
          <label key={col} className={`context-row ${checked ? "" : "context-row-unchecked"}`}>
            <input
              type="checkbox"
              className="context-checkbox"
              checked={checked}
              onChange={() => toggle(col)}
            />
            <span className="context-col-name">
              {isSelf ? "self" : displayName(col)}
            </span>
            {checked && (
              <>
                {isSelf ? (
                  <span className="context-fixed">previous</span>
                ) : (
                  <select
                    className="context-select context-mode"
                    value={ref!.row}
                    onChange={(e) => updateRef(col, { row: e.target.value as "current" | "previous" })}
                  >
                    <option value="current">current</option>
                    <option value="previous">previous</option>
                  </select>
                )}
                <select
                  className="context-select context-mode"
                  value={ref!.count}
                  onChange={(e) => updateRef(col, { count: e.target.value as "single" | "all" })}
                >
                  <option value="all">all</option>
                  <option value="single">single</option>
                </select>
              </>
            )}
          </label>
        );
      })}
    </div>
  );
}
