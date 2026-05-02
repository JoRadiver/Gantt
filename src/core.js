/**
 * Gantt.IO - Core Types, Validation, and Defaults
 *
 * Defines all types via JSDoc comments, validator functions, default factories,
 * and palette accessor functions. No dependencies on other modules.
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * @typedef {'task' | 'group' | 'milestone'} TaskType
 */

/**
 * @typedef {'finish_to_start' | 'start_to_start'} DependencyRule
 */

/**
 * @typedef {'critical' | 'high' | 'normal' | 'low'} Priority
 */

/**
 * @typedef {'none' | 'warning' | 'error'} ConflictState
 */

/**
 * @typedef {'green' | 'blue' | 'teal' | 'purple' | 'amber' | 'coral' | 'slate' | 'orange'} PaletteKey
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * @typedef {Object} Person
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string} initials - Max 2 chars
 * @property {PaletteKey} color - Color key
 * @property {string} role - Role in the project
 * @property {string} [email] - Optional email
 */

/**
 * @typedef {Object} Task
 * @property {string} id - Unique identifier
 * @property {TaskType} type - Task type
 * @property {string} title - Task title
 * @property {string} notes - Task notes
 * @property {string|null} parent_id - Parent task ID (null for root tasks)
 * @property {string[]} people_ids - IDs of assigned people
 * @property {PaletteKey|null} color - Color key (null for default)
 * @property {string} start_date - ISO 8601 date
 * @property {number} estimated_hours - Estimated hours
 * @property {string} end_date - ISO 8601 date
 * @property {boolean} end_date_is_flexible - Whether end date is flexible
 * @property {number} end_date_flexibility_range - Days of flexibility
 * @property {boolean} end_date_is_last_of_children - Whether end date is last of children
 * @property {Priority} prio - Priority
 * @property {number} hours_spent - Hours spent
 * @property {number} completion_derived - Derived completion (0.0-1.0)
 * @property {number|null} completion_manual - Manual completion (0.0-1.0)
 * @property {ConflictState} conflict_state - Conflict state
 */

/**
 * @typedef {Object} Dependency
 * @property {string} id - Unique identifier
 * @property {string} from_task_id - Source task ID
 * @property {string} to_task_id - Target task ID
 * @property {DependencyRule} rule - Dependency rule
 */

/**
 * @typedef {Object} WorkEntry
 * @property {string} id - Unique identifier
 * @property {string} task_id - Task ID
 * @property {string} person_id - Person ID
 * @property {string} date - ISO 8601 date
 * @property {number} hours - Hours spent
 * @property {string} notes - Notes
 */

/**
 * @typedef {Object} ProjectMeta
 * @property {string} id - Unique identifier
 * @property {string} name - Project name
 * @property {string} description - Project description
 * @property {string} start_date - ISO 8601 date
 * @property {string} end_date - ISO 8601 date
 */

/**
 * @typedef {Object} Project
 * @property {ProjectMeta} meta - Project metadata
 * @property {Person[]} people - List of people
 * @property {Task[]} tasks - List of tasks
 * @property {Dependency[]} dependencies - List of dependencies
 */

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates a Person object.
 * @param {Person} person - The person to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validatePerson(person) {
  if (!person || typeof person !== 'object') return false;
  if (typeof person.id !== 'string' || person.id.trim() === '') return false;
  if (typeof person.name !== 'string' || person.name.trim() === '') return false;
  if (typeof person.initials !== 'string' || person.initials.length > 2) return false;
  if (!['green', 'blue', 'teal', 'purple', 'amber', 'coral', 'slate', 'orange'].includes(person.color)) return false;
  if (typeof person.role !== 'string' || person.role.trim() === '') return false;
  if (person.email && typeof person.email !== 'string') return false;
  return true;
}

/**
 * Validates a Task object.
 * @param {Task} task - The task to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateTask(task) {
  if (!task || typeof task !== 'object') return false;
  if (typeof task.id !== 'string' || task.id.trim() === '') return false;
  if (!['task', 'group', 'milestone'].includes(task.type)) return false;
  if (typeof task.title !== 'string' || task.title.trim() === '') return false;
  if (typeof task.notes !== 'string') return false;
  if (task.parent_id !== null && typeof task.parent_id !== 'string') return false;
  if (!Array.isArray(task.people_ids)) return false;
  if (task.color !== null && !['green', 'blue', 'teal', 'purple', 'amber', 'coral', 'slate', 'orange'].includes(task.color)) return false;
  if (typeof task.start_date !== 'string' || isNaN(new Date(task.start_date).getTime())) return false;
  if (typeof task.estimated_hours !== 'number' || task.estimated_hours < 0) return false;
  if (typeof task.end_date !== 'string' || isNaN(new Date(task.end_date).getTime())) return false;
  if (typeof task.end_date_is_flexible !== 'boolean') return false;
  if (typeof task.end_date_flexibility_range !== 'number' || task.end_date_flexibility_range < 0) return false;
  if (typeof task.end_date_is_last_of_children !== 'boolean') return false;
  if (!['critical', 'high', 'normal', 'low'].includes(task.prio)) return false;
  if (typeof task.hours_spent !== 'number' || task.hours_spent < 0) return false;
  if (typeof task.completion_derived !== 'number' || task.completion_derived < 0 || task.completion_derived > 1) return false;
  if (task.completion_manual !== null && (typeof task.completion_manual !== 'number' || task.completion_manual < 0 || task.completion_manual > 1)) return false;
  if (!['none', 'warning', 'error'].includes(task.conflict_state)) return false;
  return true;
}

/**
 * Validates a Dependency object.
 * @param {Dependency} dependency - The dependency to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateDependency(dependency) {
  if (!dependency || typeof dependency !== 'object') return false;
  if (typeof dependency.id !== 'string' || dependency.id.trim() === '') return false;
  if (typeof dependency.from_task_id !== 'string' || dependency.from_task_id.trim() === '') return false;
  if (typeof dependency.to_task_id !== 'string' || dependency.to_task_id.trim() === '') return false;
  if (!['finish_to_start', 'start_to_start'].includes(dependency.rule)) return false;
  return true;
}

/**
 * Validates a WorkEntry object.
 * @param {WorkEntry} workEntry - The work entry to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateWorkEntry(workEntry) {
  if (!workEntry || typeof workEntry !== 'object') return false;
  if (typeof workEntry.id !== 'string' || workEntry.id.trim() === '') return false;
  if (typeof workEntry.task_id !== 'string' || workEntry.task_id.trim() === '') return false;
  if (typeof workEntry.person_id !== 'string' || workEntry.person_id.trim() === '') return false;
  if (typeof workEntry.date !== 'string' || isNaN(new Date(workEntry.date).getTime())) return false;
  if (typeof workEntry.hours !== 'number' || workEntry.hours < 0) return false;
  if (typeof workEntry.notes !== 'string') return false;
  return true;
}

/**
 * Validates a Project object.
 * @param {Project} project - The project to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateProject(project) {
  if (!project || typeof project !== 'object') return false;
  if (!project.meta || typeof project.meta !== 'object') return false;
  if (!validateProjectMeta(project.meta)) return false;
  if (!Array.isArray(project.people)) return false;
  for (const person of project.people) {
    if (!validatePerson(person)) return false;
  }
  if (!Array.isArray(project.tasks)) return false;
  for (const task of project.tasks) {
    if (!validateTask(task)) return false;
  }
  if (!Array.isArray(project.dependencies)) return false;
  for (const dependency of project.dependencies) {
    if (!validateDependency(dependency)) return false;
  }
  return true;
}

/**
 * Validates a ProjectMeta object.
 * @param {ProjectMeta} meta - The project metadata to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function validateProjectMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (typeof meta.id !== 'string' || meta.id.trim() === '') return false;
  if (typeof meta.name !== 'string' || meta.name.trim() === '') return false;
  if (typeof meta.description !== 'string') return false;
  if (typeof meta.start_date !== 'string' || isNaN(new Date(meta.start_date).getTime())) return false;
  if (typeof meta.end_date !== 'string' || isNaN(new Date(meta.end_date).getTime())) return false;
  return true;
}

// ============================================================================
// DEFAULTS
// ============================================================================

/**
 * Creates a default Person object.
 * @returns {Person} - The default person.
 */
function defaultPerson() {
  return {
    id: crypto.randomUUID(),
    name: 'New Person',
    initials: 'NP',
    color: 'green',
    role: 'Member',
  };
}

/**
 * Creates a default Task object.
 * @returns {Task} - The default task.
 */
function defaultTask() {
  const today = new Date().toISOString().split('T')[0];
  return {
    id: crypto.randomUUID(),
    type: 'task',
    title: 'New Task',
    notes: '',
    parent_id: null,
    people_ids: [],
    color: null,
    start_date: today,
    estimated_hours: 0,
    end_date: today,
    end_date_is_flexible: true,
    end_date_flexibility_range: 0,
    end_date_is_last_of_children: false,
    prio: 'normal',
    hours_spent: 0,
    completion_derived: 0,
    completion_manual: null,
    conflict_state: 'none',
  };
}

/**
 * Creates a default Dependency object.
 * @returns {Dependency} - The default dependency.
 */
function defaultDependency() {
  return {
    id: crypto.randomUUID(),
    from_task_id: '',
    to_task_id: '',
    rule: 'finish_to_start',
  };
}

/**
 * Creates a default WorkEntry object.
 * @returns {WorkEntry} - The default work entry.
 */
function defaultWorkEntry() {
  const today = new Date().toISOString().split('T')[0];
  return {
    id: crypto.randomUUID(),
    task_id: '',
    person_id: '',
    date: today,
    hours: 0,
    notes: '',
  };
}

// ============================================================================
// PALETTE
// ============================================================================

const PALETTE = {
  green: { base: '#3dba74', dim: '#2a8a55' },
  blue: { base: '#5b9cf6', dim: '#3a7bd5' },
  teal: { base: '#20c997', dim: '#17a2b8' },
  purple: { base: '#9f7ef5', dim: '#7c5dfa' },
  amber: { base: '#e8a23a', dim: '#d48b2a' },
  coral: { base: '#ff7180', dim: '#e85d6f' },
  slate: { base: '#6c757d', dim: '#5a6268' },
  orange: { base: '#fd7e14', dim: '#e85d04' },
};

/**
 * Gets a color stop for a given palette key and variant.
 * @param {PaletteKey} key - The palette key.
 * @param {'base' | 'dim'} variant - The color variant.
 * @returns {string} - The color hex code.
 */
function getColorStop(key, variant = 'base') {
  const color = PALETTE[key];
  if (!color) throw new Error(`Invalid palette key: ${key}`);
  if (!['base', 'dim'].includes(variant)) throw new Error(`Invalid variant: ${variant}`);
  return color[variant];
}

/**
 * Gets all color stops for a given palette key.
 * @param {PaletteKey} key - The palette key.
 * @returns {{ base: string, dim: string }} - The color stops.
 */
function getColorStops(key) {
  const color = PALETTE[key];
  if (!color) throw new Error(`Invalid palette key: ${key}`);
  return { base: color.base, dim: color.dim };
}

// Export for use in other modules
export {
    validatePerson,
    validateTask,
    validateDependency,
    validateWorkEntry,
    validateProject,
    defaultPerson,
    defaultTask,
    defaultDependency,
    defaultWorkEntry,
    getColorStop,
    getColorStops,
}
