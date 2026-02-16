import type {
  Message,
  ColumnView,
  Column,
  ResolvedView,
  WindowMode,
} from "./types.js";
import { SELF_MARKER } from "./types.js";

// Resolve a ColumnView into a ResolvedView, replacing SELF_MARKER with the actual column
export function resolveViews(
  context: ColumnView[],
  thisColumn: Column
): ResolvedView[] {
  return context.map((view) => ({
    column: view._column === SELF_MARKER ? thisColumn : (view._column as Column),
    windowMode: view._windowMode,
    name: view._name,
    isSelf: view._column === SELF_MARKER,
  }));
}

// Compute the step range for a view
function stepRange(
  windowMode: WindowMode,
  currentStep: number,
  isSelf: boolean
): Set<number> {
  const steps = new Set<number>();

  // Self excludes current step; inputs include current step
  const maxStep = isSelf ? currentStep - 1 : currentStep;

  if (maxStep < 0) return steps;

  switch (windowMode.kind) {
    case "all":
      for (let i = 0; i <= maxStep; i++) steps.add(i);
      break;
    case "latest":
      steps.add(maxStep);
      break;
    case "window": {
      const start = Math.max(0, maxStep - windowMode.n + 1);
      for (let i = start; i <= maxStep; i++) steps.add(i);
      break;
    }
  }

  return steps;
}

export function assembleMessages(
  resolvedViews: ResolvedView[],
  currentStep: number,
): Message[] {
  const selfView = resolvedViews.find((v) => v.isSelf);
  const inputViews = resolvedViews.filter((v) => !v.isSelf);
  const useXml = inputViews.length > 1;

  // Compute step ranges
  const selfSteps = selfView
    ? stepRange(selfView.windowMode, currentStep, true)
    : new Set<number>();

  const inputStepRanges = inputViews.map((v) =>
    stepRange(v.windowMode, currentStep, false)
  );

  // Union all steps
  const allSteps = new Set<number>();
  for (const s of selfSteps) allSteps.add(s);
  for (const range of inputStepRanges) {
    for (const s of range) allSteps.add(s);
  }

  const sortedSteps = [...allSteps].sort((a, b) => a - b);

  // Build raw message sequence
  const rawMessages: Message[] = [];

  for (const step of sortedSteps) {
    // Check if any input has content at this step
    const inputParts: { name: string; content: string }[] = [];
    for (let i = 0; i < inputViews.length; i++) {
      if (inputStepRanges[i].has(step)) {
        const value = inputViews[i].column.storage.get(step);
        if (value !== undefined) {
          inputParts.push({
            name: inputViews[i].name,
            content: value,
          });
        }
      }
    }

    if (inputParts.length > 0) {
      let content: string;
      if (useXml) {
        content = inputParts
          .map((p) => `<${p.name}>\n${p.content}\n</${p.name}>`)
          .join("\n\n");
      } else {
        content = inputParts.map((p) => p.content).join("\n\n");
      }
      rawMessages.push({ role: "user", content });
    }

    // Self value at this step
    if (selfSteps.has(step)) {
      const value = selfView!.column.storage.get(step);
      if (value !== undefined) {
        rawMessages.push({ role: "assistant", content: value });
      }
    }
  }

  // Merge consecutive same-role messages
  const messages: Message[] = [];
  for (const msg of rawMessages) {
    if (messages.length > 0 && messages[messages.length - 1].role === msg.role) {
      messages[messages.length - 1] = {
        role: msg.role,
        content: messages[messages.length - 1].content + "\n\n" + msg.content,
      };
    } else {
      messages.push({ ...msg });
    }
  }

  return messages;
}
