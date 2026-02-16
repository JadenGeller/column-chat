# CLAUDE.md

## Project

Columnar is a TypeScript library for step-synchronized, columnar dataflow over LLM computations. It generalizes chat from two columns to an arbitrary number, where each derived column declares its context dependencies and the library assembles the correct messages array.

## Key Documents

- `SPEC.md` — The full API design. This is the contract. Build what it describes.
- `CONTEXT_ASSEMBLY.md` — Worked examples of exactly what messages arrays should look like. This is the critical path. Read it carefully before implementing `context.ts`. The examples are the ground truth — if the spec is ambiguous, the examples are authoritative.

## Architecture

Bun workspaces monorepo. The library's core job is: given column definitions and stored history, produce a messages array in AI SDK format. The library does NOT call LLMs — it assembles context and hands it to a user-provided compute function.

```
packages/
  columnar/               — Core library
    src/
      types.ts            — Source, Derived, ColumnView, self sentinel, ColumnStorage
      column.ts           — source(), column() constructors, view methods, createInMemoryStorage()
      flow.ts             — flow(), run(), get(), addColumn(), DAG resolution, topo sort
      context.ts          — assembleMessages() — THE HEART OF THE LIBRARY
      prompt.ts           — thin convenience helper (not core)
      index.ts            — public exports
    examples/chat.ts      — Multi-column chat example
  cli/                    — CLI utilities (filesystem storage)
    src/
      storage.ts          — createFileSystemStorage(dir) — ColumnStorage backed by one file per step
      index.ts            — public exports
    examples/chat.ts      — File-based chat example
```

## Build Order

1. **types.ts** — Get the type model right. Source vs Derived. ColumnView carrying column ref + window mode + name.
2. **column.ts** — `source()` and `column()` constructors. View methods. The `self` sentinel.
3. **context.ts** — `assembleMessages()`. Write this with tests FIRST. Test against every example in CONTEXT_ASSEMBLY.md. This is the library's entire value.
4. **flow.ts** — DAG discovery (trace from leaf columns to sources), cycle detection, topo sort, push/run/get lifecycle.
5. **prompt.ts** — One function, ~10 lines.
6. **Example usage** — A script that defines a few columns and runs a 3-step conversation.

## Critical Implementation Details

- Messages format: strict `(user, assistant)*` alternation. When windowing creates gaps, merge consecutive same-role messages with `\n\n`.
- If `context` has more than one non-self entry, ALWAYS use XML wrapping (even at steps where only one input has a value). Consistency over cleverness.
- Self range excludes current step. Input range includes current step. Messages array always ends with a user message.
- `self` is an imported sentinel. It resolves to "this column" at flow creation time. It supports `.latest`, `.window(n)` like any column view.
- `run()` returns an async iterable yielding `FlowEvent` (discriminated union with `kind: "delta"` and `kind: "value"`). It's idempotent — skips already-computed cells.
- `push()` writes to source columns. It does not trigger computation. `run()` triggers computation.
- `flow()` takes leaf columns, traces dependencies to discover the full DAG including sources. No manual source registration.
- Values are strings. No structured data for now.

## Testing

Write tests for `context.ts` first. Each example in CONTEXT_ASSEMBLY.md should be a test case. The messages arrays shown there are exact expected outputs.

Then test DAG resolution: cycle detection, topo sort correctness, missing dependency errors.

Then test the full lifecycle: push → run → get.

## Dependencies

- TypeScript, no runtime dependencies beyond types.
- Tests: vitest or similar.
- The `prompt` helper references AI SDK's `generateText` but that's the user's concern, not the library's. The library only produces the messages array. `prompt.ts` is an example/convenience, not core.

## What NOT to Build

- `run()` supports token-level streaming: when a compute function returns `AsyncIterable<string>`, `run()` yields `{ kind: "delta" }` events for each token, then a final `{ kind: "value" }` event. Non-streaming compute functions yield only `{ kind: "value" }` events.
- No UI. This is a library.
- No editing past values. Append-only.
