import { useState, useRef } from "react";
import type { ColumnarState } from "../hooks/useColumnar.js";
import type { ColumnConfig, SessionConfig, Mutation } from "../../shared/types.js";
import { PRESET_COLORS, displayName, columnId } from "../../shared/defaults.js";
import { ColumnConfigCard } from "./ColumnConfigCard.js";

interface ConfigEditorProps {
  state: ColumnarState;
}

interface ImpactEntry {
  name: string;
  action: "deleted" | "recomputed";
  reason: "direct" | "cascade";
}

function columnsAffectComputation(a: ColumnConfig, b: ColumnConfig): boolean {
  return (
    a.name !== b.name ||
    a.systemPrompt !== b.systemPrompt ||
    a.reminder !== b.reminder ||
    JSON.stringify(a.context) !== JSON.stringify(b.context)
  );
}

function computeImpact(
  appliedConfig: SessionConfig,
  draftConfig: SessionConfig,
): ImpactEntry[] | null {
  const entries: ImpactEntry[] = [];
  const seen = new Set<string>();
  const appliedById = new Map(appliedConfig.map((c) => [c.id, c]));
  const draftById = new Map(draftConfig.map((c) => [c.id, c]));

  // Directly removed columns
  const removedNames: string[] = [];
  for (const [id, old] of appliedById) {
    if (!draftById.has(id)) removedNames.push(old.name);
  }

  // Directly modified columns (computation-affecting fields changed)
  const modifiedNames: string[] = [];
  for (const [id, draft] of draftById) {
    const old = appliedById.get(id);
    if (!old) continue;
    if (columnsAffectComputation(old, draft)) {
      modifiedNames.push(draft.name);
    }
  }

  if (removedNames.length === 0 && modifiedNames.length === 0) return null;

  // Cascade deletions
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

  // Cascade recomputation
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

function changeSummary(mutations: Mutation[], appliedConfig: SessionConfig, draftConfig: SessionConfig): string[] {
  if (mutations.length === 0) return [];

  const appliedById = new Map(appliedConfig.map((c) => [c.id, c]));
  const draftById = new Map(draftConfig.map((c) => [c.id, c]));
  const items: string[] = [];

  for (const [id, col] of draftById) {
    if (!appliedById.has(id)) items.push(`${displayName(col.name)} added`);
  }
  for (const [id, col] of appliedById) {
    if (!draftById.has(id)) items.push(`${displayName(col.name)} deleted`);
  }
  for (const [id, col] of draftById) {
    const old = appliedById.get(id);
    if (!old) continue;
    const diffs: string[] = [];
    if (old.name !== col.name) diffs.push("name");
    if (old.systemPrompt !== col.systemPrompt) diffs.push("prompt");
    if (old.reminder !== col.reminder) diffs.push("reminder");
    if (old.color !== col.color) diffs.push("color");
    if (JSON.stringify(old.context) !== JSON.stringify(col.context)) diffs.push("context");
    if (diffs.length > 0) items.push(`${displayName(col.name)} \u2014 ${diffs.join(", ")}`);
  }

  const appliedOrder = appliedConfig.map((c) => c.id);
  const draftOrder = draftConfig.map((c) => c.id);
  if (
    appliedOrder.length === draftOrder.length &&
    appliedOrder.every((id) => draftById.has(id)) &&
    appliedOrder.some((id, i) => id !== draftOrder[i])
  ) {
    items.push("reordered");
  }

  return items;
}

export function ConfigEditor({ state }: ConfigEditorProps) {
  const [confirmEntries, setConfirmEntries] = useState<ImpactEntry[] | null>(null);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set());
  const newColumnIdRef = useRef<string | null>(null);
  const { draftConfig, appliedConfig, mutations, steps, isDirty, validationError, dispatch, applyConfig, resetDraft } = state;
  const summary = changeSummary(mutations, appliedConfig, draftConfig);

  const addColumn = () => {
    const usedColors = new Set(draftConfig.map((c) => c.color));
    const color = PRESET_COLORS.find((c) => !usedColors.has(c)) ?? PRESET_COLORS[0];
    const id = columnId();
    newColumnIdRef.current = id;

    dispatch({
      type: "add",
      config: {
        id,
        name: "",
        systemPrompt: "",
        reminder: "Keep responses brief.",
        color,
        context: [
          { column: "input", row: "current", count: "all" },
          { column: "self", row: "previous", count: "all" },
        ],
      },
    });
  };

  const handleApply = () => {
    if (!applyConfig) return;
    const impact = computeImpact(appliedConfig, draftConfig);
    if (impact && steps.length > 0) {
      setConfirmEntries(impact);
      setCheckedNames(new Set());
    } else {
      applyConfig();
    }
  };

  const confirmApply = () => {
    if (!applyConfig) return;
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

  const confirming = confirmEntries !== null;

  return (
    <div className="config-editor">
      <div className="config-editor-row">
        {draftConfig.map((col, i) => {
          const isNew = col.id === newColumnIdRef.current;
          if (isNew) newColumnIdRef.current = null;
          return (
            <ColumnConfigCard
              key={col.id}
              config={col}
              index={i}
              totalCount={draftConfig.length}
              fullConfig={draftConfig}
              autoFocusName={isNew}
              onUpdate={(changes) => dispatch({ type: "update", id: col.id, changes })}
              onDelete={() => dispatch({ type: "remove", id: col.id })}
              onMoveLeft={() => dispatch({ type: "move", id: col.id, direction: -1 })}
              onMoveRight={() => dispatch({ type: "move", id: col.id, direction: 1 })}
            />
          );
        })}

        <button className="config-add-btn" onClick={addColumn} aria-label="Add column">
          +
        </button>
      </div>

      <div className="config-editor-footer">
        <div className="config-status-bar">
          <div className="config-status-box">
            {confirming ? (
              <div className="config-impact">
                <div className="config-impact-header">
                  Acknowledge impact across {steps.length} message{steps.length !== 1 ? "s" : ""}:
                </div>
                {confirmEntries.map((entry) => (
                  <label key={entry.name} className="config-impact-entry">
                    <input
                      type="checkbox"
                      checked={checkedNames.has(entry.name)}
                      onChange={() => toggleCheck(entry.name)}
                    />
                    <span className="config-impact-name">{displayName(entry.name)}</span>
                    <span className={`config-impact-action config-impact-${entry.action}`}>
                      {entry.action}
                    </span>
                    {entry.reason === "cascade" && (
                      <span className="config-impact-cascade">(cascade)</span>
                    )}
                  </label>
                ))}
              </div>
            ) : validationError ? (
              <span className="config-editor-error">{validationError}</span>
            ) : summary.length > 0 ? (
              <span className="config-status-changes">
                {summary.join(" \u00b7 ")}
              </span>
            ) : (
              <span className="config-status-empty">No changes</span>
            )}
          </div>
          {confirming ? (
            <button
              className="config-apply-btn"
              onClick={confirmApply}
              disabled={!allChecked || !applyConfig}
            >
              Confirm
            </button>
          ) : (
            <button
              className="config-apply-btn"
              onClick={handleApply}
              disabled={!applyConfig}
            >
              Apply
            </button>
          )}
        </div>
        <div className="composer-links">
          {confirming ? (
            <button className="clear-button" onClick={cancelConfirm}>
              Back
            </button>
          ) : isDirty ? (
            <>
              <button
                className="clear-button"
                onClick={() => state.setEditing(false)}
              >
                Stash
              </button>
              <button
                className="clear-button"
                onClick={resetDraft}
              >
                Abandon
              </button>
            </>
          ) : (
            <button
              className="clear-button"
              onClick={() => state.setEditing(false)}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
