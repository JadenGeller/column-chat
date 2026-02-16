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
    name: "Brainstorm",
    description: "Generate & refine ideas together.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        {
          id: columnId(),
          name: "ideas",
          systemPrompt:
            "Extract every concrete idea from the conversation. Include ideas mentioned in passing. Don't editorialize — just capture.",
          reminder: "Bulleted list only. One idea per bullet. No commentary.",
          color: colors[0],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        {
          id: columnId(),
          name: "themes",
          systemPrompt:
            "Group the ideas into 2–5 named themes. Give each theme a short title and list which ideas fall under it.",
          reminder: "Theme titles followed by their ideas. Structured, no prose.",
          color: colors[1],
          context: [
            { column: "ideas", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "critique",
          systemPrompt:
            "Play devil's advocate. For each idea with a real weakness, name it in one sentence. Be specific and constructive, not dismissive.",
          reminder: "2–3 sentences per real weakness. Skip solid ideas.",
          color: colors[2],
          context: [
            { column: "ideas", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "builds",
          systemPrompt:
            "Propose 2–3 builds — combine ideas, pivot weak ones, or address criticisms. Each build should be stronger than any single idea.",
          reminder: "2–3 numbered builds. One sentence each + why it's stronger.",
          color: colors[3],
          context: [
            { column: "themes", row: "current" as const, count: "single" as const },
            { column: "critique", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "gameplan",
          systemPrompt:
            "Recommend a path forward — which themes to prioritize, which builds are most promising. Then pose 1–2 provocative what-if questions or unexplored angles that could shift the direction entirely.",
          reminder: "One paragraph recommendation, then 1–2 what-if questions. Push the thinking further.",
          color: colors[4],
          context: [
            { column: "themes", row: "current" as const, count: "single" as const },
            { column: "critique", row: "current" as const, count: "single" as const },
            { column: "builds", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
  {
    name: "Research",
    description: "Explore & map a topic.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        {
          id: columnId(),
          name: "concepts",
          systemPrompt:
            "Maintain a glossary of key concepts discussed. 1–2 sentence definition each. Add new ones, update evolving ones.",
          reminder: "Glossary format: concept name then definition. No commentary.",
          color: colors[2],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        {
          id: columnId(),
          name: "questions",
          systemPrompt:
            "Track open questions. Mark answered ones as resolved. Focus on genuine uncertainties.",
          reminder: "Checklist format. Mark resolved questions. Keep open ones.",
          color: colors[1],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        {
          id: columnId(),
          name: "connections",
          systemPrompt:
            "Identify how concepts relate — causes, prerequisites, tensions, analogies. Focus on non-obvious relationships.",
          reminder: "One sentence per connection: 'X relates to Y because...'. Top 3–5 only.",
          color: colors[5],
          context: [
            { column: "concepts", row: "current" as const, count: "single" as const },
            { column: "questions", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "understanding",
          systemPrompt:
            "Summarize what's established so far, then focus on what's still fuzzy or contradictory. End with 1–2 specific questions that would most clarify the gaps.",
          reminder: "One paragraph on what's clear, then 1–2 questions to explore next.",
          color: colors[3],
          context: [
            { column: "concepts", row: "current" as const, count: "single" as const },
            { column: "questions", row: "current" as const, count: "single" as const },
            { column: "connections", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
  {
    name: "Think It Through",
    description: "Stress-test any argument.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        {
          id: columnId(),
          name: "position",
          systemPrompt:
            "Distill the speaker's current position into one clear statement. Capture the core claim and key reasoning. Update as it evolves.",
          reminder: "One clear paragraph. State the position as if committing to it now.",
          color: colors[0],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "evidence",
          systemPrompt:
            "List every piece of evidence, example, or data point cited. Include things mentioned in passing. Don't add your own.",
          reminder: "Bulleted list. One piece of evidence per bullet. No editorializing.",
          color: colors[5],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        {
          id: columnId(),
          name: "assumptions",
          systemPrompt:
            "What hidden assumptions does this position rest on? What must be true for the argument to hold? Focus on unstated beliefs.",
          reminder: "3–5 assumptions as bullets. One sentence each.",
          color: colors[1],
          context: [
            { column: "position", row: "current" as const, count: "single" as const },
            { column: "evidence", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "pushback",
          systemPrompt:
            "Steel-man the strongest counterargument. Use the speaker's own evidence gaps and assumptions. Be rigorous, not contrarian.",
          reminder: "2–3 forceful sentences. Argue as if you genuinely hold the opposing view.",
          color: colors[4],
          context: [
            { column: "position", row: "current" as const, count: "single" as const },
            { column: "evidence", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "verdict",
          systemPrompt:
            "Assess the position's overall strength — what holds up, what doesn't. Then identify the 2–3 questions that, if answered, would most change the picture. Focus on things the speaker could actually investigate or think through.",
          reminder: "One paragraph assessment, then 2–3 concrete questions to investigate.",
          color: colors[6],
          context: [
            { column: "position", row: "current" as const, count: "single" as const },
            { column: "evidence", row: "current" as const, count: "single" as const },
            { column: "assumptions", row: "current" as const, count: "single" as const },
            { column: "pushback", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
  {
    name: "Idea Evaluator",
    description: "Vet any idea from customer to moat.",
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
            "Deliver a go or no-go verdict with your reasoning. Then name the single riskiest assumption and what the speaker should validate first.",
          reminder: "Reply in 2–3 plain sentences. End with what to validate next.",
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
