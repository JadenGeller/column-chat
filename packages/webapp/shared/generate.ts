import type { ColumnConfig, ColumnContextRef, SessionConfig, Mutation } from "./types.js";
import { PRESET_COLORS, columnId } from "./defaults.js";

/** System prompt teaching the AI how to generate column configs. */
export function buildSystemPrompt(): string {
  return `You generate column configurations for a multi-column AI chat application called Columnar.

## Column Config Format

Output a JSON array of column objects. Each column has:
- "name": lowercase_snake_case identifier (e.g. "key_points", "counterarguments")
- "systemPrompt": instructions for what this column should do — write as if talking to the AI that will run this column
- "reminder": a short constraint appended after the context (e.g. "Keep responses brief.", "Bulleted list only.")
- "color": one of the preset colors listed below
- "context": array of context refs that declare what data this column sees

## Context Refs

Each context ref is { "column", "row", "count" }:
- column: "input" (user messages), "self" (this column's own history), or another column's name
- row: "current" (this step) or "previous" (before this step)
- count: "single" (just the one row) or "all" (accumulate all rows in range)

Rules:
- A column can only reference columns that appear BEFORE it in the array (topological order)
- "input" always uses row: "current"
- "self" always uses row: "previous"
- For referencing other columns: row: "current" means wait for that column to finish this step first; row: "previous" means use its value from the prior step (enables parallel execution)

## Four Patterns

1. **Accumulator**: context includes { column: "input", row: "current", count: "all" } + { column: "self", row: "previous", count: "all" } — builds up a running log across all steps
2. **Reducer**: like accumulator but with count: "single" on self — rewrites/condenses each step
3. **Journal**: only sees input + self history, no other columns — independent running commentary
4. **Map**: references other columns at row: "current", count: "single" — transforms/combines outputs from the current step

Most columns should use at least { column: "input", row: "current", count: "all" } or reference another column. Almost all columns benefit from { column: "self", row: "previous", count: "single" } or count: "all" to maintain continuity.

## Design Principles

- Each column should have a distinct analytical role — avoid redundant perspectives
- System prompts should be written in direct second-person ("You analyze...", "Find the...")
- Prompts should be opinionated and specific, not generic
- Reminders should be terse formatting constraints
- Create a DAG that flows from broad/foundational analysis to specific/synthetic conclusions
- 3-6 columns is typical. Don't create more than necessary.

## Preset Colors

${PRESET_COLORS.map((c, i) => `${i}: "${c}"`).join("\n")}

Assign distinct colors. Don't repeat colors unless you have more columns than colors.

## Output

Return ONLY a JSON array of column objects. No markdown fences, no explanation, just the JSON array.

Example:
[
  {
    "name": "key_points",
    "systemPrompt": "Extract the main claims and key points from the conversation. Focus on what's actually being argued, not peripheral details.",
    "reminder": "Bulleted list. One point per bullet.",
    "color": "#e06c75",
    "context": [
      { "column": "input", "row": "current", "count": "all" },
      { "column": "self", "row": "previous", "count": "all" }
    ]
  },
  {
    "name": "analysis",
    "systemPrompt": "Evaluate the strength of each key point. What's well-supported? What's assumption? What's missing?",
    "reminder": "Be direct. One paragraph per point.",
    "color": "#61afef",
    "context": [
      { "column": "key_points", "row": "current", "count": "single" },
      { "column": "self", "row": "previous", "count": "single" }
    ]
  }
]`;
}

/** Combine the user's natural-language prompt with the current config for context. */
export function buildUserMessage(prompt: string, currentConfig: SessionConfig): string {
  if (currentConfig.length === 0) {
    return prompt;
  }

  const configSummary = currentConfig.map((col) => ({
    name: col.name,
    systemPrompt: col.systemPrompt,
    reminder: col.reminder,
    color: col.color,
    context: col.context,
  }));

  return `Current column configuration:\n${JSON.stringify(configSummary, null, 2)}\n\nUser request: ${prompt}`;
}

/** Parse the AI's response text into a validated array of column configs (without IDs). */
export function parseGenerateResponse(text: string): Omit<ColumnConfig, "id">[] {
  // Strip markdown fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Response is not valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Response must be a JSON array");
  }

  if (parsed.length === 0) {
    throw new Error("Response must contain at least one column");
  }

  const RESERVED = new Set(["input", "self"]);
  const validColors = new Set<string>(PRESET_COLORS);

  // First pass: parse all columns and collect names
  const allNames = new Set<string>();
  const columns: Omit<ColumnConfig, "id">[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];

    const name = typeof raw.name === "string" ? raw.name.trim().toLowerCase().replace(/\s+/g, "_") : "";
    if (!name) throw new Error(`Column at index ${i} has no name`);
    if (RESERVED.has(name)) throw new Error(`"${name}" is a reserved name`);
    if (allNames.has(name)) throw new Error(`Duplicate column name: "${name}"`);
    allNames.add(name);

    const systemPrompt = typeof raw.systemPrompt === "string" ? raw.systemPrompt.trim() : "";
    if (!systemPrompt) throw new Error(`Column "${name}" has no system prompt`);

    const reminder = typeof raw.reminder === "string" ? raw.reminder.trim() : "Keep responses brief.";

    let color = typeof raw.color === "string" ? raw.color.trim() : "";
    if (!validColors.has(color)) {
      color = PRESET_COLORS[i % PRESET_COLORS.length];
    }

    // Parse context refs — drop refs to non-existent columns
    const context: ColumnContextRef[] = [];
    if (Array.isArray(raw.context)) {
      for (const ref of raw.context) {
        const col = typeof ref.column === "string" ? ref.column.trim().toLowerCase().replace(/\s+/g, "_") : "";
        if (!col) continue;

        // Drop refs to columns not in the generated set
        if (col !== "input" && col !== "self" && !allNames.has(col)) continue;

        const row = ref.row === "previous" ? "previous" as const : "current" as const;
        const count = ref.count === "all" ? "all" as const : "single" as const;
        context.push({ column: col, row, count });
      }
    }

    if (context.length === 0) {
      context.push(
        { column: "input", row: "current", count: "all" },
        { column: "self", row: "previous", count: "all" },
      );
    }

    columns.push({ name, systemPrompt, reminder, color, context });
  }

  // Topological sort — resolve forward references by reordering
  const byName = new Map(columns.map((c) => [c.name, c]));
  const visited = new Set<string>();
  const sorted: Omit<ColumnConfig, "id">[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const col = byName.get(name);
    if (!col) return;
    for (const ref of col.context) {
      if (ref.column !== "input" && ref.column !== "self") {
        visit(ref.column);
      }
    }
    sorted.push(col);
  }

  for (const col of columns) {
    visit(col.name);
  }

  return sorted;
}

/** Convert AI-generated columns into mutations against the current applied config. */
export function configToMutations(
  generated: Omit<ColumnConfig, "id">[],
  appliedConfig: SessionConfig,
): Mutation[] {
  const mutations: Mutation[] = [];
  const usedColors = new Set<string>();

  function pickColor(preferred: string): string {
    const validColors = new Set<string>(PRESET_COLORS);
    if (validColors.has(preferred) && !usedColors.has(preferred)) {
      usedColors.add(preferred);
      return preferred;
    }
    const available = PRESET_COLORS.find((c) => !usedColors.has(c));
    const color = available ?? preferred;
    usedColors.add(color);
    return color;
  }

  // Remove all existing columns first, then add generated ones in order.
  // This guarantees the result matches the AI's topological ordering.
  for (const applied of appliedConfig) {
    mutations.push({ type: "remove", id: applied.id });
  }

  for (const gen of generated) {
    mutations.push({
      type: "add",
      config: {
        id: columnId(),
        name: gen.name,
        systemPrompt: gen.systemPrompt,
        reminder: gen.reminder,
        color: pickColor(gen.color),
        context: gen.context,
      },
    });
  }

  return mutations;
}
