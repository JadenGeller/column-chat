import { describe, test, expect } from "bun:test";
import type { ColumnConfig, Mutation, SessionConfig } from "../types.js";
import { overlay } from "../types.js";

function col(
  name: string,
  id: string = `id-${name}`,
  overrides: Partial<ColumnConfig> = {},
): ColumnConfig {
  return {
    id,
    name,
    systemPrompt: `prompt-${name}`,
    reminder: "",
    color: "#000",
    context: [{ column: "input", row: "current" as const, count: "all" as const }],
    ...overrides,
  };
}

describe("overlay", () => {
  test("no mutations returns base", () => {
    const base = [col("a"), col("b")];
    expect(overlay(base, [])).toEqual(base);
  });

  test("add appends column", () => {
    const base = [col("a")];
    const result = overlay(base, [{ type: "add", config: col("b") }]);
    expect(result.length).toBe(2);
    expect(result[1].name).toBe("b");
  });

  test("remove filters column", () => {
    const base = [col("a"), col("b")];
    const result = overlay(base, [{ type: "remove", id: "id-b" }]);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("a");
  });

  test("update changes fields", () => {
    const base = [col("a")];
    const result = overlay(base, [
      { type: "update", id: "id-a", changes: { systemPrompt: "new" } },
    ]);
    expect(result[0].systemPrompt).toBe("new");
    expect(result[0].name).toBe("a");
  });

  test("update name cascades to context refs", () => {
    const base = [
      col("a"),
      col("b", "id-b", { context: [{ column: "a", row: "current", count: "all" }] }),
    ];
    const result = overlay(base, [
      { type: "update", id: "id-a", changes: { name: "a_renamed" } },
    ]);
    expect(result[0].name).toBe("a_renamed");
    expect(result[1].context[0].column).toBe("a_renamed");
  });

  test("move swaps columns", () => {
    const base = [col("a"), col("b"), col("c")];
    const result = overlay(base, [
      { type: "move", id: "id-a", direction: 1 },
    ]);
    expect(result.map((c) => c.name)).toEqual(["b", "a", "c"]);
  });

  test("sequential mutations compose", () => {
    const base: SessionConfig = [];
    const result = overlay(base, [
      { type: "add", config: col("a") },
      { type: "update", id: "id-a", changes: { systemPrompt: "changed" } },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].systemPrompt).toBe("changed");
  });

  test("does not mutate base", () => {
    const base = [col("a")];
    const original = JSON.stringify(base);
    overlay(base, [{ type: "update", id: "id-a", changes: { name: "b" } }]);
    expect(JSON.stringify(base)).toBe(original);
  });
});
