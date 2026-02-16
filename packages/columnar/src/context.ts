import type {
  Message,
  Column,
  Dependency,
  ContextInput,
} from "./types.js";
import { SELF_MARKER } from "./types.js";

// Compute the step range for a dependency
function stepRange(
  row: "current" | "previous",
  count: "single" | "all",
  currentStep: number,
): Set<number> {
  const steps = new Set<number>();

  const maxStep = row === "previous" ? currentStep - 1 : currentStep;

  if (maxStep < 0) return steps;

  switch (count) {
    case "all":
      for (let i = 0; i <= maxStep; i++) steps.add(i);
      break;
    case "single":
      steps.add(maxStep);
      break;
  }

  return steps;
}

// Internal: dependencies → plain ContextInput[] (resolves self, step ranges, storage, XML wrapping)
export function resolveContextInputs(
  context: Dependency[],
  thisColumn: Column,
  currentStep: number,
): ContextInput[] {
  return context.map((dep) => {
    const isSelf = dep.column === SELF_MARKER;
    const column = isSelf ? thisColumn : (dep.column as Column);
    const steps = stepRange(dep.row, dep.count, currentStep);
    const entries: { step: number; value: string }[] = [];
    for (const step of [...steps].sort((a, b) => a - b)) {
      const raw = column.storage.get(step);
      if (raw !== undefined) {
        const value = isSelf ? raw : `<${column.name}>\n${raw}\n</${column.name}>`;
        entries.push({ step, value });
      }
    }
    return {
      role: isSelf ? "assistant" as const : "user" as const,
      entries,
    };
  });
}

// Public: transpose step-indexed inputs into alternating Message[]
export function assembleMessages(inputs: ContextInput[]): Message[] {
  // Collect all steps across all inputs
  const allSteps = new Set<number>();
  for (const input of inputs) {
    for (const entry of input.entries) {
      allSteps.add(entry.step);
    }
  }

  const sortedSteps = [...allSteps].sort((a, b) => a - b);

  // Build lookup maps per input: step → value
  const lookups = inputs.map((input) => {
    const map = new Map<number, string>();
    for (const entry of input.entries) {
      map.set(entry.step, entry.value);
    }
    return map;
  });

  // Build raw message sequence
  const rawMessages: Message[] = [];

  for (const step of sortedSteps) {
    // Collect user values at this step
    const userParts: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i].role !== "user") continue;
      const value = lookups[i].get(step);
      if (value !== undefined) userParts.push(value);
    }
    if (userParts.length > 0) {
      rawMessages.push({ role: "user", content: userParts.join("\n\n") });
    }

    // Collect assistant values at this step
    for (let i = 0; i < inputs.length; i++) {
      if (inputs[i].role !== "assistant") continue;
      const value = lookups[i].get(step);
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
