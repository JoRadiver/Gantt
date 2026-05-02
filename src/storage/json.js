/**
 * Gantt.IO - JSON Storage Implementation
 *
 * Implements the storage/interface.js contract using JSON and the File System Access API.
 * Handles file picker fallbacks and serialization/deserialization of Project and WorkEntry[].
 */

// ============================================================================
// IMPORTS
// ============================================================================
// Import the storage interface functions for type consistency
// (In a real module system, you would import these from storage/interface.js)
/**
 * @typedef {import('./interface.js').Project} Project
 * @typedef {import('./interface.js').WorkEntry} WorkEntry
 */

// ============================================================================
// JSON STORAGE IMPLEMENTATION
// ============================================================================

/**
 * Load a project from a JSON file.
 * @param {FileSystemFileHandle|string} file - File handle or path to load from
 * @returns {Promise<Project|null>} Resolves with the loaded project or null if cancelled
 */
async function loadProject(file) {
  try {
    let fileHandle;
    if (typeof file === 'string') {
      // If a path is provided, use the File System Access API to get a handle
      // This is a placeholder for actual implementation
      fileHandle = await window.showOpenFilePicker({ types: [{ accept: { 'application/json': ['.json'] } }] }).then(handles => handles[0]);
    } else {
      fileHandle = file;
    }

    const fileData = await fileHandle.getFile();
    const text = await fileData.text();
    const project = JSON.parse(text);
    return project;
  } catch (error) {
    console.error('Failed to load project:', error);
    return null;
  }
}

/**
 * Save a project to a JSON file.
 * @param {Project} project - Project to save
 * @param {FileSystemFileHandle|string} file - File handle or path to save to
 * @returns {Promise<void>}
 */
async function saveProject(project, file) {
  try {
    let fileHandle;
    if (typeof file === 'string') {
      // If a path is provided, use the File System Access API to get a handle
      // This is a placeholder for actual implementation
      fileHandle = await window.showSaveFilePicker({ suggestedName: `${project.meta.name || 'project'}.json` }).then(handles => handles);
    } else {
      fileHandle = file;
    }

    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(project, null, 2));
    await writable.close();
  } catch (error) {
    console.error('Failed to save project:', error);
    throw error;
  }
}

/**
 * Load worklog entries from a JSON file.
 * @param {FileSystemFileHandle|string} file - File handle or path to load from
 * @returns {Promise<WorkEntry[]>} Resolves with the loaded worklog entries
 */
async function loadWorklog(file) {
  try {
    let fileHandle;
    if (typeof file === 'string') {
      // If a path is provided, use the File System Access API to get a handle
      // This is a placeholder for actual implementation
      fileHandle = await window.showOpenFilePicker({ types: [{ accept: { 'application/json': ['.json'] } }] }).then(handles => handles[0]);
    } else {
      fileHandle = file;
    }

    const fileData = await fileHandle.getFile();
    const text = await fileData.text();
    const entries = JSON.parse(text);
    return entries;
  } catch (error) {
    console.error('Failed to load worklog:', error);
    return [];
  }
}

/**
 * Save worklog entries to a JSON file.
 * @param {WorkEntry[]} entries - Worklog entries to save
 * @param {FileSystemFileHandle|string} file - File handle or path to save to
 * @returns {Promise<void>}
 */
async function saveWorklog(entries, file) {
  try {
    let fileHandle;
    if (typeof file === 'string') {
      // If a path is provided, use the File System Access API to get a handle
      // This is a placeholder for actual implementation
      fileHandle = await window.showSaveFilePicker({ suggestedName: 'worklog.json' }).then(handles => handles);
    } else {
      fileHandle = file;
    }

    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(entries, null, 2));
    await writable.close();
  } catch (error) {
    console.error('Failed to save worklog:', error);
    throw error;
  }
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
