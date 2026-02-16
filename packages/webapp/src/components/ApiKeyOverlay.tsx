import { useState } from "react";

interface ApiKeyOverlayProps {
  onSubmit: (key: string) => void;
}

export function ApiKeyOverlay({ onSubmit }: ApiKeyOverlayProps) {
  const [key, setKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="api-key-overlay">
      <form className="api-key-dialog" onSubmit={handleSubmit}>
        <div className="api-key-header">Anthropic API Key</div>
        <p className="api-key-description">
          Running in local mode. Your key stays in the browser and calls the Anthropic API directly.
        </p>
        <input
          type="password"
          className="api-key-input"
          placeholder="sk-ant-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          className="api-key-submit"
          disabled={!key.trim()}
        >
          Get started
        </button>
      </form>
    </div>
  );
}
