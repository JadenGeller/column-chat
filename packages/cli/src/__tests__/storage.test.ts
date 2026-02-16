import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSystemStorage } from "../storage.js";
import { source, column, self, flow } from "columnar";

function makeTmpDir(): string {
  return join(tmpdir(), `columnar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("fileSystemStorage", () => {
  it("empty/nonexistent dir → length 0, get returns undefined", () => {
    const dir = makeTmpDir();
    const storage = fileSystemStorage(dir)("test");
    expect(storage.length).toBe(0);
    expect(storage.get(0)).toBeUndefined();
    expect(storage.get(5)).toBeUndefined();
  });

  it("push creates files and increments length", () => {
    const dir = makeTmpDir();
    const storage = fileSystemStorage(dir)("test");

    storage.push("hello");
    expect(storage.length).toBe(1);
    expect(storage.get(0)).toBe("hello");

    storage.push("world");
    expect(storage.length).toBe(2);
    expect(storage.get(0)).toBe("hello");
    expect(storage.get(1)).toBe("world");
  });

  it("detects pre-existing source files", () => {
    const dir = makeTmpDir();
    const colDir = join(dir, "test");
    mkdirSync(colDir, { recursive: true });
    writeFileSync(join(colDir, "0.txt"), "first");
    writeFileSync(join(colDir, "1.txt"), "second");

    const storage = fileSystemStorage(dir)("test");
    expect(storage.length).toBe(2);
    expect(storage.get(0)).toBe("first");
    expect(storage.get(1)).toBe("second");
  });

  it("push appends after pre-existing files", () => {
    const dir = makeTmpDir();
    const colDir = join(dir, "test");
    mkdirSync(colDir, { recursive: true });
    writeFileSync(join(colDir, "0.txt"), "existing");

    const storage = fileSystemStorage(dir)("test");
    expect(storage.length).toBe(1);

    storage.push("appended");
    expect(storage.length).toBe(2);
    expect(storage.get(0)).toBe("existing");
    expect(storage.get(1)).toBe("appended");
  });

  it("auto-creates directory on first push", () => {
    const dir = makeTmpDir();
    const storage = fileSystemStorage(dir)("test");

    storage.push("auto-created");
    expect(storage.length).toBe(1);
    expect(storage.get(0)).toBe("auto-created");
  });

  it("integration: source + derived with fs storage through flow", async () => {
    const baseDir = makeTmpDir();
    const storage = fileSystemStorage(baseDir);

    const user = source("user", { storage });
    const assistant = column("assistant", {
      context: [user, self],
      compute: ({ messages }) => {
        const lastMsg = messages[messages.length - 1];
        return `echo: ${lastMsg.content}`;
      },
      storage,
    });

    const f = flow(assistant);

    user.push("hello");
    user.push("world");

    const events: { column: string; step: number; value: string }[] = [];
    for await (const event of f.run()) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ column: "assistant", step: 0, value: "echo: hello" });
    expect(events[1]).toEqual({ column: "assistant", step: 1, value: "echo: world" });

    // Verify files on disk via a fresh provider
    const verify = fileSystemStorage(baseDir);
    const assistantStorage = verify("assistant");
    expect(assistantStorage.length).toBe(2);
    expect(assistantStorage.get(0)).toBe("echo: hello");
    expect(assistantStorage.get(1)).toBe("echo: world");

    rmSync(baseDir, { recursive: true, force: true });
  });

  it("idempotent re-run yields no events", async () => {
    const baseDir = makeTmpDir();
    const storage = fileSystemStorage(baseDir);

    const user = source("user", { storage });
    const assistant = column("assistant", {
      context: [user, self],
      compute: ({ messages }) => {
        const lastMsg = messages[messages.length - 1];
        return `echo: ${lastMsg.content}`;
      },
      storage,
    });

    const f = flow(assistant);
    user.push("hello");

    const firstEvents: { column: string; step: number; value: string }[] = [];
    for await (const event of f.run()) {
      firstEvents.push(event);
    }
    expect(firstEvents).toHaveLength(1);

    const secondEvents: { column: string; step: number; value: string }[] = [];
    for await (const event of f.run()) {
      secondEvents.push(event);
    }
    expect(secondEvents).toHaveLength(0);

    rmSync(baseDir, { recursive: true, force: true });
  });
});
