# S1 — Schema & Validation · Interface Contract

> Gantt.IO subsystem S1. Every other subsystem imports from here.
> No dependencies on any other subsystem. No rendering, no I/O, no business logic.

---

## Files

```
src/s1-schema/
  types.ts       ← all canonical types & enums
  validators.ts  ← validation functions
  defaults.ts    ← factory functions
  palette.ts     ← color definitions
```

---

## types.ts

### Enums (string union types)

```ts
type TaskType       = "task" | "group" | "milestone"
type DependencyRule = "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish"
type Priority       = "critical" | "high" | "normal" | "low"
type ConflictState  = "none" | "warning" | "error"
type PaletteKey     = "green" | "blue" | "teal" | "purple" | "amber" | "coral" | "slate" | "orange"
```

### Entities

```ts
interface Person {
  id: string
  name: string
  initials: string        // max 2 chars
  color: PaletteKey
  role: string
  email?: string
}

interface Task {
  // identity
  id: string
  type: TaskType
  title: string
  notes: string

  // hierarchy
  parent_id: string | null   // null = root; parent must be type "group"

  // assignment
  people_ids: string[]

  // appearance
  color: PaletteKey | null   // null = inherit from parent chain

  // scheduling (user-entered)
  start_date: string                  // ISO 8601 "YYYY-MM-DD"
  estimated_hours: number             // 0 for milestones
  end_date: string                    // ISO 8601; equals start_date for milestones
  end_date_is_flexible: boolean
  end_date_flexibility_range: number  // calendar days, non-negative integer
  end_date_is_last_of_children: boolean  // groups only

  // priority
  prio: Priority

  // snapshot cache — recomputed from worklog on load, NOT ground truth
  hours_spent: number
  completion_derived: number       // 0.0–1.0, capped at 0.99 until closed
  completion_manual: number | null // 0.0–1.0 user override, or null
  conflict_state: ConflictState    // written by S4, read by S5
}

interface Dependency {
  id: string
  from_task_id: string
  to_task_id: string          // must differ from from_task_id
  rule: DependencyRule
  lag_days: number            // signed integer; negative = lead time
}

interface WorkEntry {
  id: string
  date: string                // ISO 8601 "YYYY-MM-DD"
  hours: number               // positive, non-zero
  person_id: string
  task_id: string
  note?: string
}

interface ProjectMeta {
  id: string
  name: string
  description: string
  created_at: string          // ISO 8601 datetime
  updated_at: string          // ISO 8601 datetime
  color: PaletteKey           // project-level default, used when no task color resolves
  worklog_path?: string       // optional reference to external worklog file
}

interface Project {
  meta: ProjectMeta
  people: Person[]
  tasks: Task[]
  dependencies: Dependency[]
}
```

---

## validators.ts

### Result type

```ts
interface ValidationError {
  field: string    // e.g. "end_date", "tasks[2].parent_id"
  message: string
}

type ValidationResult<T> =
  | { ok: true;  value: T }
  | { ok: false; errors: ValidationError[] }
```

Never throws. Always returns a typed result.

### Functions

```ts
validatePerson(obj: unknown):     ValidationResult<Person>
validateTask(obj: unknown):       ValidationResult<Task>
validateDependency(obj: unknown): ValidationResult<Dependency>
validateWorkEntry(obj: unknown):  ValidationResult<WorkEntry>
validateProject(obj: unknown):    ValidationResult<Project>
```

`validateProject` also enforces cross-entity rules:
- `task.parent_id` must reference an existing task of type `"group"`
- `task.people_ids` entries must reference existing person ids
- `dependency.from_task_id` / `to_task_id` must reference existing task ids
- Milestones must have `estimated_hours === 0` and `end_date === start_date`

---

## defaults.ts

Factory functions. All return fully valid objects. Callers supply required fields; the rest get sensible defaults.

```ts
// Defaults: type "task", prio "normal", color null, all snapshot fields zero/null, conflict_state "none"
// Milestone invariants (hours=0, end=start, no flex) are enforced even if overridden.
defaultTask(overrides: Partial<Task> & { id: string; title: string }): Task

// Initials auto-derived from name (first letter of each word, max 2) if not supplied.
defaultPerson(overrides: Partial<Person> & { id: string; name: string }): Person

// Defaults: rule "finish_to_start", lag_days 0
defaultDependency(overrides: Partial<Dependency> & { id: string; from_task_id: string; to_task_id: string }): Dependency

// Defaults: date today (ISO), no note
defaultWorkEntry(overrides: Partial<WorkEntry> & { id: string; person_id: string; task_id: string; hours: number }): WorkEntry
```

---

## palette.ts

### Types

```ts
type ColorStop   = "pastel" | "mid" | "full"
type PaletteEntry = Record<ColorStop, string>   // CSS hex strings
type Palette      = Record<PaletteKey, PaletteEntry>
```

### Color stops per key

| Key    | pastel    | mid       | full      |
|--------|-----------|-----------|-----------|
| green  | `#d1fae5` | `#34d399` | `#059669` |
| blue   | `#dbeafe` | `#60a5fa` | `#2563eb` |
| teal   | `#ccfbf1` | `#2dd4bf` | `#0d9488` |
| purple | `#ede9fe` | `#a78bfa` | `#7c3aed` |
| amber  | `#fef3c7` | `#fbbf24` | `#d97706` |
| coral  | `#fee2e2` | `#f87171` | `#dc2626` |
| slate  | `#f1f5f9` | `#94a3b8` | `#475569` |
| orange | `#ffedd5` | `#fb923c` | `#ea580c` |

`orange` is reserved for milestones. Tasks should not carry `color: "orange"`.

### Special renderer colors (not task colors)

```ts
CONFLICT_WARNING_COLOR  = "#fbbf24"  // amber-400 — conflict within flex range
CONFLICT_ERROR_COLOR    = "#dc2626"  // red-600   — conflict exceeds flex range
TODAY_LINE_COLOR        = "#6366f1"  // indigo-500
DEPENDENCY_ARROW_COLOR  = "#94a3b8"  // slate-400
GROUP_BRACKET_COLOR     = "#1e293b"  // slate-800
```

### Functions

```ts
getColorStop(key: PaletteKey, stop: ColorStop): string
getColorStops(key: PaletteKey): [string, string, string]  // [pastel, mid, full]

const PALETTE: Palette  // full lookup table
```

---

## Key invariants to remember

| Rule | Where enforced |
|---|---|
| Milestones: `estimated_hours === 0`, `end_date === start_date` | `validateTask`, `defaultTask` |
| `parent_id` target must be type `"group"` | `validateProject` |
| `color: null` means inherit — not a missing field | `validateTask` |
| Dates are ISO strings `"YYYY-MM-DD"`, not `Date` objects | throughout |
| Snapshot fields (`hours_spent`, `completion_derived`, `conflict_state`) are cache — not ground truth | by convention |
| `completion_derived` capped at `0.99` — the cap is S3/S4's responsibility, S1 only declares `0.0–1.0` range | validators |
| `orange` palette key exists but is for milestones only at render time | palette |
