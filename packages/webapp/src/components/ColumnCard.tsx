import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { displayName } from "../../shared/defaults.js";

interface ColumnCardProps {
  name: string;
  value: string | undefined;
  color?: string;
  prompt?: string;
  index: number;
  status: "waiting" | "computing" | "done";
  dependencies?: { name: string; done: boolean }[];
  expanded?: boolean;
  onToggle?: () => void;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function ColumnCard({ name, value, color, prompt, index, status, dependencies, expanded, onToggle }: ColumnCardProps) {
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = displayName(name);
  const isLoading = status !== "done";

  const showTooltip = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipStyle({
      position: "fixed",
      top: rect.bottom + 8,
      left: rect.left,
    });
  }, []);

  const hideTooltip = useCallback(() => setTooltipStyle(null), []);

  const style = color ? { "--column-color": color } as React.CSSProperties : undefined;

  const wordCount = value ? countWords(value) : 0;

  return (
    <div className={`column-card ${isLoading ? "loading" : ""} ${expanded ? "expanded" : ""}`} style={style}>
      <button
        className="column-card-bar"
        onClick={onToggle}
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        <span className="column-card-bar-label">{label}</span>
      </button>
      <div className="column-card-content">
        {prompt && (
          <div className="column-card-toolbar">
            <button
              ref={buttonRef}
              className="prompt-hint-button"
              onMouseEnter={showTooltip}
              onMouseLeave={hideTooltip}
              onClick={(e) => {
                e.stopPropagation();
                tooltipStyle ? hideTooltip() : showTooltip();
              }}
              aria-label="View system prompt"
            >
              ?
            </button>
          </div>
        )}
        <div className="column-card-body">
          {status !== "done" && value === undefined && dependencies && dependencies.length > 0 ? (
            <div className="column-card-waiting">
              <div className="waiting-header">{status === "computing" ? "generating" : "waiting on"}</div>
              <div className="waiting-deps">
                {dependencies.map((dep) => (
                  <div key={dep.name} className={`waiting-dep ${dep.done ? "done" : ""}`}>
                    <span className="waiting-dep-status">{dep.done ? "[done]" : "[....]"}</span>
                    <span className="waiting-dep-name">{displayName(dep.name)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : isLoading ? (
            <div className="column-card-spinner">Computing...</div>
          ) : (
            <div className="column-card-value">
              {value}
            </div>
          )}
        </div>
        {!isLoading && value && (
          <div className="column-card-footnote">
            <span>{wordCount} words</span>
          </div>
        )}
        {tooltipStyle &&
          createPortal(
            <div
              className="prompt-tooltip"
              style={tooltipStyle}
              onMouseEnter={showTooltip}
              onMouseLeave={hideTooltip}
            >
              {prompt}
            </div>,
            document.body
          )}
      </div>
    </div>
  );
}
