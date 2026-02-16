import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { createSessionFromConfig, createColumnFromConfig } from "./flow.js";
import { DEFAULT_CONFIG } from "../shared/defaults.js";
import { diffConfigs } from "../shared/config.js";
import { applyConfigUpdate } from "../shared/flow.js";
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
      diff.removed.length > 0 || diff.modified.length > 0 || diff.added.length > 0 || diff.renamed.length > 0;

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
          applyConfigUpdate(entry.session, diff, config, createColumnFromConfig);

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
  .post("/api/generate-config", async ({ body }) => {
    if (!isCloud) return new Response("Not available in local mode", { status: 404 });

    const { system, prompt } = body as { system: string; prompt: string };
    if (!system || !prompt) {
      return new Response(JSON.stringify({ error: "Missing system or prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const { generateText } = await import("ai");

      const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const result = await generateText({
        model: provider("claude-opus-4-6"),
        system,
        prompt,
      });

      return { text: result.text };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
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
