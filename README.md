# Column Chat

**Perspectives that build on each other.**

[columnchat.com](https://columnchat.com)

## Context

Every LLM call is shaped by what's in its context window. There are many approaches to managing this — agent orchestration, retrieval, dynamic tool selection — and they're powerful, but the context strategy is typically determined at runtime by the orchestration logic. Column Chat takes a different approach: context is declared as a static structure that you can see and edit.

A conversation is decomposed into columns. Each column has a prompt and a list of dependencies — which other columns it reads and how much history it sees. The dependencies form a DAG. You look at it and know what each column will receive. The system resolves ordering from the graph and parallelizes columns whose dependencies are already met, so you get several focused analyses back nearly as fast as one.

## Columns

All columns advance in lockstep. Each message you send is a step — every column produces one value, in dependency order. The result is a grid: rows are steps, columns are processes, each cell computed from declared dependencies. This is what makes it a conversation, not a prompt chain — columns carry state forward and evolve together over time.

The simplest columns watch your input independently. An extractor pulls out action items. A translator rewrites each message. These are useful but they're doing what you could do with separate API calls.

The interesting part is columns that read other columns. Say you have a summarizer maintaining a running digest. You want to track how your goals have shifted over the conversation. If it reads the full transcript, that's expensive and noisy. But if it reads the summarizer, it gets a clean, compressed version. Cheaper, faster, more focused.

Or take a debate. A steelman column articulates the strongest version of your position. A critic reads the steelman and constructs the best counterargument. A synthesis reads both and finds where the real tension lies. The critic never sees your messages — it reads a refined version of your argument. Each column gets exactly the input it needs.

This isn't agent orchestration. Nothing decides what to call next — every column runs the same way every step, on the inputs it declared. The structure is fixed; the conversation flows through it.

Your input stays immutable throughout. Each column's output lives in its own space. If one drifts or produces something bad, it doesn't contaminate your source material or other columns — a property that matters in long conversations where a single LLM's progressive paraphrasing subtly shifts your ideas over many turns.

## Memory

Each column controls how much history it sees.

A column that sees everything accumulates like a normal conversation. Rich, but context grows with every step.

A column that sees only the latest value is stateless. Each step is independent — good for extraction, classification, anything where the answer depends only on the current input.

A column that sees its own previous output and the current input is a reducer. It folds history forward: reading what just happened and its last summary, producing a new one. No matter how long the conversation gets, the reducer's context stays small. Downstream columns that read the reducer get the benefit of the full conversation in a compact form. This is how long conversations stay tractable — the reducer absorbs the cost of growing context so nothing downstream has to.

## Editing

Because the structure is declarative, you can change it and see what happens. Rewrite a column's prompt. Rewire its dependencies. Add a new column to an existing conversation. The system re-derives everything that's affected — you don't re-run anything manually, you just change the declaration and watch the results update.

When you add a column mid-conversation, it backfills from the beginning — not a one-shot summary, but a replay from message one, step by step, building up context as if it had been there from the start. When you edit a column, only downstream columns recompute. Remove a column and nothing else is affected.

## Example: Brainstorm

```
input ──→ ideas ──→ themes ──┬──→ builds ──┐
                             │             ├──→ gameplan
                   critique ─┴──→ wonders ─┘
```

Three messages in, every column has three steps of history. The themes have evolved. The critique has sharpened. The gameplan reflects the full arc of the conversation — but no single column had to read the entire transcript to get there.

## Presets

Column Chat ships with four preset pipelines — each one is just a column configuration, the same thing you'd wire up yourself.

- **Brainstorm** — Ideas in every direction, then a path forward.
- **Research** — Map what you know and find what you don't.
- **Think It Through** — Your toughest critic, then a path forward.
- **Plan** — From goal to first step.
