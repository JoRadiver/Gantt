/**
 * Gantt.IO - Storage API Contract
 *
 * Defines the abstract interface for loading and saving project and worklog data.
 * Implementations (e.g., JSON, localStorage) will provide concrete logic.
 */

// ============================================================================
// STORAGE API CONTRACT
// ============================================================================

/**
 * Load a project from a file.
 * @param {FileSystemFileHandle|string} file - File handle or path to load from
 * @returns {Promise<Project|null>} Resolves with the loaded project or null if cancelled
 */
async function loadProject(file) {
  throw new Error('loadProject: Not implemented. Use storage/json.js for the implementation.');
}

/**
 * Save a project to a file.
 * @param {Project} project - Project to save
 * @param {FileSystemFileHandle|string} file - File handle or path to save to
 * @returns {Promise<void>}
 */
async function saveProject(project, file) {
  throw new Error('saveProject: Not implemented. Use storage/json.js for the implementation.');
}

/**
 * Load worklog entries from a file.
 * @param {FileSystemFileHandle|string} file - File handle or path to load from
 * @returns {Promise<WorkEntry[]>} Resolves with the loaded worklog entries
 */
async function loadWorklog(file) {
  throw new Error('loadWorklog: Not implemented. Use storage/json.js for the implementation.');
}

/**
 * Save worklog entries to a file.
 * @param {WorkEntry[]} entries - Worklog entries to save
 * @param {FileSystemFileHandle|string} file - File handle or path to save to
 * @returns {Promise<void>}
 */
async function saveWorklog(entries, file) {
  throw new Error('saveWorklog: Not implemented. Use storage/json.js for the implementation.');
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export the storage API functions for use in other modules
export {
  loadProject,
  saveProject,
  loadWorklog,
  saveWorklog,
}
