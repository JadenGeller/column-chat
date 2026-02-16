import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { displayName } from "../../shared/defaults.js";

interface ColumnCardProps {
  name: string;
  value: string | undefined;
  color?: string;
  prompt?: string;
}

export function ColumnCard({ name, value, color, prompt }: ColumnCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = displayName(name);
  const isLoading = value === undefined;

  const showTooltip = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipStyle({
      position: "fixed",
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  const hideTooltip = useCallback(() => setTooltipStyle(null), []);

  const style = color ? { "--column-color": color } as React.CSSProperties : undefined;

  return (
    <div className={`column-card ${isLoading ? "loading" : ""}`} style={style}>
      <div className="column-card-header">
        <button
          className="column-card-title"
          onClick={() => setCollapsed(!collapsed)}
        >
          <span className="column-card-label">{label}</span>
          <span className="column-card-toggle">
            {collapsed ? "+" : "\u2013"}
          </span>
        </button>
        {prompt && (
          <>
            <button
              ref={buttonRef}
              className="prompt-hint-button"
              onMouseEnter={showTooltip}
              onMouseLeave={hideTooltip}
              onClick={() => tooltipStyle ? hideTooltip() : showTooltip()}
              aria-label="View system prompt"
            >
              ?
            </button>
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
          </>
        )}
      </div>
      {!collapsed && (
        <div className="column-card-body">
          {isLoading ? (
            <div className="column-card-spinner">Computing...</div>
          ) : (
            <div className="column-card-value">{value}</div>
          )}
        </div>
      )}
    </div>
  );
}
