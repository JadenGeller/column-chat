# Columnar: API Design

## Overview

Columnar is a library for step-synchronized, columnar dataflow over LLM computations. It generalizes chat from two columns (user/assistant) to an arbitrary number. One or more columns receive external input. All other columns are derived — each declares which columns it depends on and how much history it sees, then produces a value at each step.

The library's core job is **context assembly**: given column definitions and history, produce a messages array in AI SDK format. What you do with that array is your business.

---

## Core Concepts

**Column**: An ordered sequence of string values, one per step. Columns are either *sources* (receive external input) or *derived* (computed from other columns).

**ColumnView**: A lens on a column that specifies how it appears in another column's context. Carries: which column, which window (all, latest, window(n)), and optionally a name override. Every column implicitly *is* a view of itself with full history. Calling `.latest`, `.window(n)`, or `.as(name)` returns a new view with modified settings.

**Step**: A row across all columns. All columns advance in lockstep. When a source gets a new value, derived columns compute their values for that step in dependency order.

**Flow**: The runtime. Holds the DAG, the store, and the scheduler. Created by passing it the columns you care about — it discovers the full dependency graph by tracing their inputs back to sources.

---

## API

### Sources

```typescript
import { source } from 'columnar'

const user = source('user')
```

A source column. Values come from outside the system via `.push()`.

### Derived Columns

```typescript
import { column, self, prompt } from 'columnar'

const assistant = column('assistant', {
  context: [user, self],
  compute: prompt("You are a helpful assistant.")
})
```

A derived column. `context` is an array of column views — the things this column sees. `compute` is an async function that receives the assembled messages and returns a string.

`self` is an imported sentinel. Including it in `context` means the column sees its own prior outputs (as assistant messages). Omitting it means the column is stateless.

### Windowing

Every column is also a view. Call methods to create restricted views:

```typescript
user              // all history (default)
user.latest       // only the most recent value
user.window(5)    // the last 5 values
user.as('input')  // renamed in context
```

These compose:

```typescript
summary.latest.as('digest')
```

`self` supports the same methods:

```typescript
self              // full self-history (accumulator)
self.latest       // only previous output (reducer)
self.window(3)    // last 3 outputs
```

### The Four Patterns

| Self        | Input         | Pattern         | Use case                                      |
| ----------- | ------------- | --------------- | --------------------------------------------- |
| `self`      | `col`         | **Accumulator** | Rich analysis with full context (default chat) |
| `self.latest` | `col`       | **Reducer**     | Compress history into running state            |
| `self`      | `col.latest`  | **Journal**     | Running record that reacts to new items        |
| *(omitted)* | `col.latest`  | **Map**         | Stateless per-row transform                    |

### Compute

Every column has a `compute` function. It receives the assembled messages and returns a string (or a promise of one).

```typescript
const custom = column('wordcount', {
  context: [user.latest],
  compute: async ({ messages }) => {
    const text = messages[messages.length - 1].content
    return String(text.split(/\s+/).length)
  }
})
```

For the common case of "call an LLM with a system prompt," use the `prompt` helper:

```typescript
const topics = column('topics', {
  context: [user.latest],
  compute: prompt("Extract the main topics as a comma-separated list.")
})
```

`prompt` is a convenience — a function that returns a compute function:

```typescript
function prompt(system: string, options?: { model?: string }) {
  return async ({ messages }) => {
    const result = await generateText({
      model: options?.model ?? 'anthropic/claude-sonnet-4-5',
      system,
      messages,
    })
    return result.text
  }
}
```

Derived columns don't have to use LLMs. A column can be a deterministic function — a word count, a regex extraction, a JSON parser. The abstraction is general.

### Flow

```typescript
import { flow } from 'columnar'

const f = flow(assistant, topics, summary, critique)
```

`flow` takes the columns you care about. It traces their dependencies, discovers sources, validates the DAG (checks for cycles), and computes the topological execution order. This is the reusable runtime object. It holds the DAG and the store.

### Push

```typescript
user.push("I think we should rewrite the backend in Rust.")
```

Push writes a value to a source column for the next step. Push does not trigger computation — it just writes data.

### Run

```typescript
for await (const event of f.run()) {
  // event: { column: 'topics', step: 0, value: 'backend rewrite, Rust' }
  // event: { column: 'summary', step: 0, value: '...' }
  // event: { column: 'assistant', step: 0, value: '...' }
}
```

`run()` returns an async iterable that yields events as each column completes for the current step. It walks the topological order, assembles context, calls compute, stores results, and yields each completion.

`run()` is idempotent. If called again with nothing new, it yields nothing. If a previous run failed partway, it picks up from the incomplete cells — already-computed columns are skipped.

If a column's compute throws, `run()` throws. Columns that already succeeded for this step are preserved. Call `run()` again to retry from where it stopped.

```typescript
// Simple await if you don't need streaming
user.push("Another message.")
await f.run()
```

### Get

```typescript
f.get('assistant', 0)    // read by name and step
f.get('summary', 1)
```

Read a stored value by column name and step index.

### Add Column

```typescript
const sentiment = column('sentiment', {
  context: [user.latest],
  compute: prompt("Rate sentiment: positive, negative, neutral.")
})

await f.addColumn(sentiment)
```

Add a column to a running flow. It backfills from step 0, computing each row as if the column had always existed. The backfill yields events through the same async iterable pattern. Existing columns are not affected.

---

## Context Assembly

The core of the library. Each column's computation maps onto a chat API call. The system assembles a messages array:

**System message**: Provided by the compute function (e.g. via `prompt`).

**User messages**: Content from the column's declared context (excluding self). At each step, if a column reads multiple inputs, each input's content is wrapped in XML tags named after the column (or its `.as()` override). If there's only one input, no wrapping is needed.

**Assistant messages**: The column's own prior outputs (self-history), interleaved in the appropriate step positions.

The result is a standard `system, (user, assistant)*` messages array — the shape every LLM API expects.

For `latest` and `window(n)` views, only the relevant steps appear in the messages array.

---

## Modules

A module is a function that returns multiple columns:

```typescript
function debate(input: Column) {
  const steelman = column('steelman', {
    context: [input.latest],
    compute: prompt("Best case for this position.")
  })

  const critic = column('critic', {
    context: [steelman.latest],
    compute: prompt("Strongest objection.")
  })

  const synthesis = column('synthesis', {
    context: [steelman.latest, critic.latest, self.latest],
    compute: prompt("Synthesize the debate.")
  })

  return { steelman, critic, synthesis }
}

const d = debate(user)
const f = flow(d.steelman, d.critic, d.synthesis, assistant)
```

Columns inside the module capture each other by lexical scope. The module's parameters are whatever it can't close over. No special module system — just functions and closures.

---

## Reusable Column Definitions

```typescript
function summarizer(input: Column): Column {
  return column('summary', {
    context: [input, self.latest],
    compute: prompt("Maintain a running summary of the input.")
  })
}

const chatSummary = summarizer(user)
const topicSummary = summarizer(topics)
```

Two independent columns, same definition, different inputs.

---

## Standard Chat, Restated

```typescript
const user = source('user')

const assistant = column('assistant', {
  context: [user, self],
  compute: prompt("You are a helpful assistant.")
})

const f = flow(assistant)

user.push("Hello!")
for await (const event of f.run()) {
  console.log(event.value)
}
```

Two columns. The assistant reads all of the user's history and all of its own history. This is what every chat API call already does. The framework makes the context rule explicit.

---

## Properties

**Append-only.** You can add new steps and new columns. You cannot edit existing values. This avoids reactive reflow, versioning, and accidental recomputation costs.

**Independent extension.** Adding new steps doesn't invalidate existing derived values. Adding new columns doesn't invalidate existing columns. The two axes of extension are independent.

**Step-synchronized.** All columns advance in lockstep. No column can be ahead of or behind another within a completed step.

**DAG.** Dependencies between columns are acyclic. Self-reference reads prior steps, not the current one, so it is not a cycle. The system validates this at flow creation.

---

## Cost Model

Windowing mode determines cost:

- **Map** (no self, latest input): One small call per step. Cheapest.
- **Reducer** (latest self, all input): One call per step with bounded context. The self-summary keeps each call small.
- **Accumulator** (all self, all input): One call per step with growing context. Most expensive.

The reducer pattern manages cost: it absorbs growing history into a bounded summary so downstream columns don't pay for full context.

---

## Future Directions

- **Grouped views**: A `group('debate', [steelman.latest, critic.latest])` view that nests child views under a parent XML tag. Lets modules expose a single composite view for downstream consumers. The assembler recurses instead of assuming a flat list.
- **Column metadata**: Columns carry names, descriptions. The context assembler injects orientation info into system messages so downstream LLMs know what their inputs represent.
- **Elision annotation**: When windowing hides history, optionally annotate the context with what's missing.
- **Persistent storage**: SQLite or file-backed store that survives process restarts.
- **Conditional columns**: Columns that only fire when a condition is met (every N steps, on topic change).
- **Context options**: Beyond windowing — token budgets, filter functions, sampling strategies.
- **Editing and reactivity**: Edit a past value and reflow downstream.

---

## Implementation Plan

### File Structure

```
src/
  types.ts        — Source, Derived, ColumnView, FlowDef
  column.ts       — source(), column(), self sentinel, view methods
  flow.ts         — flow(), run(), get(), addColumn(), topo sort
  context.ts      — assembleMessages() — the heart of the library
  prompt.ts       — the convenience helper
```

### Priority Order

1. **types.ts + column.ts** — Column definitions and views. Get the data model right.
2. **context.ts** — Message assembly. This is the core value of the library.
3. **flow.ts** — DAG resolution, push/run/get lifecycle.
4. **prompt.ts** — Thin convenience wrapper.
5. **Example usage** — A script that defines columns and runs a conversation.
