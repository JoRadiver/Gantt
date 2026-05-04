// ============================================================================
// STATE
// ============================================================================
let sidebarElement = null;
let taskListElement = null;
let selectedTaskId = null;
let tasks = [];
let _state = null; // Reference to global app state
// Drag and drop state
let draggedTaskId = null;
let dropTargetId = null;
let dropPosition = null; // 'on' or 'above'

// ============================================================================
// DOM HELPERS
// ============================================================================

/**
 * Gets the indent level for a task based on its parent hierarchy.
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

/**
 * Gets the children of a group task.
 */
function getChildren(parentId, allTasks) {
  return allTasks.filter(t => t.parent_id === parentId);
}

/**
 * Checks if taskA is a descendant of taskB in the task tree.
 */
function isDescendant(taskAId, taskBId, allTasks) {
  if (taskAId === taskBId) return false;
  let currentId = taskAId;
  while (currentId) {
    const current = allTasks.find(t => t.id === currentId);
    if (!current) break;
    if (current.parent_id === taskBId) return true;
    currentId = current.parent_id;
  }
  return false;
}

/**
 * Checks if reparenting would create a cycle.
 */
function wouldCreateDragCycle(draggedTask, targetTask, position) {
  if (!draggedTask || !targetTask) return false;
  if (draggedTask.id === targetTask.id) return true;

  const newParentId = position === 'on' && targetTask.type === 'group'
    ? targetTask.id
    : position === 'above'
      ? targetTask.parent_id
      : null;

  if (!newParentId) return false;
  return isDescendant(newParentId, draggedTask.id, tasks);
}

/**
 * Clears visual drag feedback.
 */
function clearDragFeedback() {
  document.querySelectorAll('.task-row.drag-over').forEach(row => {
    row.classList.remove('drag-over', 'drop-above');
  });
  document.querySelectorAll('.task-row.dragging').forEach(row => {
    row.classList.remove('dragging');
  });
}

/**
 * Clears drag state.
 */
function clearDragState() {
  draggedTaskId = null;
  dropTargetId = null;
  dropPosition = null;
}

/**
 * Handles drag start event.
 */
function handleDragStart(e, taskId) {
  draggedTaskId = taskId;
  e.dataTransfer.setData('text/plain', taskId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.classList.add('dragging');
  e.stopPropagation();
}

/**
 * Handles drag over event.
 */
function handleDragOver(e, targetTaskId) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (draggedTaskId === targetTaskId) return;

  const targetRow = e.currentTarget;
  const rect = targetRow.getBoundingClientRect();
  const nearTop = e.clientY - rect.top < rect.height / 3;

  if (dropTargetId !== targetTaskId || dropPosition !== (nearTop ? 'above' : 'on')) {
    clearDragFeedback();
    dropTargetId = targetTaskId;
    dropPosition = nearTop ? 'above' : 'on';
    targetRow.classList.add('drag-over');
    if (nearTop) targetRow.classList.add('drop-above');
  }
  e.stopPropagation();
}

/**
 * Handles drag leave event.
 */
function handleDragLeave(e, targetTaskId) {
  if (dropTargetId === targetTaskId) {
    clearDragFeedback();
    dropTargetId = null;
    dropPosition = null;
  }
  e.stopPropagation();
}

/**
 * Handles drop event.
 */
function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!draggedTaskId || !dropTargetId) {
    clearDragState();
    return;
  }

  const draggedTask = tasks.find(t => t.id === draggedTaskId);
  const targetTask = tasks.find(t => t.id === dropTargetId);

  if (!draggedTask || !targetTask) {
    console.error('Drag or drop task not found');
    clearDragState();
    return;
  }

  if (wouldCreateDragCycle(draggedTask, targetTask, dropPosition)) {
    console.error('Cannot create circular hierarchy');
    clearDragState();
    return;
  }

  if (dropPosition === 'on') {
    if (targetTask.type === 'group') {
      window.dispatchEvent(new CustomEvent('moveTaskToGroup', {
        detail: { taskId: draggedTaskId, groupId: dropTargetId }
      }));
    } else {
      window.dispatchEvent(new CustomEvent('createGroupFromTasks', {
        detail: { taskId1: draggedTaskId, taskId2: dropTargetId }
      }));
    }
  } else if (dropPosition === 'above') {
    window.dispatchEvent(new CustomEvent('makeSiblingBefore', {
      detail: { taskId: draggedTaskId, beforeTaskId: dropTargetId }
    }));
  }

  clearDragState();
}

/**
 * Handles drag end event.
 */
function handleDragEnd(e) {
  clearDragFeedback();
  clearDragState();
  e.stopPropagation();
}

/**
 * Checks if a task's parent chain is collapsed.
 */
function isTaskVisible(task, allTasks) {
  if (task.type !== 'task' && task.type !== 'milestone') return true;
  let parentId = task.parent_id;
  while (parentId) {
    const parent = allTasks.find(t => t.id === parentId);
    if (!parent) break;
    if (_state.collapsedGroups.has(parent.id)) return false;
    parentId = parent.parent_id;
  }
  return true;
}

/**
 * Creates a DOM element for a task row.
 */
function createTaskRow(task, project) {
  const row = document.createElement('div');
  row.className = `task-row ${task.type === 'group' ? 'group-row' : ''}`;
  row.dataset.taskId = task.id;

  // --- Toggle Cell (for groups) ---
  const toggleCell = document.createElement('div');
  toggleCell.className = 'cell cell-toggle';
  if (task.type === 'group') {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle-btn';
    const isCollapsed = _state.collapsedGroups.has(task.id);
    toggleBtn.innerHTML = isCollapsed
      ? `<svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M2 2l2 2 2-2" stroke="currentColor" stroke-width="1.2"
              stroke-linecap="round" stroke-linejoin="round"/>
       </svg>`
      : `<svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M2 2l4 2-4 2" stroke="currentColor" stroke-width="1.2"
              stroke-linecap="round" stroke-linejoin="round"/>
       </svg>`;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onGroupToggled(task.id);
    });
    toggleCell.appendChild(toggleBtn);
  }
  row.appendChild(toggleCell);

  // --- Type Badge Cell ---
  const typeCell = document.createElement('div');
  typeCell.className = 'cell cell-type';
  const typeBadge = document.createElement('div');
  typeBadge.className = `type-badge type-${task.type.charAt(0).toUpperCase()}`;
  typeBadge.textContent = task.type.charAt(0).toUpperCase();
  typeCell.appendChild(typeBadge);
  row.appendChild(typeCell);

  // --- Title Cell ---
  const titleCell = document.createElement('div');
  titleCell.className = 'cell cell-title';
  const titleText = document.createElement('span');
  titleText.className = `title-text ${getIndentLevel(task, project.tasks) > 0 ? 'indent1' : ''}`;
  titleText.textContent = task.title;
  titleCell.appendChild(titleText);
  row.appendChild(titleCell);

  // --- Completion Cell ---
  const pctCell = document.createElement('div');
  pctCell.className = 'cell cell-pct';

  // Use manual completion if set, otherwise derived
  const completion = task.completion_manual !== null && task.completion_manual !== undefined
    ? task.completion_manual
    : (task.completion_derived || 0);

  const pctVal = document.createElement('span');
  pctVal.className = 'pct-val';
  pctVal.textContent = `${Math.round(completion * 100)}%`;
  pctCell.appendChild(pctVal);

  const pctBar = document.createElement('div');
  pctBar.className = 'pct-bar';
  const pctFill = document.createElement('div');
  pctFill.className = `pct-fill ${completion >= 1 ? 'done' : completion < 0.3 ? 'low' : ''}`;
  pctFill.style.width = `${completion * 100}%`;
  pctBar.appendChild(pctFill);
  pctCell.appendChild(pctBar);
  row.appendChild(pctCell);

  // --- Hours Cell ---
  const hoursCell = document.createElement('div');
  hoursCell.className = 'cell cell-hours';
  const hrsNum = document.createElement('span');
  hrsNum.className = 'hrs-num';
  hrsNum.textContent = task.estimated_hours || 0;
  const hrsUnit = document.createElement('span');
  hrsUnit.className = 'hrs-unit';
  hrsUnit.textContent = 'h';
  hoursCell.appendChild(hrsNum);
  hoursCell.appendChild(hrsUnit);
  row.appendChild(hoursCell);

  // --- People Cell ---
  const peopleCell = document.createElement('div');
  peopleCell.className = 'cell cell-people';
  const people = project.people.filter(p => task.people_ids.includes(p.id));
  people.slice(0, 2).forEach(person => {
    const pip = document.createElement('div');
    pip.className = `pip color-${person.color}`;
    pip.textContent = person.initials;
    pip.title = person.name;
    peopleCell.appendChild(pip);
  });
  if (people.length > 2) {
    const morePip = document.createElement('div');
    morePip.className = 'more-pip';
    morePip.textContent = `+${people.length - 2}`;
    peopleCell.appendChild(morePip);
  }
  row.appendChild(peopleCell);

  // --- Selection State ---
  if (task.id === selectedTaskId) {
    row.classList.add('selected');
  }

  // --- Click Handler ---
  row.addEventListener('click', () => onTaskSelected(task.id));
  row.draggable = true;
  row.addEventListener('dragstart', (e) => handleDragStart(e, task.id));
  row.addEventListener('dragover', (e) => handleDragOver(e, task.id));
  row.addEventListener('dragleave', (e) => handleDragLeave(e, task.id));
  row.addEventListener('drop', (e) => handleDrop(e, task.id));
  row.addEventListener('dragend', handleDragEnd);

  return row;
}

/**
 * Renders all visible tasks recursively.
 */
function renderTasks(parentId = null, allTasks, project) {
  const fragment = document.createDocumentFragment();
  const children = parentId
    ? allTasks.filter(t => t.parent_id === parentId)
    : allTasks.filter(t => !t.parent_id);

  children.forEach(task => {
    // Skip if parent is collapsed
    if (!isTaskVisible(task, allTasks)) return;

    const row = createTaskRow(task, project);
    fragment.appendChild(row);

    // Recursively render children if group is NOT collapsed
    if (task.type === 'group' && !_state.collapsedGroups.has(task.id)) {
      const childRows = renderTasks(task.id, allTasks, project);
      fragment.appendChild(childRows);
    }
  });

  return fragment;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Initializes the sidebar UI module.
 * @param {HTMLElement} element - The DOM element for the sidebar.
 * @param {Object} state - Global app state.
 */
function initSidebar(element, state) {
  sidebarElement = element;
  taskListElement = document.getElementById('task-tree');
  _state = state;

  // Handle scroll sync
  if (taskListElement) {
    taskListElement.addEventListener('scroll', () => {
      window.dispatchEvent(new CustomEvent('sidebarScroll', {
        detail: taskListElement.scrollTop
      }));
    });
  }
}

/**
 * Refreshes the sidebar with the latest project data.
 * @param {Object} project - The project data.
 */
function refreshSidebar(project) {
  if (!taskListElement) return;

  tasks = project.tasks || [];
  taskListElement.innerHTML = '';
  taskListElement.appendChild(renderTasks(null, tasks, project));
  clearDragState();
  clearDragFeedback();
}

/**
 * Handles selection of a task in the sidebar.
 * @param {string} taskId - The ID of the selected task.
 */
function onTaskSelected(taskId) {
  selectedTaskId = taskId;
  if (_state) _state.selectedTaskId = taskId;

  // Re-render to update selection state
  if (taskListElement) {
    refreshSidebar(_state.project);
  }

  // Emit event to notify other modules (drawer, canvas)
  window.dispatchEvent(new CustomEvent('taskSelected', { detail: taskId }));
}

/**
 * Toggles the collapsed/expanded state of a group.
 * @param {string} taskId - The ID of the group task.
 */
function onGroupToggled(taskId) {
  if (_state.collapsedGroups.has(taskId)) {
    _state.collapsedGroups.delete(taskId);
  } else {
    _state.collapsedGroups.add(taskId);
  }

  // Dispatch event so canvas knows to refresh
  window.dispatchEvent(new CustomEvent('groupToggled', {
    detail: { taskId, collapsed: _state.collapsedGroups.has(taskId) }
  }));

  refreshSidebar(_state.project);
}

/**
 * Syncs the scroll position with the canvas.
 * @param {number} scrollTop - The scroll position.
 */
function syncScroll(scrollTop) {
  if (taskListElement) {
    taskListElement.scrollTop = scrollTop;
  }
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
