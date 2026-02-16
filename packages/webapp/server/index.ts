import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { createSessionFromConfig } from "./flow.js";
import { DEFAULT_CONFIG } from "../shared/defaults.js";
import type { SessionConfig } from "../shared/types.js";

const RESERVED_NAMES = new Set(["user", "self"]);

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
      if (ref.column === "user" || ref.column === "self") continue;
      if (!seen.has(ref.column)) {
        return `Column "${col.name}" references "${ref.column}" which doesn't appear before it`;
      }
    }
  }
  return null;
}

let currentConfig: SessionConfig = DEFAULT_CONFIG;
let session = createSessionFromConfig(currentConfig);

const app = new Elysia()
  .use(cors())
  .post("/api/chat", async ({ body }) => {
    const { message } = body as { message: string };

    session.user.push(message);

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
  .post("/api/config", ({ body }) => {
    const { config } = body as { config: SessionConfig };

    const error = validateConfig(config);
    if (error) return { ok: false, error };

    currentConfig = config;
    session = createSessionFromConfig(currentConfig);
    return { ok: true, config: currentConfig };
  })
  .get("/api/messages", () => {
    const steps: Array<{ user: string; columns: Record<string, string> }> = [];

    for (let step = 0; ; step++) {
      const userValue = session.f.get("user", step);
      if (userValue === undefined) break;

      const columns: Record<string, string> = {};
      for (const name of session.columnOrder) {
        const value = session.f.get(name, step);
        if (value !== undefined) {
          columns[name] = value;
        }
      }

      steps.push({ user: userValue, columns });
    }

    return {
      steps,
      columnOrder: session.columnOrder,
      config: currentConfig,
    };
  })
  .listen(3000);

console.log(`Server running at http://localhost:${app.server!.port}`);
