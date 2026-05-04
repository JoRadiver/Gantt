/**
 * Gantt.IO - Business Logic Engine
 *
 * Handles task tree operations, dependency resolution, worklog aggregation,
 * and snapshot rebuilding. No rendering, no file I/O.
 */

// ============================================================================
// IMPORTS
// ============================================================================
/**
 * @typedef {import('../core.js').Project} Project
 * @typedef {import('../core.js').Task} Task
 * @typedef {import('../core.js').Dependency} Dependency
 * @typedef {import('../core.js').WorkEntry} WorkEntry
 * @typedef {import('../core.js').PaletteKey} PaletteKey
 */

// ============================================================================
// TASK TREE OPERATIONS
// ============================================================================

/**
 * Get all children of a task in the task tree.
 * @param {string} taskId - ID of the parent task
 * @param {Task[]} tasks - Array of all tasks
 * @returns {Task[]} Array of child tasks
 */
function getChildren(taskId, tasks) {
  return tasks.filter(task => task.parent_id === taskId);
}

/**
 * Get all descendants of a task in the task tree.
 * @param {string} taskId - ID of the parent task
 * @param {Task[]} tasks - Array of all tasks
 * @returns {Task[]} Array of descendant tasks
 */
function getDescendants(taskId, tasks) {
  const children = getChildren(taskId, tasks);
  let descendants = [...children];
  for (const child of children) {
    descendants = [...descendants, ...getDescendants(child.id, tasks)];
  }
  return descendants;
}

/**
 * Get all siblings of a task in the task tree.
 * @param {string} taskId - ID of the task
 * @param {Task[]} tasks - Array of all tasks
 * @returns {Task[]} Array of sibling tasks
 */
function getSiblings(taskId, tasks) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.parent_id) return [];
  return tasks.filter(t => t.parent_id === task.parent_id && t.id !== taskId);
}

/**
 * Get the path from a task to the root (ancestors).
 * @param {string} taskId - ID of the task
 * @param {Task[]} tasks - Array of all tasks
 * @returns {Task[]} Array of ancestor tasks, ordered from parent to root
 */
function getPath(taskId, tasks) {
  const path = [];
  let currentId = taskId;
  while (currentId) {
    const currentTask = tasks.find(t => t.id === currentId);
    if (!currentTask) break;
    path.unshift(currentTask);
    currentId = currentTask.parent_id;
  }
  return path;
}

/**
 * Get all root tasks (tasks with no parent).
 * @param {Task[]} tasks - Array of all tasks
 * @returns {Task[]} Array of root tasks
 */
function getRootTasks(tasks) {
  return tasks.filter(task => !task.parent_id);
}

// ============================================================================
// ROLLUP OPERATIONS
// ============================================================================

/**
 * Roll up task data for a group (e.g., sum progress, hours).
 * @param {string} taskId - ID of the group task
 * @param {Task[]} tasks - Array of all tasks
 * @returns {Task} Updated group task with rolled-up data
 */
function rollupGroup(taskId, tasks) {
  const descendants = getDescendants(taskId, tasks);
  const groupTask = tasks.find(t => t.id === taskId);
  if (!groupTask) return null;

  let totalHours = 0;
  let totalProgress = 0;
  let childCount = 0;

  for (const descendant of descendants) {
    if (descendant.hours_spent) totalHours += descendant.hours_spent;
    if (descendant.completion !== undefined) {
      totalProgress += descendant.completion;
      childCount++;
    }
  }

  return {
    ...groupTask,
    hours_spent: totalHours,
    completion_derived: childCount > 0 ? totalProgress / childCount : 0,
    isGroup: true,
  };
}

// ============================================================================
// DEPENDENCY RESOLUTION
// ============================================================================

/**
 * Compute the earliest start date for a task based on its dependencies.
 * @param {Task} task - Task to compute start date for
 * @param {Task[]} tasks - Array of all tasks
 * @param {Dependency[]} dependencies - Array of all dependencies
 * @returns {Date} Earliest start date
 */
function computeEarliestStart(task, tasks, dependencies) {
  const taskDependencies = dependencies.filter(d => d.to === task.id);
  let earliestStart = task.start_date ? new Date(task.start_date) : new Date(0);

  for (const dep of taskDependencies) {
    const fromTask = tasks.find(t => t.id === dep.from);
    if (fromTask && fromTask.end_date) {
      const fromEnd = new Date(fromTask.end_date);
      const requiredStart = new Date(fromEnd);
      requiredStart.setDate(requiredStart.getDate() + (dep.lag || 0));
      if (requiredStart > earliestStart) {
        earliestStart = requiredStart;
      }
    }
  }

  return earliestStart;
}

/**
 * Calculate the shift required for a dependency.
 * @param {Dependency} dependency - Dependency to calculate shift for
 * @param {Task[]} tasks - Array of all tasks
 * @returns {number} Shift in days
 */
function getDependencyShift(dependency, tasks) {
  const fromTask = tasks.find(t => t.id === dependency.from);
  const toTask = tasks.find(t => t.id === dependency.to);

  if (!fromTask || !toTask) return 0;

  const fromEnd = new Date(fromTask.end_date);
  const toStart = new Date(toTask.start_date);

  // Calculate the gap between fromTask's end and toTask's start
  const gap = toStart - fromEnd - (dependency.lag || 0) * 24 * 60 * 60 * 1000;

  // If toTask starts after fromTask ends + lag, no shift needed
  if (gap >= 0) return 0;

  // Otherwise, shift toTask forward by the absolute gap
  return Math.abs(gap) / (24 * 60 * 60 * 1000);
}

/**
 * Check if adding a dependency would create a cycle.
 * @param {Dependency} newDependency - New dependency to check
 * @param {Dependency[]} dependencies - Array of all dependencies
 * @param {Task[]} tasks - Array of all tasks
 * @returns {boolean} True if a cycle would be created
 */
function wouldCreateCycle(newDependency, dependencies, tasks) {
  // Build a graph from existing dependencies
  const graph = {};
  tasks.forEach(t => graph[t.id] = []);
  dependencies.forEach(d => {
    if (!graph[d.from]) graph[d.from] = [];
    graph[d.from].push(d.to);
  });

  // Add the new dependency
  if (!graph[newDependency.from]) graph[newDependency.from] = [];
  graph[newDependency.from].push(newDependency.to);

  // Check for cycles using DFS
  const visited = new Set();
  const recursionStack = new Set();

  function hasCycle(node) {
    if (!visited.has(node)) {
      visited.add(node);
      recursionStack.add(node);

      for (const neighbor of graph[node] || []) {
        if (!visited.has(neighbor) && hasCycle(neighbor)) {
          return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }
    }
    recursionStack.delete(node);
    return false;
  }

  for (const node in graph) {
    if (hasCycle(node)) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// WORKLOG AGGREGATION
// ============================================================================

/**
 * Aggregate worklog entries by task.
 * @param {WorkEntry[]} entries - Array of worklog entries
 * @returns {Map<string, {hours_spent: number, last_entry_date: string}>} Map of task ID to aggregated data
 */
function aggregateByTask(entries) {
  const aggregation = new Map();

  for (const entry of entries) {
    if (!aggregation.has(entry.taskId)) {
      aggregation.set(entry.taskId, {
        hours_spent: 0,
        last_entry_date: entry.date,
      });
    }
    const data = aggregation.get(entry.taskId);
    data.hours_spent += entry.hours;
    if (new Date(entry.date) > new Date(data.last_entry_date)) {
      data.last_entry_date = entry.date;
    }
  }

  return aggregation;
}

/**
 * Computes completion_derived for all tasks in a project.
 * - Uses completion_manual if set (assumed sanitized 0-1)
 * - For tasks/milestones: min(hours_spent / estimated_hours, 0.99)
 * - For groups: average of children's (completion_manual || completion_derived)
 * @param {Project} project - Project to update
 * @returns {Project} Project with completion_derived populated
 */
function computeAllCompletions(project) {
  const taskMap = new Map(project.tasks.map(task => [task.id, task]));
  const completionCache = new Map();

  function getCompletion(taskId) {
    if (completionCache.has(taskId)) return completionCache.get(taskId);

    const task = taskMap.get(taskId);
    if (!task) return completionCache.set(taskId, 0).get(taskId);

    // For groups: ALWAYS compute from children (ignore manual)
    if (task.type === 'group') {
      const children = project.tasks.filter(t => t.parent_id === task.id);
      if (children.length === 0) return completionCache.set(taskId, 0).get(taskId);
      const sum = children.reduce((acc, child) => acc + getCompletion(child.id), 0);
      return completionCache.set(taskId, sum / children.length).get(taskId);
    }

    // For tasks/milestones: use manual if set, otherwise compute
    if (task.completion_manual !== null && task.completion_manual !== undefined) {
      return completionCache.set(taskId, task.completion_manual).get(taskId);
    }

    // Tasks/milestones: hours spent / estimated hours (capped at 99%)
    if (task.type === 'task' || task.type === 'milestone') {
      const hoursSpent = task.hours_spent || 0;
      const estimatedHours = task.estimated_hours || 0;
      const value = estimatedHours === 0 ? 0 : Math.min(hoursSpent / estimatedHours, 0.99);
      return completionCache.set(taskId, value).get(taskId);
    }

    return completionCache.set(taskId, 0).get(taskId);
  }

  return {
    ...project,
    tasks: project.tasks.map(task => ({
      ...task,
      completion_derived: getCompletion(task.id)
    }))
  };
}

/**
 * Rebuild all derived fields in the project (e.g., hours_spent, completion_derived).
 * @param {Project} project - Project to rebuild
 * @param {WorkEntry[]} worklogEntries - Array of worklog entries
 * @returns {Project} Updated project with derived fields
 */
function rebuildSnapshots(project, worklogEntries) {
  const aggregated = aggregateByTask(worklogEntries);

  const updatedTasks = project.tasks.map(task => {
    const taskAggregation = aggregated.get(task.id) || {
      hours_spent: 0,
      last_entry_date: null,
    };

    return {
      ...task,
      hours_spent: taskAggregation.hours_spent,
      last_worklog_date: taskAggregation.last_entry_date,
      // You might also want to update completion_derived here if needed
    };
  });

  return computeAllCompletions({
    ...project,
    tasks: updatedTasks
  });
}

// ============================================================================
// COLOR RESOLUTION
// ============================================================================

/**
 * Resolve the color for a task based on its properties and project metadata.
 * @param {Task} task - Task to resolve color for
 * @param {Task[]} tasks - Array of all tasks
 * @param {Project['meta']} projectMeta - Project metadata
 * @returns {PaletteKey} Resolved color key
 */
function resolveColor(task, tasks, projectMeta) {
  // Default to the project's default color
  let colorKey = projectMeta?.defaultColor || 'default';

  // If task has a specific color, use it
  if (task.color) {
    colorKey = task.color;
  }
  // If task is a group, use group color
  else if (task.isGroup) {
    colorKey = projectMeta?.groupColor || 'group';
  }
  // If task is a milestone, use milestone color
  else if (task.type === 'milestone') {
    colorKey = projectMeta?.milestoneColor || 'milestone';
  }

  return colorKey;
}

// ============================================================================
// GROUP DATE ROLLUP
// ============================================================================

/**
 * Updates a group's start and end dates to encompass all its descendants.
 * A group always runs for the duration of its members (children, grandchildren, etc.).
 * Modifies the group task in place.
 * @param {Task} group - The group task to update
 * @param {Task[]} tasks - Array of all tasks
 */
function updateGroupDates(group, tasks) {
  if (group.type !== 'group') return;

  const allDescendants = getDescendants(group.id, tasks);
  if (allDescendants.length === 0) {
    // If no descendants, keep existing dates
    return;
  }

  let earliestStart = null;
  let latestEnd = null;

  for (const descendant of allDescendants) {
    if (descendant.start_date) {
      const start = new Date(descendant.start_date);
      if (!earliestStart || start < earliestStart) {
        earliestStart = start;
      }
    }
    if (descendant.end_date) {
      const end = new Date(descendant.end_date);
      if (!latestEnd || end > latestEnd) {
        latestEnd = end;
      }
    }
  }

  // Only update if we found valid dates
  if (earliestStart && latestEnd) {
    group.start_date = earliestStart.toISOString().split('T')[0];
    group.end_date = latestEnd.toISOString().split('T')[0];
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
// Export all functions for use in other modules
export {
  // Task tree operations
  getChildren,
  getDescendants,
  getSiblings,
  getPath,
  getRootTasks,
  // Rollup operations
  rollupGroup,
  updateGroupDates,
  // Dependency resolution
  computeEarliestStart,
  getDependencyShift,
  wouldCreateCycle,
  // Worklog aggregation
  aggregateByTask,
  rebuildSnapshots,
  // Color resolution
  resolveColor,
}
