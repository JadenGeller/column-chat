# Column Chat

**Perspectives that build on each other.**

[columnchat.com](https://columnchat.com)

Column Chat splits a conversation into a DAG of focused AI columns that evolve together over time. Each column has one job, declares which other columns it reads, and carries its own history forward across every step of the conversation.

This isn't a one-shot pipeline. Each message you send advances every column. An ideas column accumulates across the whole conversation. A themes column reads the latest ideas and its own previous themes, folding forward into a running synthesis. Downstream columns read upstream outputs — never your raw messages — so context stays focused as conversations grow.

## Example: Brainstorm

```
input ──→ ideas ──→ themes ──┬──→ builds ──┐
                             │             ├──→ gameplan
                   critique ─┴──→ wonders ─┘
```

You type a message. **Ideas** captures everything on the table — and remembers what it captured last time. **Themes** reads the latest ideas and its own previous groupings, updating the pattern map. **Critique** flags real weaknesses. **Builds** reads themes and critique to propose stronger combinations. **Gameplan** reads builds and wonders and picks a direction.

Three messages in, every column has three steps of history. The themes have evolved. The critique has sharpened. The gameplan reflects the full arc of the conversation — but no single column had to read the entire transcript to get there.

## How it works

Each column declares its context: which columns it reads and how much history it sees. The framework resolves the DAG, runs columns in dependency order (parallelizing where possible), and assembles the messages array per call.

Columns control their own memory. An **accumulator** sees full history — the standard chat pattern. A **reducer** sees only its previous output and current input, compressing unbounded conversation into bounded state. Downstream columns read the reducer instead of the full history — this is how long conversations stay tractable.

The system is reactive. Change a column's prompt and only downstream columns recompute. Add a column mid-conversation and it backfills from step one — not a one-shot summary, but the same incremental computation it would have done if it had been there all along.

## Presets

Column Chat ships with four preset pipelines:

- **Brainstorm** — Ideas in every direction, then a path forward.
- **Research** — Map what you know and find what you don't.
- **Think It Through** — Your toughest critic, then a path forward.
- **Plan** — From goal to first step.

Or build your own.
