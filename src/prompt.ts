import type { LanguageModel } from "ai";
import type { ComputeFunction } from "./types.js";

export function prompt(
  model: LanguageModel,
  system: string
): ComputeFunction {
  return async ({ messages }) => {
    const { generateText } = await import("ai");
    const result = await generateText({ model, system, messages });
    return result.text;
  };
}
