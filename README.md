# Column Chat

**Perspectives that build on each other.**

[columnchat.com](https://columnchat.com)

## Context

Every LLM call is shaped by what's in its context window. Most approaches to managing this — agent orchestration, retrieval, dynamic tool selection — determine the context strategy at runtime. Column Chat takes a different approach: context is declared as a static structure that you can see and edit.

A conversation is decomposed into columns. Each column has a prompt and a list of dependencies — which other columns it reads and how much history it sees. The dependencies form a DAG. You look at it and know what each column will receive. The system resolves ordering from the graph and parallelizes what it can, so you get several focused analyses back nearly as fast as one.

## Columns

All columns advance in lockstep. Each message you send is a step — every column produces one value, in dependency order. The result is a grid: rows are steps, columns are processes, each cell computed from declared dependencies. Columns carry state forward and evolve together over time — this is what makes it a conversation, not a prompt chain.

The interesting part is columns that read other columns. A steelman column articulates the strongest version of your position. A critic reads the steelman and constructs the best counterargument. A synthesis reads both and finds where the real tension lies. The critic never sees your messages — it reads a refined version of your argument. Each column gets exactly the input it needs.

This isn't agent orchestration. Nothing decides what to call next — every column runs the same way every step, on the inputs it declared. The structure is fixed; the conversation flows through it.

Your input stays immutable throughout. Each column's output lives in its own space. If one drifts or produces something bad, it doesn't contaminate your source material or other columns — a property that matters in long conversations where a single LLM's progressive paraphrasing subtly shifts your ideas over many turns.

## Memory

Each dependency controls how much history it sees — full history or latest only — both for itself and for other columns it reads. Dependencies can read from the current step (creating ordering constraints) or the previous step (running in parallel). Reading the previous step lets columns depend on each other without creating cycles — everything runs in parallel, like a synchronous dataflow step. A column without self-dependency is a stateless map. A column that sees only its previous output is a reducer — downstream columns read it and get the full conversation compacted into a fixed-size window.

## Editing

Because the structure is declarative, you can change it and see what happens. Rewrite a prompt, rewire dependencies, add a new column mid-conversation. The system re-derives everything that's affected. New columns backfill from the beginning — not a one-shot summary, but a step-by-step replay, building up context as if they had been there from the start.

## Build Your Own

Describe the pipeline you want in plain language and Opus 4.6 generates a complete column configuration — system prompts, dependencies, the full DAG. You can iterate on the result, edit it by hand, or use it as a starting point.

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
