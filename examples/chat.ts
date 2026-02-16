import { source, column, self, flow, prompt } from "../src/index.js";
import { anthropic } from "@ai-sdk/anthropic";

const model = anthropic("claude-sonnet-4-5-20250929");

const user = source("user");

const topics = column("topics", {
  context: [user.latest],
  compute: prompt(model, "Respond ONLY with a comma-separated list of topics. No explanation."),
});

const assistant = column("assistant", {
  context: [user, self],
  compute: prompt(model, "You are a helpful assistant. Keep responses brief."),
});

const f = flow(assistant, topics);

// Simulate a 3-turn conversation
const inputs = [
  "I'm thinking about rewriting our backend in Rust.",
  "The main concern is Python's performance with our data pipeline.",
  "What about Go as a middle ground?",
];

for (const input of inputs) {
  console.log(`\n--- User: ${input}`);
  user.push(input);

  for await (const event of f.run()) {
    console.log(`[${event.column}] step ${event.step}: ${event.value}`);
  }
}
