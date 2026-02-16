# Context Assembly: Worked Examples

This document specifies exactly how the library assembles messages arrays for LLM calls. This is the core of the library — everything else is bookkeeping around getting this right.

## Rules

1. The messages array follows the strict `system, (user, assistant)*` alternation that LLM APIs require.
2. Each step in the conversation produces one user message and (if self-referencing) one assistant message.
3. **Inputs** (everything in `context` except `self`) become **user message content**.
4. **Self-reference** becomes **assistant message content**.
5. All user-role inputs are always wrapped in XML tags named after the column (or its `.as()` override).
6. The system message is not the library's concern — it's provided by the compute function (e.g. `prompt("...")`). The library produces only the messages array.
7. At step 0, there are no prior steps, so a self-referencing column sees an empty history — the messages array has only one user message.

---

## Example 1: Standard Chat (Accumulator)

The simplest case. Equivalent to a normal chat API call.

```typescript
const user = source('user')
const assistant = column('assistant', {
  context: [user, self],
  compute: prompt("You are a helpful assistant.")
})
```

### State After 3 Steps

| Step | user                  | assistant                |
| ---- | --------------------- | ------------------------ |
| 0    | "Hello"               | "Hi! How can I help?"   |
| 1    | "What's TypeScript?"  | "TypeScript is a..."    |
| 2    | "Thanks"              | *(to be computed)*       |

### Messages Array for `assistant` at Step 2

One input (`user`), always XML-wrapped. Self-reference with `self` (all history), so all prior assistant outputs appear as assistant messages.

```json
[
  { "role": "user", "content": "<user>\nHello\n</user>" },
  { "role": "assistant", "content": "Hi! How can I help?" },
  { "role": "user", "content": "<user>\nWhat's TypeScript?\n</user>" },
  { "role": "assistant", "content": "TypeScript is a..." },
  { "role": "user", "content": "<user>\nThanks\n</user>" }
]
```

The LLM produces the assistant message for step 2. The XML wrapping separates user data from instructions, preventing the model from following directives embedded in user text.

---

## Example 2: Stateless Map (No Self)

A column with no self-reference. Each step is independent.

```typescript
const topics = column('topics', {
  context: [user.latest],
  compute: prompt("Extract the main topics as a comma-separated list.")
})
```

### State After 3 Steps

| Step | user                  | topics                   |
| ---- | --------------------- | ------------------------ |
| 0    | "Hello"               | "greetings"              |
| 1    | "Let's discuss Rust"  | "Rust, programming"      |
| 2    | "And memory safety"   | *(to be computed)*        |

### Messages Array for `topics` at Step 2

`.latest` on the input means only step 2's value. No self means no assistant messages.

```json
[
  { "role": "user", "content": "<user>\nAnd memory safety\n</user>" }
]
```

At step 1, the messages were:

```json
[
  { "role": "user", "content": "<user>\nLet's discuss Rust\n</user>" }
]
```

Each step gets its own independent call. No history accumulates.

---

## Example 3: Reducer (Latest Self, All Input)

A column that compresses history into a running summary.

```typescript
const summary = column('summary', {
  context: [user, self.latest],
  compute: prompt("Update the running summary with the latest message. Be concise.")
})
```

### State After 3 Steps

| Step | user                      | summary                                       |
| ---- | ------------------------- | --------------------------------------------- |
| 0    | "I'm considering Rust"    | "User is considering Rust."                    |
| 1    | "For the backend rewrite" | "User wants to rewrite the backend in Rust."   |
| 2    | "Because Python is slow"  | *(to be computed)*                              |

### Messages Array for `summary` at Step 0

First step. No prior self output exists.

```json
[
  { "role": "user", "content": "<user>\nI'm considering Rust\n</user>" }
]
```

Note: no assistant message. At step 0, self-history is empty regardless of windowing mode.

### Messages Array for `summary` at Step 1

`self.latest` means only step 0's output. All of `user` means steps 0–1.

```json
[
  { "role": "user", "content": "<user>\nI'm considering Rust\n</user>" },
  { "role": "assistant", "content": "User is considering Rust." },
  { "role": "user", "content": "<user>\nFor the backend rewrite\n</user>" }
]
```

### Messages Array for `summary` at Step 2

`self.latest` means only step 1's output. All of `user` means steps 0–2. But here's the key: we still need to maintain the `(user, assistant)*` alternation. The self output slots in at the position of its step.

```json
[
  { "role": "user", "content": "<user>\nI'm considering Rust\n</user>" },
  { "role": "user", "content": "<user>\nFor the backend rewrite\n</user>" },
  { "role": "assistant", "content": "User wants to rewrite the backend in Rust." },
  { "role": "user", "content": "<user>\nBecause Python is slow\n</user>" }
]
```

**Wait — this breaks alternation.** Two user messages in a row at the start. This is a real problem.

### The Alternation Problem

LLM APIs require strict `(user, assistant)*` alternation. When a reducer sees `self.latest` (only step 1's output) but all input (steps 0–2), the assistant message only exists at one position in the sequence. Steps without a corresponding assistant message would produce consecutive user messages.

**Solution: merge consecutive user messages.** When windowing creates gaps in the assistant history, consecutive user messages are concatenated into a single user message with step separators.

### Corrected Messages Array for `summary` at Step 2

```json
[
  { "role": "user", "content": "<user>\nI'm considering Rust\n</user>\n\n<user>\nFor the backend rewrite\n</user>" },
  { "role": "assistant", "content": "User wants to rewrite the backend in Rust." },
  { "role": "user", "content": "<user>\nBecause Python is slow\n</user>" }
]
```

Steps 0 and 1 of user input are merged because there's no assistant message between them (step 0's self output was dropped by `self.latest`).

### General Rule

Walk through steps in order. At each step, collect the input values and the self value (if it falls within the window). Build the messages list by:

1. For each step, add the input content as user-role.
2. If there's a self value at this step, add it as assistant-role.
3. After building the full sequence, merge any consecutive same-role messages.

The merge uses `\n\n` as a separator between the concatenated contents.

---

## Example 4: Multiple Inputs with XML Wrapping

A column that reads two other columns.

```typescript
const critique = column('critique', {
  context: [summary.latest, user.latest],
  compute: prompt("Given the summary and latest message, identify weak reasoning.")
})
```

### State

| Step | user                      | summary                                       |
| ---- | ------------------------- | --------------------------------------------- |
| 0    | "I'm considering Rust"    | "User is considering Rust."                    |
| 1    | "Because Python is slow"  | "User wants to rewrite backend in Rust..."     |

### Messages Array for `critique` at Step 1

Two inputs, both `.latest`, no self. Both inputs contribute to the same (and only) user message. Since there are multiple inputs, XML wrapping is used.

```json
[
  {
    "role": "user",
    "content": "<summary>\nUser wants to rewrite backend in Rust...\n</summary>\n\n<user>\nBecause Python is slow\n</user>"
  }
]
```

The tag names come from the column names: `summary` and `user`. If `.as('digest')` were used on summary, the tag would be `<digest>`.

---

## Example 5: Multiple Inputs with Full History

A column that reads full history from two inputs.

```typescript
const analysis = column('analysis', {
  context: [user, topics, self],
  compute: prompt("Analyze how the user's topics evolve over the conversation.")
})
```

### State

| Step | user                      | topics              | analysis                  |
| ---- | ------------------------- | ------------------- | ------------------------- |
| 0    | "I like Rust"             | "Rust"              | "User mentions Rust."     |
| 1    | "And Go is nice"          | "Go"                | "Expanded to Go."         |
| 2    | "Maybe Zig too"           | "Zig"               | *(to be computed)*         |

### Messages Array for `analysis` at Step 2

Multiple inputs (`user` and `topics`), both `all` history, plus `self` (all history). At each step, the two inputs are XML-wrapped into a user message, and self becomes an assistant message.

```json
[
  {
    "role": "user",
    "content": "<user>\nI like Rust\n</user>\n\n<topics>\nRust\n</topics>"
  },
  { "role": "assistant", "content": "User mentions Rust." },
  {
    "role": "user",
    "content": "<user>\nAnd Go is nice\n</user>\n\n<topics>\nGo\n</topics>"
  },
  { "role": "assistant", "content": "Expanded to Go." },
  {
    "role": "user",
    "content": "<user>\nMaybe Zig too\n</user>\n\n<topics>\nZig\n</topics>"
  }
]
```

At each step, all inputs at that step are combined into one user message with XML tags. Self values are interleaved as assistant messages at their corresponding steps.

---

## Example 6: Chained Columns

A column that reads another derived column, not a source.

```typescript
const user = source('user')

const steelman = column('steelman', {
  context: [user.latest],
  compute: prompt("Best case for this position.")
})

const critic = column('critic', {
  context: [steelman.latest],
  compute: prompt("Strongest objection.")
})
```

### State

| Step | user                      | steelman                        | critic                          |
| ---- | ------------------------- | ------------------------------- | ------------------------------- |
| 0    | "We should use Rust"      | "Rust offers memory safety..."  | "But the learning curve..."     |
| 1    | "Python is too slow"      | "Python's GIL limits..."        | *(to be computed)*               |

### Execution Order at Step 1

Topological sort: `steelman` first (depends on `user`), then `critic` (depends on `steelman`).

1. `steelman` computes with `user.latest` at step 1.
2. `critic` computes with `steelman.latest` at step 1 — using the value *just computed*.

### Messages Array for `critic` at Step 1

Single input, `.latest`, no self.

```json
[
  { "role": "user", "content": "<steelman>\nPython's GIL limits...\n</steelman>" }
]
```

The critic sees the steelman's output, not the user's original message. The XML tag names the source column.

---

## Example 7: Window(n)

```typescript
const recent = column('recent', {
  context: [user.window(2), self.latest],
  compute: prompt("Summarize the recent messages.")
})
```

### State

| Step | user        | recent                    |
| ---- | ----------- | ------------------------- |
| 0    | "Alpha"     | "Mentioned alpha."        |
| 1    | "Beta"      | "Alpha, then beta."       |
| 2    | "Gamma"     | "Beta, then gamma."       |
| 3    | "Delta"     | *(to be computed)*         |

### Messages Array for `recent` at Step 3

`user.window(2)` means steps 2–3. `self.latest` means step 2. Following the merge rule:

Step 2: user has "Gamma", self has "Beta, then gamma."
Step 3: user has "Delta", no self.

```json
[
  { "role": "user", "content": "<user>\nGamma\n</user>" },
  { "role": "assistant", "content": "Beta, then gamma." },
  { "role": "user", "content": "<user>\nDelta\n</user>" }
]
```

Steps 0–1 are completely absent — they fall outside both windows.

---

## Assembly Algorithm

```
function assembleMessages(column, currentStep, store):
  // 1. Determine which steps have content
  inputRange = resolveWindow(column.contextInputs, currentStep)
  selfRange = resolveWindow(column.selfView, currentStep)  // empty if no self
  allSteps = union(inputRange, selfRange), sorted ascending

  // 2. Build raw sequence
  rawMessages = []
  for step in allSteps:
    if step in inputRange:
      inputContent = assembleInputs(column.contextInputs, step, store)
      rawMessages.push({ role: "user", content: inputContent, step })
    if step in selfRange:
      selfContent = store.get(column, step)
      rawMessages.push({ role: "assistant", content: selfContent, step })

  // 3. Merge consecutive same-role messages
  messages = []
  for msg in rawMessages:
    if messages.length > 0 and messages.last.role == msg.role:
      messages.last.content += "\n\n" + msg.content
    else:
      messages.push(msg)

  return messages


function assembleInputs(inputs, step, store):
  values = []
  for input in inputs:
    if step in resolveWindow(input, step):
      values.push({ name: input.name, content: store.get(input.column, step) })

  return values.map(v => `<${v.name}>\n${v.content}\n</${v.name}>`).join("\n\n")


function resolveWindow(view, currentStep):
  if view.mode == "all":
    return 0..currentStep
  if view.mode == "latest":
    return [currentStep]  // for inputs
    // for self: [currentStep - 1] (most recent completed step)
  if view.mode == "window(n)":
    return max(0, currentStep - n + 1)..currentStep
```

### Important Details

**Self range excludes the current step.** At step N, self can reference steps 0..N-1. `self` (all) = 0..N-1. `self.latest` = N-1 only. `self.window(k)` = max(0, N-1-k+1)..N-1.

**Input range includes the current step.** At step N, `user` (all) = 0..N. `user.latest` = N only. `user.window(k)` = max(0, N-k+1)..N.

**The current step always has a user message.** There's always at least one input value at the current step (otherwise, why is this column running?). The messages array always ends with a user message — the LLM's job is to produce the next assistant response.

**At step 0 with self, the self range is empty.** There are no prior steps. The messages array is just the user message(s) for step 0.

**Always XML-wrap user-role inputs.** Every user-role input is wrapped in `<name>...\n</name>` tags, regardless of how many inputs the column has. This separates data from instructions and prevents models from following directives embedded in user text.

---

## Edge Cases

**Empty input value.** A source might push an empty string. Treat it as valid — include it in the messages. The column's compute function can decide what to do with it.

**Column not yet computed for a step.** This shouldn't happen if execution follows topological order. If it does (bug), throw an error.

**Self at step 0.** Self range is empty. No assistant messages in the array. The prompt should be written to handle this — e.g. a reducer prompt like "Update the running summary" should gracefully handle having no prior summary.
