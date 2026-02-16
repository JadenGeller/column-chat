import { useState, useCallback, useContext, createContext, type FC } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import type { ColumnarState } from "../hooks/useColumnar.js";
import { useColumnarRuntime } from "../runtime.js";
import { ColumnCard } from "./ColumnCard.js";

const OpenSidebarContext = createContext<() => void>(() => {});

interface ChatProps {
  state: ColumnarState;
}

export function Chat({ state }: ChatProps) {
  const { steps, columnOrder, columnColors, columnPrompts, columnDeps, isRunning, sendMessage, clearChat, setSidebarOpen } = state;
  const runtime = useColumnarRuntime(steps, columnOrder, columnColors, columnPrompts, columnDeps, isRunning, sendMessage);
  const openSidebar = useCallback(() => setSidebarOpen(true), [setSidebarOpen]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <OpenSidebarContext.Provider value={openSidebar}>
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
      </OpenSidebarContext.Provider>
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
  const openSidebar = useContext(OpenSidebarContext);

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
      columnDeps: Record<string, string[]>;
      computing: string[];
      isRunning: boolean;
      error?: string;
    };

    if (data.error) {
      return <div className="step-error">{data.error}</div>;
    }

    const computingSet = new Set(data.computing);

    function cardStatus(name: string): "waiting" | "computing" | "done" {
      if (data.columns[name] !== undefined) return "done";
      if (computingSet.has(name)) return "computing";
      if (data.isRunning) return "waiting";
      return "done";
    }

    function cardDeps(name: string): { name: string; done: boolean }[] | undefined {
      const deps = data.columnDeps?.[name];
      if (!deps || deps.length === 0) return undefined;
      return deps.map((d) => ({
        name: d,
        done: data.columns[d] !== undefined,
      }));
    }

    if (data.columnOrder.length === 0) {
      return (
        <div className="columns-layout">
          <div className="columns-grid">
            <button className="empty-column-card" onClick={openSidebar}>
              it's a little quiet in here
            </button>
          </div>
        </div>
      );
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
            status={cardStatus(name)}
            dependencies={cardDeps(name)}
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
                status={cardStatus(name)}
                dependencies={cardDeps(name)}
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
