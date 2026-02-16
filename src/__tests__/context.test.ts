import { describe, test, expect } from "bun:test";
import { source, column, self } from "../column.js";
import { assembleMessages, resolveViews, type Store } from "../context.js";
import type { Column, Message } from "../types.js";

// Helper: create a store from a record of column -> values
function makeStore(entries: [Column, string[]][]): Store {
  return new Map(entries);
}

// Helper: resolve views and assemble messages
function assemble(
  col: ReturnType<typeof column>,
  currentStep: number,
  store: Store
): Message[] {
  const resolved = resolveViews(col.context, col);
  return assembleMessages(resolved, currentStep, store);
}

describe("context assembly", () => {
  // Example 1: Standard Chat (Accumulator)
  test("example 1: standard chat accumulator", () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [user, self],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["Hello", "What's TypeScript?", "Thanks"]],
      [assistant, ["Hi! How can I help?", "TypeScript is a..."]],
    ]);

    const messages = assemble(assistant, 2, store);
    expect(messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi! How can I help?" },
      { role: "user", content: "What's TypeScript?" },
      { role: "assistant", content: "TypeScript is a..." },
      { role: "user", content: "Thanks" },
    ]);
  });

  // Example 2: Stateless Map (No Self)
  test("example 2: stateless map", () => {
    const user = source("user");
    const topics = column("topics", {
      context: [user.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["Hello", "Let's discuss Rust", "And memory safety"]],
      [topics, ["greetings", "Rust, programming"]],
    ]);

    // At step 2
    const messages = assemble(topics, 2, store);
    expect(messages).toEqual([
      { role: "user", content: "And memory safety" },
    ]);

    // At step 1
    const messages1 = assemble(topics, 1, store);
    expect(messages1).toEqual([
      { role: "user", content: "Let's discuss Rust" },
    ]);
  });

  // Example 3: Reducer (Latest Self, All Input)
  test("example 3: reducer at step 0", () => {
    const user = source("user");
    const summary = column("summary", {
      context: [user, self.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["I'm considering Rust", "For the backend rewrite", "Because Python is slow"]],
      [summary, ["User is considering Rust.", "User wants to rewrite the backend in Rust."]],
    ]);

    const messages0 = assemble(summary, 0, store);
    expect(messages0).toEqual([
      { role: "user", content: "I'm considering Rust" },
    ]);
  });

  test("example 3: reducer at step 1", () => {
    const user = source("user");
    const summary = column("summary", {
      context: [user, self.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["I'm considering Rust", "For the backend rewrite", "Because Python is slow"]],
      [summary, ["User is considering Rust.", "User wants to rewrite the backend in Rust."]],
    ]);

    const messages1 = assemble(summary, 1, store);
    expect(messages1).toEqual([
      { role: "user", content: "I'm considering Rust" },
      { role: "assistant", content: "User is considering Rust." },
      { role: "user", content: "For the backend rewrite" },
    ]);
  });

  test("example 3: reducer at step 2 (merges consecutive user messages)", () => {
    const user = source("user");
    const summary = column("summary", {
      context: [user, self.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["I'm considering Rust", "For the backend rewrite", "Because Python is slow"]],
      [summary, ["User is considering Rust.", "User wants to rewrite the backend in Rust."]],
    ]);

    const messages2 = assemble(summary, 2, store);
    expect(messages2).toEqual([
      { role: "user", content: "I'm considering Rust\n\nFor the backend rewrite" },
      { role: "assistant", content: "User wants to rewrite the backend in Rust." },
      { role: "user", content: "Because Python is slow" },
    ]);
  });

  // Example 4: Multiple Inputs with XML Wrapping
  test("example 4: multiple inputs with XML wrapping", () => {
    const user = source("user");
    const summaryCol = source("summary"); // using source as stand-in for a derived column with known values

    const critique = column("critique", {
      context: [summaryCol.latest, user.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["I'm considering Rust", "Because Python is slow"]],
      [summaryCol, ["User is considering Rust.", "User wants to rewrite backend in Rust..."]],
    ]);

    const messages = assemble(critique, 1, store);
    expect(messages).toEqual([
      {
        role: "user",
        content:
          "<summary>\nUser wants to rewrite backend in Rust...\n</summary>\n\n<user>\nBecause Python is slow\n</user>",
      },
    ]);
  });

  // Example 5: Multiple Inputs with Full History
  test("example 5: multiple inputs with full history and self", () => {
    const user = source("user");
    const topics = source("topics"); // stand-in

    const analysis = column("analysis", {
      context: [user, topics, self],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["I like Rust", "And Go is nice", "Maybe Zig too"]],
      [topics, ["Rust", "Go", "Zig"]],
      [analysis, ["User mentions Rust.", "Expanded to Go."]],
    ]);

    const messages = assemble(analysis, 2, store);
    expect(messages).toEqual([
      {
        role: "user",
        content: "<user>\nI like Rust\n</user>\n\n<topics>\nRust\n</topics>",
      },
      { role: "assistant", content: "User mentions Rust." },
      {
        role: "user",
        content: "<user>\nAnd Go is nice\n</user>\n\n<topics>\nGo\n</topics>",
      },
      { role: "assistant", content: "Expanded to Go." },
      {
        role: "user",
        content: "<user>\nMaybe Zig too\n</user>\n\n<topics>\nZig\n</topics>",
      },
    ]);
  });

  // Example 6: Chained Columns
  test("example 6: chained columns", () => {
    const user = source("user");
    const steelman = source("steelman"); // stand-in

    const critic = column("critic", {
      context: [steelman.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["We should use Rust", "Python is too slow"]],
      [steelman, ["Rust offers memory safety...", "Python's GIL limits..."]],
    ]);

    const messages = assemble(critic, 1, store);
    expect(messages).toEqual([
      { role: "user", content: "Python's GIL limits..." },
    ]);
  });

  // Example 7: Window(n)
  test("example 7: window(n)", () => {
    const user = source("user");
    const recent = column("recent", {
      context: [user.window(2), self.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["Alpha", "Beta", "Gamma", "Delta"]],
      [recent, ["Mentioned alpha.", "Alpha, then beta.", "Beta, then gamma."]],
    ]);

    const messages = assemble(recent, 3, store);
    expect(messages).toEqual([
      { role: "user", content: "Gamma" },
      { role: "assistant", content: "Beta, then gamma." },
      { role: "user", content: "Delta" },
    ]);
  });

  // Edge case: XML wrapping consistency with mixed windows
  test("XML wrapping when context has multiple non-self entries with different windows", () => {
    const user = source("user");
    const summaryCol = source("summary");

    // user (all) + summary.latest => 2 inputs, always XML wrap
    const col = column("test", {
      context: [user, summaryCol.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["msg0", "msg1", "msg2"]],
      [summaryCol, ["s0", "s1", "s2"]],
    ]);

    // At step 2: user contributes steps 0-2, summary only step 2
    // All user messages merge since there are no assistant messages between them
    const messages = assemble(col, 2, store);
    expect(messages).toEqual([
      {
        role: "user",
        content:
          "<user>\nmsg0\n</user>\n\n<user>\nmsg1\n</user>\n\n<user>\nmsg2\n</user>\n\n<summary>\ns2\n</summary>",
      },
    ]);
  });

  // Edge case: .as() renames the XML tag
  test("as() renames XML tag", () => {
    const user = source("user");
    const summaryCol = source("summary");

    const col = column("test", {
      context: [summaryCol.latest.as("digest"), user.latest],
      compute: async () => "",
    });

    const store = makeStore([
      [user, ["hello"]],
      [summaryCol, ["sum"]],
    ]);

    const messages = assemble(col, 0, store);
    expect(messages).toEqual([
      {
        role: "user",
        content: "<digest>\nsum\n</digest>\n\n<user>\nhello\n</user>",
      },
    ]);
  });
});
