/**
 * Gantt.IO - Worklog UI Module
 *
 * Handles quick entry, history view, and aggregation display for work logs.
 * No business logic, no direct DOM manipulation beyond the worklog panel.
 */

// ============================================================================
// TYPES
// ============================================================================
/**
 * @typedef {import('../core.js').WorkEntry} WorkEntry
 * @typedef {import('../core.js').Project} Project
 * @typedef {import('../core.js').Task} Task
 * @typedef {import('../core.js').Person} Person
 */

// ============================================================================
// STATE
// ============================================================================
let worklogElement = null;
let historyTable = null;
let summaryPanel = null;
let _state = null;  // Reference to global app state (passed during init)

// ============================================================================
// DOM HELPERS
// ============================================================================

/**
 * Creates a quick entry form.
 * @returns {HTMLElement} Quick entry form element.
 */
function createQuickEntryForm() {
  if (!_state?.project) {
    console.error("Project is not provided!");
    return null;
  }
  const project = _state.project;
  const form = document.createElement('form');
  form.className = 'quick-entry-form';

  // Date
  const dateField = document.createElement('div');
  dateField.className = 'form-field';
  const dateLabel = document.createElement('label');
  dateLabel.htmlFor = 'worklog-date';
  dateLabel.textContent = 'Date';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.id = 'worklog-date';
  dateInput.value = new Date().toISOString().split('T')[0];
  dateField.appendChild(dateLabel);
  dateField.appendChild(dateInput);
  form.appendChild(dateField);

  // Hours
  const hoursField = document.createElement('div');
  hoursField.className = 'form-field';
  const hoursLabel = document.createElement('label');
  hoursLabel.htmlFor = 'worklog-hours';
  hoursLabel.textContent = 'Hours';
  const hoursInput = document.createElement('input');
  hoursInput.type = 'number';
  hoursInput.id = 'worklog-hours';
  hoursInput.step = '0.1';
  hoursInput.min = '0.1';
  hoursField.appendChild(hoursLabel);
  hoursField.appendChild(hoursInput);
  form.appendChild(hoursField);

  // Person
  const personField = document.createElement('div');
  personField.className = 'form-field';
  const personLabel = document.createElement('label');
  personLabel.htmlFor = 'worklog-person';
  personLabel.textContent = 'Person';
  const personSelect = document.createElement('select');
  personSelect.id = 'worklog-person';
  project.people?.forEach(person => {
    const option = document.createElement('option');
    option.value = person.id;
    option.textContent = person.name;
    personSelect.appendChild(option);
  });
  personField.appendChild(personLabel);
  personField.appendChild(personSelect);
  form.appendChild(personField);

  // Task
  const taskField = document.createElement('div');
  taskField.className = 'form-field';
  const taskLabel = document.createElement('label');
  taskLabel.htmlFor = 'worklog-task';
  taskLabel.textContent = 'Task';
  const taskSelect = document.createElement('select');
  taskSelect.id = 'worklog-task';
  project.tasks?.forEach(task => {
    const option = document.createElement('option');
    option.value = task.id;
    option.textContent = task.title;
    taskSelect.appendChild(option);
  });
  taskField.appendChild(taskLabel);
  taskField.appendChild(taskSelect);
  form.appendChild(taskField);

  // Note
  const noteField = document.createElement('div');
  noteField.className = 'form-field';
  const noteLabel = document.createElement('label');
  noteLabel.htmlFor = 'worklog-note';
  noteLabel.textContent = 'Note (Optional)';
  const noteInput = document.createElement('textarea');
  noteInput.id = 'worklog-note';
  noteField.appendChild(noteLabel);
  noteField.appendChild(noteInput);
  form.appendChild(noteField);

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = 'Add Entry';
  form.appendChild(submitBtn);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = form.querySelector('#worklog-date').value;
    const hours = parseFloat(form.querySelector('#worklog-hours').value);
    const personId = form.querySelector('#worklog-person').value;
    const taskId = form.querySelector('#worklog-task').value;
    const note = form.querySelector('#worklog-note').value;

    const newEntry = {
      id: `worklog-${Date.now()}`,
      date,
      hours,
      person_id: personId,
      task_id: taskId,
      note: note || undefined
    };

    onWorklogEntryAdded(newEntry);
    form.reset();
  });

  return form;
}

/**
 * Creates a history table for worklog entries.
 * @returns {HTMLElement} History table element.
 */
function createHistoryTable() {
  const table = document.createElement('table');
  table.className = 'worklog-history';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Date', 'Hours', 'Person', 'Task', 'Note', 'Actions'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  tbody.id = 'worklog-entries';
  table.appendChild(tbody);

  return table;
}

/**
 * Renders a worklog entry in the history table.
 * @param {WorkEntry} entry - The worklog entry to render.
 */
function renderWorklogEntry(entry) {
  if (!_state?.project) return;

  const project = _state.project;
  const row = document.createElement('tr');
  row.dataset.entryId = entry.id;

  const dateCell = document.createElement('td');
  dateCell.textContent = entry.date;
  row.appendChild(dateCell);

  const hoursCell = document.createElement('td');
  hoursCell.textContent = entry.hours;
  row.appendChild(hoursCell);

  const personCell = document.createElement('td');
  const person = project.people?.find(p => p.id === entry.person_id);
  personCell.textContent = person?.name || 'Unknown';
  row.appendChild(personCell);

  const taskCell = document.createElement('td');
  const task = project.tasks?.find(t => t.id === entry.task_id);
  taskCell.textContent = task?.title || 'Unknown';
  row.appendChild(taskCell);

  const noteCell = document.createElement('td');
  noteCell.textContent = entry.note || '';
  row.appendChild(noteCell);

  const actionsCell = document.createElement('td');
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'delete-btn';
  deleteBtn.addEventListener('click', () => {
    onWorklogEntryDeleted(entry.id);
  });
  actionsCell.appendChild(deleteBtn);
  row.appendChild(actionsCell);

  if (historyTable) {
    const tbody = historyTable.querySelector('tbody');
    if (tbody) tbody.appendChild(row);
  }
}

/**
 * Creates a summary panel for worklog aggregations.
 * @returns {HTMLElement} Summary panel element.
 */
function createSummaryPanel() {
  const panel = document.createElement('div');
  panel.className = 'worklog-summary';

  const title = document.createElement('h3');
  title.textContent = 'Summary';
  panel.appendChild(title);

  const hoursByPerson = document.createElement('div');
  hoursByPerson.className = 'summary-section';
  hoursByPerson.innerHTML = '<h4>Hours by Person</h4><div id="hours-by-person"></div>';
  panel.appendChild(hoursByPerson);

  const hoursByTask = document.createElement('div');
  hoursByTask.className = 'summary-section';
  hoursByTask.innerHTML = '<h4>Hours by Task</h4><div id="hours-by-task"></div>';
  panel.appendChild(hoursByTask);

  return panel;
}

/**
 * Updates the summary panel with aggregated data.
 */
function updateSummaryPanel() {
  if (!_state?.project || !_state.worklog || !summaryPanel) return;

  const project = _state.project;
  const entries = _state.worklog;

  const hoursByPerson = {};
  const hoursByTask = {};

  entries.forEach(entry => {
    if (!hoursByPerson[entry.person_id]) hoursByPerson[entry.person_id] = 0;
    hoursByPerson[entry.person_id] += entry.hours;

    if (!hoursByTask[entry.task_id]) hoursByTask[entry.task_id] = 0;
    hoursByTask[entry.task_id] += entry.hours;
  });

  // Render hours by person
  const personContainer = summaryPanel.querySelector('#hours-by-person');
  if (personContainer) {
    personContainer.innerHTML = '';
    Object.entries(hoursByPerson).forEach(([personId, hours]) => {
      const person = project.people?.find(p => p.id === personId);
      const p = document.createElement('p');
      p.textContent = `${person?.name || 'Unknown'}: ${hours} hours`;
      personContainer.appendChild(p);
    });
  }

  // Render hours by task
  const taskContainer = summaryPanel.querySelector('#hours-by-task');
  if (taskContainer) {
    taskContainer.innerHTML = '';
    Object.entries(hoursByTask).forEach(([taskId, hours]) => {
      const task = project.tasks?.find(t => t.id === taskId);
      const p = document.createElement('p');
      p.textContent = `${task?.title || 'Unknown'}: ${hours} hours`;
      taskContainer.appendChild(p);
    });
  }
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Initializes the worklog UI module.
 * @param {HTMLElement} element - The DOM element for the worklog panel.
 * @param {Object} state - Global app state.
 */
function initWorklog(element, state) {
  _state = state;
  worklogElement = element;

  // Clear existing content
  element.innerHTML = '';

  // Create and append all UI components
  const form = createQuickEntryForm();
  historyTable = createHistoryTable();
  summaryPanel = createSummaryPanel();

  if (form) element.appendChild(form);
  element.appendChild(historyTable);
  element.appendChild(summaryPanel);
}

/**
 * Refreshes the worklog UI with the latest entries and aggregations.
 */
function refreshWorklogUI() {
  if (!_state?.project || !worklogElement) return;

  const entries = _state.worklog || [];

  // Re-render history table
  if (historyTable) {
    const tbody = historyTable.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = '';
      entries.forEach(entry => renderWorklogEntry(entry));
    }
  }

  // Update summary panel
  updateSummaryPanel();

  // Re-create form to ensure it has latest project data (e.g., new tasks/people)
  const existingForm = worklogElement.querySelector('.quick-entry-form');
  if (existingForm) {
    const newForm = createQuickEntryForm();
    if (newForm) worklogElement.replaceChild(newForm, existingForm);
  }
}

/**
 * Handles addition of a new worklog entry.
 * @param {WorkEntry} entry - The new worklog entry.
 */
function onWorklogEntryAdded(entry) {
  window.dispatchEvent(new CustomEvent('worklogEntryAdded', { detail: entry }));
  refreshWorklogUI(); // Immediate UI update (app.js will sync state via event)
}

/**
 * Handles deletion of a worklog entry.
 * @param {string} entryId - The ID of the entry to delete.
 */
function onWorklogEntryDeleted(entryId) {
  window.dispatchEvent(new CustomEvent('worklogEntryDeleted', { detail: entryId }));
  refreshWorklogUI();
}

// ============================================================================
// EXPORTS
// ============================================================================
export {
  initWorklog,
  refreshWorklogUI,
  onWorklogEntryAdded,
  onWorklogEntryDeleted
};
