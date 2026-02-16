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
  onMoveLeft: () => void;
  onMoveRight: () => void;
}

export function ColumnConfigCard({
  config,
  index,
  totalCount,
  fullConfig,
  onUpdate,
  onDelete,
  onMoveLeft,
  onMoveRight,
}: ColumnConfigCardProps) {
  const availableColumns = fullConfig
    .filter((_, i) => i !== index)
    .map((c) => c.name);

  const handleDelete = () => {
    if (totalCount <= 1) return;
    onDelete();
  };

  const label = displayName(config.name);

  return (
    <div className="config-card" style={{ "--column-color": config.color } as React.CSSProperties}>
      <div className="column-card-bar">
        <span className="column-card-bar-label">{label}</span>
      </div>
      <div className="column-card-content">
        <div className="config-card-toolbar">
          <div className="config-card-reorder">
            <button
              className="config-reorder-btn"
              onClick={onMoveLeft}
              disabled={index === 0}
              aria-label="Move left"
            >
              &#8592;
            </button>
            <button
              className="config-reorder-btn"
              onClick={onMoveRight}
              disabled={index === totalCount - 1}
              aria-label="Move right"
            >
              &#8594;
            </button>
          </div>
          <button
            className="config-delete-btn"
            onClick={handleDelete}
            disabled={totalCount <= 1}
            aria-label="Delete column"
          >
            x
          </button>
        </div>

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
            <label className="config-label">
              System reminder
              <span className="config-label-hint" data-tip="Injected as the final message before the model responds. Use for formatting rules, output constraints, etc.">?</span>
            </label>
            <input
              className="config-input"
              value={config.reminder}
              onChange={(e) => onUpdate({ reminder: e.target.value })}
              placeholder=""
            />
          </div>

          <ContextEditor
            context={config.context}
            availableColumns={availableColumns}
            onChange={(context) => onUpdate({ context })}
          />
        </div>
      </div>
    </div>
  );
}
