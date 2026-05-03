/**
 * Gantt.IO - Drawer UI Module
 * Slide-up bottom panel for editing selected tasks.
 */

// ============================================================================
// TYPES
// ============================================================================
/**
 * @typedef {import('../core.js').Task} Task
 * @typedef {import('../core.js').Project} Project
 * @typedef {import('../core.js').Person} Person
 */

// ============================================================================
// STATE
// ============================================================================
let drawerElement = null;
let currentTask = null;
let currentProject = null;
let isOpen = false;
let _state = null;
let scrimElement = null;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Creates a field separator.
 * @returns {HTMLElement}
 */
function createFieldSep() {
  const sep = document.createElement('div');
  sep.className = 'field-sep';
  return sep;
}

/**
 * Validates the form data.
 * @returns {boolean}
 */
function validateForm() {
  const title = document.getElementById('drawer-title-input').value.trim();
  if (!title) {
    alert('Title is required.');
    return false;
  }

  const startDate = document.getElementById('task-start-date').value;
  const endDate = document.getElementById('task-end-date').value;
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    alert('Start date must be before end date.');
    return false;
  }

  const estimatedHours = parseFloat(document.getElementById('task-hours').value);
  if (isNaN(estimatedHours) || estimatedHours < 0) {
    alert('Estimated hours must be a positive number.');
    return false;
  }

  return true;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Initializes the drawer UI.
 * @param {HTMLElement} element - The drawer DOM element.
 * @param {Object} state - Global app state.
 */
function initDrawer(element, state) {
  _state = state;
  drawerElement = element;
  drawerElement.className = 'drawer';

  // Ensure scrim exists
  scrimElement = document.getElementById('drawer-scrim');
  if (!scrimElement) {
    scrimElement = document.createElement('div');
    scrimElement.className = 'drawer-scrim';
    scrimElement.id = 'drawer-scrim';
    document.body.appendChild(scrimElement);
  }
  scrimElement.addEventListener('click', closeDrawer);

  // Clear and rebuild drawer structure
  drawerElement.innerHTML = '';

  // --- Drawer Pill ---
  const pill = document.createElement('div');
  pill.className = 'drawer-pill';
  drawerElement.appendChild(pill);

  // --- Drawer Head ---
  const head = document.createElement('div');
  head.className = 'drawer-head';

  // Type badge
  const typeBadge = document.createElement('div');
  typeBadge.className = 'drawer-type-badge';
  typeBadge.id = 'drawer-type-badge';
  head.appendChild(typeBadge);

  // Title input
  const titleInput = document.createElement('input');
  titleInput.className = 'drawer-title-input';
  titleInput.id = 'drawer-title-input';
  titleInput.type = 'text';
  titleInput.placeholder = 'Task title...';
  head.appendChild(titleInput);

  // Head actions (Delete + Close)
  const headActions = document.createElement('div');
  headActions.className = 'drawer-head-actions';

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'dicon-btn danger';
  deleteBtn.title = 'Delete task';
  deleteBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5h9M5 3.5V2h3v1.5M5.5 6v4M7.5 6v4M3 3.5l.6 7a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-7"
            stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  deleteBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this task?')) {
      onTaskDeleted(currentTask.id);
      closeDrawer();
    }
  });
  headActions.appendChild(deleteBtn);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'dicon-btn';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  `;
  closeBtn.addEventListener('click', closeDrawer);
  headActions.appendChild(closeBtn);

  head.appendChild(headActions);
  drawerElement.appendChild(head);

  // --- Drawer Body (will be populated by bindTaskToForm) ---
  const body = document.createElement('div');
  body.className = 'drawer-body';
  body.id = 'drawer-body';
  drawerElement.appendChild(body);

  // --- Drawer Footer ---
  const footer = document.createElement('div');
  footer.className = 'drawer-footer';

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  footer.appendChild(spacer);

  // Discard button
  const discardBtn = document.createElement('button');
  discardBtn.className = 'dbtn';
  discardBtn.textContent = 'Discard';
  discardBtn.addEventListener('click', closeDrawer);
  footer.appendChild(discardBtn);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'dbtn save';
  saveBtn.textContent = 'Save changes';
  saveBtn.addEventListener('click', () => {
    if (validateForm()) {
      onTaskUpdated({
        ...currentTask,
        title: document.getElementById('drawer-title-input').value,
        type: document.getElementById('task-type').value,
        parent_id: document.getElementById('task-parent').value || null,
        start_date: document.getElementById('task-start-date').value,
        end_date: document.getElementById('task-end-date').value,
        estimated_hours: parseFloat(document.getElementById('task-hours').value) || 0,
        prio: document.getElementById('task-priority').value,
        people_ids: currentTask.people_ids, // Preserve existing (editing not implemented yet)
        notes: document.getElementById('task-notes').value,
        completion_manual: parseFloat(document.getElementById('completion-slider').value) / 100
      });
    }
  });
  footer.appendChild(saveBtn);

  drawerElement.appendChild(footer);
  closeDrawer();
}

/**
 * Updates the drawer for a specific task.
 * @param {Task} task - Task to edit.
 * @param {Project} project - Project data.
 */
function updateDrawerForTask(task, project) {
  currentTask = task;
  currentProject = project;
  bindTaskToForm();
  openDrawer();
}

/**
 * Binds task data to the form fields.
 */
function bindTaskToForm() {
  if (!currentTask || !currentProject) return;

  // Update header
  const typeBadge = document.getElementById('drawer-type-badge');
  const typeChar = currentTask.type.charAt(0).toUpperCase();
  typeBadge.textContent = typeChar;
  typeBadge.className = `drawer-type-badge type-${typeChar}`;

  document.getElementById('drawer-title-input').value = currentTask.title;

  // Clear and rebuild body
  const body = document.getElementById('drawer-body');
  body.innerHTML = '';

  // ===== COLUMN 1: Type + Group =====
  const col1 = document.createElement('div');
  col1.className = 'field-col';

  // Type
  const typeLabel = document.createElement('div');
  typeLabel.className = 'field-label';
  typeLabel.textContent = 'Type';
  col1.appendChild(typeLabel);

  const typeSelect = document.createElement('select');
  typeSelect.className = 'd-input';
  typeSelect.id = 'task-type';
  ['task', 'group', 'milestone'].forEach(type => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    if (type === currentTask.type) option.selected = true;
    typeSelect.appendChild(option);
  });
  col1.appendChild(typeSelect);

  // Group (Parent)
  const parentLabel = document.createElement('div');
  parentLabel.className = 'field-label';
  parentLabel.textContent = 'Group';
  col1.appendChild(parentLabel);

  const parentSelect = document.createElement('select');
  parentSelect.className = 'd-input';
  parentSelect.id = 'task-parent';
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'None';
  parentSelect.appendChild(noneOption);

  currentProject.tasks?.filter(t => t.type === 'group' && t.id !== currentTask.id).forEach(group => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.title;
    if (group.id === currentTask.parent_id) option.selected = true;
    parentSelect.appendChild(option);
  });
  col1.appendChild(parentSelect);

  body.appendChild(col1);
  body.appendChild(createFieldSep());

  // ===== COLUMN 2: Start + End Dates =====
  const col2 = document.createElement('div');
  col2.className = 'field-col';

  // Start Date
  const startLabel = document.createElement('div');
  startLabel.className = 'field-label';
  startLabel.textContent = 'Start Date';
  col2.appendChild(startLabel);

  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.className = 'd-input';
  startInput.id = 'task-start-date';
  startInput.value = currentTask.start_date;
  col2.appendChild(startInput);

  // End Date
  const endLabel = document.createElement('div');
  endLabel.className = 'field-label';
  endLabel.textContent = 'End Date';
  col2.appendChild(endLabel);

  const endInput = document.createElement('input');
  endInput.type = 'date';
  endInput.className = 'd-input';
  endInput.id = 'task-end-date';
  endInput.value = currentTask.end_date;
  col2.appendChild(endInput);

  body.appendChild(col2);
  body.appendChild(createFieldSep());

  // ===== COLUMN 3: Completion Slider =====
  const col3 = document.createElement('div');
  col3.className = 'field-col';

  const compLabel = document.createElement('div');
  compLabel.className = 'field-label';
  compLabel.textContent = 'Completion';
  col3.appendChild(compLabel);

  const pctField = document.createElement('div');
  pctField.className = 'pct-field';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = Math.round((currentTask.completion_manual || 0) * 100);
  slider.id = 'completion-slider';
  pctField.appendChild(slider);

  const pctDisplay = document.createElement('span');
  pctDisplay.className = 'pct-display';
  pctDisplay.textContent = `${slider.value}%`;
  pctField.appendChild(pctDisplay);

  slider.addEventListener('input', () => {
    pctDisplay.textContent = `${slider.value}%`;
  });

  col3.appendChild(pctField);
  body.appendChild(col3);
  body.appendChild(createFieldSep());

  // ===== COLUMN 4: Hours + Priority =====
  const col4 = document.createElement('div');
  col4.className = 'field-col';

  // Hours
  const hoursLabel = document.createElement('div');
  hoursLabel.className = 'field-label';
  hoursLabel.textContent = 'Expected hrs';
  col4.appendChild(hoursLabel);

  const hoursInput = document.createElement('input');
  hoursInput.type = 'number';
  hoursInput.className = 'd-input';
  hoursInput.id = 'task-hours';
  hoursInput.value = currentTask.estimated_hours || 0;
  col4.appendChild(hoursInput);

  // Priority
  const prioLabel = document.createElement('div');
  prioLabel.className = 'field-label';
  prioLabel.textContent = 'Priority';
  col4.appendChild(prioLabel);

  const prioSelect = document.createElement('select');
  prioSelect.className = 'd-input';
  prioSelect.id = 'task-priority';
  ['critical', 'high', 'normal', 'low'].forEach(prio => {
    const option = document.createElement('option');
    option.value = prio;
    option.textContent = prio;
    if (prio === currentTask.prio) option.selected = true;
    prioSelect.appendChild(option);
  });
  col4.appendChild(prioSelect);

  body.appendChild(col4);
  body.appendChild(createFieldSep());

  // ===== COLUMN 5: People =====
  const col5 = document.createElement('div');
  col5.className = 'field-col';

  const peopleLabel = document.createElement('div');
  peopleLabel.className = 'field-label';
  peopleLabel.textContent = 'People';
  col5.appendChild(peopleLabel);

  const peopleContainer = document.createElement('div');
  peopleContainer.className = 'people-chips';

  if (currentTask.people_ids?.length > 0) {
    // Show chips for assigned people
    currentTask.people_ids.forEach(personId => {
      const person = currentProject.people?.find(p => p.id === personId);
      if (person) {
        const chip = document.createElement('div');
        chip.className = 'chip';
        const pip = document.createElement('div');
        pip.className = 'chip-pip';
        pip.textContent = person.name.charAt(0).toUpperCase();
        chip.appendChild(pip);
        const nameSpan = document.createElement('span');
        nameSpan.textContent = person.name;
        chip.appendChild(nameSpan);
        peopleContainer.appendChild(chip);
      }
    });
  } else {
    // Show + button if no people assigned
    const addBtn = document.createElement('button');
    addBtn.className = 'chip chip-add';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => console.log('Add person clicked'));
    peopleContainer.appendChild(addBtn);
  }

  col5.appendChild(peopleContainer);
  body.appendChild(col5);
  body.appendChild(createFieldSep());

  // ===== COLUMN 6: Notes =====
  const col6 = document.createElement('div');
  col6.className = 'field-col';

  const notesLabel = document.createElement('div');
  notesLabel.className = 'field-label';
  notesLabel.textContent = 'Notes';
  col6.appendChild(notesLabel);

  const notesTextarea = document.createElement('textarea');
  notesTextarea.className = 'd-textarea';
  notesTextarea.id = 'task-notes';
  notesTextarea.value = currentTask.notes || '';
  col6.appendChild(notesTextarea);

  body.appendChild(col6);
}

/**
 * Opens the drawer.
 */
function openDrawer() {
  drawerElement.classList.add('open');
  isOpen = true;
}

/**
 * Closes the drawer.
 */
function closeDrawer() {
  drawerElement.classList.remove('open');
  isOpen = false;
}

/**
 * Handles task updates.
 * @param {Task} updatedTask
 */
function onTaskUpdated(updatedTask) {
  currentTask = updatedTask;
  window.dispatchEvent(new CustomEvent('taskUpdated', { detail: updatedTask }));
}

/**
 * Handles task deletion.
 * @param {string} taskId
 */
function onTaskDeleted(taskId) {
  window.dispatchEvent(new CustomEvent('taskDeleted', { detail: taskId }));
}

/**
 * Refreshes the drawer UI.
 */
function refreshDrawer() {
  if (!isOpen || !currentTask || !_state?.project) return;
  updateDrawerForTask(currentTask, _state.project);
}

// ============================================================================
// EXPORTS
// ============================================================================
export {
  initDrawer,
  updateDrawerForTask,
  onTaskUpdated,
  onTaskDeleted,
  refreshDrawer
};
