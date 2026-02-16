import { useState } from "react";

interface ColumnCardProps {
  name: string;
  value: string | undefined;
}

const LABELS: Record<string, string> = {
  sentiment: "Sentiment",
  claims: "Claims",
  questions: "Questions",
  assumptions: "Assumptions",
  thread: "Thread",
  next_steps: "Next Steps",
};

export function ColumnCard({ name, value }: ColumnCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const label = LABELS[name] ?? name;
  const isLoading = value === undefined;

  return (
    <div className={`column-card ${isLoading ? "loading" : ""}`}>
      <button
        className="column-card-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="column-card-label">{label}</span>
        <span className="column-card-toggle">{collapsed ? "+" : "\u2013"}</span>
      </button>
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
