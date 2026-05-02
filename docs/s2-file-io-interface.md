# S2 — File I/O & Storage Adapter · Interface Contract

> Gantt.IO subsystem S2. Handles loading, saving, and validating project files (JSON) and work logs (JSON/CSV).
> **Dependencies**: S1 (schema/types).
> **Used by**: All other subsystems (via S1 imports).

---

## Files

```
src/s2-file/
  errors.ts         ← Custom error classes (InvalidFileError, SchemaValidationError, ParseError)
  adapters.ts       ← Storage adapters (JSON, CSV)
  file_loader.ts    ← Load project/worklog files from disk
  file_saver.ts     ← Save project/worklog files to disk
  file_validator.ts ← Validate file structure against S1 schema
  index.ts          ← Module exports
```

---

## Core Responsibilities

### 1. **File Loading**
- **Input**: `File` object (from browser file picker or drag-and-drop).
- **Output**: Parsed and validated `Project` or `WorkEntry[]` (as S1 types).
- **Behavior**:
  - For project files: Parse JSON → validate against S1 schema → return `Project`.
  - For work logs: Parse JSON/CSV → validate structure → return `WorkEntry[]`.
  - Throw descriptive errors for:
    - Invalid JSON/CSV syntax (`ParseError`).
    - Missing required fields or type mismatches (`SchemaValidationError`).
  - Uses `FileReader` API for browser compatibility.

### 2. **File Saving**
- **Input**: `Project` or `WorkEntry[]` (from S3/S4 or S8).
- **Output**: File saved to user-selected path (or auto-save to last path).
- **Behavior**:
  - Project files: Serialize to pretty-printed JSON (2-space indent).
  - Work logs: Serialize to JSON or CSV (user choice).
  - In browser: Triggers download dialog via `Blob` and `URL.createObjectURL`.
  - Overwrite confirmation handled by browser's save dialog.

### 3. **Storage Adapters**
- **JSON Adapter**:
  - Default for project files and work logs.
  - Uses browser-native `JSON.parse`/`JSON.stringify`.
- **CSV Adapter** (Work Logs Only):
  - Schema: `id, date, hours, person_id, task_id, note?`
  - Handles:
    - CSV → `WorkEntry[]` (load).
    - `WorkEntry[]` → CSV (save).
  - **`id` field handling**:
    - On **save**: the `WorkEntry.id` is written as-is to the `id` column.
    - On **load**: if the `id` column is present and non-empty, it is used directly. If the column is absent or the cell is empty, a fresh UUID v4 is generated for that row. This means CSV round-trips are **ID-stable** when exported from this app, but **ID-generative** when importing hand-authored CSVs.
  - Properly escapes fields containing commas, quotes, or newlines.
  - Handles quoted values and escaped quotes (`""` → `"`).

### 4. **Validation**
- **Project Files**:
  - Wraps S1's `validateProject` (which never throws; returns `ValidationResult<Project>`).
  - On `ok: false`, collects `ValidationError[]` from S1 and re-throws a single `SchemaValidationError` with a concatenated message listing all field-level failures.
  - Verify `parent_id` and `people_ids` references exist (also enforced by S1's cross-entity rules).
- **Work Logs**:
  - Wraps S1's `validateWorkEntry` per entry.
  - Check `date` is ISO 8601 (`YYYY-MM-DD`).
  - Check `hours` is a positive number.
  - Check `person_id` and `task_id` exist in the loaded project (if project context is provided).
- **Cross-Validation**: When project context is provided, validates that all `person_id` and `task_id` references exist in the project.

> **Note on S1 validator contract**: S1 validators never throw — they return `ValidationResult<T>`.
> S2's `FileValidator` is an intentional higher-level wrapper: it calls S1 validators, then converts
> any `ok: false` result into a thrown `SchemaValidationError` for UI surfacing. Implementers should
> not call S1 validators directly from S2 — always go through `FileValidator`.

---

## Interfaces

### Custom Errors
```typescript
class InvalidFileError extends Error {
  constructor(message: string) { ... }
}

class SchemaValidationError extends InvalidFileError {
  // `field` mirrors S1's ValidationError.field; may be a comma-joined list when
  // multiple S1 errors are collapsed into a single throw.
  constructor(message: string, public field?: string) { ... }
}

class ParseError extends InvalidFileError { ... }
```

### FileLoader
```typescript
const FileLoader = {
  loadProjectFile(file: File): Promise<Project>;
  loadWorkLogFile(file: File, format: 'json' | 'csv'): Promise<WorkEntry[]>;
};
```

### FileSaver
```typescript
const FileSaver = {
  saveProjectFile(project: Project, filePath?: string): Promise<void>;
  saveWorkLogFile(entries: WorkEntry[], filePath?: string, format: 'json' | 'csv'): Promise<void>;
};
```

### FileValidator
```typescript
const FileValidator = {
  // Internally calls S1's validateProject. Throws SchemaValidationError on failure.
  validateProject(data: unknown): Project;

  // Internally calls S1's validateWorkEntry per entry. Throws SchemaValidationError on failure.
  // Pass `project` to enable cross-validation of person_id / task_id references.
  validateWorkLog(data: unknown, project?: Project): WorkEntry[];
};
```

### CsvAdapter
```typescript
const CsvAdapter = {
  // Parses CSV string into WorkEntry[].
  // If a row's `id` cell is absent or empty, generates a UUID v4 for that entry.
  csvToWorkLog(csv: string): WorkEntry[];

  // Serialises WorkEntry[] to CSV string, including the `id` column.
  workLogToCsv(entries: WorkEntry[]): string;
};
```

---

## CSV Column Schema

| Column      | Type     | Required | Notes                                                  |
|-------------|----------|----------|--------------------------------------------------------|
| `id`        | string   | No*      | UUID. Generated at load time if absent or empty.       |
| `date`      | string   | Yes      | ISO 8601 `YYYY-MM-DD`                                  |
| `hours`     | number   | Yes      | Positive, non-zero                                     |
| `person_id` | string   | Yes      | Must match a `Person.id` if project context provided   |
| `task_id`   | string   | Yes      | Must match a `Task.id` if project context provided     |
| `note`      | string   | No       | Free text; escaped if it contains commas/quotes/newlines |

\* Strongly recommended in exported files; optional only for hand-authored imports.

---

## Error Handling
- **Custom Errors**:
  - `InvalidFileError`: Base class for all file-related errors.
  - `SchemaValidationError`: Includes field-level details for validation failures. When wrapping multiple S1 `ValidationError` entries, the `field` property contains a comma-joined list (e.g. `"tasks[2].parent_id, tasks[2].end_date"`).
  - `ParseError`: For malformed JSON/CSV.
- **User Feedback**:
  - Surface errors in the UI (e.g. `"Invalid end_date in Task #123: expected YYYY-MM-DD"`).
  - All errors include descriptive messages for debugging.

---

## Dependencies
- **S1**: Uses `Project`, `Task`, `Person`, `WorkEntry`, `Dependency`, and other types/validators from `../s1-schema/types` and `../s1-schema/validators`.

---

## Notes
- **No State Management**: S2 is stateless. It does not track open files or modifications.
- **Browser Constraints**: Uses browser APIs (`FileReader`, `Blob`, `URL.createObjectURL`).
- **Future-Proofing**: Adapters can be extended for other formats (e.g. XML) or backends (e.g. database).
- **Type Note**: Uses `WorkEntry` from S1 (not `WorkLogEntry` as originally documented).
- **CSV ID round-trip**: Exporting then re-importing a work log via CSV is ID-stable. Hand-authored CSVs that omit the `id` column will have IDs generated on import; these IDs are not reproducible across separate imports of the same file.
