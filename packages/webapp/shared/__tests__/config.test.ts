import { describe, test, expect } from "bun:test";
import { diffConfigs } from "../config.js";
import type { ColumnConfig, SessionConfig } from "../types.js";

function col(
  name: string,
  deps: string[] = ["input"],
  overrides: Partial<ColumnConfig> = {},
): ColumnConfig {
  return {
    name,
    systemPrompt: `prompt-${name}`,
    reminder: "",
    color: "#000",
    context: deps.map((d) => ({ column: d, row: "current" as const, count: "single" as const })),
    ...overrides,
  };
}

describe("diffConfigs", () => {
  test("detects removed columns", () => {
    const old: SessionConfig = [col("a"), col("b")];
    const next: SessionConfig = [col("a")];
    const diff = diffConfigs(old, next);

    expect(diff.removed).toEqual(["b"]);
    expect(diff.added).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.colorOnly).toEqual([]);
  });

  test("detects added columns", () => {
    const old: SessionConfig = [col("a")];
    const next: SessionConfig = [col("a"), col("b")];
    const diff = diffConfigs(old, next);

    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([col("b")]);
    expect(diff.modified).toEqual([]);
  });

  test("detects modified columns — prompt change", () => {
    const old: SessionConfig = [col("a")];
    const next: SessionConfig = [col("a", ["input"], { systemPrompt: "new" })];
    const diff = diffConfigs(old, next);

    expect(diff.modified).toEqual([
      { name: "a", config: col("a", ["input"], { systemPrompt: "new" }) },
    ]);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
  });

  test("detects modified columns — reminder change", () => {
    const old: SessionConfig = [col("a")];
    const next: SessionConfig = [col("a", ["input"], { reminder: "be concise" })];
    const diff = diffConfigs(old, next);

    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0].name).toBe("a");
  });

  test("detects modified columns — context change", () => {
    const old: SessionConfig = [col("a"), col("b", ["a"])];
    const next: SessionConfig = [col("a"), col("b", ["input"])];
    const diff = diffConfigs(old, next);

    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0].name).toBe("b");
  });

  test("detects color-only changes", () => {
    const old: SessionConfig = [col("a")];
    const next: SessionConfig = [col("a", ["input"], { color: "#fff" })];
    const diff = diffConfigs(old, next);

    expect(diff.colorOnly).toEqual(["a"]);
    expect(diff.modified).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
  });

  test("no changes — all empty", () => {
    const config: SessionConfig = [col("a"), col("b")];
    const diff = diffConfigs(config, config);

    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.colorOnly).toEqual([]);
  });

  test("combo: add + remove + modify in one diff", () => {
    const old: SessionConfig = [
      col("a"),
      col("b"),
      col("c"),
    ];
    const next: SessionConfig = [
      col("a", ["input"], { systemPrompt: "changed" }),
      col("c"),
      col("d"),
    ];
    const diff = diffConfigs(old, next);

    expect(diff.removed).toEqual(["b"]);
    expect(diff.added).toEqual([col("d")]);
    expect(diff.modified.length).toBe(1);
    expect(diff.modified[0].name).toBe("a");
  });
});
