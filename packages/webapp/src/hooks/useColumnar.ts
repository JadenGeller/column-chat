import { useState, useEffect, useCallback } from "react";

export interface Step {
  user: string;
  columns: Record<string, string>;
  isRunning: boolean;
  error?: string;
}

export interface ColumnarState {
  steps: Step[];
  columnOrder: string[];
  columnPrompts: Record<string, string>;
  isRunning: boolean;
  sendMessage: (text: string) => void;
  clearChat: () => void;
}

export function useColumnar(): ColumnarState {
  const [steps, setSteps] = useState<Step[]>([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnPrompts, setColumnPrompts] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);

  // Load existing state on mount
  useEffect(() => {
    fetch("/api/messages")
      .then((res) => res.json())
      .then((data: { steps: Array<{ user: string; columns: Record<string, string> }>; columnOrder: string[]; columnPrompts: Record<string, string> }) => {
        setSteps(data.steps.map((s) => ({ ...s, isRunning: false })));
        setColumnOrder(data.columnOrder);
        setColumnPrompts(data.columnPrompts);
      })
      .catch(console.error);
  }, []);

  const sendMessage = useCallback((text: string) => {
    const stepIndex = steps.length;

    setSteps((prev) => [
      ...prev,
      { user: text, columns: {}, isRunning: true },
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

          const { column, value: colValue } = data as {
            column: string;
            step: number;
            value: string;
          };

          setSteps((prev) =>
            prev.map((s, i) =>
              i === stepIndex
                ? { ...s, columns: { ...s.columns, [column]: colValue } }
                : s
            )
          );
        }
      }
    }).catch((err) => {
      markDone(err instanceof Error ? err.message : String(err));
    });
  }, [steps.length]);

  const clearChat = useCallback(() => {
    fetch("/api/clear", { method: "POST" })
      .then(() => {
        setSteps([]);
      })
      .catch(console.error);
  }, []);

  return { steps, columnOrder, columnPrompts, isRunning, sendMessage, clearChat };
}
