import { describe, test, expect } from "bun:test";
import { source, column, self, flow, inMemoryStorage } from "columnar";
import type { Column, DerivedColumn, Dependency, StorageProvider } from "columnar";
import { applyConfigUpdate } from "../flow.js";
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

function testColumnFactory(
  cfg: ColumnConfig,
  columnMap: Map<string, Column>,
  storage: StorageProvider,
): DerivedColumn {
  const deps: Dependency[] = cfg.context.map((ref) => {
    if (ref.column === "self") return { column: self, row: "previous" as const, count: ref.count };
    const resolved = columnMap.get(ref.column);
    if (!resolved) throw new Error(`Missing column: ${ref.column}`);
    return { column: resolved, row: ref.row, count: ref.count };
  });
  return column(cfg.name, {
    context: deps,
    compute: () => `${cfg.name}-value`,
    storage,
  });
}

function createTestSession(configs: ColumnConfig[]) {
  const storage = inMemoryStorage();
  const input = source("input", { storage });
  const columnMap = new Map<string, Column>();
  columnMap.set("input", input);

  const derived: DerivedColumn[] = [];
  for (const cfg of configs) {
    const c = testColumnFactory(cfg, columnMap, storage);
    columnMap.set(cfg.name, c);
    derived.push(c);
  }

  const f = flow(...derived);
  return { f, columnMap, storage, input };
}

describe("applyConfigUpdate", () => {
  test("cascade removal + re-add (the config apply bug)", async () => {
    // Initial: A(→input), B(→A), C(→A)
    const oldConfig: SessionConfig = [col("a"), col("b", ["a"]), col("c", ["a"])];
    const session = createTestSession(oldConfig);

    // New config: B(→input), C(→input) — A removed, B and C changed deps
    const newConfig: SessionConfig = [col("b"), col("c")];
    const diff = diffConfigs(oldConfig, newConfig);

    expect(diff.removed).toEqual(["a"]);

    applyConfigUpdate(session, diff, newConfig, testColumnFactory);

    // A should be gone, B and C should be re-added
    expect(session.columnMap.has("a")).toBe(false);
    expect(session.columnMap.has("b")).toBe(true);
    expect(session.columnMap.has("c")).toBe(true);

    // Push input and run to verify the flow works
    session.input.push("hello");
    await session.f.run();

    expect(session.f.get("a", 0)).toBeUndefined();
    expect(session.f.get("b", 0)).toBe("b-value");
    expect(session.f.get("c", 0)).toBe("c-value");
  });

  test("simple removal — no dependents", async () => {
    const oldConfig: SessionConfig = [col("a"), col("b")];
    const session = createTestSession(oldConfig);

    session.input.push("hello");
    await session.f.run();

    expect(session.f.get("a", 0)).toBe("a-value");
    expect(session.f.get("b", 0)).toBe("b-value");

    const newConfig: SessionConfig = [col("a")];
    const diff = diffConfigs(oldConfig, newConfig);

    applyConfigUpdate(session, diff, newConfig, testColumnFactory);

    expect(session.columnMap.has("b")).toBe(false);
    expect(session.f.get("b", 0)).toBeUndefined();
    // Existing column a is preserved
    expect(session.f.get("a", 0)).toBe("a-value");
  });

  test("add new column", async () => {
    const oldConfig: SessionConfig = [col("a")];
    const session = createTestSession(oldConfig);

    session.input.push("hello");
    await session.f.run();

    const newConfig: SessionConfig = [col("a"), col("b")];
    const diff = diffConfigs(oldConfig, newConfig);

    applyConfigUpdate(session, diff, newConfig, testColumnFactory);

    expect(session.columnMap.has("b")).toBe(true);

    // run() backfills the new column
    await session.f.run();
    expect(session.f.get("b", 0)).toBe("b-value");
  });

  test("modify existing column — replaceColumn path", async () => {
    const oldConfig: SessionConfig = [col("a")];
    const session = createTestSession(oldConfig);

    session.input.push("hello");
    await session.f.run();
    expect(session.f.get("a", 0)).toBe("a-value");

    const newConfig: SessionConfig = [
      col("a", ["input"], { systemPrompt: "new-prompt" }),
    ];
    const diff = diffConfigs(oldConfig, newConfig);

    expect(diff.modified.length).toBe(1);

    applyConfigUpdate(session, diff, newConfig, testColumnFactory);

    // Storage cleared by replaceColumn, needs recompute
    expect(session.f.get("a", 0)).toBeUndefined();

    await session.f.run();
    expect(session.f.get("a", 0)).toBe("a-value");
  });

  test("no-op — empty diff causes no mutations", async () => {
    const config: SessionConfig = [col("a")];
    const session = createTestSession(config);

    session.input.push("hello");
    await session.f.run();

    const diff = diffConfigs(config, config);
    applyConfigUpdate(session, diff, config, testColumnFactory);

    // Nothing changed
    expect(session.f.get("a", 0)).toBe("a-value");
  });

  test("remove + add simultaneously", async () => {
    const oldConfig: SessionConfig = [col("a")];
    const session = createTestSession(oldConfig);

    session.input.push("hello");
    await session.f.run();

    const newConfig: SessionConfig = [col("b")];
    const diff = diffConfigs(oldConfig, newConfig);

    applyConfigUpdate(session, diff, newConfig, testColumnFactory);

    expect(session.columnMap.has("a")).toBe(false);
    expect(session.columnMap.has("b")).toBe(true);

    await session.f.run();
    expect(session.f.get("a", 0)).toBeUndefined();
    expect(session.f.get("b", 0)).toBe("b-value");
  });

  test("cascade removal where dependents are also explicitly removed", () => {
    // A(→input), B(→A) — remove both A and B
    const oldConfig: SessionConfig = [col("a"), col("b", ["a"])];
    const session = createTestSession(oldConfig);

    const newConfig: SessionConfig = [];
    const diff = diffConfigs(oldConfig, newConfig);

    // Both a and b in diff.removed. b depends on a.
    // Should not double-remove.
    expect(() => {
      applyConfigUpdate(session, diff, newConfig, testColumnFactory);
    }).not.toThrow();

    expect(session.columnMap.has("a")).toBe(false);
    expect(session.columnMap.has("b")).toBe(false);
  });
});
