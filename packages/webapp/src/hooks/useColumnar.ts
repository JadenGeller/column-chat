import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { SessionConfig, Capabilities } from "../../shared/types.js";

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
  editing: boolean;
  setEditing: (editing: boolean) => void;
  mode: "cloud" | "local" | null;
  apiKey: string | null;
  setApiKey: (key: string) => void;
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

// SSE stream reader helper
function readSSE(
  res: Response,
  onEvent: (data: any) => void,
  onDone: () => void,
  onError: (error: string) => void
) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
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
          onError(data.error);
          return;
        }

        if (data.done) {
          onDone();
          return;
        }

        onEvent(data);
      }
    }
  })();
}

// localStorage helpers
interface SavedChat {
  steps: Array<{ input: string; columns: Record<string, string> }>;
  config: SessionConfig;
}

function loadChat(chatId: string): SavedChat | null {
  try {
    const raw = localStorage.getItem(`columnar:${chatId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedChat;
  } catch {
    return null;
  }
}

function saveChat(chatId: string, data: SavedChat) {
  localStorage.setItem(`columnar:${chatId}`, JSON.stringify(data));
}

function loadApiKey(): string | null {
  return localStorage.getItem("columnar:apiKey");
}

function saveApiKey(key: string) {
  localStorage.setItem("columnar:apiKey", key);
}

// Type for the local session ref
type LocalSession = Awaited<ReturnType<typeof import("../../shared/flow.js").createSessionFromConfig>>;

export function useColumnar(chatId: string): ColumnarState {
  const [mode, setMode] = useState<"cloud" | "local" | null>(null);
  const [apiKey, setApiKeyState] = useState<string | null>(loadApiKey());
  const [steps, setSteps] = useState<Step[]>([]);
  const [appliedConfig, setAppliedConfig] = useState<SessionConfig>([]);
  const [draftConfig, setDraftConfig] = useState<SessionConfig>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [editing, setEditing] = useState(false);

  // Local mode session ref
  const sessionRef = useRef<LocalSession | null>(null);
  const sessionConfigRef = useRef<SessionConfig>([]);

  const { columnOrder, columnColors, columnPrompts, columnDeps } = useMemo(
    () => deriveFromConfig(appliedConfig),
    [appliedConfig]
  );

  const isDirty = useMemo(
    () => JSON.stringify(appliedConfig) !== JSON.stringify(draftConfig),
    [appliedConfig, draftConfig]
  );

  const setApiKey = useCallback((key: string) => {
    saveApiKey(key);
    setApiKeyState(key);
  }, []);

  // Fetch capabilities on mount
  useEffect(() => {
    fetch("/api/capabilities")
      .then((res) => res.json())
      .then((data: Capabilities) => setMode(data.mode))
      .catch(() => setMode("local"));
  }, []);

  // Cloud mode: load existing state on mount
  useEffect(() => {
    if (mode !== "cloud") return;
    fetch(`/api/messages/${chatId}`)
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
  }, [mode, chatId]);

  // Local mode: load from localStorage, create flow
  useEffect(() => {
    if (mode !== "local" || !apiKey) return;
    let cancelled = false;

    (async () => {
      const [{ createAnthropic }, { createSessionFromConfig }, { inMemoryStorage }] = await Promise.all([
        import("@ai-sdk/anthropic"),
        import("../../shared/flow.js"),
        import("columnar"),
      ]);
      if (cancelled) return;

      const provider = createAnthropic({
        apiKey,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      });
      const model = provider("claude-sonnet-4-5-20250929");

      const saved = loadChat(chatId);
      const config = saved?.config ?? [];

      // Build pre-populated store from saved steps
      const store: Record<string, string>[] = [];
      if (saved?.steps) {
        for (const s of saved.steps) {
          store.push({ input: s.input, ...s.columns });
        }
      }

      // Create session with pre-populated storage
      const storage = inMemoryStorage(store);
      const session = createSessionFromConfig(config, model, storage);

      sessionRef.current = session;
      sessionConfigRef.current = config;

      if (saved?.steps) {
        setSteps(saved.steps.map((s) => ({
          ...s,
          computing: new Set<string>(),
          isRunning: false,
        })));
      }
      setAppliedConfig(config);
      setDraftConfig(config);
    })();

    return () => { cancelled = true; };
  }, [mode, chatId, apiKey]);

  // Persist helper for local mode
  const persist = useCallback((currentSteps: Step[], config: SessionConfig) => {
    const data: SavedChat = {
      steps: currentSteps.map((s) => ({ input: s.input, columns: s.columns })),
      config,
    };
    saveChat(chatId, data);
  }, [chatId]);

  // ---- sendMessage ----
  const sendMessage = useCallback((text: string) => {
    const stepIndex = steps.length;

    setSteps((prev) => [
      ...prev,
      { input: text, columns: {}, computing: new Set(), isRunning: true },
    ]);
    setIsRunning(true);

    if (mode === "cloud") {
      const markDone = (error?: string) => {
        setSteps((prev) =>
          prev.map((s, i) =>
            i === stepIndex ? { ...s, isRunning: false, computing: new Set<string>(), error } : s
          )
        );
        setIsRunning(false);
      };

      fetch(`/api/chat/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      }).then((res) => {
        readSSE(
          res,
          (data) => {
            if (data.kind === "start") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === stepIndex
                    ? { ...s, computing: new Set(s.computing).add(data.column) }
                    : s
                )
              );
            } else if (data.kind === "delta") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === stepIndex
                    ? { ...s, columns: { ...s.columns, [data.column]: (s.columns[data.column] ?? "") + data.delta } }
                    : s
                )
              );
            } else if (data.kind === "value") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === stepIndex
                    ? { ...s, columns: { ...s.columns, [data.column]: data.value } }
                    : s
                )
              );
            }
          },
          () => markDone(),
          (error) => markDone(error)
        );
      }).catch((err) => {
        markDone(err instanceof Error ? err.message : String(err));
      });
    } else {
      // Local mode
      const session = sessionRef.current;
      if (!session) return;

      session.input.push(text);

      (async () => {
        try {
          for await (const event of session.f.run()) {
            if (event.kind === "start") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === stepIndex
                    ? { ...s, computing: new Set(s.computing).add(event.column) }
                    : s
                )
              );
            } else if (event.kind === "delta") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === stepIndex
                    ? { ...s, columns: { ...s.columns, [event.column]: (s.columns[event.column] ?? "") + event.delta } }
                    : s
                )
              );
            } else if (event.kind === "value") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === stepIndex
                    ? { ...s, columns: { ...s.columns, [event.column]: event.value } }
                    : s
                )
              );
            }
          }
          setSteps((prev) => {
            const updated = prev.map((s, i) =>
              i === stepIndex ? { ...s, isRunning: false, computing: new Set<string>() } : s
            );
            persist(updated, sessionConfigRef.current);
            return updated;
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          setSteps((prev) =>
            prev.map((s, i) =>
              i === stepIndex ? { ...s, isRunning: false, error } : s
            )
          );
        }
        setIsRunning(false);
      })();
    }
  }, [steps.length, chatId, mode, persist]);

  // ---- clearChat ----
  const clearChat = useCallback(() => {
    window.open("/", "_blank");
  }, []);

  const updateDraft = useCallback((config: SessionConfig) => {
    setDraftConfig(config);
  }, []);

  // ---- applyConfig ----
  const applyConfig = useCallback(async () => {
    if (mode === "cloud") {
      try {
        const res = await fetch(`/api/config/${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: draftConfig }),
        });

        const contentType = res.headers.get("Content-Type") ?? "";

        if (contentType.includes("application/json")) {
          const data = await res.json() as { ok: boolean; config?: SessionConfig; error?: string };
          if (data.ok && data.config) {
            setAppliedConfig(data.config);
            setDraftConfig(data.config);
          }
          return;
        }

        setIsRunning(true);
        readSSE(
          res,
          (data) => {
            if (data.kind === "init") {
              setAppliedConfig(data.config);
              setDraftConfig(data.config);
              setSteps(
                data.steps.map((s: any) => ({
                  ...s,
                  computing: new Set<string>(),
                  isRunning: false,
                }))
              );
            } else if (data.kind === "start") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === data.step
                    ? { ...s, computing: new Set(s.computing).add(data.column), isRunning: true }
                    : s
                )
              );
            } else if (data.kind === "delta") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === data.step
                    ? { ...s, columns: { ...s.columns, [data.column]: (s.columns[data.column] ?? "") + data.delta } }
                    : s
                )
              );
            } else if (data.kind === "value") {
              setSteps((prev) =>
                prev.map((s, i) =>
                  i === data.step
                    ? { ...s, columns: { ...s.columns, [data.column]: data.value } }
                    : s
                )
              );
            }
          },
          () => setIsRunning(false),
          (error) => {
            console.error("Config apply error:", error);
            setIsRunning(false);
          }
        );
      } catch (err) {
        console.error("Failed to apply config:", err);
        setIsRunning(false);
      }
    } else {
      // Local mode: recreate session with new config, replay inputs
      if (!apiKey) return;

      const [{ createAnthropic }, { createSessionFromConfig }] = await Promise.all([
        import("@ai-sdk/anthropic"),
        import("../../shared/flow.js"),
      ]);

      const provider = createAnthropic({
        apiKey,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      });
      const model = provider("claude-sonnet-4-5-20250929");

      const newConfig = draftConfig;
      const savedInputs = steps.map((s) => s.input);
      const freshSession = createSessionFromConfig(newConfig, model);

      sessionRef.current = freshSession;
      sessionConfigRef.current = newConfig;
      setAppliedConfig(newConfig);
      setDraftConfig(newConfig);

      if (savedInputs.length === 0) {
        persist([], newConfig);
        return;
      }

      setIsRunning(true);
      setSteps(savedInputs.map((input) => ({
        input,
        columns: {},
        computing: new Set<string>(),
        isRunning: true,
      })));

      for (const input of savedInputs) {
        freshSession.input.push(input);
      }

      try {
        for await (const event of freshSession.f.run()) {
          if (event.kind === "start") {
            setSteps((prev) =>
              prev.map((s, i) =>
                i === event.step
                  ? { ...s, computing: new Set(s.computing).add(event.column), isRunning: true }
                  : s
              )
            );
          } else if (event.kind === "delta") {
            setSteps((prev) =>
              prev.map((s, i) =>
                i === event.step
                  ? { ...s, columns: { ...s.columns, [event.column]: (s.columns[event.column] ?? "") + event.delta } }
                  : s
              )
            );
          } else if (event.kind === "value") {
            setSteps((prev) =>
              prev.map((s, i) =>
                i === event.step
                  ? { ...s, columns: { ...s.columns, [event.column]: event.value } }
                  : s
              )
            );
          }
        }
        setSteps((prev) => {
          const updated = prev.map((s) => ({ ...s, isRunning: false, computing: new Set<string>() }));
          persist(updated, newConfig);
          return updated;
        });
      } catch (err) {
        console.error("Config apply error:", err);
      }
      setIsRunning(false);
    }
  }, [mode, draftConfig, chatId, apiKey, steps, persist]);

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
    editing,
    setEditing,
    mode,
    apiKey,
    setApiKey,
  };
}
