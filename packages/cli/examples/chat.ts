import { source, column, self, flow, prompt } from "columnar";
import { createFileSystemStorage } from "columnar-cli";
import { anthropic } from "@ai-sdk/anthropic";
import { join } from "node:path";

const dataDir = process.argv[2] ?? "./data";
const model = anthropic("claude-sonnet-4-5-20250929");

const user = source("user", {
  storage: createFileSystemStorage(join(dataDir, "user")),
});

const assistant = column("assistant", {
  context: [user, self],
  compute: prompt(model, "You are a helpful assistant. Keep responses brief."),
  storage: createFileSystemStorage(join(dataDir, "assistant")),
});

const f = flow(assistant);

// Run will process any source files that don't yet have assistant responses
for await (const event of f.run()) {
  console.log(`[${event.column}] step ${event.step}: ${event.value}`);
}
