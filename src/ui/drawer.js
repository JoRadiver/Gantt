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

import { PALETTE } from '../core.js';
import { getDescendants } from '../engine.js';

// ============================================================================
// STATE
// ============================================================================
let drawerElement = null;
let currentTask = null;
let currentProject = null;
let isOpen = false;
let _state = null;
let scrimElement = null;
let sliderTouched = false;

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
 * Validates the task for auto-save.
 * @param {Task} task - The task to validate.
 * @returns {boolean} - True if valid.
 */
function validateTaskForSave(task) {
  if (!task) return false;
  // Title is required
  if (typeof task.title !== 'string' || task.title.trim() === '') {
    alert('Title is required.');
    return false;
  }
  // Start date must be before end date
  if (task.start_date && task.end_date) {
    const start = new Date(task.start_date);
    const end = new Date(task.end_date);
    if (start > end) {
      alert('Start date must be before end date.');
      return false;
    }
  }
  // Estimated hours must be non-negative
  if (typeof task.estimated_hours !== 'number' || task.estimated_hours < 0) {
    alert('Estimated hours must be a positive number.');
    return false;
  }
  return true;
}

/**
 * Updates the type badge in the drawer header.
 */
function updateTypeBadge() {
  const typeBadge = document.getElementById('drawer-type-badge');
  if (typeBadge && currentTask) {
    const typeChar = currentTask.type.charAt(0).toUpperCase();
    typeBadge.textContent = typeChar;
    typeBadge.className = `drawer-type-badge type-${typeChar}`;
  }
}

/**
 * Handles field changes for auto-save.
 * @param {Event} e - The event (blur, change, or input).
 */
function handleFieldChange(e) {
  if (!currentTask) return;
  const field = e.target.dataset.field;
  if (!field) return;

  let value = e.target.value;

  // Handle date synchronization
  if (field === 'start_date' || field === 'end_date') {
    if (field === 'start_date') {
      const oldStartDate = currentTask.start_date ? new Date(currentTask.start_date) : null;
      const oldEndDate = currentTask.end_date ? new Date(currentTask.end_date) : null;
      const newStartDate = new Date(value);

      // Always update start date
      currentTask.start_date = value;

      // Shift end date if it exists and dates are valid
      if (oldStartDate && oldEndDate && !isNaN(newStartDate.getTime())) {
        const delta = newStartDate.getTime() - oldStartDate.getTime();
        const newEndDate = new Date(oldEndDate.getTime() + delta);
        currentTask.end_date = newEndDate.toISOString().split('T')[0];
        const endInput = document.getElementById('task-end-date');
        if (endInput) endInput.value = currentTask.end_date;
      }
    } else if (field === 'end_date') {
      const newEndDate = new Date(value);
      const currentStartDate = currentTask.start_date ? new Date(currentTask.start_date) : null;

      if (currentStartDate && !isNaN(newEndDate.getTime()) && !isNaN(currentStartDate.getTime())) {
        if (newEndDate < currentStartDate) {
          alert('End date cannot be before start date.');
          const endInput = document.getElementById('task-end-date');
          if (endInput) endInput.value = currentTask.end_date || '';
          return; // Blocks save
        }
      }
      currentTask.end_date = value;
    }
  }

  // Convert and assign value to currentTask
  switch (field) {
    case 'title':
    case 'notes':
    case 'type':
    case 'prio':
      currentTask[field] = value;
      break;
    case 'parent_id':
      currentTask.parent_id = value || null;
      break;
    case 'color':
      currentTask.color = value || null;
      break;
    case 'estimated_hours':
      currentTask.estimated_hours = parseFloat(value) || 0;
      break;
    case 'completion_manual':
      currentTask.completion_manual = Math.min(1, Math.max(0, parseFloat(value) / 100));
      // Update the percentage display
      const pctDisplay = document.querySelector('.pct-display');
      if (pctDisplay) {
        pctDisplay.textContent = `${Math.round(currentTask.completion_manual * 100)}%`;
      }
      break;
    default:
      break;
  }

  // Update type badge if type changed
  if (field === 'type') updateTypeBadge();

  // Validate and save
  if (validateTaskForSave(currentTask)) {
    onTaskUpdated(currentTask);
  }
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
  titleInput.dataset.field = 'title'; // NEW: Mark for auto-save
  // NEW: Auto-save on blur or Enter
  titleInput.addEventListener('blur', handleFieldChange);
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleFieldChange(e);
      titleInput.blur();
    }
  });
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
    if (currentTask.type === 'group') {
      showGroupDeleteDialog(currentTask);
    } else {
      if (confirm('Are you sure you want to delete this task?')) {
        onTaskDeleted(currentTask.id);
        closeDrawer();
      }
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

  // Save button (kept for backward compatibility)
  const saveBtn = document.createElement('button');
  saveBtn.className = 'dbtn save';
  saveBtn.textContent = 'Save changes';
  saveBtn.addEventListener('click', () => {
    if (!currentTask) return;
    if (validateTaskForSave(currentTask)) {
      onTaskUpdated(currentTask);
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
  sliderTouched = false;
  bindTaskToForm();
  openDrawer();
}

/**
 * Binds task data to the form fields.
 */
function bindTaskToForm() {
  if (!currentTask || !currentProject) return;

  // Update header
  updateTypeBadge();
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
  typeSelect.dataset.field = 'type'; // NEW: Mark for auto-save
  typeSelect.addEventListener('change', handleFieldChange); // NEW: Auto-save on change
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
  parentSelect.dataset.field = 'parent_id'; // NEW
  parentSelect.addEventListener('change', handleFieldChange); // NEW
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
  startInput.dataset.field = 'start_date'; // NEW
  startInput.addEventListener('change', handleFieldChange); // NEW
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
  endInput.dataset.field = 'end_date'; // NEW
  endInput.addEventListener('change', handleFieldChange); // NEW
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
  slider.value = Math.round((currentTask.completion_manual ?? 0) * 100);
  slider.id = 'completion-slider';
  slider.dataset.field = 'completion_manual'; // NEW
  slider.addEventListener('input', handleFieldChange); // NEW: Auto-save on input (real-time)
  pctField.appendChild(slider);

  const pctDisplay = document.createElement('span');
  pctDisplay.className = 'pct-display';
  pctDisplay.textContent = `${slider.value}%`;
  pctField.appendChild(pctDisplay);

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
  hoursInput.dataset.field = 'estimated_hours'; // NEW
  hoursInput.value = currentTask.estimated_hours || 0;
  // NEW: Auto-save on blur or Enter
  hoursInput.addEventListener('blur', handleFieldChange);
  hoursInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleFieldChange(e);
      hoursInput.blur();
    }
  });
  col4.appendChild(hoursInput);

  // Priority
  const prioLabel = document.createElement('div');
  prioLabel.className = 'field-label';
  prioLabel.textContent = 'Priority';
  col4.appendChild(prioLabel);

  const prioSelect = document.createElement('select');
  prioSelect.className = 'd-input';
  prioSelect.id = 'task-priority';
  prioSelect.dataset.field = 'prio'; // NEW
  prioSelect.addEventListener('change', handleFieldChange); // NEW
  ['critical', 'high', 'normal', 'low'].forEach(prio => {
    const option = document.createElement('option');
    option.value = prio;
    option.textContent = prio;
    if (prio === currentTask.prio) option.selected = true;
    prioSelect.appendChild(option);
  });
  col4.appendChild(prioSelect);

  // Color
  const colorLabel = document.createElement('div');
  colorLabel.className = 'field-label';
  colorLabel.textContent = 'Color';
  col4.appendChild(colorLabel);

  const colorSelect = document.createElement('select');
  colorSelect.className = 'd-input';
  colorSelect.id = 'task-color';
  colorSelect.dataset.field = 'color'; // NEW
  colorSelect.addEventListener('change', handleFieldChange); // NEW

  // Default option (null)
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Default';
  if (currentTask.color === null || currentTask.color === undefined) defaultOption.selected = true;
  colorSelect.appendChild(defaultOption);

  // Palette colors
  Object.keys(PALETTE).forEach(color => {
    const option = document.createElement('option');
    option.value = color;
    option.textContent = color;
    if (color === currentTask.color) option.selected = true;
    colorSelect.appendChild(option);
  });
  col4.appendChild(colorSelect);

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
  notesTextarea.dataset.field = 'notes'; // NEW
  notesTextarea.value = currentTask.notes || '';
  // NEW: Auto-save on blur or Enter
  notesTextarea.addEventListener('blur', handleFieldChange);
  notesTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleFieldChange(e);
      notesTextarea.blur();
    }
  });
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

/**
 * Shows a dialog for deleting a group task with options.
 * @param {Task} task - The group task to delete.
 */
function showGroupDeleteDialog(task) {
  const modal = document.createElement('div');
  modal.className = 'delete-group-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <p>Delete "${task.title}"?</p>
      <div class="modal-options">
        <button class="modal-btn delete-all">Delete group and all subtasks</button>
        <button class="modal-btn dissolve">Dissolve group (keep subtasks)</button>
        <button class="modal-btn cancel">Cancel</button>
      </div>
    </div>
  `;

  Object.assign(modal.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
    alignItems: 'center', zIndex: '10000'
  });

  const content = modal.querySelector('.modal-content');
  Object.assign(content.style, {
    background: '#fff', padding: '1.5rem', borderRadius: '8px',
    maxWidth: '400px', width: '90%', textAlign: 'center'
  });

  content.querySelector('p').style.margin = '0 0 1.5rem';

  const options = modal.querySelector('.modal-options');
  Object.assign(options.style, {
    display: 'flex', flexDirection: 'column', gap: '0.75rem'
  });

  const styleButton = (btn) => Object.assign(btn.style, {
    padding: '0.5rem 1rem', border: 'none', borderRadius: '4px',
    cursor: 'pointer', fontSize: '0.875rem'
  });

  Object.assign(modal.querySelector('.delete-all').style, { background: '#c0392b', color: '#fff' });
  Object.assign(modal.querySelector('.dissolve').style, { background: '#3498db', color: '#fff' });
  Object.assign(modal.querySelector('.cancel').style, { background: '#ecf0f1', color: '#2c3e50' });

  [modal.querySelector('.delete-all'), modal.querySelector('.dissolve'), modal.querySelector('.cancel')]
    .forEach(styleButton);

  modal.querySelector('.delete-all').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('taskDeletedWithChildren', { detail: task.id }));
    closeDrawer();
    modal.remove();
  });

  modal.querySelector('.dissolve').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('taskDissolved', { detail: task.id }));
    closeDrawer();
    modal.remove();
  });

  modal.querySelector('.cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  document.body.appendChild(modal);
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
