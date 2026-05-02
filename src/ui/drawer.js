/**
 * Gantt.IO - Drawer UI Module
 *
 * Slide-up bottom panel for editing selected tasks.
 * Handles form binding, validation, and actions (save, cancel, delete).
 */

// ============================================================================
// TYPES
// ============================================================================
/**
 * @typedef {import('../core.js').Task} Task
 * @typedef {import('../core.js').Project} Project
 * @typedef {import('../core.js').Dependency} Dependency
 * @typedef {import('../core.js').Person} Person
 * @typedef {import('../core.js').Priority} Priority
 * @typedef {import('../core.js').TaskType} TaskType
 * @typedef {import('../core.js').PaletteKey} PaletteKey
 */

// ============================================================================
// STATE
// ============================================================================
let drawerElement = null;
let currentTask = null;
let currentProject = null;
let formElement = null;
let isOpen = false;

// ============================================================================
// DOM HELPERS
// ============================================================================

/**
 * Creates a form field with label and input.
 * @param {string} id - Field ID.
 * @param {string} label - Field label.
 * @param {string} type - Input type (text, date, number, select, etc.).
 * @param {string|number} value - Initial value.
 * @param {string[]} [options] - Options for select inputs.
 * @returns {HTMLElement} Form field container.
 */
function createFormField(id, label, type, value, options = []) {
  const container = document.createElement('div');
  container.className = 'form-field';

  const labelEl = document.createElement('label');
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  container.appendChild(labelEl);

  let input;
  if (type === 'select') {
    input = document.createElement('select');
    input.id = id;
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      input.appendChild(option);
    });
  } else {
    input = document.createElement('input');
    input.type = type;
    input.id = id;
  }
  input.value = value;
  container.appendChild(input);

  return container;
}

/**
 * Binds task data to the form.
 */
function bindTaskToForm() {
  if (!currentTask || !formElement) return;

  // Clear existing fields
  formElement.innerHTML = '';

  // Title
  const titleField = createFormField('title', 'Title', 'text', currentTask.title);
  formElement.appendChild(titleField);

  // Type
  const typeField = createFormField('type', 'Type', 'select', currentTask.type, ['task', 'group', 'milestone']);
  formElement.appendChild(typeField);

  // Parent (if not a root task)
  if (currentTask.parent_id) {
    const parentField = createFormField('parent_id', 'Parent', 'select', currentTask.parent_id, ['None', ...getTaskTitles()]);
    formElement.appendChild(parentField);
  }

  // Start Date
  const startDateField = createFormField('start_date', 'Start Date', 'date', currentTask.start_date);
  formElement.appendChild(startDateField);

  // End Date
  const endDateField = createFormField('end_date', 'End Date', 'date', currentTask.end_date);
  formElement.appendChild(endDateField);

  // Estimated Hours
  const hoursField = createFormField('estimated_hours', 'Estimated Hours', 'number', currentTask.estimated_hours);
  formElement.appendChild(hoursField);

  // Priority
  const priorityField = createFormField('prio', 'Priority', 'select', currentTask.prio, ['critical', 'high', 'normal', 'low']);
  formElement.appendChild(priorityField);

  // People
  const peopleField = createFormField('people_ids', 'People', 'select', currentTask.people_ids?.join(',') || '', currentProject.people?.map(p => p.id) || []);
  peopleField.querySelector('select').multiple = true;
  formElement.appendChild(peopleField);

  // Notes
  const notesField = document.createElement('div');
  notesField.className = 'form-field';
  const notesLabel = document.createElement('label');
  notesLabel.htmlFor = 'notes';
  notesLabel.textContent = 'Notes';
  const notesTextarea = document.createElement('textarea');
  notesTextarea.id = 'notes';
  notesTextarea.value = currentTask.notes || '';
  notesField.appendChild(notesLabel);
  notesField.appendChild(notesTextarea);
  formElement.appendChild(notesField);

  // Manual Completion
  const completionField = createFormField('completion_manual', 'Manual Completion (%)', 'number', currentTask.completion_manual || 0);
  formElement.appendChild(completionField);

  // Dependency Editor
  const depHeader = document.createElement('h3');
  depHeader.textContent = 'Dependencies';
  formElement.appendChild(depHeader);

  const depList = document.createElement('div');
  depList.id = 'dependency-list';
  currentTask.dependencies?.forEach(dep => {
    const depItem = document.createElement('div');
    depItem.className = 'dependency-item';
    depItem.textContent = `Dependency: ${dep.from_task_id} -> ${dep.to_task_id} (${dep.rule})`;
    depList.appendChild(depItem);
  });
  formElement.appendChild(depList);
}

/**
 * Gets titles of all tasks for parent dropdown.
 * @returns {string[]} Array of task titles.
 */
function getTaskTitles() {
  return currentProject.tasks?.map(t => t.title) || [];
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates the form data.
 * @returns {boolean} True if valid.
 */
function validateForm() {
  const title = formElement.querySelector('#title').value.trim();
  if (!title) {
    alert('Title is required.');
    return false;
  }

  const startDate = formElement.querySelector('#start_date').value;
  const endDate = formElement.querySelector('#end_date').value;
  if (new Date(startDate) > new Date(endDate)) {
    alert('Start date must be before end date.');
    return false;
  }

  const estimatedHours = parseFloat(formElement.querySelector('#estimated_hours').value);
  if (isNaN(estimatedHours) || estimatedHours < 0) {
    alert('Estimated hours must be a positive number.');
    return false;
  }

  const completion = parseFloat(formElement.querySelector('#completion_manual').value);
  if (completion < 0 || completion > 100) {
    alert('Completion must be between 0 and 100.');
    return false;
  }

  return true;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Initializes the drawer UI module.
 * @param {HTMLElement} element - The DOM element for the drawer.
 */
function initDrawer(element) {
  drawerElement = element;
  drawerElement.className = 'drawer';

  // Create form
  formElement = document.createElement('form');
  formElement.id = 'task-form';
  drawerElement.appendChild(formElement);

  // Action buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'drawer-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    if (validateForm()) {
      const updatedTask = {
        ...currentTask,
        title: formElement.querySelector('#title').value,
        type: formElement.querySelector('#type').value,
        start_date: formElement.querySelector('#start_date').value,
        end_date: formElement.querySelector('#end_date').value,
        estimated_hours: parseFloat(formElement.querySelector('#estimated_hours').value),
        prio: formElement.querySelector('#prio').value,
        people_ids: Array.from(formElement.querySelector('#people_ids').selectedOptions).map(opt => opt.value),
        notes: formElement.querySelector('#notes').value,
        completion_manual: parseFloat(formElement.querySelector('#completion_manual').value) / 100
      };
      onTaskUpdated(updatedTask);
    }
  });
  actionsDiv.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    closeDrawer();
  });
  actionsDiv.appendChild(cancelBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'delete-btn';
  deleteBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this task?')) {
      onTaskDeleted(currentTask.id);
      closeDrawer();
    }
  });
  actionsDiv.appendChild(deleteBtn);

  drawerElement.appendChild(actionsDiv);
  closeDrawer();
}

/**
 * Updates the drawer to display the form for the selected task.
 * @param {Task} task - The task to edit.
 * @param {Project} project - The project data.
 */
function updateDrawerForTask(task, project) {
  currentTask = task;
  currentProject = project;
  bindTaskToForm();
  openDrawer();
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
 * Handles updates to a task.
 * @param {Task} updatedTask - The updated task data.
 */
function onTaskUpdated(updatedTask) {
  currentTask = updatedTask;
  // Emit event to notify other modules (e.g., engine, sidebar, canvas)
  window.dispatchEvent(new CustomEvent('taskUpdated', { detail: updatedTask }));
}

/**
 * Handles deletion of a task.
 * @param {string} taskId - The ID of the task to delete.
 */
function onTaskDeleted(taskId) {
  // Emit event to notify other modules (e.g., engine, sidebar, canvas)
  window.dispatchEvent(new CustomEvent('taskDeleted', { detail: taskId }));
}

/**
 * Refreshes the drawer UI.
 * @param {Project} project - The project data.
 */
function refreshDrawer(project) {
  if (isOpen && currentTask) {
    updateDrawerForTask(currentTask, project);
  }
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
