import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { displayName } from "../../shared/defaults.js";

interface ColumnCardProps {
  name: string;
  value: string | undefined;
  color?: string;
  prompt?: string;
  index: number;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function ColumnCard({ name, value, color, prompt, index }: ColumnCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = displayName(name);
  const isLoading = value === undefined;

  const sectionNumber = String(index + 1).padStart(2, "0");

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
    <div className={`column-card ${isLoading ? "loading" : ""} ${collapsed ? "collapsed" : ""}`} style={style}>
      <button
        className="column-card-bar"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand" : "Collapse"}
      >
        <span className="column-card-number">{sectionNumber}</span>
        <span className="column-card-bar-label">{label}</span>
      </button>
      {!collapsed && (
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
            {isLoading ? (
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
      )}
    </div>
  );
}
