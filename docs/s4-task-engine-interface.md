# S4 — Task & Dependency Engine · Interface Contract

> Gantt.IO subsystem S4. Owns all business logic on the task tree: hierarchy traversal,
> group rollup, dependency resolution, conflict detection, color resolution, critical path,
> and task mutation.
> **Dependencies**: S1 (schema/types/validators only).
> **Used by**: S5 (canvas renderer), S6 (sidebar), S7 (edit drawer), S9 (app shell).

---

## Files

```
src/s4-tasks/
  tree.ts                ← pure hierarchy queries (read-only)
  rollup.ts              ← rollupGroups: group completion & date derivation
  dependency-resolver.ts ← computeEarliestStart, getDependencyShift, cycle detection
  conflict.ts            ← computeConflictState(s), resolveColor
  critical-path.ts       ← computeCriticalPath
  mutations.ts           ← addTask, updateTask, removeTask, moveTask
  index.ts               ← module exports
```

---

## Core Responsibilities

### 1. Hierarchy Traversal (`tree.ts`)

Pure read queries over a flat `Task[]`. No mutation. These are utility functions used
internally by other S4 modules and exported for S5, S6, S7 to build their views.

### 2. Group Rollup (`rollup.ts`)

After S3 runs `rebuildSnapshots`, group tasks still have `completion_derived === 0.0`.
`rollupGroups` makes a bottom-up pass over the tree and fills in every group's
`completion_derived` (weighted by `estimated_hours` of non-group descendants) and, for
groups with `end_date_is_last_of_children === true`, recomputes `end_date` as the latest
`end_date` of direct children.

Returns a new `Project` — does not mutate the input.

### 3. Dependency Resolution (`dependency-resolver.ts`)

Computes the earliest calendar date a task *can* start given all its predecessors in the
dependency graph, respecting each `Dependency.rule` and `lag_days`. Detects and surfaces
cycles as a structured error. All date arithmetic is done in whole calendar days on ISO
`"YYYY-MM-DD"` strings — no `Date` objects escape this module.

### 4. Conflict Detection (`conflict.ts`)

Uses the dependency-resolved earliest start to classify each task's scheduling tension as
`"none"`, `"warning"`, or `"error"` and writes that to `task.conflict_state`.
Also provides `resolveColor`: walks the parent chain to find the effective `PaletteKey`
for rendering, with special-case handling for milestones and the project-level default.

### 5. Critical Path (`critical-path.ts`)

Identifies the set of task IDs that form the longest end-to-end chain through the
dependency graph. Used by S5 to render the critical-path highlight outline on bars.

### 6. Task Mutation (`mutations.ts`)

Create, update, delete, and move tasks while enforcing all S1 invariants (milestone
field locks, parent-must-be-group rule, no orphan dependencies). All mutation functions
return a new `Project` — they never mutate in place.

---

## Types

S4 introduces no new entity types — it uses S1 types throughout. It does define result
types for operations that can fail structurally (cycle detection, validation errors on
mutation).

```ts
// Returned by computeEarliestStart and computeCriticalPath when the dependency
// graph contains a cycle. Never thrown — always returned as a discriminated union.
interface CycleError {
  kind: "cycle"
  // The minimal cycle that was detected, expressed as an ordered list of task ids.
  // The first and last element are the same task (the entry point of the cycle).
  cycle: string[]
}

// Union used by dependency-resolver functions that can fail.
type DependencyResult<T> =
  | { ok: true;  value: T }
  | { ok: false; error: CycleError }

// One entry in a critical path result.
interface CriticalPathLink {
  task_id: string
  dependency_id: string | null   // null for the first task in the chain
}
```

---

## tree.ts

All functions are pure and accept a flat `Task[]`. They do not throw; callers supply
valid data (S1 validation is a precondition).

```ts
// Direct children of `task_id` in their original array order.
// Returns [] if `task_id` has no children or does not exist.
getChildren(task_id: string, tasks: Task[]): Task[]

// All descendants (children, grandchildren, …) in depth-first order.
// Returns [] if `task_id` has no descendants or does not exist.
getDescendants(task_id: string, tasks: Task[]): Task[]

// Direct siblings: tasks sharing the same `parent_id` (including the task itself).
// Returns [task] (singleton) if there are no other siblings.
getSiblings(task_id: string, tasks: Task[]): Task[]

// Ancestor chain from direct parent up to (but not including) the root, ordered
// nearest-first. Returns [] for root-level tasks.
getAncestors(task_id: string, tasks: Task[]): Task[]

// Breadcrumb path including the task itself: [root-ancestor, …, task].
// Suitable for display in the edit drawer header.
getPath(task_id: string, tasks: Task[]): Task[]

// True if `ancestor_id` is a strict ancestor of `task_id` (not the task itself).
isAncestor(ancestor_id: string, task_id: string, tasks: Task[]): boolean

// Depth of `task_id` in the tree. Root-level tasks have depth 0.
getDepth(task_id: string, tasks: Task[]): number

// Returns all root-level tasks (parent_id === null) in array order.
getRoots(tasks: Task[]): Task[]
```

---

## rollup.ts

```ts
// Bottom-up pass: for every group task in `project.tasks`, recomputes:
//   - `completion_derived`  (hours-weighted average of non-group leaf descendants)
//   - `end_date`            (latest end_date of direct children, only when
//                            end_date_is_last_of_children === true)
//   - `hours_spent`         is NOT touched — S3.rebuildSnapshots already set it
//                            for groups as the sum of all descendant work-entry hours.
//
// Processing order: deepest groups first (post-order traversal) so that a group's
// children are already rolled up before the group itself is processed.
//
// Completion derivation for a group:
//   Let leaves = all non-group descendants of the group.
//   Let eligible = leaves where estimated_hours > 0.
//   If eligible is empty → completion_derived = 0.0
//   Otherwise:
//     completion_active(task) = completion_manual ?? completion_derived
//     completion_derived(group) =
//       Σ(completion_active(leaf) * leaf.estimated_hours) / Σ(leaf.estimated_hours)
//     Result is capped at 0.99 (consistent with S3's leaf cap).
//
// Returns a new Project. Does not mutate the input.
// meta.updated_at is NOT changed by rollupGroups (it is set by S3.rebuildSnapshots
// and by S4 mutation functions only).
rollupGroups(project: Project): Project
```

---

## dependency-resolver.ts

All date arithmetic is performed on `"YYYY-MM-DD"` ISO strings. Calendar day counts are
timezone-agnostic (treat dates as plain date labels, not instants).

### Dependency rule semantics

| Rule | Predecessor constraint on successor |
|---|---|
| `finish_to_start` | successor.earliest_start ≥ predecessor.resolved_end + lag_days |
| `start_to_start` | successor.earliest_start ≥ predecessor.resolved_start + lag_days |
| `finish_to_finish` | successor.earliest_end ≥ predecessor.resolved_end + lag_days |
| `start_to_finish` | successor.earliest_end ≥ predecessor.resolved_start + lag_days |

`lag_days` is a signed integer. Negative values express lead time (earlier start allowed).
`resolved_start` / `resolved_end` of a predecessor are themselves dependency-resolved
(graph traversal is recursive / memoized).

For `finish_to_finish` and `start_to_finish`, the returned "earliest start" is
back-calculated from the constrained end date using the task's planned duration
(`end_date − start_date` in calendar days). Milestones have zero duration.

### Functions

```ts
// Walks the dependency graph upstream from `task_id` and returns the earliest
// calendar date the task can start given all predecessor constraints.
//
// Returns `{ ok: true, value: "YYYY-MM-DD" }` on success.
// Returns `{ ok: false, error: CycleError }` if a cycle is detected.
//
// If the task has no dependencies (direct or transitive), returns its own
// `task.start_date` unchanged.
//
// Memoization: the resolver builds an internal map on each call; results for
// previously resolved tasks are cached within a single call tree but NOT across
// calls. Callers computing many tasks in one pass should prefer
// `computeAllEarliestStarts`.
computeEarliestStart(
  task_id: string,
  tasks: Task[],
  dependencies: Dependency[]
): DependencyResult<string>   // "YYYY-MM-DD"

// Computes earliest starts for all tasks in a single graph traversal.
// More efficient than calling computeEarliestStart in a loop.
// Returns a Map from task_id → "YYYY-MM-DD" on success.
// Returns CycleError on the first cycle detected (fails fast).
computeAllEarliestStarts(
  tasks: Task[],
  dependencies: Dependency[]
): DependencyResult<Map<string, string>>

// Returns the signed number of calendar days by which the dependency-resolved
// earliest start differs from the task's planned `start_date`.
// Positive = task is pushed later (dependency conflict risk).
// Zero = no shift; the task can start on its planned date.
// Negative values are theoretically possible (all predecessors finish early)
//   but are clamped to 0 — a task is never pulled earlier than its planned date.
//
// Returns `{ ok: false, error: CycleError }` if cycle detected.
getDependencyShift(
  task_id: string,
  tasks: Task[],
  dependencies: Dependency[]
): DependencyResult<number>

// Detects whether the dependency graph contains any cycles.
// Returns the first cycle found as a CycleError, or null if the graph is acyclic.
detectCycles(
  tasks: Task[],
  dependencies: Dependency[]
): CycleError | null
```

---

## conflict.ts

### Conflict state rules

Given a task and its dependency-resolved `earliest_start`:

Let `shift = getDependencyShift(task_id, ...)` (calendar days, clamped to 0).

| Condition | `conflict_state` |
|---|---|
| `shift === 0` | `"none"` |
| `!task.end_date_is_flexible && shift > 0` | `"error"` — any shift on a hard-deadline task is an error |
| `task.end_date_is_flexible && shift > 0 && shifted_end ≤ end_date + flexibility_range` | `"warning"` |
| `task.end_date_is_flexible && shifted_end > end_date + flexibility_range` | `"error"` |

Where `shifted_end = addDays(task.end_date, shift)`.

Milestones use `end_date === start_date`, so `shifted_end = addDays(task.start_date, shift)`.

Group tasks **do not receive a `conflict_state`** from this function — groups are not
directly scheduled by dependencies. They retain the value written by the prior pass
(`"none"`). S5 renders group brackets without conflict coloring.

If `detectCycles` returns a cycle (called internally), all tasks in the cycle receive
`conflict_state: "error"`. Tasks outside any cycle are processed normally.

### Functions

```ts
// Computes and returns the conflict_state for a single task given pre-computed shift.
// Pure function — does not touch the project.
// Exported for use in tests and incremental updates (e.g. after editing one task).
computeConflictState(
  task: Task,
  shift: number   // already-computed getDependencyShift result (clamped, non-negative)
): ConflictState

// Runs computeAllEarliestStarts, then computeConflictState for every task, and
// writes the result to task.conflict_state.
// Returns a new Project with all conflict_state fields updated.
// If a cycle is detected, tasks in the cycle get "error"; others are still processed.
// Group tasks are left at "none".
// meta.updated_at is NOT changed here.
computeConflictStates(
  project: Project,
  dependencies: Dependency[]
): Project

// Walks up the parent chain of `task` to find the first non-null `color` value.
// Falls back to `project_color` (the project-level default) if no ancestor has a color.
// Special cases:
//   - Milestones always return "orange" regardless of the task's or parents' color.
//   - If the task itself has a non-null color, that is returned immediately.
resolveColor(
  task: Task,
  tasks: Task[],
  project_color: PaletteKey
): PaletteKey
```

---

## critical-path.ts

The critical path is the longest end-to-end chain through the dependency graph, measured
in calendar days. Only `finish_to_start` dependencies with non-negative `lag_days` are
considered for critical path purposes (the standard project-management definition).
Other dependency types are ignored in this computation.

```ts
// Returns the ordered list of CriticalPathLink entries forming the longest
// dependency chain, from the earliest-starting task to the latest-finishing task.
//
// "Longest" is measured as: sum of task durations (end_date − start_date in
// calendar days) plus lag_days on each connecting dependency.
//
// Returns { ok: false, error: CycleError } if a cycle is detected.
// Returns { ok: true, value: [] } if there are no finish_to_start dependencies.
//
// The returned links use planned (user-entered) dates, not dependency-resolved
// dates, so the critical path reflects schedule intent, not current shift.
computeCriticalPath(
  tasks: Task[],
  dependencies: Dependency[]
): DependencyResult<CriticalPathLink[]>

// Convenience: returns the Set of task_ids on the critical path.
// Returns an empty Set on cycle error (does not surface the error — call
// computeCriticalPath directly if you need the CycleError).
getCriticalPathIds(
  tasks: Task[],
  dependencies: Dependency[]
): Set<string>
```

---

## mutations.ts

All mutation functions validate their inputs using S1 validators and enforce structural
invariants before applying changes. They return a new `Project` on success or throw a
`TypeError` with a descriptive message on invariant violation. They never mutate inputs.

`meta.updated_at` is set to the current UTC ISO datetime on every returned `Project`.

```ts
// Appends a new task to project.tasks after validating it with S1.validateTask
// and enforcing cross-entity rules:
//   - If task.parent_id is set, the referenced task must exist and be type "group".
//   - task.people_ids entries must reference existing person ids.
//   - task.id must be unique within the project.
// Milestone invariants (estimated_hours=0, end_date=start_date) are enforced even
// if the caller passes different values (silently corrected, not errored).
addTask(task: Task, project: Project): Project

// Replaces the task matching `task.id` with the new value.
// Same invariant checks as addTask, plus:
//   - Changing `type` away from "group" is rejected if the task has children.
//   - `task.id` must match an existing task in the project.
updateTask(task: Task, project: Project): Project

// Removes the task with the given id and cascades:
//   - All descendants are also removed (recursive).
//   - All dependencies referencing the removed task ids (as from_task_id or
//     to_task_id) are also removed.
//   - people_ids on other tasks are NOT affected.
// If `task_id` does not exist, returns the project unchanged (no error thrown).
removeTask(task_id: string, project: Project): Project

// Changes the `parent_id` of `task_id` to `new_parent_id` (null = root).
// Validation:
//   - `new_parent_id` must reference an existing task of type "group", or be null.
//   - Moving a task into one of its own descendants is rejected (TypeError).
// The task is re-appended to the end of its new sibling list (array order change).
moveTask(task_id: string, new_parent_id: string | null, project: Project): Project
```

---

## Caller Sequences (for reference — not part of S4)

### Full rebuild on load (S9)

```
S2.loadProjectFile(file)                       → project
S2.loadWorkLogFile(file, format)               → entries
S3.deduplicateEntries(entries)                 → entries
S3.rebuildSnapshots(project, entries)          → project  (leaf hours_spent + completion_derived set)
S4.rollupGroups(project)                       → project  (group completion_derived + end_date set)
S4.computeConflictStates(project, project.dependencies) → project  (conflict_state written)
// → store in S9 global state
```

### After task edit (S7 → S9)

```
S4.updateTask(editedTask, project)             → project
S3.rebuildSnapshots(project, entries)          → project
S4.rollupGroups(project)                       → project
S4.computeConflictStates(project, project.dependencies) → project
S2.saveProjectFile(project)                    → (persisted)
// → update S9 global state, trigger re-render
```

### Canvas rendering (S5, read-only, no mutations)

```
S4.getCriticalPathIds(project.tasks, project.dependencies) → Set<string>
S4.computeAllEarliestStarts(project.tasks, project.dependencies) → Map<task_id, date>
S4.resolveColor(task, project.tasks, project.meta.color)  → PaletteKey  (per task)
// task.conflict_state is read directly from the project — no S4 call needed at render time
```

---

## Error Handling

| Condition | Behaviour |
|---|---|
| Cycle in dependency graph | `computeEarliestStart`, `computeAllEarliestStarts`, `getDependencyShift`, `computeCriticalPath` return `{ ok: false, error: CycleError }`. `computeConflictStates` marks cycled tasks `"error"` and continues. `detectCycles` returns the `CycleError` directly. |
| `addTask` / `updateTask` receives invalid S1 data | Throws `TypeError` with S1 `ValidationError` messages concatenated |
| `updateTask` tries to change a group-with-children to non-group | Throws `TypeError` |
| `moveTask` would create a cycle in the hierarchy | Throws `TypeError` |
| `removeTask` called with unknown id | Returns project unchanged (silent no-op) |
| `computeEarliestStart` called with unknown `task_id` | Returns `{ ok: true, value: task.start_date }` (no predecessors assumed) |
| `resolveColor` reaches root with no non-null color ancestor | Returns `project_color` (the supplied fallback — never throws) |

---

## Key Invariants

| Rule | Where enforced |
|---|---|
| Group tasks get `conflict_state: "none"` — only leaf tasks and milestones are conflict-checked | `computeConflictStates` |
| `conflict_state` is never set by S3 — S4 owns it exclusively | by design |
| `completion_manual` is never touched by S4 | `rollupGroups`, `mutations.ts` |
| Groups with `end_date_is_last_of_children` have their `end_date` derived, not user-entered | `rollupGroups` |
| Moving a task into its own subtree is rejected | `moveTask` |
| `removeTask` cascades to descendants and their dependencies | `removeTask` |
| `milestone.color` always resolves to `"orange"` regardless of the task or its ancestors | `resolveColor` |
| All functions return new objects — no mutation of inputs | throughout |
| S4 performs no file I/O | by design — S2 and S9 handle persistence |
| S4 has no dependency on S2, S3, S5, S6, S7, S8, or S9 | by design |
