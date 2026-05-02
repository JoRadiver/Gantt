/**
 * S1 — Schema & Validation — tests
 * Run with: npx tsx s1-schema/s1_test.ts
 */

import { validateTask, validatePerson, validateDependency, validateWorkEntry, validateProject } from "../src/s1-schema/validators";
import { defaultTask, defaultPerson, defaultDependency, defaultWorkEntry } from "../src/s1-schema/defaults";
import { PALETTE, getColorStop, getColorStops, CONFLICT_ERROR_COLOR } from "../src/s1-schema/palette";

// ── Minimal test harness ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function expect(value: unknown) {
  return {
    toBe(expected: unknown) {
      if (value !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    },
    toEqual(expected: unknown) {
      const a = JSON.stringify(value);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
    },
    toBeTruthy() {
      if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`);
    },
    toBeFalsy() {
      if (value) throw new Error(`Expected falsy, got ${JSON.stringify(value)}`);
    },
    toContain(sub: string) {
      if (typeof value !== "string" || !value.includes(sub))
        throw new Error(`Expected "${value}" to contain "${sub}"`);
    },
  };
}

// ── defaultPerson ─────────────────────────────────────────────────────────────

console.log("\ndefaultPerson");

test("generates initials from name", () => {
  const p = defaultPerson({ id: "p1", name: "Jane Doe" });
  expect(p.initials).toBe("JD");
});

test("caps initials at 2 chars", () => {
  const p = defaultPerson({ id: "p1", name: "Alice Bob Charlie" });
  expect(p.initials).toBe("AB");
});

test("overrides are applied", () => {
  const p = defaultPerson({ id: "p1", name: "Jane Doe", role: "dev", color: "green" });
  expect(p.role).toBe("dev");
  expect(p.color).toBe("green");
});

// ── defaultTask ───────────────────────────────────────────────────────────────

console.log("\ndefaultTask");

test("creates a task with defaults", () => {
  const t = defaultTask({ id: "t1", title: "First task" });
  expect(t.type).toBe("task");
  expect(t.prio).toBe("normal");
  expect(t.conflict_state).toBe("none");
  expect(t.completion_manual).toBe(null);
  expect(t.parent_id).toBe(null);
});

test("milestone invariants are enforced even if overridden", () => {
  const m = defaultTask({ id: "m1", title: "Go-live", type: "milestone", estimated_hours: 99 });
  expect(m.estimated_hours).toBe(0);
  expect(m.end_date).toBe(m.start_date);
  expect(m.end_date_is_flexible).toBe(false);
});

test("overrides win for non-invariant fields", () => {
  const t = defaultTask({ id: "t1", title: "X", prio: "critical", color: "teal" });
  expect(t.prio).toBe("critical");
  expect(t.color).toBe("teal");
});

// ── defaultDependency ─────────────────────────────────────────────────────────

console.log("\ndefaultDependency");

test("defaults to finish_to_start with 0 lag", () => {
  const d = defaultDependency({ id: "d1", from_task_id: "t1", to_task_id: "t2" });
  expect(d.rule).toBe("finish_to_start");
  expect(d.lag_days).toBe(0);
});

// ── defaultWorkEntry ──────────────────────────────────────────────────────────

console.log("\ndefaultWorkEntry");

test("defaults to today with no note", () => {
  const e = defaultWorkEntry({ id: "w1", person_id: "p1", task_id: "t1", hours: 3 });
  expect(typeof e.date).toBe("string");
  expect(e.date).toBe(new Date().toISOString().slice(0, 10));
  expect(e.note).toBe(undefined);
});

// ── validatePerson ────────────────────────────────────────────────────────────

console.log("\nvalidatePerson");

test("accepts a valid person", () => {
  const p = defaultPerson({ id: "p1", name: "Jane Doe" });
  const r = validatePerson(p);
  expect(r.ok).toBeTruthy();
});

test("rejects empty id", () => {
  const r = validatePerson({ ...defaultPerson({ id: "x", name: "A" }), id: "" });
  expect(r.ok).toBeFalsy();
  if (!r.ok) expect(r.errors[0].field).toBe("id");
});

test("rejects initials > 2 chars", () => {
  const r = validatePerson({ ...defaultPerson({ id: "p1", name: "A" }), initials: "ABC" });
  expect(r.ok).toBeFalsy();
});

test("rejects unknown palette key", () => {
  const r = validatePerson({ ...defaultPerson({ id: "p1", name: "A" }), color: "pink" });
  expect(r.ok).toBeFalsy();
});

// ── validateTask ──────────────────────────────────────────────────────────────

console.log("\nvalidateTask");

test("accepts a valid task", () => {
  const t = defaultTask({ id: "t1", title: "Write tests" });
  const r = validateTask(t);
  expect(r.ok).toBeTruthy();
});

test("rejects end_date before start_date", () => {
  const t = defaultTask({ id: "t1", title: "X", start_date: "2025-06-10", end_date: "2025-06-01" });
  const r = validateTask(t);
  expect(r.ok).toBeFalsy();
  if (!r.ok) {
    const fields = r.errors.map((e) => e.field);
    expect(fields.join(",")).toContain("end_date");
  }
});

test("rejects milestone with estimated_hours > 0", () => {
  const t = defaultTask({ id: "m1", title: "M", type: "milestone" });
  const bad = { ...t, estimated_hours: 5 };
  const r = validateTask(bad);
  expect(r.ok).toBeFalsy();
});

test("rejects milestone with end_date != start_date", () => {
  const t = defaultTask({ id: "m1", title: "M", type: "milestone" });
  const bad = { ...t, end_date: "2099-01-01" };
  const r = validateTask(bad);
  expect(r.ok).toBeFalsy();
});

test("accepts null color (inherit)", () => {
  const t = defaultTask({ id: "t1", title: "X", color: null });
  expect(validateTask(t).ok).toBeTruthy();
});

test("rejects invalid completion_derived", () => {
  const t = { ...defaultTask({ id: "t1", title: "X" }), completion_derived: 1.5 };
  expect(validateTask(t).ok).toBeFalsy();
});

test("rejects non-integer end_date_flexibility_range", () => {
  const t = { ...defaultTask({ id: "t1", title: "X" }), end_date_flexibility_range: 2.5 };
  expect(validateTask(t).ok).toBeFalsy();
});

// ── validateDependency ────────────────────────────────────────────────────────

console.log("\nvalidateDependency");

test("accepts a valid dependency", () => {
  const d = defaultDependency({ id: "d1", from_task_id: "t1", to_task_id: "t2" });
  expect(validateDependency(d).ok).toBeTruthy();
});

test("rejects self-referencing dependency", () => {
  const d = defaultDependency({ id: "d1", from_task_id: "t1", to_task_id: "t1" });
  expect(validateDependency(d).ok).toBeFalsy();
});

test("rejects non-integer lag_days", () => {
  const d = { ...defaultDependency({ id: "d1", from_task_id: "t1", to_task_id: "t2" }), lag_days: 1.5 };
  expect(validateDependency(d).ok).toBeFalsy();
});

test("accepts negative lag_days (lead time)", () => {
  const d = { ...defaultDependency({ id: "d1", from_task_id: "t1", to_task_id: "t2" }), lag_days: -2 };
  expect(validateDependency(d).ok).toBeTruthy();
});

// ── validateWorkEntry ─────────────────────────────────────────────────────────

console.log("\nvalidateWorkEntry");

test("accepts a valid work entry", () => {
  const e = defaultWorkEntry({ id: "w1", person_id: "p1", task_id: "t1", hours: 4 });
  expect(validateWorkEntry(e).ok).toBeTruthy();
});

test("rejects hours = 0", () => {
  const e = { ...defaultWorkEntry({ id: "w1", person_id: "p1", task_id: "t1", hours: 4 }), hours: 0 };
  expect(validateWorkEntry(e).ok).toBeFalsy();
});

test("rejects invalid date format", () => {
  const e = { ...defaultWorkEntry({ id: "w1", person_id: "p1", task_id: "t1", hours: 1 }), date: "01-06-2025" };
  expect(validateWorkEntry(e).ok).toBeFalsy();
});

// ── validateProject (cross-entity) ────────────────────────────────────────────

console.log("\nvalidateProject");

const validProject = {
  meta: {
    id: "proj1",
    name: "Test Project",
    description: "",
    created_at: "2025-01-01T00:00:00",
    updated_at: "2025-01-01T00:00:00",
    color: "blue",
  },
  people: [defaultPerson({ id: "p1", name: "Alice" })],
  tasks: [
    defaultTask({ id: "t1", title: "Design", type: "group" }),
    defaultTask({ id: "t2", title: "Wireframes", parent_id: "t1", people_ids: ["p1"] }),
  ],
  dependencies: [
    defaultDependency({ id: "d1", from_task_id: "t1", to_task_id: "t2" }),
  ],
};

test("accepts a valid project", () => {
  expect(validateProject(validProject).ok).toBeTruthy();
});

test("rejects unknown parent_id", () => {
  const bad = {
    ...validProject,
    tasks: [{ ...defaultTask({ id: "t1", title: "X" }), parent_id: "ghost" }],
    dependencies: [],
  };
  expect(validateProject(bad).ok).toBeFalsy();
});

test("rejects parent that is not a group", () => {
  const bad = {
    ...validProject,
    tasks: [
      defaultTask({ id: "t1", title: "Parent task", type: "task" }),
      { ...defaultTask({ id: "t2", title: "Child" }), parent_id: "t1" },
    ],
    dependencies: [],
  };
  expect(validateProject(bad).ok).toBeFalsy();
});

test("rejects dependency referencing unknown task", () => {
  const bad = {
    ...validProject,
    dependencies: [defaultDependency({ id: "d1", from_task_id: "t1", to_task_id: "ghost" })],
  };
  expect(validateProject(bad).ok).toBeFalsy();
});

test("rejects task with unknown person_id", () => {
  const bad = {
    ...validProject,
    tasks: [{ ...defaultTask({ id: "t1", title: "X" }), people_ids: ["ghost_person"] }],
    dependencies: [],
  };
  expect(validateProject(bad).ok).toBeFalsy();
});

test("rejects non-object", () => {
  expect(validateProject("not a project").ok).toBeFalsy();
  expect(validateProject(null).ok).toBeFalsy();
  expect(validateProject(42).ok).toBeFalsy();
});

// ── palette ───────────────────────────────────────────────────────────────────

console.log("\npalette");

test("all 8 palette keys are present", () => {
  const keys = ["green", "blue", "teal", "purple", "amber", "coral", "slate", "orange"];
  for (const k of keys) {
    if (!(k in PALETTE)) throw new Error(`Missing palette key: ${k}`);
  }
});

test("each entry has all three stops", () => {
  for (const [key, entry] of Object.entries(PALETTE)) {
    if (!entry.pastel || !entry.mid || !entry.full)
      throw new Error(`Palette key "${key}" is missing a color stop`);
  }
});

test("getColorStop returns correct value", () => {
  expect(getColorStop("blue", "pastel")).toBe("#dbeafe");
  expect(getColorStop("green", "full")).toBe("#059669");
});

test("getColorStops returns tuple of 3", () => {
  const stops = getColorStops("teal");
  expect(stops.length).toBe(3);
  expect(stops[0]).toBe(PALETTE.teal.pastel);
  expect(stops[2]).toBe(PALETTE.teal.full);
});

test("special renderer colors are defined", () => {
  expect(typeof CONFLICT_ERROR_COLOR).toBe("string");
  expect(CONFLICT_ERROR_COLOR.startsWith("#")).toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
