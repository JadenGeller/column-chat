import { describe, test, expect } from "bun:test";
import { source, column, self } from "../column.js";
import { flow } from "../flow.js";

describe("flow", () => {
  test("standard chat lifecycle: push, run, get", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: self, row: "previous", count: "all" },
      ],
      compute: async ({ messages }) => {
        const last = messages[messages.length - 1].content;
        return `echo: ${last}`;
      },
    });

    const f = flow(assistant);

    user.push("Hello");
    const events: any[] = [];
    for await (const e of f.run()) {
      events.push(e);
    }

    expect(events).toEqual([
      { kind: "start", column: "assistant", step: 0 },
      { kind: "value", column: "assistant", step: 0, value: "echo: <user>\nHello\n</user>" },
    ]);

    expect(f.get("assistant", 0)).toBe("echo: <user>\nHello\n</user>");
    expect(f.get("user", 0)).toBe("Hello");
  });

  test("multi-step conversation", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: self, row: "previous", count: "all" },
      ],
      compute: async ({ messages }) => {
        return `reply ${messages.length}`;
      },
    });

    const f = flow(assistant);

    user.push("msg1");
    await f.run();
    expect(f.get("assistant", 0)).toBe("reply 1");

    user.push("msg2");
    await f.run();
    // At step 1: user msg1, assistant reply1, user msg2 => 3 messages
    expect(f.get("assistant", 1)).toBe("reply 3");
  });

  test("idempotent run — yields nothing when nothing new", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "done",
    });

    const f = flow(assistant);
    user.push("hello");
    await f.run();

    const events: any[] = [];
    for await (const e of f.run()) {
      events.push(e);
    }
    expect(events).toEqual([]);
  });

  test("DAG with chained columns", async () => {
    const user = source("user");
    const steelman = column("steelman", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `pro: ${messages[0].content}`,
    });
    const critic = column("critic", {
      context: [
        { column: steelman, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `con: ${messages[0].content}`,
    });

    const f = flow(critic);
    user.push("Rust is good");

    const events: any[] = [];
    for await (const e of f.run()) {
      events.push(e);
    }

    // steelman computes first, then critic
    expect(events).toEqual([
      { kind: "start", column: "steelman", step: 0 },
      { kind: "value", column: "steelman", step: 0, value: "pro: <user>\nRust is good\n</user>" },
      { kind: "start", column: "critic", step: 0 },
      { kind: "value", column: "critic", step: 0, value: "con: <steelman>\npro: <user>\nRust is good\n</user>\n</steelman>" },
    ]);
  });

  test("row: 'current' cycle detection", () => {
    const user = source("user");
    const c1 = column("c1", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const c2 = column("c2", {
      context: [
        { column: c1, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    // Create a current-row cycle: c1 depends on c2
    (c1 as any).context = [{ column: c2, row: "current", count: "single" }];

    expect(() => flow(c2)).toThrow("Cycle detected");
  });

  test("row: 'previous' cycles are allowed (pipeline parallelism)", () => {
    const input = source("input");
    const A = column("A", {
      context: [
        { column: input, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const B = column("B", {
      context: [
        { column: input, row: "current", count: "single" },
        { column: A, row: "previous", count: "single" },
      ],
      compute: async () => "",
    });
    // Create previous-row cycle: A also depends on B.previous
    (A as any).context = [
      { column: input, row: "current", count: "single" },
      { column: B, row: "previous", count: "single" },
    ];

    // Should NOT throw — previous-row cycles are valid
    expect(() => flow(A, B)).not.toThrow();
  });

  test("addColumn backfills completed steps", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `reply: ${messages[0].content}`,
    });

    const f = flow(assistant);

    user.push("step0");
    user.push("step1");
    await f.run();

    expect(f.get("assistant", 0)).toBe("reply: <user>\nstep0\n</user>");
    expect(f.get("assistant", 1)).toBe("reply: <user>\nstep1\n</user>");

    // Add a new column after 2 steps have been computed
    const wordcount = column("wordcount", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async ({ messages }) =>
        String(messages[0].content.split(/\s+/).length),
    });

    f.addColumn(wordcount);

    // addColumn is sync — values aren't computed yet
    expect(f.get("wordcount", 0)).toBeUndefined();

    // run() backfills the new column
    const events: any[] = [];
    for await (const e of f.run()) {
      events.push(e);
    }

    // Only wordcount events (assistant already computed)
    expect(events.map(e => e.column)).toEqual(["wordcount", "wordcount", "wordcount", "wordcount"]);

    // XML-wrapped content: "<user>\nstep0\n</user>" splits into 3 tokens
    expect(f.get("wordcount", 0)).toBe("3");
    expect(f.get("wordcount", 1)).toBe("3");
  });

  test("get returns undefined for unknown column or step", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "x",
    });

    const f = flow(a);
    user.push("hello");
    await f.run();

    expect(f.get("nonexistent", 0)).toBeUndefined();
    expect(f.get("a", 99)).toBeUndefined();
  });

  test("reducer pattern accumulates correctly", async () => {
    const user = source("user");
    const summary = column("summary", {
      context: [
        { column: user, row: "current", count: "all" },
        { column: self, row: "previous", count: "single" },
      ],
      compute: async ({ messages }) => {
        // Just join all user content as a simple "summary"
        const userMsgs = messages
          .filter((m) => m.role === "user")
          .map((m) => m.content);
        return userMsgs.join(" + ");
      },
    });

    const f = flow(summary);

    user.push("alpha");
    await f.run();
    expect(f.get("summary", 0)).toBe("<user>\nalpha\n</user>");

    user.push("beta");
    await f.run();
    // At step 1: user sees [alpha, beta], self.previous.single sees step 0
    // messages: user "<user>\nalpha\n</user>", assistant "<user>\nalpha\n</user>", user "<user>\nbeta\n</user>"
    expect(f.get("summary", 1)).toBe("<user>\nalpha\n</user> + <user>\nbeta\n</user>");

    user.push("gamma");
    await f.run();
    // At step 2: user sees [alpha, beta, gamma], self.previous.single sees step 1
    // self.previous.single = step 1 only, so steps 0-1 of user merge (no assistant between them at step 0)
    // messages: user "<user>\nalpha\n</user>\n\n<user>\nbeta\n</user>", assistant "...", user "<user>\ngamma\n</user>"
    expect(f.get("summary", 2)).toBe("<user>\nalpha\n</user>\n\n<user>\nbeta\n</user> + <user>\ngamma\n</user>");
  });

  test("multiple source columns", async () => {
    const a = source("a");
    const b = source("b");
    const combined = column("combined", {
      context: [
        { column: a, row: "current", count: "single" },
        { column: b, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => messages[0].content,
    });

    const f = flow(combined);
    a.push("x");
    b.push("y");
    await f.run();

    // Multiple inputs => XML wrapping
    expect(f.get("combined", 0)).toBe("<a>\nx\n</a>\n\n<b>\ny\n</b>");
  });
});

describe("streaming", () => {
  test("streaming compute yields delta then value events", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async function* () {
        yield "Hello";
        yield " ";
        yield "World";
      },
    });

    const f = flow(assistant);
    user.push("hi");

    const events: any[] = [];
    for await (const e of f.run()) {
      events.push(e);
    }

    expect(events).toEqual([
      { kind: "start", column: "assistant", step: 0 },
      { kind: "delta", column: "assistant", step: 0, delta: "Hello" },
      { kind: "delta", column: "assistant", step: 0, delta: " " },
      { kind: "delta", column: "assistant", step: 0, delta: "World" },
      { kind: "value", column: "assistant", step: 0, value: "Hello World" },
    ]);
  });

  test("accumulated value stored correctly", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async function* () {
        yield "a";
        yield "b";
        yield "c";
      },
    });

    const f = flow(assistant);
    user.push("hi");
    await f.run();

    expect(f.get("assistant", 0)).toBe("abc");
  });

  test("mixed streaming and non-streaming columns run in parallel", async () => {
    const user = source("user");
    const streamer = column("streamer", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async function* () {
        yield "s1";
        yield "s2";
      },
    });
    const plain = column("plain", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "plain-value",
    });

    const f = flow(streamer, plain);
    user.push("hi");

    const events: any[] = [];
    for await (const e of f.run()) {
      events.push(e);
    }

    // Parallel execution — per-column order is preserved but interleaving is non-deterministic
    const streamerEvents = events.filter((e: any) => e.column === "streamer");
    const plainEvents = events.filter((e: any) => e.column === "plain");

    expect(streamerEvents).toEqual([
      { kind: "start", column: "streamer", step: 0 },
      { kind: "delta", column: "streamer", step: 0, delta: "s1" },
      { kind: "delta", column: "streamer", step: 0, delta: "s2" },
      { kind: "value", column: "streamer", step: 0, value: "s1s2" },
    ]);
    expect(plainEvents).toEqual([
      { kind: "start", column: "plain", step: 0 },
      { kind: "value", column: "plain", step: 0, value: "plain-value" },
    ]);
  });

  test("await f.run() drains streaming silently", async () => {
    const user = source("user");
    let yieldCount = 0;
    const assistant = column("assistant", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async function* () {
        yieldCount++;
        yield "tok1";
        yieldCount++;
        yield "tok2";
      },
    });

    const f = flow(assistant);
    user.push("hi");
    await f.run();

    expect(yieldCount).toBe(2);
    expect(f.get("assistant", 0)).toBe("tok1tok2");
  });

  test("addColumn backfill with streaming compute", async () => {
    const user = source("user");
    const plain = column("plain", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "done",
    });

    const f = flow(plain);
    user.push("step0");
    user.push("step1");
    await f.run();

    const streamer = column("streamer", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async function* ({ messages }) {
        const text = messages[0].content;
        yield "got:";
        yield text;
      },
    });

    f.addColumn(streamer);
    await f.run();

    expect(f.get("streamer", 0)).toBe("got:<user>\nstep0\n</user>");
    expect(f.get("streamer", 1)).toBe("got:<user>\nstep1\n</user>");
  });
});

describe("removeColumn", () => {
  test("removes column from flow", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "a-val",
    });
    const b = column("b", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "b-val",
    });

    const f = flow(a, b);
    user.push("hi");
    await f.run();

    expect(f.get("a", 0)).toBe("a-val");
    expect(f.get("b", 0)).toBe("b-val");

    f.removeColumn("b");

    // b is gone, a still works
    expect(f.get("b", 0)).toBeUndefined();
    expect(f.get("a", 0)).toBe("a-val");

    // New steps still compute a but not b
    user.push("hi2");
    await f.run();
    expect(f.get("a", 1)).toBe("a-val");
    expect(f.get("b", 1)).toBeUndefined();
  });

  test("throws if dependents exist", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "a-val",
    });
    const b = column("b", {
      context: [
        { column: a, row: "current", count: "single" },
      ],
      compute: async () => "b-val",
    });

    const f = flow(b);

    expect(() => f.removeColumn("a")).toThrow('column "b" depends on it');
  });

  test("throws for unknown column", () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const f = flow(a);

    expect(() => f.removeColumn("nonexistent")).toThrow('not found');
  });

  test("throws for source column", () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const f = flow(a);

    expect(() => f.removeColumn("user")).toThrow('source');
  });
});

describe("replaceColumn", () => {
  test("replaces column and recomputes on run", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `v1: ${messages[0].content}`,
    });

    const f = flow(a);
    user.push("hello");
    await f.run();

    expect(f.get("a", 0)).toBe("v1: <user>\nhello\n</user>");

    // Replace with new compute function
    const a2 = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `v2: ${messages[0].content}`,
    });

    f.replaceColumn("a", a2);

    // After replace, old values are cleared
    expect(f.get("a", 0)).toBeUndefined();

    // run() recomputes
    await f.run();
    expect(f.get("a", 0)).toBe("v2: <user>\nhello\n</user>");
  });

  test("recomputes transitive dependents", async () => {
    const user = source("user");
    let aPrefix = "v1";
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => `${aPrefix}`,
    });
    const b = column("b", {
      context: [
        { column: a, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `b(${messages[0].content})`,
    });

    const f = flow(b);
    user.push("hi");
    await f.run();

    expect(f.get("a", 0)).toBe("v1");
    expect(f.get("b", 0)).toBe("b(<a>\nv1\n</a>)");

    // Replace a with new version
    const a2 = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "v2",
    });

    f.replaceColumn("a", a2);

    // Both a and b should be cleared
    expect(f.get("a", 0)).toBeUndefined();
    expect(f.get("b", 0)).toBeUndefined();

    await f.run();

    expect(f.get("a", 0)).toBe("v2");
    expect(f.get("b", 0)).toBe("b(<a>\nv2\n</a>)");
  });

  test("yields events for recomputed columns", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "old",
    });

    const f = flow(a);
    user.push("hi");
    await f.run();

    const a2 = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "new",
    });

    f.replaceColumn("a", a2);

    const events: any[] = [];
    for await (const e of f.run()) {
      events.push(e);
    }

    expect(events).toEqual([
      { kind: "start", column: "a", step: 0 },
      { kind: "value", column: "a", step: 0, value: "new" },
    ]);
  });

  test("throws if name mismatch", () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const f = flow(a);

    const b = column("b", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });

    expect(() => f.replaceColumn("a", b)).toThrow('must match');
  });
});

describe("dependents", () => {
  test("returns transitive dependents in topo order", () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const b = column("b", {
      context: [
        { column: a, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const c = column("c", {
      context: [
        { column: b, row: "current", count: "single" },
      ],
      compute: async () => "",
    });

    const f = flow(c);
    expect(f.dependents("a")).toEqual(["b", "c"]);
    expect(f.dependents("b")).toEqual(["c"]);
    expect(f.dependents("c")).toEqual([]);
  });

  test("returns empty for unknown column", () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const f = flow(a);
    expect(f.dependents("nonexistent")).toEqual([]);
  });

  test("returns empty for leaf column", () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const f = flow(a);
    expect(f.dependents("a")).toEqual([]);
  });

  test("handles diamond dependencies", () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const b = column("b", {
      context: [
        { column: a, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const c = column("c", {
      context: [
        { column: a, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const d = column("d", {
      context: [
        { column: b, row: "current", count: "single" },
        { column: c, row: "current", count: "single" },
      ],
      compute: async () => "",
    });

    const f = flow(d);
    const deps = f.dependents("a");
    // b and c are both direct dependents of a, d depends on both
    expect(deps).toContain("b");
    expect(deps).toContain("c");
    expect(deps).toContain("d");
    // d must come after both b and c
    expect(deps.indexOf("d")).toBeGreaterThan(deps.indexOf("b"));
    expect(deps.indexOf("d")).toBeGreaterThan(deps.indexOf("c"));
  });

  test("includes row: 'previous' dependents for invalidation", () => {
    const input = source("input");
    const A = column("A", {
      context: [
        { column: input, row: "current", count: "single" },
      ],
      compute: async () => "",
    });
    const B = column("B", {
      context: [
        { column: input, row: "current", count: "single" },
        { column: A, row: "previous", count: "single" },
      ],
      compute: async () => "",
    });

    const f = flow(A, B);
    // B depends on A via row: 'previous', so B is a dependent of A
    expect(f.dependents("A")).toContain("B");
  });
});

describe("replaceColumn context fixup", () => {
  test("dependent columns read from new column after replace", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "old-a",
    });
    const b = column("b", {
      context: [
        { column: a, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `b(${messages[0].content})`,
    });

    const f = flow(b);
    user.push("hi");
    await f.run();

    expect(f.get("b", 0)).toBe("b(<a>\nold-a\n</a>)");

    // Replace a — b's context should now read from the new a
    const a2 = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "new-a",
    });
    f.replaceColumn("a", a2);
    await f.run();

    expect(f.get("a", 0)).toBe("new-a");
    expect(f.get("b", 0)).toBe("b(<a>\nnew-a\n</a>)");
  });

  test("deep chain fixup works through multiple levels", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "old",
    });
    const b = column("b", {
      context: [
        { column: a, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `b:${messages[0].content}`,
    });
    const c = column("c", {
      context: [
        { column: b, row: "current", count: "single" },
      ],
      compute: async ({ messages }) => `c:${messages[0].content}`,
    });

    const f = flow(c);
    user.push("x");
    await f.run();

    const a2 = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "new",
    });
    f.replaceColumn("a", a2);
    await f.run();

    expect(f.get("a", 0)).toBe("new");
    // b should read from new a
    expect(f.get("b", 0)).toContain("new");
    // c should read from recomputed b
    expect(f.get("c", 0)).toContain("new");
  });
});

describe("ColumnStorage.clear", () => {
  test("clears values and resets length", async () => {
    const user = source("user");
    const a = column("a", {
      context: [
        { column: user, row: "current", count: "single" },
      ],
      compute: async () => "val",
    });

    const f = flow(a);
    user.push("s0");
    user.push("s1");
    await f.run();

    expect(a.storage.length).toBe(2);
    expect(a.storage.get(0)).toBe("val");

    a.storage.clear();

    expect(a.storage.length).toBe(0);
    expect(a.storage.get(0)).toBeUndefined();
    expect(a.storage.get(1)).toBeUndefined();

    // Can push again after clear
    a.storage.push("new");
    expect(a.storage.length).toBe(1);
    expect(a.storage.get(0)).toBe("new");
  });
});
