import { useState, useEffect, useCallback, useMemo } from "react";
import type { SessionConfig } from "../../shared/types.js";
import { DEFAULT_CONFIG } from "../../shared/defaults.js";

export interface Step {
  input: string;
  columns: Record<string, string>;
  computing: Set<string>;
  isRunning: boolean;
  error?: string;
}

export interface ColumnarState {
  steps: Step[];
  columnOrder: string[];
  columnColors: Record<string, string>;
  columnPrompts: Record<string, string>;
  columnDeps: Record<string, string[]>;
  isRunning: boolean;
  sendMessage: (text: string) => void;
  clearChat: () => void;
  appliedConfig: SessionConfig;
  draftConfig: SessionConfig;
  isDirty: boolean;
  updateDraft: (config: SessionConfig) => void;
  applyConfig: () => Promise<void>;
  resetDraft: () => void;
}

function deriveFromConfig(config: SessionConfig) {
  const columnOrder = config.map((c) => c.name);
  const columnColors: Record<string, string> = {};
  const columnPrompts: Record<string, string> = {};
  const columnDeps: Record<string, string[]> = {};
  for (const col of config) {
    columnColors[col.name] = col.color;
    columnPrompts[col.name] = col.systemPrompt;
    columnDeps[col.name] = col.context
      .map((ref) => ref.column)
      .filter((c) => c !== "input" && c !== "self");
  }
  return { columnOrder, columnColors, columnPrompts, columnDeps };
}

export function useColumnar(): ColumnarState {
  const [steps, setSteps] = useState<Step[]>([]);
  const [appliedConfig, setAppliedConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [draftConfig, setDraftConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [isRunning, setIsRunning] = useState(false);

  const { columnOrder, columnColors, columnPrompts, columnDeps } = useMemo(
    () => deriveFromConfig(appliedConfig),
    [appliedConfig]
  );

  const isDirty = useMemo(
    () => JSON.stringify(appliedConfig) !== JSON.stringify(draftConfig),
    [appliedConfig, draftConfig]
  );

  // Load existing state on mount
  useEffect(() => {
    fetch("/api/messages")
      .then((res) => res.json())
      .then((data: {
        steps: Array<{ input: string; columns: Record<string, string> }>;
        columnOrder: string[];
        config: SessionConfig;
      }) => {
        setSteps(data.steps.map((s) => ({ ...s, computing: new Set<string>(), isRunning: false })));
        setAppliedConfig(data.config);
        setDraftConfig(data.config);
      })
      .catch(console.error);
  }, []);

  const sendMessage = useCallback((text: string) => {
    const stepIndex = steps.length;

    setSteps((prev) => [
      ...prev,
      { input: text, columns: {}, computing: new Set(), isRunning: true },
    ]);
    setIsRunning(true);

    const markDone = (error?: string) => {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === stepIndex ? { ...s, isRunning: false, error } : s
        )
      );
      setIsRunning(false);
    };

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    }).then(async (res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.error) {
            markDone(data.error);
            return;
          }

          if (data.done) {
            markDone();
            return;
          }

          if (data.kind === "start") {
            const { column } = data as { column: string };
            setSteps((prev) =>
              prev.map((s, i) =>
                i === stepIndex
                  ? { ...s, computing: new Set(s.computing).add(column) }
                  : s
              )
            );
          } else if (data.kind === "delta") {
            const { column, delta } = data as { column: string; delta: string };
            setSteps((prev) =>
              prev.map((s, i) =>
                i === stepIndex
                  ? { ...s, columns: { ...s.columns, [column]: (s.columns[column] ?? "") + delta } }
                  : s
              )
            );
          } else if (data.kind === "value") {
            const { column, value: colValue } = data as { column: string; value: string };
            setSteps((prev) =>
              prev.map((s, i) =>
                i === stepIndex
                  ? { ...s, columns: { ...s.columns, [column]: colValue } }
                  : s
              )
            );
          }
        }
      }
    }).catch((err) => {
      markDone(err instanceof Error ? err.message : String(err));
    });
  }, [steps.length]);

  const clearChat = useCallback(() => {
    fetch("/api/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(() => {
        setSteps([]);
      })
      .catch(console.error);
  }, []);

  const updateDraft = useCallback((config: SessionConfig) => {
    setDraftConfig(config);
  }, []);

  const applyConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: draftConfig }),
      });

      const contentType = res.headers.get("Content-Type") ?? "";

      // Non-streaming response (color-only or error)
      if (contentType.includes("application/json")) {
        const data = await res.json() as { ok: boolean; config?: SessionConfig; error?: string };
        if (data.ok && data.config) {
          setAppliedConfig(data.config);
          setDraftConfig(data.config);
        }
        return;
      }

      // SSE streaming response
      setIsRunning(true);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.error) {
            console.error("Config apply error:", data.error);
            setIsRunning(false);
            return;
          }

          if (data.done) {
            setIsRunning(false);
            return;
          }

          if (data.kind === "init") {
            const { steps: initSteps, columnOrder: newOrder, config: newConfig } = data as {
              steps: Array<{ input: string; columns: Record<string, string> }>;
              columnOrder: string[];
              config: SessionConfig;
            };
            setAppliedConfig(newConfig);
            setDraftConfig(newConfig);
            setSteps(
              initSteps.map((s) => ({
                ...s,
                computing: new Set<string>(),
                isRunning: false,
              }))
            );
          } else if (data.kind === "start") {
            const { column, step } = data as { column: string; step: number };
            setSteps((prev) =>
              prev.map((s, i) =>
                i === step
                  ? { ...s, computing: new Set(s.computing).add(column), isRunning: true }
                  : s
              )
            );
          } else if (data.kind === "delta") {
            const { column, step, delta } = data as { column: string; step: number; delta: string };
            setSteps((prev) =>
              prev.map((s, i) =>
                i === step
                  ? { ...s, columns: { ...s.columns, [column]: (s.columns[column] ?? "") + delta } }
                  : s
              )
            );
          } else if (data.kind === "value") {
            const { column, step, value: colValue } = data as { column: string; step: number; value: string };
            setSteps((prev) =>
              prev.map((s, i) =>
                i === step
                  ? { ...s, columns: { ...s.columns, [column]: colValue } }
                  : s
              )
            );
          }
        }
      }
    } catch (err) {
      console.error("Failed to apply config:", err);
      setIsRunning(false);
    }
  }, [draftConfig]);

  const resetDraft = useCallback(() => {
    setDraftConfig(appliedConfig);
  }, [appliedConfig]);

  return {
    steps,
    columnOrder,
    columnColors,
    columnPrompts,
    columnDeps,
    isRunning,
    sendMessage,
    clearChat,
    appliedConfig,
    draftConfig,
    isDirty,
    updateDraft,
    applyConfig,
    resetDraft,
  };
}
