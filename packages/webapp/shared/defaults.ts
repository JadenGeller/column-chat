import type { SessionConfig } from "./types.js";

export const PRESET_COLORS = [
  "#e06c75", // Rose
  "#e5c07b", // Amber
  "#61afef", // Blue
  "#c678dd", // Purple
  "#56b6c2", // Teal
  "#98c379", // Green
  "#d19a66", // Orange
  "#e88cba", // Pink
] as const;

export function displayName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function columnId(): string {
  return crypto.randomUUID();
}

export const DEFAULT_CONFIG: SessionConfig = [];

export interface Preset {
  name: string;
  description: string;
  create: () => SessionConfig;
}

export const PRESETS: Preset[] = [
  {
    name: "Idea Evaluator",
    description: "Analyze ideas through 7 lenses — from customer fit to final verdict.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        // Layer 1 — independent lenses
        {
          id: columnId(),
          name: "customer",
          systemPrompt:
            "Analyze the target customer. Who has this problem? Is it a painkiller or vitamin? How large is the audience?",
          reminder: "Reply in 2–3 plain sentences. No markdown, no bullet points.",
          color: colors[0],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        {
          id: columnId(),
          name: "feasibility",
          systemPrompt:
            "Assess technical feasibility. What needs to be built? What's the hardest part? What can be leveraged from existing technology?",
          reminder: "Reply in 2–3 plain sentences. No markdown, no bullet points.",
          color: colors[1],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        {
          id: columnId(),
          name: "market",
          systemPrompt:
            "Analyze the competitive landscape. Who are the competitors? What's the market size and timing? What trends help or threaten this?",
          reminder: "Reply in 2–3 plain sentences. No markdown, no bullet points.",
          color: colors[2],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        // Layer 2 — cross-cutting
        {
          id: columnId(),
          name: "business_model",
          systemPrompt:
            "Evaluate the business model. How does this make money? What's the pricing strategy and path to profitability?",
          reminder: "Reply in 2–3 plain sentences. No markdown, no bullet points.",
          color: colors[3],
          context: [
            { column: "customer", row: "current" as const, count: "single" as const },
            { column: "feasibility", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "risks",
          systemPrompt:
            "Identify the biggest risks. What could go wrong technically, in the market, or in execution?",
          reminder: "Reply in 2–3 plain sentences. No markdown, no bullet points.",
          color: colors[4],
          context: [
            { column: "customer", row: "current" as const, count: "single" as const },
            { column: "feasibility", row: "current" as const, count: "single" as const },
            { column: "market", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "moat",
          systemPrompt:
            "Assess defensibility. What creates a moat — network effects, switching costs, technical barriers, or brand?",
          reminder: "Reply in 2–3 plain sentences. No markdown, no bullet points.",
          color: colors[5],
          context: [
            { column: "market", row: "current" as const, count: "single" as const },
            { column: "feasibility", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        // Layer 3 — synthesis
        {
          id: columnId(),
          name: "verdict",
          systemPrompt:
            "Deliver a verdict. Go or no-go? What would need to be true? What should be validated first?",
          reminder: "Reply in 2–3 plain sentences. No markdown, no bullet points.",
          color: colors[6],
          context: [
            { column: "business_model", row: "current" as const, count: "single" as const },
            { column: "risks", row: "current" as const, count: "single" as const },
            { column: "moat", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
];
