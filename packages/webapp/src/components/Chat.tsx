import { useState, useCallback, type FC } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import type { ColumnarState } from "../hooks/useColumnar.js";
import { useColumnarRuntime } from "../runtime.js";
import { ColumnCard } from "./ColumnCard.js";

interface ChatProps {
  state: ColumnarState;
}

export function Chat({ state }: ChatProps) {
  const { steps, columnOrder, columnColors, columnPrompts, isRunning, sendMessage, clearChat } = state;
  const runtime = useColumnarRuntime(steps, columnOrder, columnColors, columnPrompts, isRunning, sendMessage);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="thread-root">
        <ThreadPrimitive.Viewport className="thread-viewport">
          <ThreadPrimitive.Empty>
            <div className="thread-empty">
              <div className="thread-empty-mark">Vol. I / No. 1</div>
              <h2>Thinking<br />Prism</h2>
              <hr className="thread-empty-rule" />
              <p>
                Write freely. Your thoughts will be refracted through multiple
                analytical lenses.
              </p>
              <div className="thread-empty-footer">Columnar Analysis Engine</div>
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
              Clear session
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
      <div className="message-user-label">Input</div>
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
  return (
    <MessagePrimitive.Content
      components={{
        Text: ColumnsRenderer,
      }}
    />
  );
}

const ColumnsRenderer: FC<{ text: string }> = ({ text }) => {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

  const toggle = useCallback((name: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  try {
    const data = JSON.parse(text) as {
      stepIndex: number;
      columns: Record<string, string>;
      columnOrder: string[];
      columnColors: Record<string, string>;
      columnPrompts: Record<string, string>;
      isRunning: boolean;
      error?: string;
    };

    if (data.error) {
      return <div className="step-error">{data.error}</div>;
    }

    const expanded = data.columnOrder.filter((n) => expandedSet.has(n));
    const compact = data.columnOrder.filter((n) => !expandedSet.has(n));

    return (
      <div className="columns-layout">
        {expanded.map((name) => (
          <ColumnCard
            key={name}
            name={name}
            value={data.columns[name]}
            color={data.columnColors[name]}
            prompt={data.columnPrompts[name]}
            index={data.columnOrder.indexOf(name)}
            expanded
            onToggle={() => toggle(name)}
          />
        ))}
        {compact.length > 0 && (
          <div className="columns-grid">
            {compact.map((name) => (
              <ColumnCard
                key={name}
                name={name}
                value={data.columns[name]}
                color={data.columnColors[name]}
                prompt={data.columnPrompts[name]}
                index={data.columnOrder.indexOf(name)}
                onToggle={() => toggle(name)}
              />
            ))}
          </div>
        )}
      </div>
    );
  } catch {
    return <div>{text}</div>;
  }
};
