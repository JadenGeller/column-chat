import { useExternalStoreRuntime } from "@assistant-ui/react";
import type { ThreadMessageLike, AppendMessage } from "@assistant-ui/react";
import type { Step } from "./hooks/useColumnar.js";

interface StepMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
}

export function useColumnarRuntime(
  steps: Step[],
  columnOrder: string[],
  columnColors: Record<string, string>,
  columnPrompts: Record<string, string>,
  isRunning: boolean,
  sendMessage: (text: string) => void
) {
  // Convert steps to alternating user/assistant messages
  const messages: StepMessage[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    messages.push({
      role: "user",
      content: step.input,
      id: `user-${i}`,
    });

    // Assistant message = columns data encoded as JSON
    const columnsJson = JSON.stringify({
      stepIndex: i,
      columns: step.columns,
      columnOrder,
      columnColors,
      columnPrompts,
      isRunning: step.isRunning,
      error: step.error,
    });

    messages.push({
      role: "assistant",
      content: columnsJson,
      id: `assistant-${i}`,
    });
  }

  const convertMessage = (msg: StepMessage): ThreadMessageLike => ({
    role: msg.role,
    content: [{ type: "text", text: msg.content }],
    id: msg.id,
  });

  const onNew = async (message: AppendMessage) => {
    const textPart = message.content.find((p) => p.type === "text");
    if (!textPart || textPart.type !== "text") return;
    sendMessage(textPart.text);
  };

  return useExternalStoreRuntime({
    messages,
    convertMessage,
    onNew,
    isRunning,
  });
}
