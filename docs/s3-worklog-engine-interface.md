# S3 — Work Log Engine · Interface Contract

> Gantt.IO subsystem S3. Owns all logic around recorded work — accumulation, deduplication,
> aggregation, and snapshot generation.
> **Dependencies**: S1 (schema/types/validators only).
> **Used by**: S8 (Work Log UI — entry & display), S9 (App Shell — snapshot rebuild on load).

---

## Files

```
src/s3-worklog/
  engine.ts       ← entry mutation: addEntry, deduplication
  aggregator.ts   ← aggregateByTask, aggregateByPerson, aggregateByDate
  snapshots.ts    ← rebuildSnapshots
  index.ts        ← module exports
```

---

## Core Responsibilities

### 1. Entry Mutation

Accept a new `WorkEntry`, apply deduplication against an existing list, and return the updated
list. S3 never writes to disk — that is S2's job. S9 calls S2 after receiving the updated list.

**Deduplication key**: `(date, person_id, task_id)`. If an entry with the same key already
exists in the list, the incoming entry **replaces** it (last-write wins). Replacing preserves
the original entry's `id` so that references stored elsewhere remain stable.

### 2. Aggregation

Three read-only views over a `WorkEntry[]`. All functions are pure — no side effects, no
mutation of the input array.

- **By task** — total hours and most recent entry date per `task_id`.
- **By person** — total hours, entry count, and most recent entry date per `person_id`,
  optionally scoped to a single task.
- **By date** — daily hour totals within a date range, useful for burn-down charts.

### 3. Snapshot Rebuild

Given a full `Project` and its associated `WorkEntry[]`, recompute the snapshot/cache fields
(`hours_spent`, `completion_derived`) on every **non-group** task and return a new `Project`
with those fields updated. Group rollup (`rollupGroup`) is S4's responsibility and runs after
S3's pass.

**Completion derivation rules (per non-group task):**

| Condition | `completion_derived` |
|---|---|
| `estimated_hours > 0` | `hours_spent / estimated_hours`, capped at `0.99` |
| `estimated_hours === 0` (milestone) | `0.0` |

`completion_manual` is **never touched** by S3 — it is a user-set override and survives
snapshot rebuilds unchanged.

`conflict_state` is **not touched** by S3 — it is written by S4.

---

## Types

### Aggregate result types

```ts
interface TaskAggregate {
  task_id: string
  hours_spent: number           // sum of all work entry hours for this task
  last_entry_date: string | null  // ISO "YYYY-MM-DD"; null if no entries
}

interface PersonAggregate {
  person_id: string
  hours_spent: number           // sum within the queried scope
  entry_count: number
  last_entry_date: string | null  // ISO "YYYY-MM-DD"; null if no entries
}

interface DailyTotal {
  date: string                  // ISO "YYYY-MM-DD"
  hours: number                 // sum of all hours logged on this date
}

interface DateRange {
  start: string                 // ISO "YYYY-MM-DD", inclusive
  end: string                   // ISO "YYYY-MM-DD", inclusive
}
```

---

## engine.ts

### Functions

```ts
// Appends or replaces `entry` in `entries` using (date, person_id, task_id) as the
// deduplication key. Returns a new array — does not mutate the input.
// When replacing, the returned entry carries the *incoming* entry's id, hours, and note,
// but keeps the key fields of the original entry (date, person_id, task_id) unchanged
// since they are identical by definition.
addEntry(entry: WorkEntry, entries: WorkEntry[]): WorkEntry[]

// Removes the entry with the given id. Returns a new array.
// If no entry matches, the original array is returned unchanged (no error thrown).
removeEntry(id: string, entries: WorkEntry[]): WorkEntry[]

// Applies deduplication to an entire list (e.g. after a CSV bulk import).
// For each group of entries sharing the same (date, person_id, task_id),
// the last entry in array order wins; the others are dropped.
// Returns a new, deduplicated array. Relative order of surviving entries is preserved.
deduplicateEntries(entries: WorkEntry[]): WorkEntry[]
```

---

## aggregator.ts

### Functions

```ts
// Returns one TaskAggregate per task_id that appears in `entries`.
// Tasks with zero entries are not included in the result.
aggregateByTask(entries: WorkEntry[]): Map<string, TaskAggregate>

// Returns one PersonAggregate per person_id that appears in `entries`.
// If `task_id` is provided, only entries for that task are considered.
aggregateByPerson(
  entries: WorkEntry[],
  task_id?: string
): Map<string, PersonAggregate>

// Returns one DailyTotal for each calendar date within `range` (inclusive) that has
// at least one matching entry. Dates with no entries are omitted from the result.
// If `task_id` is provided, only entries for that task are considered.
// If `person_id` is provided, only entries for that person are considered.
// Both filters may be combined.
aggregateByDate(
  entries: WorkEntry[],
  range: DateRange,
  options?: { task_id?: string; person_id?: string }
): DailyTotal[]
```

---

## snapshots.ts

### Functions

```ts
// Recomputes `hours_spent` and `completion_derived` for every non-group task in
// `project.tasks` based on `entries`. Returns a new Project object with updated task
// snapshot fields — does not mutate the input.
//
// Group tasks:
//   hours_spent is set to the sum of all descendant work-entry hours (direct + indirect).
//   completion_derived is left at 0.0 — group rollup is S4's responsibility.
//
// Non-group tasks (task, milestone):
//   hours_spent = sum of entry.hours for entries where entry.task_id === task.id
//   completion_derived:
//     - if estimated_hours > 0: min(hours_spent / estimated_hours, 0.99)
//     - if estimated_hours === 0: 0.0
//
// Fields never touched by rebuildSnapshots:
//   completion_manual, conflict_state, all other task fields.
//
// meta.updated_at is set to the current UTC ISO datetime on the returned Project.
rebuildSnapshots(project: Project, entries: WorkEntry[]): Project
```

---

## Error Handling

S3 is a pure logic layer. It does not perform I/O and therefore does not throw file or
network errors. Potential error conditions and their handling:

| Condition | Behaviour |
|---|---|
| `entries` contains entries whose `task_id` or `person_id` has no match in the project | Silently skipped during `rebuildSnapshots`; still aggregated by the aggregator functions |
| `addEntry` receives an entry that fails S1 validation | **Throws `TypeError`** with the S1 `ValidationError` messages concatenated. Callers must pre-validate using S1's `validateWorkEntry` before calling S3. |
| `DateRange.end` is before `DateRange.start` in `aggregateByDate` | Returns an empty array |
| `estimated_hours` is negative (should not occur if S1 validation was applied) | `completion_derived` is clamped to `0.0` |

S3 functions do **not** call S1 validators internally (to avoid redundant validation when
called in a hot loop). The contract assumes callers pass valid `WorkEntry` objects. The single
exception is `addEntry`, which validates its single argument because it is a mutation
operation with no hot-path justification for skipping validation.

---

## Key Invariants

| Rule | Where enforced |
|---|---|
| Deduplication key is `(date, person_id, task_id)` — not `id` | `addEntry`, `deduplicateEntries` |
| Replacing a duplicate preserves the incoming entry's `id` | `addEntry` |
| `completion_derived` is capped at `0.99`, never `1.0` | `rebuildSnapshots` |
| `completion_manual` is never modified | `rebuildSnapshots` |
| `conflict_state` is never modified | `rebuildSnapshots` (S4 owns it) |
| Group `completion_derived` is left `0.0` after S3's pass | `rebuildSnapshots` — S4 must run after |
| All functions are pure / return new objects — no mutation | throughout |
| S3 performs no file I/O | by design — S2 and S9 handle persistence |

---

## Caller Sequence (for reference — not part of S3)

### On project load (S9)

```
S2.loadProjectFile(file)           → project
S2.loadWorkLogFile(file, format)   → entries
S3.deduplicateEntries(entries)     → entries (clean)
S3.rebuildSnapshots(project, entries) → project (snapshots updated)
S4.rollupGroups(project)           → project (group rollup applied)
S4.computeConflictStates(project, deps) → project (conflict_state written)
// → store in S9 global state
```

### On quick-entry (S8 → S9)

```
S1.validateWorkEntry(rawInput)     → WorkEntry
S3.addEntry(entry, currentEntries) → updatedEntries
S3.rebuildSnapshots(project, updatedEntries) → updatedProject
S4.rollupGroups(updatedProject)    → updatedProject
S2.saveWorkLogFile(updatedEntries) → (persisted)
S2.saveProjectFile(updatedProject) → (persisted)
// → update S9 global state, trigger re-render
```

### On CSV bulk import (S8 → S9)

```
S2.loadWorkLogFile(file, 'csv')    → importedEntries
S3.deduplicateEntries([...currentEntries, ...importedEntries]) → mergedEntries
S3.rebuildSnapshots(project, mergedEntries) → updatedProject
S4.rollupGroups(updatedProject)    → updatedProject
S2.saveWorkLogFile(mergedEntries)  → (persisted)
S2.saveProjectFile(updatedProject) → (persisted)
// → update S9 global state, trigger re-render
```

---

## Notes

- **Stateless by design.** S3 holds no internal state. The current entries array lives in S9's
  global store and is passed in on every call.
- **No UI.** S3 has no knowledge of dialogs, forms, or rendering. That belongs to S8.
- **No S4 dependency.** Group completion rollup is excluded from S3 deliberately. S4 owns
  hierarchy traversal; S3 would need to import S4 to perform it, creating an unwanted
  coupling. S9 sequences the two passes.
- **Hot-loop friendly.** Aggregation functions are written to make a single pass over
  `entries`. `rebuildSnapshots` makes a single pass over tasks and a single pass over entries
  (building the `aggregateByTask` map first, then applying it). No nested iteration.
