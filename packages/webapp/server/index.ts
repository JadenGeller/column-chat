import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { createSession, derivedColumns } from "./flow.js";

let session = createSession();

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
  .post("/api/clear", () => {
    session = createSession();
    return { ok: true };
  })
  .get("/api/messages", () => {
    const steps: Array<{ user: string; columns: Record<string, string> }> = [];

    for (let step = 0; ; step++) {
      const userValue = session.f.get("user", step);
      if (userValue === undefined) break;

      const columns: Record<string, string> = {};
      for (const name of derivedColumns) {
        const value = session.f.get(name, step);
        if (value !== undefined) {
          columns[name] = value;
        }
      }

      steps.push({ user: userValue, columns });
    }

    return { steps, columnOrder: derivedColumns };
  })
  .listen(3000);

console.log(`Server running at http://localhost:${app.server!.port}`);
