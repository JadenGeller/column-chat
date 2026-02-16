import type { FC } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import { useColumnar } from "../hooks/useColumnar.js";
import { useColumnarRuntime } from "../runtime.js";
import { ColumnCard } from "./ColumnCard.js";

export function Chat() {
  const { steps, columnOrder, isRunning, sendMessage, clearChat } = useColumnar();
  const runtime = useColumnarRuntime(steps, columnOrder, isRunning, sendMessage);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="thread-root">
        <ThreadPrimitive.Viewport className="thread-viewport">
          <ThreadPrimitive.Empty>
            <div className="thread-empty">
              <h2>Thinking Prism</h2>
              <p>
                Write freely. Your thoughts will be refracted through multiple
                analytical lenses.
              </p>
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>

        <div className="composer-container">
          <ComposerPrimitive.Root className="composer-root">
            <ComposerPrimitive.Input
              className="composer-input"
              placeholder="Think out loud..."
            />
            <ComposerPrimitive.Send className="composer-send">
              Send
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
          {steps.length > 0 && (
            <button
              className="clear-button"
              onClick={clearChat}
              disabled={isRunning}
            >
              Clear
            </button>
          )}
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="message-user">
      <div className="message-user-label">You</div>
      <div className="message-user-content">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="message-assistant">
      <AssistantMessageContent />
    </MessagePrimitive.Root>
  );
};

function AssistantMessageContent() {
  // We need to extract the columns data from the message content.
  // The content is JSON-encoded in our runtime conversion.
  // We'll use MessagePrimitive.Content with a custom Text renderer.
  return (
    <MessagePrimitive.Content
      components={{
        Text: ColumnsRenderer,
      }}
    />
  );
}

const ColumnsRenderer: FC<{ text: string }> = ({ text }) => {
  try {
    const data = JSON.parse(text) as {
      stepIndex: number;
      columns: Record<string, string>;
      columnOrder: string[];
      isRunning: boolean;
      error?: string;
    };

    if (data.error) {
      return <div className="step-error">{data.error}</div>;
    }

    return (
      <div className="columns-grid">
        {data.columnOrder.map((name) => (
          <ColumnCard
            key={name}
            name={name}
            value={data.columns[name]}
          />
        ))}
      </div>
    );
  } catch {
    return <div>{text}</div>;
  }
};
