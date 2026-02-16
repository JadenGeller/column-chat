import { describe, test, expect } from "bun:test";
import { source, column, self } from "../column.js";
import { assembleMessages, resolveContextInputs } from "../context.js";
import type { Column, Message } from "../types.js";

// Helper: populate a column's storage with values
function populate(col: Column, values: string[]): void {
  for (const v of values) {
    col.storage.push(v);
  }
}

// Helper: resolve context inputs and assemble messages
function assemble(
  col: ReturnType<typeof column>,
  currentStep: number,
): Message[] {
  const inputs = resolveContextInputs(col.context, col, currentStep);
  return assembleMessages(inputs);
}

describe("context assembly", () => {
  // Example 1: Standard Chat (Accumulator)
  test("example 1: standard chat accumulator", () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: self, row: "previous", count: "all" },
      ],
      compute: async () => "",
    });

    populate(user, ["Hello", "What's TypeScript?", "Thanks"]);
    populate(assistant, ["Hi! How can I help?", "TypeScript is a..."]);

    const messages = assemble(assistant, 2);
    expect(messages).toEqual([
      { role: "user", content: "<user>\nHello\n</user>" },
      { role: "assistant", content: "Hi! How can I help?" },
      { role: "user", content: "<user>\nWhat's TypeScript?\n</user>" },
      { role: "assistant", content: "TypeScript is a..." },
      { role: "user", content: "<user>\nThanks\n</user>" },
    ]);
  });

  // Example 2: Stateless Map (No Self)
  test("example 2: stateless map", () => {
    const user = source("user");
    const topics = column("topics", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });

    populate(user, ["Hello", "Let's discuss Rust", "And memory safety"]);
    populate(topics, ["greetings", "Rust, programming"]);

    // At step 2
    const messages = assemble(topics, 2);
    expect(messages).toEqual([
      { role: "user", content: "<user>\nAnd memory safety\n</user>" },
    ]);

    // At step 1
    const messages1 = assemble(topics, 1);
    expect(messages1).toEqual([
      { role: "user", content: "<user>\nLet's discuss Rust\n</user>" },
    ]);
  });

  // Example 3: Reducer (Latest Self, All Input)
  test("example 3: reducer at step 0", () => {
    const user = source("user");
    const summary = column("summary", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: self, row: "previous", count: "single" },
      ],
      compute: async () => "",
    });

    populate(user, ["I'm considering Rust", "For the backend rewrite", "Because Python is slow"]);
    populate(summary, ["User is considering Rust.", "User wants to rewrite the backend in Rust."]);

    const messages0 = assemble(summary, 0);
    expect(messages0).toEqual([
      { role: "user", content: "<user>\nI'm considering Rust\n</user>" },
    ]);
  });

  test("example 3: reducer at step 1", () => {
    const user = source("user");
    const summary = column("summary", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: self, row: "previous", count: "single" },
      ],
      compute: async () => "",
    });

    populate(user, ["I'm considering Rust", "For the backend rewrite", "Because Python is slow"]);
    populate(summary, ["User is considering Rust.", "User wants to rewrite the backend in Rust."]);

    const messages1 = assemble(summary, 1);
    expect(messages1).toEqual([
      { role: "user", content: "<user>\nI'm considering Rust\n</user>" },
      { role: "assistant", content: "User is considering Rust." },
      { role: "user", content: "<user>\nFor the backend rewrite\n</user>" },
    ]);
  });

  test("example 3: reducer at step 2 (merges consecutive user messages)", () => {
    const user = source("user");
    const summary = column("summary", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: self, row: "previous", count: "single" },
      ],
      compute: async () => "",
    });

    populate(user, ["I'm considering Rust", "For the backend rewrite", "Because Python is slow"]);
    populate(summary, ["User is considering Rust.", "User wants to rewrite the backend in Rust."]);

    const messages2 = assemble(summary, 2);
    expect(messages2).toEqual([
      { role: "user", content: "<user>\nI'm considering Rust\n</user>\n\n<user>\nFor the backend rewrite\n</user>" },
      { role: "assistant", content: "User wants to rewrite the backend in Rust." },
      { role: "user", content: "<user>\nBecause Python is slow\n</user>" },
    ]);
  });

  // Example 4: Multiple Inputs with XML Wrapping
  test("example 4: multiple inputs with XML wrapping", () => {
    const user = source("user");
    const summaryCol = source("summary"); // using source as stand-in for a derived column with known values

    const critique = column("critique", {
      context: [
        { column: summaryCol, row: "current", count: "single" },
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });

    populate(user, ["I'm considering Rust", "Because Python is slow"]);
    populate(summaryCol, ["User is considering Rust.", "User wants to rewrite backend in Rust..."]);

    const messages = assemble(critique, 1);
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
      context: [
        { column: user, row: "current", count: "all" },
        { column: topics, row: "current", count: "all" },
        { column: self, row: "previous", count: "all" },
      ],
      compute: async () => "",
    });

    populate(user, ["I like Rust", "And Go is nice", "Maybe Zig too"]);
    populate(topics, ["Rust", "Go", "Zig"]);
    populate(analysis, ["User mentions Rust.", "Expanded to Go."]);

    const messages = assemble(analysis, 2);
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
      context: [
        { column: steelman, row: "current", count: "single" },
      ],
      compute: async () => "",
    });

    populate(user, ["We should use Rust", "Python is too slow"]);
    populate(steelman, ["Rust offers memory safety...", "Python's GIL limits..."]);

    const messages = assemble(critic, 1);
    expect(messages).toEqual([
      { role: "user", content: "<steelman>\nPython's GIL limits...\n</steelman>" },
    ]);
  });

  // Edge case: XML wrapping consistency with mixed count modes
  test("XML wrapping when context has multiple non-self entries with different counts", () => {
    const user = source("user");
    const summaryCol = source("summary");

    // user (all) + summary (single) => 2 inputs, always XML wrap
    const col = column("test", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: summaryCol, row: "current", count: "single" },
      ],
      compute: async () => "",
    });

    populate(user, ["msg0", "msg1", "msg2"]);
    populate(summaryCol, ["s0", "s1", "s2"]);

    // At step 2: user contributes steps 0-2, summary only step 2
    const messages = assemble(col, 2);
    expect(messages).toEqual([
      {
        role: "user",
        content:
          "<user>\nmsg0\n</user>\n\n<user>\nmsg1\n</user>\n\n<user>\nmsg2\n</user>\n\n<summary>\ns2\n</summary>",
      },
    ]);
  });

  // Validation: self must have row: 'previous'
  test("self with row: 'current' throws", () => {
    const user = source("user");
    expect(() =>
      column("bad", {
        context: [
          { column: user, row: "current", count: "all" },
          { column: self, row: "current" as any, count: "all" },
        ],
        compute: async () => "",
      })
    ).toThrow("self dependency must have row: 'previous'");
  });

  // Validation: at least one dependency required
  test("empty context throws", () => {
    expect(() =>
      column("bad", {
        context: [],
        compute: async () => "",
      })
    ).toThrow("must have at least one dependency");
  });
});
