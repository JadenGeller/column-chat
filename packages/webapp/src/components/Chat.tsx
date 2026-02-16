import { useState, useCallback, useContext, createContext, type FC } from "react";
import { createPortal } from "react-dom";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessage,
} from "@assistant-ui/react";
import type { ColumnarState } from "../hooks/useColumnar.js";
import { useColumnarRuntime } from "../runtime.js";
import { ColumnCard } from "./ColumnCard.js";
import { PRESET_COLORS, columnId } from "../../shared/defaults.js";

const FocusContext = createContext<{
  focused: string | null;
  focusColor: string | null;
  setFocused: (name: string | null, color?: string) => void;
}>({ focused: null, focusColor: null, setFocused: () => {} });

const ChatActionsContext = createContext<{
  addColumnAndEdit: () => void;
  hovered: { column: string; step: number } | null;
  setHovered: (h: { column: string; step: number } | null) => void;
}>({ addColumnAndEdit: () => {}, hovered: null, setHovered: () => {} });

interface ChatProps {
  state: ColumnarState;
}

export function Chat({ state }: ChatProps) {
  const { steps, columnOrder, columnColors, columnPrompts, columnDeps, columnContext, isRunning, sendMessage, clearChat, setEditing, dispatch, draftConfig } = state;
  const runtime = useColumnarRuntime(steps, columnOrder, columnColors, columnPrompts, columnDeps, columnContext, isRunning, sendMessage);
  const [focused, setFocusedRaw] = useState<string | null>(null);
  const [focusColor, setFocusColor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ column: string; step: number } | null>(null);

  const setFocused = useCallback((name: string | null, color?: string) => {
    setFocusedRaw(name);
    setFocusColor(color ?? null);
  }, []);

  const addColumnAndEdit = useCallback(() => {
    const usedColors = new Set(draftConfig.map((c) => c.color));
    const color = PRESET_COLORS.find((c) => !usedColors.has(c)) ?? PRESET_COLORS[0];

    dispatch({
      type: "add",
      config: {
        id: columnId(),
        name: "",
        systemPrompt: "",
        reminder: "Keep responses brief.",
        color,
        context: [
          { column: "input", row: "current", count: "all" },
          { column: "self", row: "previous", count: "all" },
        ],
      },
    });
    setEditing(true);
  }, [draftConfig, dispatch, setEditing]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatActionsContext.Provider value={{ addColumnAndEdit, hovered, setHovered }}>
      <FocusContext.Provider value={{ focused, focusColor, setFocused }}>
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
          <div className="composer-links">
            <button
              className="clear-button"
              onClick={() => setEditing(true)}
            >
              Edit columns
            </button>
            {steps.length > 0 && (
              <button
                className="clear-button"
                onClick={clearChat}
                disabled={isRunning}
              >
                New chat
              </button>
            )}
          </div>
        </div>
      </ThreadPrimitive.Root>
      {focused && focusColor && createPortal(
        <div
          className="focus-tint"
          style={{ background: focusColor }}
        />,
        document.body
      )}
      </FocusContext.Provider>
      </ChatActionsContext.Provider>
    </AssistantRuntimeProvider>
  );
}

const UserMessage: FC = () => {
  const id = useMessage((m) => m.id);
  const stepIndex = parseInt(id.replace("user-", ""), 10);
  const label = String(stepIndex + 1).padStart(2, "0");

  return (
    <MessagePrimitive.Root className="message-user">
      <div className="message-user-label">{label}</div>
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

const EMPTY_MESSAGES = [
  "it's a little quiet in here",
  "really think you should add a column",
  "your thoughts deserve more than silence",
];

const ColumnsRenderer: FC<{ text: string }> = ({ text }) => {
  const { focused, setFocused } = useContext(FocusContext);
  const { addColumnAndEdit, hovered, setHovered } = useContext(ChatActionsContext);

  const toggle = useCallback((name: string, color?: string) => {
    setFocused(focused === name ? null : name, color);
  }, [focused, setFocused]);

  try {
    const data = JSON.parse(text) as {
      stepIndex: number;
      columns: Record<string, string>;
      columnOrder: string[];
      columnColors: Record<string, string>;
      columnPrompts: Record<string, string>;
      columnDeps: Record<string, string[]>;
      columnContext: Record<string, { column: string; row: string }[]>;
      computing: string[];
      isRunning: boolean;
      error?: string;
    };

    if (data.error) {
      return <div className="step-error">{data.error}</div>;
    }

    const computingSet = new Set(data.computing);

    function cardStatus(name: string): "waiting" | "computing" | "done" {
      if (computingSet.has(name)) return "computing";
      if (data.columns[name] !== undefined) return "done";
      if (data.isRunning) return "waiting";
      return "done";
    }

    function cardDeps(name: string): { name: string; done: boolean }[] | undefined {
      const deps = data.columnDeps?.[name];
      if (!deps || deps.length === 0) return undefined;
      return deps.map((d) => ({
        name: d,
        done: data.columns[d] !== undefined && !computingSet.has(d),
      }));
    }

    if (data.columnOrder.length === 0) {
      const message = EMPTY_MESSAGES[Math.min(data.stepIndex, EMPTY_MESSAGES.length - 1)];
      return (
        <div className="columns-layout">
          <div className="columns-grid">
            <button className="empty-column-card" onClick={addColumnAndEdit}>
              {message}
            </button>
          </div>
        </div>
      );
    }

    // Focus mode: show only the focused column, expanded
    if (focused && data.columnOrder.includes(focused)) {
      return (
        <div className="columns-layout">
          <ColumnCard
            key={focused}
            name={focused}
            value={data.columns[focused]}
            color={data.columnColors[focused]}
            prompt={data.columnPrompts[focused]}
            index={data.columnOrder.indexOf(focused)}
            status={cardStatus(focused)}
            dependencies={cardDeps(focused)}
            expanded
            onToggle={() => toggle(focused, data.columnColors[focused])}
          />
        </div>
      );
    }

    // Determine which cards at this step are in context for the hovered card
    function isDimmed(name: string): boolean {
      if (!hovered) return false;
      const { column: hCol, step: hStep } = hovered;
      const step = data.stepIndex;
      // The hovered card itself
      if (name === hCol && step === hStep) return false;
      // Cards after the hovered step are always dimmed
      if (step > hStep) return true;
      // Check if this card (name, step) is in the hovered column's context
      const refs = data.columnContext[hCol];
      if (!refs) return true;
      for (const ref of refs) {
        const refCol = ref.column === "self" ? hCol : ref.column;
        if (refCol !== name) continue;
        const maxStep = ref.row === "previous" ? hStep - 1 : hStep;
        if (step <= maxStep) return false;
      }
      return true;
    }

    // Normal mode: all columns in the grid
    return (
      <div className="columns-layout">
        <div className="columns-grid">
          {data.columnOrder.map((name) => (
            <ColumnCard
              key={name}
              name={name}
              value={data.columns[name]}
              color={data.columnColors[name]}
              prompt={data.columnPrompts[name]}
              index={data.columnOrder.indexOf(name)}
              status={cardStatus(name)}
              dependencies={cardDeps(name)}
              dimmed={isDimmed(name)}
              onToggle={() => toggle(name, data.columnColors[name])}
              onMouseEnter={() => setHovered({ column: name, step: data.stepIndex })}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </div>
      </div>
    );
  } catch {
    return <div>{text}</div>;
  }
};
