# Column Types Design

## The Dependency Model

Every derived column declares a list of **dependencies**. Each dependency has three properties:

1. **`column`** — which column to depend on (including `self`)
2. **`row`**: `'current' | 'previous'` — see this column's value from the current row, or from the previous row
3. **`count`**: `'single' | 'all'` — see just the most recent value, or all values in range

The four combinations per dependency:

| `row` | `count` | What you see (at row N) |
|-------|---------|------------------------|
| `'current'` | `'all'` | Rows 0..N |
| `'current'` | `'single'` | Row N only |
| `'previous'` | `'all'` | Rows 0..N-1 |
| `'previous'` | `'single'` | Row N-1 only |

Example:
```typescript
const assistant = column('assistant', {
  context: [
    { column: input, row: 'current', count: 'all' },
    { column: self,  row: 'previous', count: 'all' },
  ],
  compute: ...
})
```

## Self

`self` is a sentinel meaning "this column." It always has `row: 'previous'` — you can't read your own current-row value because you haven't computed it yet. The library enforces this. `self` dependencies become assistant-role messages in context assembly; all other dependencies become user-role messages.

## Emergent Patterns

Column "types" aren't declared — they emerge from the dependency configuration:

| Pattern | Self | Input | Description |
|---------|------|-------|-------------|
| **Map** | none | `row: 'current', count: 'single'` | Stateless per-row transform |
| **Reducer** | `count: 'single'` | `row: 'current', count: 'all'` | Fold with running state |
| **Accumulator** | `count: 'all'` | `row: 'current', count: 'all'` | Full chat-style memory |

These labels are UI affordances (shown as hints in the webapp config card), not library-level types.

## DAG and Scheduling

Dependencies create two kinds of edges:

- **`row: 'current'`** → ordering edge. The dependency must compute before this column in the current row.
- **`row: 'previous'`** → no ordering edge. The dependency's value from the previous row is already available. These columns can run **in parallel**.

Topological sort operates only on `row: 'current'` edges. `row: 'previous'` edges are "free" — they don't constrain execution order within a row.

**Cycle detection**: Cycles in `row: 'current'` edges are invalid (true circular dependency). Cycles involving `row: 'previous'` edges are valid — columns read each other's previous values and run in parallel.

**Pipeline example:**
```typescript
const A = column('A', {
  context: [
    { column: input, row: 'current', count: 'single' },
    { column: B,     row: 'previous', count: 'single' },
    { column: self,  row: 'previous', count: 'all' },
  ],
  compute: ...
})
const B = column('B', {
  context: [
    { column: input, row: 'current', count: 'single' },
    { column: A,     row: 'previous', count: 'single' },
    { column: self,  row: 'previous', count: 'all' },
  ],
  compute: ...
})
// A and B run in parallel! Each sees the other's previous row value.
```

## Validation Rules

1. **Every column must transitively reach a source** through both `row: 'current'` and `row: 'previous'` edges. No disconnected islands.
2. **`self` must have `row: 'previous'`**. The library enforces this (error or auto-correct).
3. **At least one dependency required.** A column with no dependencies is invalid.
4. **`row: 'current'` DAG must be acyclic.** Cycles through `row: 'previous'` edges are fine.

## Invalidation

Any configuration change to a column (adding/removing dependencies, changing `row` or `count` settings, changing the compute function) invalidates **all stored values for that column and all transitive dependents**. Recompute from row 0.

Transitive dependent collection must handle cycles (from `row: 'previous'` edges) using a visited set.

Adding a **new** column to the flow invalidates nothing — existing columns are unaffected.

## Dropping `window(n)`

The current `.window(n)` view is removed. Only `'single'` and `'all'` are supported for `count`. This simplifies the API, types, context assembly, and UI. `window(n)` can be reintroduced later as an advanced option if needed.

## No Shorthand — Always Explicit

Every dependency is always the full `{ column, row, count }` object. No bare column references, no defaults. The library API and the webapp config card speak the same language — what you see in the UI is what's in the code.

This means no composition sugar (`latest(recall(B))` etc.) as an alternative syntax. One way to express things, maximum coherence.

## Webapp UI

The column config card becomes a checklist:

```
Dependencies:
  [x] input     row: [current v]  count: [all v]
  [x] self      row:  previous    count: [single v]
  [ ] topics
  [ ] summary
```

- Each upstream column is a checkbox
- `row` and `count` are dropdowns per checked dependency
- `self` always has `row: previous` (grayed out / enforced)
- Pattern label (map/reducer/accumulator) shown as secondary hint based on current selections

## Future Directions (document, don't build)

1. **Cross-row downstream dependencies**: Depend on columns that normally compute after you by using `row: 'previous'`. Already supported by this design.
2. **Cyclic column pairs**: A depends on `previous(B)`, B depends on `previous(A)`. Already supported.
3. **Step-specific windows**: Depend on a column's value at a specific row, or up to a specific row. Would extend `row` from a binary to a richer range specifier.
4. **`window(n)`**: Reintroduce as a `count` option (`count: 'window(5)'` or similar) for seeing the last N values.
5. **Column reordering in UI**: Swapping which column is "first" in a row changes who gets current vs previous values of the other. Complex invalidation implications — needs careful design.
6. **Token budgeting**: Replace fixed count with "fit within N tokens." Deeply context-assembly-specific.
