// ts/s2-storage/s2_test.ts

import {
  CsvAdapter,
  FileValidator,
  InvalidFileError,
  SchemaValidationError,
  ParseError
} from '../src/s2-storage';
import type { Project, WorkEntry } from '../src/s1-schema/types';

// ===== TEST DATA =====
const validEntries: WorkEntry[] = [
  { id: '1', date: '2026-01-01', hours: 8, person_id: 'p1', task_id: 't1', note: 'Test' }
];

const validProject: Project = {
  meta: { id: '1', name: 'Test', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', color: 'blue' },
  people: [{ id: 'p1', name: 'P1', initials: 'P', color: 'green', role: 'Dev' }],
  tasks: [{
    id: 't1', type: 'task', title: 'Task', notes: '', parent_id: null, people_ids: ['p1'], color: null,
    start_date: '2026-01-01', estimated_hours: 10, end_date: '2026-01-10',
    end_date_is_flexible: false, end_date_flexibility_range: 0, end_date_is_last_of_children: false,
    prio: 'normal', hours_spent: 0, completion_derived: 0, completion_manual: null, conflict_state: 'none'
  }],
  dependencies: []
};

// ===== RUN TESTS =====
function runTests() {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`✗ ${name}`);
      console.error(`  ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  };

  // CSV Adapter Tests
  test('CSV: Parse valid CSV', () => {
    const csv = 'date,hours,person_id,task_id,note\n2026-01-01,8,p1,t1,Test';
    const result = CsvAdapter.csvToWorkLog(csv);
    if (result.length !== 1) throw new Error('Expected 1 entry');
    if (result[0].hours !== 8) throw new Error('Hours mismatch');
  });

  test('CSV: Parse quoted fields', () => {
    const csv = 'date,hours,person_id,task_id,note\n2026-01-01,8,p1,t1,"Note, with comma"';
    const result = CsvAdapter.csvToWorkLog(csv);
    if (result[0].note !== 'Note, with comma') throw new Error('Quoted field failed');
  });

  test('CSV: Generate CSV', () => {
    const csv = CsvAdapter.workLogToCsv(validEntries);
    if (!csv.includes('2026-01-01,8,p1,t1,"Test"')) throw new Error('CSV generation failed');
  });

  // FileValidator Tests
  test('Validator: Validate work entries', () => {
    const result = FileValidator.validateWorkLog(validEntries);
    if (result.length !== 1) throw new Error('Validation failed');
  });

  test('Validator: Validate with project context', () => {
    const result = FileValidator.validateWorkLog(validEntries, validProject);
    if (result.length !== 1) throw new Error('Context validation failed');
  });

  test('Validator: Reject invalid person_id', () => {
    const invalid = [{ ...validEntries[0], person_id: 'invalid' }];
    try {
      FileValidator.validateWorkLog(invalid, validProject);
      throw new Error('Should have thrown');
    } catch (e) {
      if (!(e instanceof SchemaValidationError)) throw e;
    }
  });

  // Error Tests
  test('CSV: Throw on missing headers', () => {
    try {
      CsvAdapter.csvToWorkLog('date,hours\n2026-01-01,8');
      throw new Error('Should have thrown');
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
    }
  });

  test('CSV: Throw on invalid hours', () => {
    try {
      CsvAdapter.csvToWorkLog('date,hours,person_id,task_id\n2026-01-01,abc,p1,t1');
      throw new Error('Should have thrown');
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Run and exit with code
runTests()

