import type { LanguageModel } from "ai";
import type { ComputeFunction } from "./types.js";

export function prompt(
  model: LanguageModel,
  system: string,
  options?: { stream?: boolean }
): ComputeFunction {
  if (options?.stream) {
    return async function* ({ messages }) {
      const { streamText } = await import("ai");
      const result = streamText({ model, system, messages });
      for await (const delta of result.textStream) {
        yield delta;
      }
    };
  }
  return async ({ messages }) => {
    const { generateText } = await import("ai");
    const result = await generateText({ model, system, messages });
    return result.text;
  };
}
