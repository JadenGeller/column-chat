import { describe, test, expect } from "bun:test";
import { source, column, self } from "../column.js";
import { flow } from "../flow.js";

describe("flow", () => {
  test("standard chat lifecycle: push, run, get", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [user, self],
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
      context: [user, self],
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
      context: [user.latest],
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
      context: [user.latest],
      compute: async ({ messages }) => `pro: ${messages[0].content}`,
    });
    const critic = column("critic", {
      context: [steelman.latest],
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

  test("cycle detection", () => {
    const user = source("user");
    const a = column("a", {
      context: [user.latest],
      compute: async () => "",
    });
    const b = column("b", {
      context: [a.latest],
      compute: async () => "",
    });
    // Manually create a cycle: make a depend on b
    // We need to construct this carefully
    const c1 = column("c1", {
      context: [user.latest],
      compute: async () => "",
    });
    const c2 = column("c2", {
      context: [c1.latest],
      compute: async () => "",
    });
    // Hack: make c1 depend on c2 to create a cycle
    (c1 as any).context = [c2.latest];

    expect(() => flow(c2)).toThrow("Cycle detected");
  });

  test("addColumn backfills completed steps", async () => {
    const user = source("user");
    const assistant = column("assistant", {
      context: [user.latest],
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
      context: [user.latest],
      compute: async ({ messages }) =>
        String(messages[0].content.split(/\s+/).length),
    });

    await f.addColumn(wordcount);

    // XML-wrapped content: "<user>\nstep0\n</user>" splits into 3 tokens
    expect(f.get("wordcount", 0)).toBe("3");
    expect(f.get("wordcount", 1)).toBe("3");
  });

  test("get returns undefined for unknown column or step", async () => {
    const user = source("user");
    const a = column("a", {
      context: [user.latest],
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
      context: [user, self.latest],
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
    // At step 1: user sees [alpha, beta], self.latest sees step 0
    // messages: user "<user>\nalpha\n</user>", assistant "<user>\nalpha\n</user>", user "<user>\nbeta\n</user>"
    expect(f.get("summary", 1)).toBe("<user>\nalpha\n</user> + <user>\nbeta\n</user>");

    user.push("gamma");
    await f.run();
    // At step 2: user sees [alpha, beta, gamma], self.latest sees step 1
    // self.latest = step 1 only, so steps 0-1 of user merge (no assistant between them at step 0)
    // messages: user "<user>\nalpha\n</user>\n\n<user>\nbeta\n</user>", assistant "...", user "<user>\ngamma\n</user>"
    expect(f.get("summary", 2)).toBe("<user>\nalpha\n</user>\n\n<user>\nbeta\n</user> + <user>\ngamma\n</user>");
  });

  test("multiple source columns", async () => {
    const a = source("a");
    const b = source("b");
    const combined = column("combined", {
      context: [a.latest, b.latest],
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
      context: [user.latest],
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
      context: [user.latest],
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
      context: [user.latest],
      compute: async function* () {
        yield "s1";
        yield "s2";
      },
    });
    const plain = column("plain", {
      context: [user.latest],
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
      context: [user.latest],
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
      context: [user.latest],
      compute: async () => "done",
    });

    const f = flow(plain);
    user.push("step0");
    user.push("step1");
    await f.run();

    const streamer = column("streamer", {
      context: [user.latest],
      compute: async function* ({ messages }) {
        const text = messages[0].content;
        yield "got:";
        yield text;
      },
    });

    await f.addColumn(streamer);

    expect(f.get("streamer", 0)).toBe("got:<user>\nstep0\n</user>");
    expect(f.get("streamer", 1)).toBe("got:<user>\nstep1\n</user>");
  });
});
