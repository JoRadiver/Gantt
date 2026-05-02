/**
 * Gantt.IO - Sidebar UI Module
 *
 * Renders the task list as a tree with indent levels, handles row selection,
 * collapse/expand for groups, and scroll synchronization with the canvas.
 * Implements virtualization for performance.
 */

// ============================================================================
// TYPES
// ============================================================================
/**
 * @typedef {import('../core.js').Task} Task
 * @typedef {import('../core.js').Project} Project
 * @typedef {import('../core.js').PaletteKey} PaletteKey
 */

// ============================================================================
// STATE
// ============================================================================
let sidebarElement = null;
let selectedTaskId = null;
let tasks = [];
let collapsedGroups = new Set();
let visibleTasks = [];
let scrollTop = 0;
const ROW_HEIGHT = 32; // Fixed height for virtualization

// ============================================================================
// DOM HELPERS
// ============================================================================

/**
 * Creates a DOM element for a task row.
 * @param {Task} task - The task to render.
 * @param {number} indentLevel - Indent level for tree hierarchy.
 * @returns {HTMLElement} The task row element.
 */
function createTaskRow(task, indentLevel) {
  const row = document.createElement('div');
  row.className = 'sidebar-row';
  row.dataset.taskId = task.id;
  row.style.height = `${ROW_HEIGHT}px`;
  row.style.paddingLeft = `${indentLevel * 20}px`;

  // Type badge
  const typeBadge = document.createElement('span');
  typeBadge.className = `task-type-badge ${task.type}`;
  typeBadge.textContent = task.type;
  row.appendChild(typeBadge);

  // Title
  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = task.title;
  row.appendChild(titleSpan);

  // Completion mini-bar
  const completionBar = document.createElement('div');
  completionBar.className = 'completion-bar';
  completionBar.style.width = `${(task.completion_derived || 0) * 100}%`;
  row.appendChild(completionBar);

  // Estimated hours
  const hoursSpan = document.createElement('span');
  hoursSpan.className = 'task-hours';
  hoursSpan.textContent = task.estimated_hours;
  row.appendChild(hoursSpan);

  // People pips
  const peopleDiv = document.createElement('div');
  peopleDiv.className = 'task-people';
  task.people_ids?.forEach(personId => {
    const pip = document.createElement('span');
    pip.className = 'person-pip';
    pip.style.backgroundColor = `var(--color-${task.color || 'slate'})`;
    peopleDiv.appendChild(pip);
  });
  row.appendChild(peopleDiv);

  // Collapse/expand toggle for groups
  if (task.type === 'group') {
    const toggle = document.createElement('button');
    toggle.className = 'group-toggle';
    toggle.textContent = collapsedGroups.has(task.id) ? '▶' : '▼';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      onGroupToggled(task.id);
    });
    row.prepend(toggle);
  }

  // Selection state
  if (task.id === selectedTaskId) {
    row.classList.add('selected');
  }

  // Click handler for row selection
  row.addEventListener('click', () => onTaskSelected(task.id));

  return row;
}

// ============================================================================
// VIRTUALIZATION
// ============================================================================

/**
 * Updates the visible tasks based on the current scroll position.
 */
function updateVisibleTasks() {
  const startIdx = Math.floor(scrollTop / ROW_HEIGHT);
  const endIdx = startIdx + Math.ceil(sidebarElement.clientHeight / ROW_HEIGHT) + 2;
  visibleTasks = tasks.slice(startIdx, endIdx);

  // Render only visible tasks
  sidebarElement.innerHTML = '';
  visibleTasks.forEach(task => {
    const indentLevel = getIndentLevel(task, tasks);
    if (!isTaskVisible(task)) return;
    const row = createTaskRow(task, indentLevel);
    sidebarElement.appendChild(row);
  });
}

/**
 * Checks if a task is visible (not collapsed under a group).
 * @param {Task} task - The task to check.
 * @returns {boolean} True if the task is visible.
 */
function isTaskVisible(task) {
  if (task.type !== 'group') return true;
  return !collapsedGroups.has(task.id);
}

/**
 * Gets the indent level for a task based on its hierarchy.
 * @param {Task} task - The task.
 * @param {Task[]} allTasks - All tasks in the project.
 * @returns {number} Indent level.
 */
function getIndentLevel(task, allTasks) {
  if (!task.parent_id) return 0;
  let level = 1;
  let parent = allTasks.find(t => t.id === task.parent_id);
  while (parent?.parent_id) {
    level++;
    parent = allTasks.find(t => t.id === parent.parent_id);
  }
  return level;
}

// ============================================================================
// SCROLL SYNC
// ============================================================================

/**
 * Syncs the scroll position with the canvas.
 * @param {number} newScrollTop - The new scroll position.
 */
function syncScroll(newScrollTop) {
  scrollTop = newScrollTop;
  sidebarElement.scrollTop = scrollTop;
  updateVisibleTasks();
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Initializes the sidebar UI module.
 * @param {HTMLElement} element - The DOM element for the sidebar.
 */
function initSidebar(element) {
  sidebarElement = element;
  sidebarElement.className = 'sidebar';
  sidebarElement.style.overflowY = 'auto';
  sidebarElement.addEventListener('scroll', () => {
    scrollTop = sidebarElement.scrollTop;
    // Emit scroll event to canvas for sync
    window.dispatchEvent(new CustomEvent('sidebarScroll', { detail: scrollTop }));
  });
}

/**
 * Renders the task list as a tree.
 * @param {Project} project - The project data containing tasks.
 */
function refreshSidebar(project) {
  tasks = project.tasks || [];
  collapsedGroups.clear(); // Reset collapsed state on refresh
  updateVisibleTasks();
}

/**
 * Handles selection of a task in the sidebar.
 * @param {string} taskId - The ID of the selected task.
 */
function onTaskSelected(taskId) {
  selectedTaskId = taskId;
  updateVisibleTasks(); // Re-render to update selection state
  // Emit event to notify other modules (e.g., drawer, canvas)
  window.dispatchEvent(new CustomEvent('taskSelected', { detail: taskId }));
}

/**
 * Toggles the collapsed/expanded state of a group.
 * @param {string} taskId - The ID of the group task.
 */
function onGroupToggled(taskId) {
  if (collapsedGroups.has(taskId)) {
    collapsedGroups.delete(taskId);
  } else {
    collapsedGroups.add(taskId);
  }
  updateVisibleTasks();
}

// ============================================================================
// EXPORTS
// ============================================================================
export {
  initSidebar,
  refreshSidebar,
  onTaskSelected,
  onGroupToggled,
  syncScroll
};
