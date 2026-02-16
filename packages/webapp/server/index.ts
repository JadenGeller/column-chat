import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { createSessionFromConfig, createColumnFromConfig } from "./flow.js";
import { DEFAULT_CONFIG } from "../shared/defaults.js";
import type { SessionConfig, ColumnConfig } from "../shared/types.js";

const RESERVED_NAMES = new Set(["input", "self"]);

function validateConfig(config: SessionConfig): string | null {
  if (!Array.isArray(config) || config.length === 0) {
    return "At least one column is required";
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

let currentConfig: SessionConfig = DEFAULT_CONFIG;
let session = createSessionFromConfig(currentConfig);

const app = new Elysia()
  .use(cors())
  .post("/api/chat", async ({ body }) => {
    const { message } = body as { message: string };

    session.input.push(message);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const event of session.f.run()) {
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
  .post("/api/clear", ({ body }) => {
    const { config } = (body ?? {}) as { config?: SessionConfig };
    if (config) {
      const error = validateConfig(config);
      if (error) return { ok: false, error };
      currentConfig = config;
    }
    session = createSessionFromConfig(currentConfig);
    return { ok: true, config: currentConfig };
  })
  .post("/api/config", async ({ body }) => {
    const { config } = body as { config: SessionConfig };

    const error = validateConfig(config);
    if (error) {
      return new Response(
        JSON.stringify({ ok: false, error }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const diff = diffConfigs(currentConfig, config);
    const hasComputation =
      diff.removed.length > 0 || diff.modified.length > 0 || diff.added.length > 0;

    // If no structural changes (color-only or identical), apply immediately
    if (!hasComputation) {
      currentConfig = config;
      return new Response(
        JSON.stringify({ ok: true, config: currentConfig }),
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
            for (const dep of session.f.dependents(name)) {
              toRemove.add(dep);
            }
          }
          // Remove in reverse topo order (leaves first) by collecting dependents, then the roots
          const removeOrder: string[] = [];
          const removeVisited = new Set<string>();
          for (const name of diff.removed) {
            const deps = session.f.dependents(name);
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
            session.f.removeColumn(name);
            session.columnOrder = session.columnOrder.filter((n) => n !== name);
            session.columnMap.delete(name);
          }

          // Apply modifications
          for (const { name, config: cfg } of diff.modified) {
            const newCol = createColumnFromConfig(cfg, session.columnMap, session.storage);
            session.f.replaceColumn(name, newCol);
            session.columnMap.set(name, newCol);
          }

          // Apply additions
          for (const cfg of diff.added) {
            const newCol = createColumnFromConfig(cfg, session.columnMap, session.storage);
            session.f.addColumn(newCol);
            session.columnMap.set(cfg.name, newCol);
            session.columnOrder.push(cfg.name);
          }

          // Update config and column order to match new config ordering
          currentConfig = config;
          session.columnOrder = config.map((c) => c.name);

          // Send init event with current state snapshot
          const steps = getStepsSnapshot(session);
          send({
            kind: "init",
            steps,
            columnOrder: session.columnOrder,
            config: currentConfig,
          });

          // Stream computation events
          for await (const event of session.f.run()) {
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
  .get("/api/messages", () => {
    const steps = getStepsSnapshot(session);
    return {
      steps,
      columnOrder: session.columnOrder,
      config: currentConfig,
    };
  })
  .listen(3000);

console.log(`Server running at http://localhost:${app.server!.port}`);
