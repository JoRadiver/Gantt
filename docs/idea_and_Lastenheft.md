# Gantt.IO — Project Description & Lastenheft

> A browser-based, file-driven project planning tool.  
> Human-readable storage. No server required. DB-migration-ready by design.

---

## 1. Vision

A single-page Gantt application that runs entirely in the browser and stores its data in plain JSON and optionally CSV. The design philosophy is *file-first*: the project file is the source of truth and must be readable, editable, and diffable without any special tooling. Internally the data is structured so that swapping the file layer for a database requires only replacing a thin storage adapter — nothing else changes.

---

## 2. Core Concepts & Clarified Ideas

### 2.1 Data split: Project file vs. Work log

Two logical tables exist at the storage level:

| Store | Contents | Format |
|---|---|---|
| **Project file** | Task tree, people, dependencies, project metadata, *cached aggregates* | `.json` (primary) |
| **Work log** | Every time someone records hours: date, hours, person, task | `.json` or `.csv` |

The project file contains **snapshot fields** (`hours_spent`, `hours_done`, `completion_derived`) that are *computed from the work log and cached*. They are not the ground truth — they are a materialized view for fast loading and offline display. On every load the app recomputes them from the work log and overwrites the cache. This means: open the project JSON in a text editor and the numbers make sense; open it without a work log and you still see the last known state.

### 2.2 Tasks are the universal entity

Rather than maintaining separate tables for Tasks, Groups, and Milestones, all three are **rows in the same task table** distinguished by a `type` field:

| Type | Meaning |
|---|---|
| `task` | Standard unit of work with duration |
| `group` | Container — has children, no direct hours |
| `milestone` | Single-point event — `start_date == end_date`, zero estimated hours, renders as a diamond |

This avoids join complexity and keeps the file readable. Milestones with dependencies behave identically to tasks in the dependency engine.

### 2.3 Hierarchy vs. Dependencies — they are different things

- **Parent/child** (`parent_id`) is a *display and rollup* relationship. A group owns its children. Completion, hours, and date ranges of a group are derived from its children.
- **Dependencies** are a *scheduling* relationship between any two tasks regardless of hierarchy. A dependency does **not** mutate the user-entered `start_date`. It is a separate computed signal: "the earliest this task *can* start given its predecessors." The Gantt renders both — the planned bar and a dependency-shifted ghost — so schedule drift is immediately visible.

### 2.4 Completion: manual vs. derived

Two parallel fields exist per task:

- `completion_manual` — an optional user-set override (e.g. "I know this is 70% done even though hours don't show it").
- `completion_derived` — computed: `hours_spent / estimated_hours`, capped at 99% until explicitly closed.

The UI shows `completion_manual` when set, `completion_derived` otherwise. Both are stored in the project JSON snapshot.

### 2.5 End date flexibility

Tasks have:
- `end_date` — the planned end date as entered.
- `end_date_is_flexible` (bool) — whether the end date is a hard deadline or a guide.
- `end_date_flexibility_range` (days) — acceptable overshoot.
- `end_date_is_last_of_children` (bool) — if true, `end_date` is computed as the latest end date of all direct children, not entered manually. Only meaningful on group-type tasks.

### 2.6 Work log entry

Two entry paths:
1. **Quick-entry dialog** — "I just worked on something." Selects date (defaults today), person, task, and hours. Appends a row to the work log.
2. **CSV import** — bulk-load historical data. Expected columns: `date, hours, person_id, task_id`. The importer validates, deduplicates on `(date, person_id, task_id)`, and recomputes snapshots after load.

---

## 3. Full Data Schema

### 3.1 `Project` (root of the JSON file)

```
meta
  id, name, description, created_at, updated_at, color, worklog_path (optional external ref)

people[]
  id, name, initials, color, role, email (optional)

tasks[]
  — identity
  id, type (task | group | milestone), title, notes

  — hierarchy
  parent_id (null = root)

  — assignment
  people_ids[]

  — appearance
  color (palette key, e.g. "green" | "blue" | "amber" | null)
    null means "inherit from parent group"
    milestone color is always "orange" regardless of this field
    conflict state overrides all of the above with "red" at render time

  — scheduling (user-entered)
  start_date
  estimated_hours
  end_date
  end_date_is_flexible
  end_date_flexibility_range (days)
  end_date_is_last_of_children

  — priority & metadata
  prio (critical | high | normal | low)

  — snapshot / cache (recomputed from worklog on load)
  hours_spent
  completion_derived (0.0–1.0)
  completion_manual (0.0–1.0 | null)
  conflict_state (none | warning | error)  ← computed by S4, consumed by S5

dependencies[]
  id, from_task_id, to_task_id
  rule (finish_to_start | start_to_start | finish_to_finish | start_to_finish)
  lag_days (signed integer, default 0)
```

### 3.2 `Work log` (separate file, same JSON schema or CSV)

```
worklog[]
  id, date, hours, person_id, task_id, note (optional)
```

---

## 4. Subsystem Breakdown — Divide & Conquer

Nine subsystems, each independently developable with a thin interface to its neighbors.

---

### S1 — Schema & Validation

**What it does:** Defines the canonical data types and validates objects at the boundary (on load, before save, on user input).

**Contains:**
- Type/interface definitions for all entities (Task, Person, Dependency, WorkEntry, Project).
- Enum definitions: `TaskType`, `DependencyRule`, `Priority`.
- Validator functions: `validateTask(obj)`, `validateWorkEntry(obj)`, etc. Returns typed errors, not exceptions.
- Default factory functions: `defaultTask()`, `defaultPerson()`.

**Does not contain:** Rendering, storage I/O, business logic.

**Why separate:** Every other subsystem imports from here. Changes to the schema are felt everywhere but contained here.

---

### S2 — Storage Adapter

**What it does:** All file I/O. Reads and writes project JSON, reads and writes/appends work log JSON or CSV. Presents a uniform interface so callers never touch the file system directly.

**Contains:**
- `loadProject(file) → Project`
- `saveProject(project, file)`
- `loadWorklog(file) → WorkEntry[]`
- `saveWorklog(entries, file)`
- `importWorklogCSV(file) → WorkEntry[]` (parse, validate, deduplicate)
- `exportTasksCSV(tasks) → Blob`
- Internal: JSON serializer/deserializer, CSV parser, file picker wrappers (File System Access API, with fallback to `<input type=file>`).

**DB migration surface:** Replace the bodies of these functions with API calls. The rest of the app does not change.

**Does not contain:** Any knowledge of what the data means.

---

### S3 — Work Log Engine

**What it does:** Owns all logic around recorded work — accumulation, aggregation, and snapshot generation.

**Contains:**
- `addEntry(entry)` — append and persist.
- `aggregateByTask(entries) → Map<task_id, {hours_spent, last_entry_date}>`
- `aggregateByPerson(entries, task_id?) → ...`
- `aggregateByDate(entries, range) → daily series` (useful for burn-down chart later)
- `rebuildSnapshots(project, entries) → Project` — recomputes all `hours_spent` and `completion_derived` fields on tasks, returns an updated project.
- Deduplication logic (same date + person + task → update, not append).

**Does not contain:** UI for entry, file I/O.

---

### S4 — Task & Dependency Engine

**What it does:** All business logic on the task tree. Hierarchy traversal, date computation, dependency resolution, conflict detection, and color resolution.

**Contains:**
- Tree operations: `getChildren(task_id)`, `getDescendants(task_id)`, `getSiblings(task_id)`, `getPath(task_id)` (breadcrumb).
- Rollup: `rollupGroup(group, tasks)` — computes group's derived hours, date range, completion from children.
- `computeEndDate(task, tasks)` — respects `end_date_is_last_of_children`.
- Dependency resolution:
  - `computeEarliestStart(task_id, tasks, dependencies) → Date` — walks the dependency graph to find when a task *can* start given all predecessors, respecting `lag_days`.
  - Cycle detection: returns a structured error if the dependency graph has cycles.
  - `getDependencyShift(task, tasks, deps) → days` — how many calendar days ahead of the planned start the dependency pushes the task.
- `computeConflictState(task, tasks, deps) → 'none' | 'warning' | 'error'`:
  - `none` — no dependency shift, or shift fits within planned dates.
  - `warning` — earliest possible start exceeds `end_date` but falls within `end_date + flexibility_range`.
  - `error` — earliest possible start exceeds `end_date + flexibility_range`, or `end_date_is_flexible` is false and any shift pushes past `end_date`.
- `resolveColor(task, tasks) → paletteKey` — walks up the parent chain until a non-null `color` is found. Returns that key. If the root has no color, returns the project default. Milestones always return `'orange'` regardless.
- Critical path computation: identify the longest chain of finish-to-start dependencies end-to-end.
- No rendering, no storage.

---

### S5 — Gantt Canvas Renderer

**What it does:** Draws the timeline on an HTML Canvas element. Reads pre-computed data from S4; performs no date math or business logic of its own.

**Contains:**

*Timeline header:* day / week / month / quarter column headers, scaling to the current zoom level (px-per-day). A vertical "today" line runs the full height of the canvas.

*Bar rendering per task:*  
Each task bar is drawn in three layers from back to front:
1. **Background track** — the full planned duration, filled with the task's *pastel* resolved color. This represents the total planned work.
2. **Progress fill** — drawn from the left edge, width proportional to `completion_active` (manual if set, derived otherwise), filled with the *saturated* resolved color.
3. At 100% completion the entire bar uses the *fully saturated* resolved color.

Conflict state overrides the resolved color: `warning` tints the bar amber, `error` replaces it entirely with red. Conflict override takes priority over everything including completion fill — a conflicted task shows as a solid amber or red bar with no progress fill visible, because the scheduling problem is more important information than the progress.

*Color palette and saturation model:*  
A fixed palette of named hues is defined (green, blue, teal, purple, amber, coral, slate). Each hue has exactly three stops:
- `pastel` — very light, low saturation (background track / 0% done)
- `mid` — medium saturation (active progress fill)
- `full` — fully saturated (completed tasks)

Special fixed colors outside the palette:
- Milestones: always `orange` (diamond shape, not a bar)
- Conflict warning: always `amber` (overrides task color)
- Conflict error: always `red` (overrides task color)

Groups do not render a bar. They render a bracket: a thin horizontal line spanning their children's date range with small downward tick marks at each end, in a neutral dark color.

*Bar label:*  
Every task bar displays its title as a single line of monospace text, left-aligned and vertically centered inside the bar.

Label positioning rules (evaluated in order):
1. **Normal:** label starts at `bar_left + padding`. Clipped to bar width.
2. **Start off-screen left:** if `bar_left < canvas_scroll_left`, the label is instead positioned at `canvas_scroll_left + padding` — it "sticks" to the left edge of the visible canvas and scrolls with the viewport, not with the bar.
3. **Overflow prevention:** in rule 2, the label's right edge must never exceed `bar_right - padding`. If the remaining space is too narrow to show at least a few characters, the label is hidden entirely.
4. **Too long:** the label is truncated with an ellipsis to fit the available width.

The font is always monospace. Size scales mildly with the row height but has a minimum of 11px and a maximum of 13px.

*Other canvas elements:*
- Ghost bar: a dashed outline bar showing where the task would sit based on dependency-resolved earliest start. Rendered only when there is a nonzero dependency shift. Drawn in a low-opacity version of the task's resolved color.
- Dependency arrows: elbow-style connectors between task bars according to the dependency rule (finish-to-start, etc.). Drawn in a neutral muted color. Arrow tip is a filled triangle.
- Milestone diamonds: centered on the milestone date, sized to row height.
- Critical path highlight: a thin colored outline on bars that are part of the critical path.
- Row height stays synchronized with the sidebar row height so bars align with list rows pixel-perfectly.
- Hit testing: `hitTest(x, y) → task_id | null` — maps canvas click coordinates to a task, accounting for scroll and zoom.

**Does not contain:** Task data manipulation, date math, file I/O, business logic.

---

### S6 — Sidebar Task List

**What it does:** The left-panel tree view of tasks.

**Contains:**
- Tree rendering with indent levels, collapse/expand per group.
- Column cells: type badge, title, % complete mini-bar, expected hours, people pips.
- Row selection state (single select for now, multi-select later).
- Sort, filter, group-by logic at the display level (does not mutate the underlying task list).
- Synchronizes scroll position with the canvas renderer so rows and Gantt bars stay aligned.
- Emits events: `onRowSelect(task_id)`, `onRowCollapse(task_id)`.

**Does not contain:** Edit logic, canvas drawing.

---

### S7 — Edit Drawer

**What it does:** The slide-up bottom panel for editing a selected task.

**Contains:**
- Form rendering and two-way binding to a task object (works on a *copy* until save is confirmed).
- Fields: title, type, group (parent), start date, end date, flexibility settings, estimated hours, priority, assigned people (chip editor), notes, manual completion override.
- Dependency editor: list current deps, add new (task picker + rule selector + lag), remove.
- Validation feedback inline (e.g. end date before start date).
- Save → calls Task Engine to apply changes, triggers snapshot rebuild, triggers re-render.
- Delete → with confirmation.
- Discard → reverts the copy.
- Keyboard shortcuts: `Esc` to close, `Ctrl+S` to save.

**Does not contain:** File I/O, rendering logic beyond the form.

---

### S8 — Work Log Entry UI

**What it does:** User-facing interface for recording and reviewing hours worked.

**Contains:**
- Quick-entry dialog: date picker (default today), person selector, task selector (searchable), hours input, optional note. Submits to Work Log Engine.
- Work history view: a table of recent entries, editable inline, deletable.
- CSV import wizard: file picker → preview parsed rows → validate → confirm import → triggers snapshot rebuild.
- Summary panel: hours per person, hours per task this week / this month.

**Does not contain:** Aggregation logic (that lives in S3), file I/O (that lives in S2).

---

### S9 — App Shell & State

**What it does:** Wires everything together. Global application state, toolbar, view routing.

**Contains:**
- Global state store: current project, current worklog, selected task, UI state (zoom, scroll, active view, filter settings).
- Toolbar: view switcher (Gantt | List), zoom controls, filter/sort/group controls, search.
- View router: Gantt view (S5 + S6 side by side), List view (S6 alone, wider). No other views.
- File menu: New project, Open, Save, Save As, Open work log, Export CSV.
- Header: project name, team avatars, log-work button.
- State-change propagation: when a task is edited, notifies all subscribed subsystems (list, canvas, drawer) to re-render. Snapshot rebuild is triggered here after any worklog mutation.
- Keyboard shortcut registry.

**Does not contain:** Any domain logic — it only orchestrates.

---

## 5. Dependency Map Between Subsystems

```
S1 Schema  ←─ imported by all subsystems

S2 Storage ←─ S9 App Shell (open/save actions)
           └─ S8 Work Log UI (import/export)

S3 Worklog Engine ←─ S8 Work Log UI (entry)
                  └─ S9 App Shell (on load: rebuild snapshots)

S4 Task Engine ←─ S7 Edit Drawer (save/delete)
               └─ S9 App Shell (task CRUD operations)

S5 Canvas ←─ S9 App Shell (render trigger, scroll/zoom state)
           └─ S4 Task Engine (date + dependency data)

S6 Sidebar ←─ S9 App Shell (render trigger, filter/sort state)
           └─ S4 Task Engine (tree structure)

S7 Drawer ←─ S9 App Shell (open/close, selected task)
           └─ S4 Task Engine (validate, save)

S8 Work Log UI ←─ S9 App Shell (open dialog action)
               └─ S3 Worklog Engine (aggregate display)
```

No subsystem except S9 knows about any other subsystem except S1 and its direct logical dependencies. This keeps modules testable in isolation.

---

## 6. File Layout (Suggested)

```
gantt/
  index.html
  src/
    s1-schema/
      types.js
      validators.js
      defaults.js
      palette.js       ← color hue definitions with pastel/mid/full stops
    s2-storage/
      adapter.js       ← the DB-migration surface
      json-io.js
      csv-parser.js
    s3-worklog/
      engine.js
      aggregator.js
    s4-tasks/
      tree.js
      dependency-resolver.js
      critical-path.js
      conflict.js      ← computeConflictState, resolveColor
    s5-canvas/
      renderer.js
      timeline-header.js
      bar-painter.js   ← three-layer bar, label sticky logic, palette stops
      hit-test.js
    s6-sidebar/
      task-list.js
      row-renderer.js
    s7-drawer/
      drawer.js
      form-binder.js
    s8-worklog-ui/
      entry-dialog.js
      history-view.js
      import-wizard.js
    s9-shell/
      state.js
      toolbar.js
      app.js
  data/
    example-project.json
    example-worklog.csv
```

---

## 7. Resolved Design Decisions

All open questions are now closed.

**1. No baseline history.** The dates stored on a task are the current planned dates, full stop. If the user changes a start date, the old value is gone. There is no "original plan" layer. If versioning is needed in the future, the project JSON can be committed to git — that is sufficient, and no app feature is needed.

**2. Single project.** The app opens exactly one project file at a time. The shell has no concept of a workspace or project switcher. Open → edit → save.

**3. Board view is not planned.** The view switcher offers Gantt and List only. Board is removed entirely, not stubbed.

**4. Conflict recoloring is automatic and threshold-aware.** The dependency engine computes a `conflict_state` enum per task — `none | warning | error` — and stores it as a derived field alongside the snapshot. S5 reads this field; it does no date math itself. Rules: if the earliest-possible start (from dependency resolution) is later than `end_date` while still within `end_date + flexibility_range`, state is `warning` (bar tints amber). If it exceeds even the flexibility range, state is `error` (bar turns red). If there is no dependency shift or the task has room, state is `none`.

**5. No person availability.** The dependency resolver works in calendar days only. People have no schedules, vacation, or working-hours constraints.

---

## 8. Build Order (Recommended)

| Phase | Subsystems | Deliverable |
|---|---|---|
| 1 | S1 + S2 | Load/save a JSON file; palette and schema types defined |
| 2 | S3 + S4 | Task tree, worklog aggregation, snapshots rebuild; conflict states computed |
| 3 | S6 + S9 | Sidebar list renders from real data; toolbar wires up (Gantt + List only) |
| 4 | S5 (basic) | Canvas renders colored bars with three-layer progress fill, aligned to sidebar |
| 5 | S5 (labels) | Sticky monospace labels with overflow/abbreviation logic |
| 6 | S7 | Edit drawer saves back to state, re-renders; color picker included |
| 7 | S8 | Work log entry dialog and CSV import |
| 8 | S4 + S5 (deps) | Dependency arrows, ghost bars, conflict recoloring, critical path |
| 9 | Polish | Filters, sort, zoom levels, keyboard shortcuts, CSV export |
