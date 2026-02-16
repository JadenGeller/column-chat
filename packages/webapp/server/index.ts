import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { createSessionFromConfig, createColumnFromConfig } from "./flow.js";
import { DEFAULT_CONFIG } from "../shared/defaults.js";
import type { SessionConfig, ColumnConfig } from "../shared/types.js";

const RESERVED_NAMES = new Set(["input", "self"]);

function validateConfig(config: SessionConfig): string | null {
  if (!Array.isArray(config)) {
    return "Config must be an array";
  }

  const seen = new Set<string>();
  for (let i = 0; i < config.length; i++) {
    const col = config[i];

    if (!col.name || typeof col.name !== "string") {
      return `Column at index ${i} has an invalid name`;
    }
    if (RESERVED_NAMES.has(col.name)) {
      return `"${col.name}" is a reserved name`;
    }
    if (seen.has(col.name)) {
      return `Duplicate column name: "${col.name}"`;
    }
    seen.add(col.name);

    if (!col.systemPrompt || typeof col.systemPrompt !== "string") {
      return `Column "${col.name}" requires a system prompt`;
    }

    for (const ref of col.context) {
      if (ref.column === "input" || ref.column === "self") continue;
      if (!seen.has(ref.column)) {
        return `Column "${col.name}" references "${ref.column}" which doesn't appear before it`;
      }
    }
  }
  return null;
}

interface ConfigDiff {
  removed: string[];
  added: ColumnConfig[];
  modified: { name: string; config: ColumnConfig }[];
  colorOnly: string[];
}

function diffConfigs(oldConfig: SessionConfig, newConfig: SessionConfig): ConfigDiff {
  const oldByName = new Map(oldConfig.map((c) => [c.name, c]));
  const newByName = new Map(newConfig.map((c) => [c.name, c]));

  const removed: string[] = [];
  const added: ColumnConfig[] = [];
  const modified: { name: string; config: ColumnConfig }[] = [];
  const colorOnly: string[] = [];

  // Find removed columns
  for (const name of oldByName.keys()) {
    if (!newByName.has(name)) removed.push(name);
  }

  // Find added and modified columns
  for (const [name, newCol] of newByName) {
    const oldCol = oldByName.get(name);
    if (!oldCol) {
      added.push(newCol);
    } else {
      const promptChanged = oldCol.systemPrompt !== newCol.systemPrompt;
      const reminderChanged = oldCol.reminder !== newCol.reminder;
      const contextChanged =
        JSON.stringify(oldCol.context) !== JSON.stringify(newCol.context);
      const colorChanged = oldCol.color !== newCol.color;

      if (promptChanged || reminderChanged || contextChanged) {
        modified.push({ name, config: newCol });
      } else if (colorChanged) {
        colorOnly.push(name);
      }
    }
  }

  return { removed, added, modified, colorOnly };
}

function getStepsSnapshot(session: ReturnType<typeof createSessionFromConfig>) {
  const steps: Array<{ input: string; columns: Record<string, string> }> = [];
  for (let step = 0; ; step++) {
    const inputValue = session.f.get("input", step);
    if (inputValue === undefined) break;
    const columns: Record<string, string> = {};
    for (const name of session.columnOrder) {
      const value = session.f.get(name, step);
      if (value !== undefined) {
        columns[name] = value;
      }
    }
    steps.push({ input: inputValue, columns });
  }
  return steps;
}

interface ServerSession {
  config: SessionConfig;
  session: ReturnType<typeof createSessionFromConfig>;
}

const sessions = new Map<string, ServerSession>();

function getOrCreateSession(chatId: string): ServerSession {
  let entry = sessions.get(chatId);
  if (!entry) {
    const config = DEFAULT_CONFIG;
    entry = { config, session: createSessionFromConfig(config) };
    sessions.set(chatId, entry);
  }
  return entry;
}

const isCloud = !!process.env.ANTHROPIC_API_KEY;

const app = new Elysia()
  .use(cors())
  .get("/api/capabilities", () => {
    return { mode: isCloud ? "cloud" : "local" };
  })
  .post("/api/chat/:chatId", async ({ params, body }) => {
    if (!isCloud) return new Response("Not available in local mode", { status: 404 });
    const chatId = params.chatId;
    const entry = getOrCreateSession(chatId);
    const { message } = body as { message: string };

    entry.session.input.push(message);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const event of entry.session.f.run()) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          console.error("Flow error:", message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: message })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  })
  .post("/api/clear/:chatId", ({ params, body }) => {
    if (!isCloud) return new Response("Not available in local mode", { status: 404 });
    const chatId = params.chatId;
    const { config } = (body ?? {}) as { config?: SessionConfig };
    const entry = getOrCreateSession(chatId);
    if (config) {
      const error = validateConfig(config);
      if (error) return { ok: false, error };
      entry.config = config;
    }
    entry.session = createSessionFromConfig(entry.config);
    sessions.set(chatId, entry);
    return { ok: true, config: entry.config };
  })
  .post("/api/config/:chatId", async ({ params, body }) => {
    if (!isCloud) return new Response("Not available in local mode", { status: 404 });
    const chatId = params.chatId;
    const entry = getOrCreateSession(chatId);
    const { config } = body as { config: SessionConfig };

    const error = validateConfig(config);
    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const diff = diffConfigs(entry.config, config);
    const hasComputation =
      diff.removed.length > 0 || diff.modified.length > 0 || diff.added.length > 0;

    // If no structural changes (color-only or identical), apply immediately
    if (!hasComputation) {
      entry.config = config;
      return new Response(
        JSON.stringify({ ok: true, config: entry.config }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // SSE stream for structural changes
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // Apply removals: collect all columns to remove, then remove leaves-first
          const toRemove = new Set<string>();
          for (const name of diff.removed) {
            toRemove.add(name);
            for (const dep of entry.session.f.dependents(name)) {
              toRemove.add(dep);
            }
          }
          // Remove in reverse topo order (leaves first) by collecting dependents, then the roots
          const removeOrder: string[] = [];
          const removeVisited = new Set<string>();
          for (const name of diff.removed) {
            const deps = entry.session.f.dependents(name);
            for (const dep of [...deps].reverse()) {
              if (toRemove.has(dep) && !removeVisited.has(dep)) {
                removeVisited.add(dep);
                removeOrder.push(dep);
              }
            }
            if (!removeVisited.has(name)) {
              removeVisited.add(name);
              removeOrder.push(name);
            }
          }
          for (const name of removeOrder) {
            entry.session.f.removeColumn(name);
            entry.session.columnOrder = entry.session.columnOrder.filter((n) => n !== name);
            entry.session.columnMap.delete(name);
          }

          // Apply modifications
          for (const { name, config: cfg } of diff.modified) {
            const newCol = createColumnFromConfig(cfg, entry.session.columnMap, entry.session.storage);
            entry.session.f.replaceColumn(name, newCol);
            entry.session.columnMap.set(name, newCol);
          }

          // Apply additions
          for (const cfg of diff.added) {
            const newCol = createColumnFromConfig(cfg, entry.session.columnMap, entry.session.storage);
            entry.session.f.addColumn(newCol);
            entry.session.columnMap.set(cfg.name, newCol);
            entry.session.columnOrder.push(cfg.name);
          }

          // Update config and column order to match new config ordering
          entry.config = config;
          entry.session.columnOrder = config.map((c) => c.name);

          // Send init event with current state snapshot
          const steps = getStepsSnapshot(entry.session);
          send({
            kind: "init",
            steps,
            columnOrder: entry.session.columnOrder,
            config: entry.config,
          });

          // Stream computation events
          for await (const event of entry.session.f.run()) {
            send(event);
          }

          send({ done: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("Config apply error:", message);
          send({ error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  })
  .get("/api/messages/:chatId", ({ params }) => {
    if (!isCloud) return new Response("Not available in local mode", { status: 404 });
    const chatId = params.chatId;
    const entry = getOrCreateSession(chatId);
    const steps = getStepsSnapshot(entry.session);
    return {
      steps,
      columnOrder: entry.session.columnOrder,
      config: entry.config,
    };
  })
  .get("*", ({ request }) => {
    const url = new URL(request.url);
    // Don't catch API routes
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(Bun.file("dist/index.html"), {
      headers: { "Content-Type": "text/html" },
    });
  })
  .listen(3000);

console.log(`Server running at http://localhost:${app.server!.port} (${isCloud ? "cloud" : "local"} mode)`);
