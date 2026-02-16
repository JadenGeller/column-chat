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
    description: "Ideas in every direction, then a path forward.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        {
          id: columnId(),
          name: "ideas",
          systemPrompt:
            "Capture every idea from the conversation — stated directly, implied, or mentioned in passing. Cast a wide net. Don't filter or judge, just collect.",
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
            "What patterns are emerging? Group ideas into 2–5 named themes. A good theme name makes you see the ideas differently.",
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
            "Be the honest friend. Which ideas have real problems — not nitpicks, but genuine weaknesses that would matter? Name them plainly. Skip the solid ones.",
          reminder: "One sentence per weakness. Only flag real problems.",
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
            "Take the best raw material — strong ideas, valid critiques — and propose 2–3 stronger combinations. Each build should be better than any single idea alone.",
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
          name: "wonders",
          systemPrompt:
            "What hasn't anyone said yet? What assumptions is this whole brainstorm sitting on? What's the question nobody's asking? Be the one who changes the frame.",
          reminder: "2–3 questions or unexplored angles. Provocative, not safe.",
          color: colors[4],
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
            "Cut through the noise. What's the most promising direction given the builds and the blind spots the wonders revealed? Be decisive — pick a direction and say why.",
          reminder: "One opinionated paragraph. Commit to a direction.",
          color: colors[5],
          context: [
            { column: "builds", row: "current" as const, count: "single" as const },
            { column: "wonders", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
  {
    name: "Research",
    description: "Map what you know and find what you don't.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        {
          id: columnId(),
          name: "concepts",
          systemPrompt:
            "Build a running glossary of key concepts. Define each in 1–2 plain sentences. When a concept evolves or gets clarified, update the definition. This is the shared vocabulary.",
          reminder: "Concept: definition format. Plain language. Update as understanding shifts.",
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
            "What don't we know yet? Track genuine open questions — not rhetorical ones. When something gets answered, mark it resolved but keep it visible. New questions matter more than old ones.",
          reminder: "Checklist. Mark resolved. Prioritize new unknowns.",
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
            "How do these concepts actually relate? Look for causes, tensions, prerequisites, and surprising analogies. The non-obvious connections are the valuable ones.",
          reminder: "Top 3–5 connections. 'X relates to Y because...' format.",
          color: colors[5],
          context: [
            { column: "concepts", row: "current" as const, count: "single" as const },
            { column: "questions", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "assumptions",
          systemPrompt:
            "What are we taking for granted that might be wrong? What does our current mental model assume without evidence? Name the beliefs we haven't tested — especially the ones that feel obvious.",
          reminder: "2–4 bullets starting with 'We're assuming...'",
          color: colors[0],
          context: [
            { column: "concepts", row: "current" as const, count: "single" as const },
            { column: "connections", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "understanding",
          systemPrompt:
            "Where do we actually stand? What's solid, what's shaky, and what's the single most important thing to figure out next? Be honest about confidence levels.",
          reminder: "One paragraph: what's clear, what's fuzzy, what to explore next.",
          color: colors[3],
          context: [
            { column: "concepts", row: "current" as const, count: "single" as const },
            { column: "questions", row: "current" as const, count: "single" as const },
            { column: "connections", row: "current" as const, count: "single" as const },
            { column: "assumptions", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
  {
    name: "Think It Through",
    description: "Your toughest critic, then a path forward.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        {
          id: columnId(),
          name: "position",
          systemPrompt:
            "What is the speaker actually saying? Distill it to the core claim and key reasoning. State it as clearly and charitably as possible — as if you were committing to this position yourself.",
          reminder: "One clear paragraph. State the position, not your opinion of it.",
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
            "What evidence has actually been put on the table? List every fact, example, data point, or experience cited. Only what was said — never add your own.",
          reminder: "Bulleted list. One piece of evidence per bullet. Nothing invented.",
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
            "What has to be true for this position to hold — but hasn't been said out loud? Find the load-bearing beliefs. The ones where, if they're wrong, the whole thing falls apart.",
          reminder: "3–5 bullets. Focus on unstated, load-bearing beliefs.",
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
            "Steel-man the strongest counterargument. Don't be contrarian for sport — argue as if you genuinely believe the other side. Use the speaker's own evidence gaps and shaky assumptions.",
          reminder: "2–3 forceful sentences. Mean it.",
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
            "How strong is this position, honestly? What holds up under scrutiny and what doesn't? Don't hedge — say where you'd put your money.",
          reminder: "One paragraph. Direct and honest.",
          color: colors[6],
          context: [
            { column: "position", row: "current" as const, count: "single" as const },
            { column: "evidence", row: "current" as const, count: "single" as const },
            { column: "assumptions", row: "current" as const, count: "single" as const },
            { column: "pushback", row: "current" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "investigate",
          systemPrompt:
            "What would actually change the picture? Name 2–3 specific things the speaker could go find out, test, or think harder about. Not rhetorical questions — real next steps for getting closer to the truth.",
          reminder: "2–3 numbered questions. Things you could actually go do.",
          color: colors[7],
          context: [
            { column: "assumptions", row: "current" as const, count: "single" as const },
            { column: "pushback", row: "current" as const, count: "single" as const },
            { column: "verdict", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
  {
    name: "Plan",
    description: "From goal to first step.",
    create: () => {
      const colors = [...PRESET_COLORS];
      return [
        {
          id: columnId(),
          name: "goals",
          systemPrompt:
            "What does success actually look like? Not vague aspirations — concrete outcomes. If there are multiple goals, name them and be honest about which ones conflict.",
          reminder: "Numbered list. Each goal is a concrete, testable outcome.",
          color: colors[2],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "constraints",
          systemPrompt:
            "What are the real limits? Time, money, skills, dependencies, politics — whatever's actually going to constrain this. Be specific, not hypothetical.",
          reminder: "Bulleted list. Only constraints that materially affect the plan.",
          color: colors[6],
          context: [
            { column: "input", row: "current" as const, count: "all" as const },
            { column: "self", row: "previous" as const, count: "all" as const },
          ],
        },
        {
          id: columnId(),
          name: "steps",
          systemPrompt:
            "Given these goals and constraints, what are the concrete steps? Order matters — what has to happen before what? Each step should be something a person could actually sit down and do.",
          reminder: "Numbered steps. Concrete and ordered. No hand-waving.",
          color: colors[1],
          context: [
            { column: "goals", row: "current" as const, count: "single" as const },
            { column: "constraints", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "risks",
          systemPrompt:
            "Where could this plan go sideways? Not every possible thing — the 2–3 risks that are most likely or most damaging. For each, say what you'd watch for as an early warning sign.",
          reminder: "2–3 risks. Each with a warning sign.",
          color: colors[0],
          context: [
            { column: "steps", row: "current" as const, count: "single" as const },
            { column: "constraints", row: "current" as const, count: "single" as const },
            { column: "self", row: "previous" as const, count: "single" as const },
          ],
        },
        {
          id: columnId(),
          name: "next_move",
          systemPrompt:
            "Cut to the chase: what's the single most important thing to do right now? Not the whole plan — just step one. Say what it is, why it's first, and what you'll know after doing it.",
          reminder: "One paragraph. The single next action and why it's first.",
          color: colors[3],
          context: [
            { column: "steps", row: "current" as const, count: "single" as const },
            { column: "risks", row: "current" as const, count: "single" as const },
          ],
        },
      ];
    },
  },
];
