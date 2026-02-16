import { useState } from "react";
import type { ColumnConfig, SessionConfig } from "../../shared/types.js";
import { PRESET_COLORS, displayName } from "../../shared/defaults.js";
import { ContextEditor } from "./ContextEditor.js";

interface ColumnConfigCardProps {
  config: ColumnConfig;
  index: number;
  totalCount: number;
  fullConfig: SessionConfig;
  onUpdate: (updates: Partial<ColumnConfig>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function ColumnConfigCard({
  config,
  index,
  totalCount,
  fullConfig,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: ColumnConfigCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Columns that appear before this one in the config
  const availableColumns = fullConfig
    .slice(0, index)
    .map((c) => c.name);

  // Check which columns depend on this one
  const dependents = fullConfig
    .filter((c) => c.context.some((ref) => ref.column === config.name))
    .map((c) => c.name);

  const handleDelete = () => {
    if (totalCount <= 1) return;

    if (dependents.length > 0) {
      const names = dependents.map((n) => displayName(n)).join(", ");
      if (!confirm(`Deleting "${displayName(config.name)}" will also remove: ${names}. Continue?`)) {
        return;
      }
    }
    onDelete();
  };

  return (
    <div className="config-card" style={{ "--column-color": config.color } as React.CSSProperties}>
      <div className="config-card-header">
        <div className="config-card-reorder">
          <button
            className="config-reorder-btn"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label="Move up"
          >
            ^
          </button>
          <button
            className="config-reorder-btn"
            onClick={onMoveDown}
            disabled={index === totalCount - 1}
            aria-label="Move down"
          >
            v
          </button>
        </div>
        <button
          className="config-card-title"
          onClick={() => setExpanded(!expanded)}
        >
          <span
            className="config-color-dot"
            style={{ background: config.color }}
          />
          <span className="config-card-name">{displayName(config.name)}</span>
          <span className="config-card-toggle">{expanded ? "\u2013" : "+"}</span>
        </button>
        <button
          className="config-delete-btn"
          onClick={handleDelete}
          disabled={totalCount <= 1}
          aria-label="Delete column"
        >
          x
        </button>
      </div>

      {expanded && (
        <div className="config-card-body">
          <div className="config-field">
            <label className="config-label">Name</label>
            <input
              className="config-input"
              value={config.name}
              onChange={(e) => onUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
            />
          </div>

          <div className="config-field">
            <label className="config-label">Color</label>
            <div className="config-swatches">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  className={`config-swatch ${config.color === color ? "active" : ""}`}
                  style={{ background: color }}
                  onClick={() => onUpdate({ color })}
                  aria-label={color}
                />
              ))}
            </div>
          </div>

          <div className="config-field">
            <label className="config-label">System Prompt</label>
            <textarea
              className="config-textarea"
              value={config.systemPrompt}
              onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
              rows={6}
            />
          </div>

          <div className="config-field">
            <label className="config-label">Footer Text</label>
            <input
              className="config-input"
              value={config.footerText}
              onChange={(e) => onUpdate({ footerText: e.target.value })}
              placeholder="Optional footer instruction"
            />
          </div>

          <ContextEditor
            context={config.context}
            availableColumns={availableColumns}
            onChange={(context) => onUpdate({ context })}
          />
        </div>
      )}
    </div>
  );
}
