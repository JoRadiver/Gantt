/**
 * Gantt.IO - Main Application Orchestrator
 *
 * Owns global state, handles file operations, routes events between modules.
 * No business logic, no rendering, no direct DOM manipulation.
 */

// ============================================================================
// IMPORTS
// ============================================================================

import {
  validateTask, validateDependency, validateWorkEntry, validateProject,
  defaultPerson, defaultTask, defaultDependency, defaultWorkEntry,
  getColorStop, getColorStops
} from './core.js';

import {
  getRootTasks, rollupGroup, getChildren,
  computeEarliestStart, getDependencyShift, wouldCreateCycle,
  aggregateByTask, rebuildSnapshots, getDescendants,
  resolveColor, updateGroupDates,
} from './engine.js';

import { loadProject, saveProject, loadWorklog, saveWorklog } from './storage/json.js';

import { initDrawer, updateDrawerForTask, refreshDrawer as _refreshDrawer } from './ui/drawer.js';
import { initSidebar, refreshSidebar as _refreshSidebar, syncScroll } from './ui/sidebar.js';
import { initWorklog, refreshWorklogUI } from './ui/worklog.js';
import { initCanvas, refreshCanvas as _refreshCanvas, setZoom as _setCanvasZoom, syncCanvasScroll } from './ui/canvas.js';

// ============================================================================
// DEFAULT PROJECT FACTORY
// (not in core.js docs — defined here so newProject() works standalone)
// ============================================================================

function createDefaultProject() {
  const today = new Date().toISOString().split('T')[0];
  const end = new Date();
  end.setDate(end.getDate() + 30);
  const endStr = end.toISOString().split('T')[0];

  return {
    meta: {
      id: crypto.randomUUID(),
      name: 'Untitled Project',
      description: '',
      start_date: today,
      end_date: endStr,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      default_task_color: 'green',
      default_milestone_color: 'amber',
      worklog_path: null
    },
    people: [],
    tasks: [],
    dependencies: []
  };
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

export const state = {
  // Project data
  project: createDefaultProject(),
  worklog: [],

  // Selection and view
  selectedTaskId: null,
  viewMode: 'gantt',       // 'gantt' | 'list' | 'board'

  // Canvas state
  zoom: 'week',            // 'day' | 'week' | 'month' | 'quarter'
  scroll: { x: 0, y: 0 },
  collapsedGroups: new Set(),

  // UI state
  isDrawerOpen: false,
  isWorklogOpen: false,

  // Flags
  showBaseline: false,
  showCriticalPath: false,

  // Filter / sort / group
  filterText: '',
  sortBy: null,
  groupBy: null

};

// ============================================================================
// FILE MENU HANDLERS
// ============================================================================

/**
 * Updates all group tasks in the project to encompass their descendants' dates.
 * Call this whenever tasks are added, updated, deleted, or moved.
 */
function updateAllGroupDates() {
  if (!state.project?.tasks) return;
  for (const task of state.project.tasks) {
    if (task.type === 'group') {
      updateGroupDates(task, state.project.tasks);
    }
  }
}

export function newProject() {
  state.project = createDefaultProject();
  state.worklog = [];
  state.selectedTaskId = null;
  state.scroll = { x: 0, y: 0 };
  state.collapsedGroups = new Set();

  refreshAll();
  updateHeader();
}

export async function openProject() {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'Gantt.IO project', accept: { 'application/json': ['.json'] } }]
    });

    const project = await loadProject(fileHandle);
    if (!project) return;

    state.project  = project;
    state.worklog = project.meta.worklog_path ? await loadWorklog(project.meta.worklog_path) : [];
    state.selectedTaskId = null;
    state.scroll   = { x: 0, y: 0 };
    state.collapsedGroups = new Set();
    state.project  = rebuildSnapshots(state.project, state.worklog);

    refreshAll();
    updateHeader();
  } catch (err) {
    // User cancelled the picker — ignore AbortError
    if (err.name !== 'AbortError') showError('Failed to open project: ' + err.message);
  }
}

export async function saveProjectToFile() {
  try {
    if (!state.project) throw new Error('No project loaded');

    const fileHandle = await window.showSaveFilePicker({
      suggestedName: (state.project.meta.name ?? 'project') + '.json',
      types: [{ description: 'Gantt.IO project', accept: { 'application/json': ['.json'] } }]
    });

    state.project.meta.updated_at = new Date().toISOString();
    await saveProject(state.project, fileHandle);
    showSuccess('Project saved');
  } catch (err) {
    if (err.name !== 'AbortError') showError('Failed to save project: ' + err.message);
  }
}

export async function saveWorklogToFile() {
  try {
    if (!state.worklog.length) throw new Error('Worklog is empty');

    const fileHandle = await window.showSaveFilePicker({
      suggestedName: 'worklog.json',
      types: [{ description: 'Gantt.IO worklog', accept: { 'application/json': ['.json'] } }]
    });

    await saveWorklog(state.worklog, fileHandle);
    showSuccess('Worklog saved');
  } catch (err) {
    if (err.name !== 'AbortError') showError('Failed to save worklog: ' + err.message);
  }
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

// In app.js, modify addTask to accept parent_id:
export function addTask(taskData = {}) {
  const task = Object.assign(defaultTask(), taskData);
  if (!validateTask(task)) throw new Error('Invalid task data');

  // If parent_id is provided, validate it exists and is a group
  if (task.parent_id) {
    const parent = state.project.tasks.find(t => t.id === task.parent_id);
    if (!parent || parent.type !== 'group') {
      throw new Error('Parent must be a group task');
    }
  }

  state.project.tasks.push(task);
  updateAllGroupDates();
  state.project = rebuildSnapshots(state.project, state.worklog);
  refreshAll();
  updateStatusBar();
}

export function updateTask(taskId, updates) {
  const idx = state.project.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) throw new Error('Task not found: ' + taskId);

  const updated = { ...state.project.tasks[idx], ...updates };
  if (!validateTask(updated)) throw new Error('Invalid task data');

  state.project.tasks[idx] = updated;
  updateAllGroupDates();
  state.project = rebuildSnapshots(state.project, state.worklog);
  refreshAll();
  updateStatusBar();
}

export function deleteTask(taskId) {
  const idx = state.project.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) throw new Error('Task not found: ' + taskId);

  state.project.tasks.splice(idx, 1);
  // Also prune dependencies that reference this task
  state.project.dependencies = state.project.dependencies.filter(
    d => d.from_task_id !== taskId && d.to_task_id !== taskId
  );

  if (state.selectedTaskId === taskId) state.selectedTaskId = null;
  updateAllGroupDates();
  state.project = rebuildSnapshots(state.project, state.worklog);
  refreshAll();
  updateStatusBar();
}

// ============================================================================
// DEPENDENCY OPERATIONS
// ============================================================================

export function addDependency(dependencyData = {}) {
  const dep = Object.assign(defaultDependency(), dependencyData);
  if (!validateDependency(dep)) throw new Error('Invalid dependency data');

  if (wouldCreateCycle(dep, state.project.dependencies, state.project.tasks)) {
    throw new Error('This dependency would create a cycle');
  }

  state.project.dependencies.push(dep);
  state.project = rebuildSnapshots(state.project, state.worklog);
  refreshAll();
}

export function removeDependency(dependencyId) {
  const idx = state.project.dependencies.findIndex(d => d.id === dependencyId);
  if (idx === -1) throw new Error('Dependency not found: ' + dependencyId);

  state.project.dependencies.splice(idx, 1);
  state.project = rebuildSnapshots(state.project, state.worklog);
  refreshAll();
}

/**
 * Checks if taskA is a descendant of taskB in the task tree.
 */
function isDescendantOf(taskAId, taskBId, tasks) {
  if (taskAId === taskBId) return false;
  let currentId = taskAId;
  while (currentId) {
    const current = tasks.find(t => t.id === currentId);
    if (!current) break;
    if (current.parent_id === taskBId) return true;
    currentId = current.parent_id;
  }
  return false;
}

/**
 * Checks if reparenting taskId to newParentId would create a cycle.
 */
function wouldCreateParentCycle(taskId, newParentId, tasks) {
  if (!newParentId) return false; // Moving to root is safe
  return isDescendantOf(newParentId, taskId, tasks);
}

// ============================================================================
// WORKLOG OPERATIONS
// ============================================================================

export function addWorklogEntry(entryData = {}) {
  const entry = Object.assign(defaultWorkEntry(), entryData);
  if (!validateWorkEntry(entry)) throw new Error('Invalid worklog entry');

  state.worklog.push(entry);
  state.project = rebuildSnapshots(state.project, state.worklog);
  refreshWorklogUI();
  _refreshSidebar(state.project);   // hours_spent may have changed
}

export function deleteWorklogEntry(entryId) {
  const idx = state.worklog.findIndex(e => e.id === entryId);
  if (idx === -1) throw new Error('Worklog entry not found: ' + entryId);

  state.worklog.splice(idx, 1);
  state.project = rebuildSnapshots(state.project, state.worklog);
  refreshWorklogUI();
  _refreshSidebar(state.project);
}

// ============================================================================
// VIEW / ZOOM
// ============================================================================

export function setViewMode(mode) {
  state.viewMode = mode;
  document.querySelectorAll('.view-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  refreshAll();
}

export function setZoom(zoom) {
  state.zoom = zoom;
  document.querySelectorAll('.zoom-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.zoom === zoom);
  });
  const label = document.querySelector('.zoom-level');
  if (label) label.textContent = 'Zoom: ' + zoom.charAt(0).toUpperCase() + zoom.slice(1);
  _setCanvasZoom(zoom);
}

// ============================================================================
// UI REFRESH
// ============================================================================

export function refreshAll() {
  if (!state.project) return;
  _refreshSidebar(state.project);
  _refreshCanvas(state.project, state);
  refreshDrawer();
  refreshWorklogUI();
}

export function refreshSidebar() {
  if (state.project) _refreshSidebar(state.project);
}

export function refreshCanvas() {
  if (state.project) _refreshCanvas(state.project, state);
}

export function refreshDrawer() {
  if (state.project) _refreshDrawer(state.project);
}



// ============================================================================
// STATUS BAR + HEADER
// ============================================================================

function updateHeader() {
  const nameEl = document.querySelector('#project-name-input');
  if (nameEl) nameEl.value = state.project?.meta?.name ?? 'Untitled Project';

  const startDateEl = document.querySelector('#project-start-date');
  const endDateEl = document.querySelector('#project-end-date');
  if (startDateEl) startDateEl.value = state.project?.meta?.start_date ?? '';
  if (endDateEl) endDateEl.value = state.project?.meta?.end_date ?? '';
}

function updateProjectMeta(updates) {
  state.project.meta = { ...state.project.meta, ...updates };
  state.project.meta.updated_at = new Date().toISOString();
  updateHeader();
  refreshAll();
}

function updateStatusBar() {
  if (!state.project) return;

  const tasks    = state.project.tasks.filter(t => t.type === 'task');
  const total    = tasks.length;
  const pct      = total
    ? Math.round(tasks.reduce((s, t) => s + (t.completion ?? 0), 0) / total * 100)
    : 0;

  const countEl = document.querySelector('.task-count');
  const progEl  = document.querySelector('.progress');
  if (countEl) countEl.textContent = total + (total === 1 ? ' task' : ' tasks');
  if (progEl)  progEl.textContent  = pct + '% complete';
}

// ============================================================================
// TOAST HELPERS
// ============================================================================

function showError(message) {
  console.error('[Gantt.IO]', message);
  showToast(message, 'error');
}

function showSuccess(message) {
  console.log('[Gantt.IO]', message);
  showToast(message, 'success');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '1.5rem', right: '1.5rem',
    padding: '0.6rem 1rem', borderRadius: '6px',
    background: type === 'error' ? '#c0392b' : '#27ae60',
    color: '#fff', fontSize: '0.875rem', zIndex: 9999,
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    transition: 'opacity 0.3s'
  });
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
  setTimeout(() => toast.remove(), 2900);
}

// ============================================================================
// SIDEBAR RESIZER
// ============================================================================

function initResizer() {
  const resizer = document.getElementById('resizer');
  const sidebar = document.getElementById('sidebar');
  if (!resizer || !sidebar) return;

  let dragging = false;
  let startX, startWidth;

  resizer.addEventListener('mousedown', e => {
    dragging  = true;
    startX    = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.max(160, Math.min(600, startWidth + (e.clientX - startX)));
    sidebar.style.width = w + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ============================================================================
// WIRE UP WINDOW EVENTS FROM UI MODULES
// ============================================================================

function registerWindowEvents() {
  // Drawer dispatches 'taskUpdated' after user saves a task in the form
  window.addEventListener('taskUpdated', e => {
    const task = e.detail;
    if (!task?.id) return;
    updateTask(task.id, task);
    updateStatusBar();
  });

  // Drawer dispatches 'taskDeleted' after user confirms delete
  window.addEventListener('taskDeleted', e => {
    const taskId = e.detail;
    if (!taskId) return;
    deleteTask(taskId);
  });

  window.addEventListener('taskDissolved', e => {
    const groupId = e.detail;
    if (!groupId) return;

    const group = state.project.tasks.find(t => t.id === groupId);
    if (!group) return;

    // Reparent all direct children to the group's parent
    const children = getChildren(groupId, state.project.tasks);
    children.forEach(child => {
      child.parent_id = group.parent_id;
    });

    // Now delete the group
    deleteTask(groupId);
  });

  // Sidebar dispatches 'taskSelected' when a row is clicked
  window.addEventListener('taskSelected', e => {
    const taskId = e.detail;
    state.selectedTaskId = taskId;
    const task = state.project?.tasks.find(t => t.id === taskId);
    if (task && state.project) updateDrawerForTask(task, state.project);
  });

  // Sidebar dispatches 'sidebarScroll' so canvas stays in sync
  window.addEventListener('sidebarScroll', e => {
    state.scroll.y = e.detail ?? 0;
    syncScroll(state.scroll.y);
    syncCanvasScroll(state.scroll.y);  // <-- Add this line
    _refreshCanvas(state.project, state);
  });

  // Add this alongside the existing sidebarScroll listener
  window.addEventListener('canvasScroll', e => {
    state.scroll.y = e.detail ?? 0;
    syncScroll(state.scroll.y);  // Sync sidebar to canvas
  });

  window.addEventListener('groupToggled', e => {
    // The state is already updated by sidebar, just refresh UI
    refreshSidebar();
    refreshCanvas();
  });

  // Drag and drop event handlers
  window.addEventListener('moveTaskToGroup', e => {
    const { taskId, groupId } = e.detail;
    const task = state.project.tasks.find(t => t.id === taskId);
    const group = state.project.tasks.find(t => t.id === groupId);
    if (!task || !group) {
      console.error('Task or group not found');
      return;
    }
    if (group.type !== 'group') {
      console.error('Target is not a group');
      return;
    }
    if (task.id === group.id) {
      console.error('Cannot move task into itself');
      return;
    }
    if (wouldCreateParentCycle(taskId, groupId, state.project.tasks)) {
      console.error('Cannot create circular hierarchy');
      return;
    }
    task.parent_id = groupId;
    updateAllGroupDates();
    state.project = rebuildSnapshots(state.project, state.worklog);
    refreshAll();
  });

  window.addEventListener('createGroupFromTasks', e => {
    const { taskId1, taskId2 } = e.detail;
    const task1 = state.project.tasks.find(t => t.id === taskId1);
    const task2 = state.project.tasks.find(t => t.id === taskId2);
    if (!task1 || !task2) {
      console.error('One or both tasks not found');
      return;
    }
    if (task1.type === 'group' || task2.type === 'group') {
      console.error('Cannot create group from a group task');
      return;
    }
    if (task1.id === task2.id) {
      console.error('Cannot create group from the same task');
      return;
    }
    if (isDescendantOf(task1.id, task2.id, state.project.tasks) ||
      isDescendantOf(task2.id, task1.id, state.project.tasks)) {
      console.error('Cannot create circular hierarchy');
      return;
    }

    // Group gets the same parent as task2
    const groupParentId = task2.parent_id;

    // Find the original indices of both tasks
    const task1Index = state.project.tasks.findIndex(t => t.id === taskId1);
    const task2Index = state.project.tasks.findIndex(t => t.id === taskId2);

    // Create new group
    const newGroup = {
      id: crypto.randomUUID(),
      type: 'group',
      title: 'Group',
      notes: '',
      parent_id: groupParentId,
      people_ids: [],
      color: null,
      start_date: task1.start_date,
      estimated_hours: 0,
      end_date: task1.end_date,
      end_date_is_flexible: true,
      end_date_flexibility_range: 0,
      end_date_is_last_of_children: false,
      prio: 'normal',
      hours_spent: 0,
      completion_derived: 0,
      completion_manual: null,
      conflict_state: 'none',
    };

    // Remove both tasks from their current positions (higher index first to avoid shifting)
    const indicesToRemove = [task1Index, task2Index].filter(i => i !== -1).sort((a, b) => b - a);
    indicesToRemove.forEach(idx => state.project.tasks.splice(idx, 1));

    // Insert the new group at task2's original position
    state.project.tasks.splice(task2Index, 0, newGroup);

    // Insert both tasks right after the new group (so they appear as children in order)
    state.project.tasks.splice(task2Index + 1, 0, task1, task2);

    // Reparent both tasks to the new group
    task1.parent_id = newGroup.id;
    task2.parent_id = newGroup.id;

    updateAllGroupDates();
    state.project = rebuildSnapshots(state.project, state.worklog);
    refreshAll();
  });

  window.addEventListener('makeSiblingBefore', e => {
    const { taskId, beforeTaskId } = e.detail;
    const task = state.project.tasks.find(t => t.id === taskId);
    const beforeTask = state.project.tasks.find(t => t.id === beforeTaskId);
    if (!task || !beforeTask) {
      console.error('Task or beforeTask not found');
      return;
    }
    if (task.id === beforeTask.id) {
      console.error('Cannot make task sibling of itself');
      return;
    }

    const newParentId = beforeTask.parent_id;
    if (wouldCreateParentCycle(taskId, newParentId, state.project.tasks)) {
      console.error('Cannot create circular hierarchy');
      return;
    }

    // Remove task from current position
    const taskIndex = state.project.tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      state.project.tasks.splice(taskIndex, 1);
    }

    // Set new parent
    task.parent_id = newParentId;

    // Insert before beforeTask in the array
    const beforeIndex = state.project.tasks.findIndex(t => t.id === beforeTaskId);
    if (beforeIndex !== -1) {
      state.project.tasks.splice(beforeIndex, 0, task);
    } else {
      state.project.tasks.push(task);
    }

    updateAllGroupDates();
    state.project = rebuildSnapshots(state.project, state.worklog);
    refreshAll();
  });

  // Worklog dispatches 'worklogEntryAdded'
  window.addEventListener('worklogEntryAdded', e => {
    const entry = e.detail;
    if (!entry?.id) return;
    // Avoid double-push if addWorklogEntry() was the original caller
    if (!state.worklog.find(w => w.id === entry.id)) {
      state.worklog.push(entry);
      state.project = rebuildSnapshots(state.project, state.worklog);
      _refreshSidebar(state.project);
    }
    updateStatusBar();
  });

  // Worklog dispatches 'worklogEntryDeleted'
  window.addEventListener('worklogEntryDeleted', e => {
    const entryId = e.detail;
    const idx = state.worklog.findIndex(w => w.id === entryId);
    if (idx !== -1) {
      state.worklog.splice(idx, 1);
      state.project = rebuildSnapshots(state.project, state.worklog);
      _refreshSidebar(state.project);
    }
  });

  window.addEventListener('taskDeletedWithChildren', e => {
    const taskId = e.detail;
    if (!taskId) return;

    const descendants = getDescendants(taskId, state.project.tasks);
    const allTaskIds = [taskId, ...descendants.map(t => t.id)];

    state.project.tasks = state.project.tasks.filter(t => !allTaskIds.includes(t.id));
    state.project.dependencies = state.project.dependencies.filter(
      d => !allTaskIds.includes(d.from_task_id) && !allTaskIds.includes(d.to_task_id)
    );

    if (state.selectedTaskId && allTaskIds.includes(state.selectedTaskId)) {
      state.selectedTaskId = null;
    }

    updateAllGroupDates();
    state.project = rebuildSnapshots(state.project, state.worklog);
    refreshAll();
    updateStatusBar();
  });
}

// ============================================================================
// DOM WIRING
// ============================================================================

function wireDOMEvents() {
  // File menu
  document.getElementById('new-project-btn')?.addEventListener('click', newProject);
  document.getElementById('open-project-btn')?.addEventListener('click', openProject);
  document.getElementById('save-project-btn')?.addEventListener('click', saveProjectToFile);

  // Add task
  document.getElementById('add-task-btn')?.addEventListener('click', () => {
    if (!state.project) { showError('Open or create a project first'); return; }
    addTask();
  });

  // Close drawer
  document.getElementById('close-drawer-btn')?.addEventListener('click', () => {
    document.getElementById('drawer')?.classList.remove('open');
    state.isDrawerOpen = false;
  });

  // Close worklog
  document.getElementById('close-worklog-btn')?.addEventListener('click', () => {
    document.getElementById('worklog-panel')?.classList.remove('open');
    state.isWorklogOpen = false;
  });

  // View switcher
  document.querySelectorAll('.view-button').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  // Zoom controls
  document.querySelectorAll('.zoom-button').forEach(btn => {
    btn.addEventListener('click', () => setZoom(btn.dataset.zoom));
  });

  // Toggles
  document.getElementById('baseline-toggle')?.addEventListener('change', e => {
    state.showBaseline = e.target.checked;
    refreshCanvas();
  });

  document.getElementById('critical-path-toggle')?.addEventListener('change', e => {
    state.showCriticalPath = e.target.checked;
    refreshCanvas();
  });

  // Search / filter
  document.querySelector('.search-box')?.addEventListener('input', e => {
    state.filterText = e.target.value.trim();
    refreshSidebar();
    refreshCanvas();
  });

  // Project meta editing
  document.getElementById('project-name-input')?.addEventListener('input', e => {
    updateProjectMeta({ name: e.target.value });
  });

  document.getElementById('project-start-date')?.addEventListener('change', e => {
    updateProjectMeta({ start_date: e.target.value });
  });

  document.getElementById('project-end-date')?.addEventListener('change', e => {
    updateProjectMeta({ end_date: e.target.value });
  });

  document.querySelector('.edit-icon')?.addEventListener('click', () => {
    document.getElementById('project-name-input')?.focus();
  });
}

// ============================================================================
// BOOT
// ============================================================================

// 3. Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
  // 4. Get DOM elements
  const drawerEl = document.getElementById('drawer');
  const sidebarEl = document.getElementById('sidebar');
  const worklogEl = document.getElementById('worklog-content');
  const canvasEl = document.getElementById('canvas');

  // 5. Initialize modules with state
  if (drawerEl)  initDrawer(drawerEl, state);
  if (sidebarEl) initSidebar(sidebarEl, state);
  if (worklogEl) initWorklog(worklogEl, state);
  if (canvasEl)  initCanvas(canvasEl, state);

  wireDOMEvents();
  registerWindowEvents();
  refreshAll();
  updateHeader();
});
