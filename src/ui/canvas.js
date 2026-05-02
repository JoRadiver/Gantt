/**
 * Gantt.IO - Canvas Module
 *
 * Renders the Gantt chart: sticky timeline header, task bars,
 * group brackets, milestone diamonds, and elbow-style dependency arrows.
 *
 * Public API:
 *   initCanvas(element)
 *   refreshCanvas(project, appState)
 *   setZoom(zoom)
 *   syncCanvasScroll(scrollTop)
 *
 * Custom events dispatched on window:
 *   'canvasScroll'  { detail: scrollTop }
 *   'taskSelected'  { detail: taskId }
 */

// ============================================================================
// MODULE STATE
// ============================================================================

let _element  = null;   // <main id="canvas"> — the scroll container
let _project  = null;
let _appState = null;
let _zoom     = 'week';

let _wrapEl   = null;   // Full-size positioning wrapper
let _headerEl = null;   // Sticky SVG timeline header
let _canvasEl = null;   // <canvas> for bars
let _ctx      = null;

/** Cached layout, recomputed on every render pass. */
let _layout   = null;

// ============================================================================
// LAYOUT CONSTANTS
// ============================================================================

const ROW_H    = 32;   // px — must match sidebar row height
const BAR_H    = 18;   // px — height of a task bar
const BAR_R    = 3;    // px — bar corner radius
const HEADER_H = 48;   // px — two-row sticky header
const PAD_DAYS = 14;   // days of whitespace before/after project span

/** Pixels per day at each zoom level. */
const DAY_PX = { day: 44, week: 22, month: 8, quarter: 3 };

// ============================================================================
// COLOUR CONSTANTS
// ============================================================================

/** Three-stop colour palette for each task colour key. */
const PALETTE = {
  green:  { track: '#1a3326', fill: '#234d38', full: '#3dba74' },
  blue:   { track: '#1a2d52', fill: '#3a6199', full: '#5b9cf6' },
  teal:   { track: '#152e35', fill: '#1f5060', full: '#3db5c8' },
  purple: { track: '#281a4a', fill: '#5a3d8a', full: '#9f7ef5' },
  amber:  { track: '#3d2a06', fill: '#8a5c10', full: '#e8a23a' },
  coral:  { track: '#3d1a14', fill: '#8a3828', full: '#e8735b' },
  slate:  { track: '#1a2535', fill: '#3a5575', full: '#7494b5' },
  orange: { track: '#3d2806', fill: '#8a5208', full: '#e8922a' },
};

const DEFAULT_COLOR = 'blue';

/** Global colour tokens. */
const C = {
  bg:            '#0f1117',
  bgRowAlt:      '#111420',
  bgGroup:       '#1d2130',
  border:        '#2a2f42',
  border2:       '#373d54',
  text:          '#d4d8e8',
  textMuted:     '#6b7494',
  textDim:       '#3e4560',
  rowSelected:   '#1a2d52',
  milestoneRing: '#e8922a',
  milestoneCore: '#3d2806',
  depLine:       '#3e4560',
  depArrow:      '#6b7494',
  todayFill:     'rgba(91,156,246,0.10)',
  todayLine:     '#5b9cf6',
  critPath:      '#e85b5b',
  headerBg:      '#161922',
  headerBorder:  '#2a2f42',
  weekend:       'rgba(255,255,255,0.018)',
};

// ============================================================================
// DATE HELPERS
// ============================================================================

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

/** ISO week number for a Date. */
function _isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/** Convert a date value to a pixel x-coordinate. */
function _dateToX(date, rangeStart, dayPx) {
  return ((+new Date(date)) - (+rangeStart)) / 86400000 * dayPx;
}

// ============================================================================
// INIT
// ============================================================================

/**
 * Initialise the canvas module.
 * @param {HTMLElement} element - The <main id="canvas"> container.
 */
export function initCanvas(element) {
  _element = element;
  _element.classList.add('canvas--ready');
  _setupDOM();
  _renderEmpty('No project loaded. Click "New" or "Open" to get started.');
}

// ============================================================================
// REFRESH
// ============================================================================

/**
 * Re-render the Gantt chart for the given project and app state.
 * @param {Object} project  - Full project object.
 * @param {Object} appState - Global app state.
 */
export function refreshCanvas(project, appState) {
  if (!_element) return;
  _project  = project;
  _appState = appState;

  if (!project || !project.tasks || !project.tasks.length) {
    _renderEmpty('No tasks yet. Add your first task with "+ Add Task".');
    return;
  }

  _render();
}

// ============================================================================
// ZOOM
// ============================================================================

/**
 * Update the time-scale zoom and re-render.
 * @param {'day'|'week'|'month'|'quarter'} zoom
 */
export function setZoom(zoom) {
  _zoom = zoom;
  if (_project) refreshCanvas(_project, _appState);
}

// ============================================================================
// SCROLL SYNC
// ============================================================================

/**
 * Synchronise the canvas vertical scroll with the sidebar.
 * @param {number} scrollTop
 */
export function syncCanvasScroll(scrollTop) {
  if (!_element) return;
  _element.scrollTop = scrollTop;
}

// ============================================================================
// DOM SETUP
// ============================================================================

function _setupDOM() {
  _element.innerHTML = '';
  _element.style.overflow = 'auto';
  _element.style.position = 'relative';

  // Full-size wrapper — sets the scrollable content dimensions.
  _wrapEl = document.createElement('div');
  _wrapEl.className = 'canvas__wrap';
  _wrapEl.style.cssText = 'position: relative; min-width: 100%; min-height: 100%;';
  _element.appendChild(_wrapEl);

  // Sticky timeline header rendered as SVG.
  _headerEl = document.createElement('div');
  _headerEl.className = 'canvas__timeline';
  _headerEl.style.cssText = [
    'position: sticky',
    'top: 0',
    'z-index: 10',
    `background: ${C.headerBg}`,
    `border-bottom: 1px solid ${C.headerBorder}`,
    `height: ${HEADER_H}px`,
    'overflow: hidden',
    'flex-shrink: 0',
  ].join(';');
  _wrapEl.appendChild(_headerEl);

  // Canvas element for all Gantt bar rendering.
  _canvasEl = document.createElement('canvas');
  _canvasEl.className = 'canvas__bars';
  _canvasEl.style.display = 'block';
  _wrapEl.appendChild(_canvasEl);

  _ctx = _canvasEl.getContext('2d');

  _element.addEventListener('scroll', _onScroll, { passive: true });
  _canvasEl.addEventListener('click', _onCanvasClick);
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function _renderEmpty(message) {
  if (!_canvasEl) return;

  _headerEl.innerHTML = '';
  _headerEl.style.height = '0';

  const cw = Math.max(_element.clientWidth  || 600, 200);
  const ch = Math.max(_element.clientHeight || 400, 100);

  _wrapEl.style.width  = cw + 'px';
  _wrapEl.style.height = ch + 'px';

  _resizeCanvas(cw, ch);

  _ctx.fillStyle = C.bg;
  _ctx.fillRect(0, 0, cw, ch);

  _ctx.font         = '13px "IBM Plex Sans", sans-serif';
  _ctx.fillStyle    = C.textMuted;
  _ctx.textAlign    = 'center';
  _ctx.textBaseline = 'middle';
  _ctx.fillText(message, cw / 2, ch / 2);
  _ctx.textAlign = 'left';
}

// ============================================================================
// LAYOUT COMPUTATION
// ============================================================================

function _computeLayout() {
  const zoom    = _appState?.zoom ?? _zoom;
  const dayPx   = DAY_PX[zoom] ?? 22;
  const range   = _computeDateRange();
  const visible = _getVisibleTasks();
  const totalW  = Math.ceil((+range.end - +range.start) / 86400000) * dayPx;
  const totalH  = visible.length * ROW_H;

  return { zoom, dayPx, range, visible, totalW, totalH };
}

function _computeDateRange() {
  let min = Infinity, max = -Infinity;
  for (const t of _project.tasks) {
    const s = +new Date(t.start_date);
    const e = +new Date(t.end_date);
    if (s < min) min = s;
    if (e > max) max = e;
  }
  const pad = PAD_DAYS * 86400000;
  const start = new Date(min - pad);
  start.setHours(0, 0, 0, 0);
  const end = new Date(max + pad);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

/**
 * Returns visible tasks in tree order, respecting collapsedGroups.
 * @returns {{ task: Task, depth: number }[]}
 */
function _getVisibleTasks() {
  const collapsed = new Set(_appState?.collapsedGroups ?? []);
  const result = [];

  function walk(parentId, depth) {
    const children = _project.tasks
      .filter(t => (t.parent_id ?? null) === parentId)
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    for (const task of children) {
      result.push({ task, depth });
      if (task.type === 'group' && !collapsed.has(task.id)) {
        walk(task.id, depth + 1);
      }
    }
  }

  walk(null, 0);
  return result;
}

// ============================================================================
// MAIN RENDER PASS
// ============================================================================

function _render() {
  _layout = _computeLayout();
  const { totalW, totalH } = _layout;

  // Size the wrapper to hold the full timeline.
  _wrapEl.style.width  = totalW + 'px';
  _wrapEl.style.height = (HEADER_H + totalH) + 'px';

  // Size the sticky header.
  _headerEl.style.height = HEADER_H + 'px';
  _headerEl.style.width  = totalW + 'px';

  // Size and clear the drawing canvas.
  _resizeCanvas(totalW, totalH);

  _drawBackground();
  _drawGridLines();
  _drawTodayColumn();
  _drawBars();
  _drawDependencies();
  _buildHeader();
}

// ============================================================================
// CANVAS RESIZE HELPER
// ============================================================================

function _resizeCanvas(cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  _canvasEl.style.width  = cssW + 'px';
  _canvasEl.style.height = cssH + 'px';
  // Setting .width/.height resets the context transform.
  _canvasEl.width  = Math.round(cssW * dpr);
  _canvasEl.height = Math.round(cssH * dpr);
  _ctx.scale(dpr, dpr);
}

// ============================================================================
// DRAWING — BACKGROUND ROWS
// ============================================================================

function _drawBackground() {
  const { totalW, totalH, visible } = _layout;
  const selectedId = _appState?.selectedTaskId ?? null;

  _ctx.fillStyle = C.bg;
  _ctx.fillRect(0, 0, totalW, totalH);

  for (let i = 0; i < visible.length; i++) {
    const { task } = visible[i];
    const y = i * ROW_H;

    if (task.id === selectedId) {
      _ctx.fillStyle = C.rowSelected;
    } else if (task.type === 'group') {
      _ctx.fillStyle = C.bgGroup;
    } else {
      _ctx.fillStyle = i % 2 === 0 ? C.bg : C.bgRowAlt;
    }
    _ctx.fillRect(0, y, totalW, ROW_H);
  }
}

// ============================================================================
// DRAWING — GRID LINES
// ============================================================================

function _drawGridLines() {
  const { zoom, dayPx, range, totalH, totalW, visible } = _layout;
  const startMs = +range.start;
  const totalDays = Math.ceil((+range.end - startMs) / 86400000);

  const cur = new Date(range.start);

  for (let d = 0; d <= totalDays; d++) {
    const x   = d * dayPx;
    const dow = cur.getDay();           // 0 Sun – 6 Sat
    const isMonthStart  = cur.getDate() === 1;
    const isWeekStart   = dow === 1;    // Monday
    const isQuarterStart = isMonthStart && [0,3,6,9].includes(cur.getMonth());

    // Weekend shading (day zoom only)
    if (zoom === 'day' && (dow === 0 || dow === 6)) {
      _ctx.fillStyle = C.weekend;
      _ctx.fillRect(x, 0, dayPx, totalH);
    }

    // Vertical grid lines
    let alpha = 0, strokeColor = C.border;

    if (zoom === 'day') {
      alpha = isMonthStart ? 0.55 : isWeekStart ? 0.30 : 0.12;
      strokeColor = isMonthStart ? C.border2 : C.border;
    } else if (zoom === 'week') {
      if (isWeekStart) {
        alpha = isMonthStart ? 0.65 : 0.30;
        strokeColor = isMonthStart ? C.border2 : C.border;
      }
    } else if (zoom === 'month') {
      if (isMonthStart) {
        alpha = isQuarterStart ? 0.70 : 0.40;
        strokeColor = isQuarterStart ? C.border2 : C.border;
      }
    } else { // quarter
      if (isMonthStart) {
        alpha = isQuarterStart ? 0.70 : 0.25;
        strokeColor = isQuarterStart ? C.border2 : C.border;
      }
    }

    if (alpha > 0) {
      _ctx.globalAlpha = alpha;
      _ctx.strokeStyle = strokeColor;
      _ctx.lineWidth   = 1;
      _ctx.beginPath();
      _ctx.moveTo(x + 0.5, 0);
      _ctx.lineTo(x + 0.5, totalH);
      _ctx.stroke();
    }

    cur.setDate(cur.getDate() + 1);
  }

  _ctx.globalAlpha = 1;

  // Horizontal row separators
  _ctx.strokeStyle = C.border;
  _ctx.lineWidth   = 1;
  _ctx.globalAlpha = 0.45;
  for (let i = 1; i < visible.length; i++) {
    const y = i * ROW_H - 0.5;
    _ctx.beginPath();
    _ctx.moveTo(0, y);
    _ctx.lineTo(totalW, y);
    _ctx.stroke();
  }
  _ctx.globalAlpha = 1;
}

// ============================================================================
// DRAWING — TODAY COLUMN
// ============================================================================

function _drawTodayColumn() {
  const { range, dayPx, totalH } = _layout;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (+today < +range.start || +today > +range.end) return;

  const x = _dateToX(today, range.start, dayPx);

  // Soft background column
  _ctx.fillStyle = C.todayFill;
  _ctx.fillRect(x, 0, dayPx, totalH);

  // Dashed vertical line
  _ctx.strokeStyle = C.todayLine;
  _ctx.lineWidth   = 1.5;
  _ctx.globalAlpha = 0.7;
  _ctx.setLineDash([4, 3]);
  _ctx.beginPath();
  _ctx.moveTo(x + 0.5, 0);
  _ctx.lineTo(x + 0.5, totalH);
  _ctx.stroke();
  _ctx.setLineDash([]);
  _ctx.globalAlpha = 1;
}

// ============================================================================
// DRAWING — BARS (dispatcher)
// ============================================================================

function _drawBars() {
  const { visible, range, dayPx } = _layout;
  const selectedId   = _appState?.selectedTaskId   ?? null;
  const showCritPath = _appState?.showCriticalPath  ?? false;
  const scrollLeft   = _element ? _element.scrollLeft : 0;

  for (let i = 0; i < visible.length; i++) {
    const { task } = visible[i];
    const rowY = i * ROW_H;

    if (task.type === 'milestone') {
      _drawMilestone(task, rowY, range, dayPx, selectedId, scrollLeft);
    } else if (task.type === 'group') {
      _drawGroupBar(task, rowY, range, dayPx, selectedId, showCritPath, scrollLeft);
    } else {
      _drawTaskBar(task, rowY, range, dayPx, selectedId, showCritPath, scrollLeft);
    }
  }
}

// ============================================================================
// DRAWING — STANDARD TASK BAR
// ============================================================================

function _drawTaskBar(task, rowY, range, dayPx, selectedId, showCritPath, scrollLeft) {
  const x1 = _dateToX(task.start_date, range.start, dayPx);
  const x2 = _dateToX(task.end_date,   range.start, dayPx);
  const w  = Math.max(x2 - x1, BAR_R * 2);
  const barY  = rowY + (ROW_H - BAR_H) / 2;
  const pal   = _getPalette(task);
  const comp  = task.completion_manual ?? task.completion_derived ?? 0;
  const isSel = task.id === selectedId;
  const isCrit = showCritPath && task.prio === 'critical';

  // Background track
  _roundRect(_ctx, x1, barY, w, BAR_H, BAR_R);
  _ctx.fillStyle = isCrit ? 'rgba(232,91,91,0.12)' : pal.track;
  _ctx.fill();

  // Progress fill
  if (comp > 0) {
    const fillW = Math.max(w * Math.min(comp, 1), BAR_R * 2);
    _roundRect(_ctx, x1, barY, fillW, BAR_H, BAR_R);
    _ctx.fillStyle = comp >= 1 ? pal.full : pal.fill;
    _ctx.fill();
  }

  // Selection / critical-path ring
  if (isSel || isCrit) {
    _roundRect(_ctx, x1, barY, w, BAR_H, BAR_R);
    _ctx.strokeStyle = isSel ? '#5b9cf6' : C.critPath;
    _ctx.lineWidth   = isSel ? 2 : 1.5;
    _ctx.stroke();
  }

  // Bar label — sticky to left viewport edge when bar scrolls off-screen
  const labelX = Math.max(x1 + 5, scrollLeft + 5);
  const labelW = x2 - labelX - 5;
  if (labelW > 12) {
    _drawLabel(task.title, labelX, barY, labelW, BAR_H, isSel);
  }
}

// ============================================================================
// DRAWING — GROUP BRACKET
// ============================================================================

function _drawGroupBar(task, rowY, range, dayPx, selectedId, showCritPath, scrollLeft) {
  const x1 = _dateToX(task.start_date, range.start, dayPx);
  const x2 = _dateToX(task.end_date,   range.start, dayPx);
  const w  = Math.max(x2 - x1, 10);
  const pal  = _getPalette(task);
  const isSel = task.id === selectedId;
  const isCrit = showCritPath && task.prio === 'critical';

  const barColor = isCrit ? C.critPath : (isSel ? pal.full : pal.fill);

  // Horizontal spine
  const spineY = rowY + Math.round(ROW_H * 0.5);
  const thick  = 3;
  _ctx.fillStyle = barColor;
  _ctx.fillRect(x1, spineY - Math.floor(thick / 2), w, thick);

  // Left arm (drops down)
  const armH = 6;
  _ctx.fillRect(x1, spineY - Math.floor(thick / 2), thick, armH);

  // Right arm
  _ctx.fillRect(x2 - thick, spineY - Math.floor(thick / 2), thick, armH);

  // Subtle completion stripe along the spine
  const comp = task.completion_manual ?? task.completion_derived ?? 0;
  if (comp > 0) {
    const stripeW = (w - thick * 2) * Math.min(comp, 1);
    _ctx.fillStyle = pal.full;
    _ctx.globalAlpha = 0.5;
    _ctx.fillRect(x1 + thick, spineY - 1, stripeW, 2);
    _ctx.globalAlpha = 1;
  }

  // Label
  const labelX = Math.max(x1 + 5, scrollLeft + 5);
  const labelW = x2 - labelX - 5;
  if (labelW > 12) {
    const labelY = rowY + (ROW_H - BAR_H) / 2;
    _drawLabel(task.title, labelX, labelY, labelW, BAR_H, isSel, true);
  }
}

// ============================================================================
// DRAWING — MILESTONE DIAMOND
// ============================================================================

function _drawMilestone(task, rowY, range, dayPx, selectedId, scrollLeft) {
  const mx   = _dateToX(task.start_date, range.start, dayPx);
  const cy   = rowY + ROW_H / 2;
  const r    = 7;
  const isSel = task.id === selectedId;

  // Diamond
  _ctx.beginPath();
  _ctx.moveTo(mx,     cy - r);
  _ctx.lineTo(mx + r, cy);
  _ctx.lineTo(mx,     cy + r);
  _ctx.lineTo(mx - r, cy);
  _ctx.closePath();
  _ctx.fillStyle   = C.milestoneCore;
  _ctx.fill();
  _ctx.strokeStyle = isSel ? '#fff' : C.milestoneRing;
  _ctx.lineWidth   = isSel ? 2.5 : 1.5;
  _ctx.stroke();

  // Label to the right of the diamond (or sticky if off-screen)
  const labelX = Math.max(mx + r + 6, scrollLeft + 5);
  if (labelX < _layout.totalW - 20) {
    _ctx.font         = `500 11px "IBM Plex Sans", sans-serif`;
    _ctx.fillStyle    = C.textMuted;
    _ctx.textBaseline = 'middle';
    _ctx.fillText(_truncate(task.title, 140, _ctx), labelX, cy);
  }
}

// ============================================================================
// DRAWING — BAR LABEL
// ============================================================================

function _drawLabel(title, x, barY, maxW, barH, selected, dim = false) {
  _ctx.save();
  _ctx.beginPath();
  _ctx.rect(x, barY, maxW, barH);
  _ctx.clip();

  _ctx.font         = `500 11px "IBM Plex Sans", sans-serif`;
  _ctx.fillStyle    = selected ? C.text : (dim ? C.textMuted : C.text);
  _ctx.globalAlpha  = dim ? 0.75 : 1;
  _ctx.textBaseline = 'middle';
  _ctx.fillText(_truncate(title, maxW, _ctx), x, barY + barH / 2);

  _ctx.restore();
  _ctx.globalAlpha = 1;
}

// ============================================================================
// DRAWING — DEPENDENCY ARROWS (elbow style)
// ============================================================================

function _drawDependencies() {
  if (!_project.dependencies?.length) return;

  const { range, dayPx, visible } = _layout;
  const rowOf = new Map(visible.map(({ task }, i) => [task.id, i]));

  _ctx.strokeStyle = C.depLine;
  _ctx.fillStyle   = C.depArrow;
  _ctx.lineWidth   = 1;
  _ctx.setLineDash([3, 3]);

  for (const dep of _project.dependencies) {
    const fromIdx = rowOf.get(dep.from_task_id);
    const toIdx   = rowOf.get(dep.to_task_id);
    if (fromIdx === undefined || toIdx === undefined) continue;

    const fromTask = _project.tasks.find(t => t.id === dep.from_task_id);
    const toTask   = _project.tasks.find(t => t.id === dep.to_task_id);
    if (!fromTask || !toTask) continue;

    let x1, x2;
    if (dep.rule === 'finish_to_start') {
      x1 = _dateToX(fromTask.end_date,   range.start, dayPx);
      x2 = _dateToX(toTask.start_date,   range.start, dayPx);
    } else { // start_to_start
      x1 = _dateToX(fromTask.start_date, range.start, dayPx);
      x2 = _dateToX(toTask.start_date,   range.start, dayPx);
    }

    const y1 = fromIdx * ROW_H + ROW_H / 2;
    const y2 = toIdx   * ROW_H + ROW_H / 2;

    _drawElbow(x1, y1, x2, y2);
  }

  _ctx.setLineDash([]);
}

/**
 * Draw an elbow-style (right-angle) connector from (x1,y1) to (x2,y2)
 * with an arrowhead at the destination.
 */
function _drawElbow(x1, y1, x2, y2) {
  const GAP  = 8;   // horizontal gap before turning vertical
  const midX = x1 + GAP + Math.max(0, (x2 - x1 - GAP * 2) / 2);

  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.lineTo(midX, y1);   // horizontal leg out of source
  _ctx.lineTo(midX, y2);   // vertical leg
  _ctx.lineTo(x2,   y2);   // horizontal leg into target
  _ctx.stroke();

  // Arrowhead pointing right (toward x2)
  _ctx.setLineDash([]);
  _ctx.globalAlpha = 0.8;
  _ctx.beginPath();
  const aL = 5, aW = 3.5;
  const dir = x2 >= x1 ? 1 : -1;
  _ctx.moveTo(x2,                y2);
  _ctx.lineTo(x2 - dir * aL,     y2 - aW);
  _ctx.lineTo(x2 - dir * aL,     y2 + aW);
  _ctx.closePath();
  _ctx.fill();
  _ctx.globalAlpha = 1;
  _ctx.setLineDash([3, 3]);
}

// ============================================================================
// TIMELINE HEADER (SVG)
// ============================================================================

/**
 * Build the sticky SVG timeline header with two rows:
 *   upper: months (or years for long-range views)
 *   lower: weeks / days / months / quarters (by zoom)
 */
function _buildHeader() {
  const { zoom, dayPx, range, totalW } = _layout;
  const UPPER_H = 22;
  const LOWER_H = HEADER_H - UPPER_H;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width',  totalW);
  svg.setAttribute('height', HEADER_H);
  svg.style.display = 'block';

  // Background
  const bg = _svgEl('rect', { x:0, y:0, width:totalW, height:HEADER_H, fill: C.headerBg });
  svg.appendChild(bg);

  // Upper row (months or years)
  const upperSegs = (zoom === 'quarter' || zoom === 'month')
    ? _segsByYear(range)
    : _segsByMonth(range);
  _renderHeaderRow(svg, upperSegs, dayPx, range.start, 0, UPPER_H, true);

  // Row divider
  svg.appendChild(_svgEl('line', {
    x1: 0, y1: UPPER_H + 0.5, x2: totalW, y2: UPPER_H + 0.5,
    stroke: C.border, 'stroke-width': 1,
  }));

  // Lower row
  let lowerSegs;
  if      (zoom === 'day')     lowerSegs = _segsByDay(range);
  else if (zoom === 'week')    lowerSegs = _segsByWeek(range);
  else if (zoom === 'month')   lowerSegs = _segsByMonth(range);
  else                         lowerSegs = _segsByQuarter(range);

  _renderHeaderRow(svg, lowerSegs, dayPx, range.start, UPPER_H, LOWER_H, false);

  // Bottom border
  svg.appendChild(_svgEl('line', {
    x1: 0, y1: HEADER_H - 0.5, x2: totalW, y2: HEADER_H - 0.5,
    stroke: C.headerBorder, 'stroke-width': 1,
  }));

  _headerEl.innerHTML = '';
  _headerEl.appendChild(svg);
}

function _renderHeaderRow(svg, segs, dayPx, rangeStart, offsetY, rowH, isUpper) {
  const today = new Date(); today.setHours(0,0,0,0);

  for (const seg of segs) {
    const x = (seg.startMs - +rangeStart) / 86400000 * dayPx;
    const w = (seg.endMs   - seg.startMs) / 86400000 * dayPx;
    if (w < 1) continue;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Today highlight (lower row only)
    if (!isUpper && seg.isToday) {
      g.appendChild(_svgEl('rect', {
        x, y: offsetY, width: w, height: rowH,
        fill: 'rgba(91,156,246,0.10)',
      }));
    }

    // Weekend fill (lower row, day zoom)
    if (!isUpper && seg.isWeekend) {
      g.appendChild(_svgEl('rect', {
        x, y: offsetY, width: w, height: rowH, fill: C.weekend,
      }));
    }

    // Separator
    g.appendChild(_svgEl('line', {
      x1: x + 0.5, y1: offsetY, x2: x + 0.5, y2: offsetY + rowH,
      stroke: isUpper ? C.border2 : C.border,
      'stroke-width': 1,
      'stroke-opacity': isUpper ? 0.6 : 0.35,
    }));

    // Label
    if (seg.label && w > 12) {
      const clipId = `hc-${Math.random().toString(36).slice(2,8)}`;
      const defs   = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const clip   = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      clip.setAttribute('id', clipId);
      clip.appendChild(_svgEl('rect', {
        x: x + 3, y: offsetY,
        width:  Math.max(w - 6, 0),
        height: rowH,
      }));
      defs.appendChild(clip);
      g.appendChild(defs);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + 5);
      text.setAttribute('y', offsetY + rowH / 2);
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-family', '"IBM Plex Mono", monospace');
      text.setAttribute('font-size',   isUpper ? '10' : '9');
      text.setAttribute('font-weight', '500');
      text.setAttribute('fill',        isUpper ? C.textMuted : C.textDim);
      text.setAttribute('clip-path',   `url(#${clipId})`);
      text.textContent = seg.label;
      g.appendChild(text);
    }

    svg.appendChild(g);
  }
}

// ============================================================================
// DATE SEGMENT BUILDERS
// ============================================================================

/** Returns segments, each with { startMs, endMs, label, isToday?, isWeekend? } */

function _segsByYear({ start, end }) {
  const segs = [];
  const cur  = new Date(start.getFullYear(), 0, 1);
  while (+cur < +end) {
    const segStart = Math.max(+cur, +start);
    const next     = new Date(cur.getFullYear() + 1, 0, 1);
    const segEnd   = Math.min(+next, +end);
    segs.push({ startMs: segStart, endMs: segEnd, label: String(cur.getFullYear()) });
    cur.setFullYear(cur.getFullYear() + 1);
  }
  return segs;
}

function _segsByQuarter({ start, end }) {
  const segs = [];
  const qStart = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
  const cur    = new Date(qStart);
  while (+cur < +end) {
    const segStart = Math.max(+cur, +start);
    const next     = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
    const segEnd   = Math.min(+next, +end);
    const q        = Math.floor(cur.getMonth() / 3) + 1;
    segs.push({ startMs: segStart, endMs: segEnd, label: `Q${q} ${cur.getFullYear()}` });
    cur.setMonth(cur.getMonth() + 3);
  }
  return segs;
}

function _segsByMonth({ start, end }) {
  const segs = [];
  const cur  = new Date(start.getFullYear(), start.getMonth(), 1);
  while (+cur < +end) {
    const segStart = Math.max(+cur, +start);
    const next     = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const segEnd   = Math.min(+next, +end);
    const wPx      = (segEnd - segStart) / 86400000 * (DAY_PX[_layout?.zoom ?? 'week'] ?? 22);
    const label    = wPx > 56
      ? `${MONTH_FULL[cur.getMonth()]} ${cur.getFullYear()}`
      : wPx > 22
        ? MONTH_SHORT[cur.getMonth()]
        : '';
    segs.push({ startMs: segStart, endMs: segEnd, label });
    cur.setMonth(cur.getMonth() + 1);
  }
  return segs;
}

function _segsByWeek({ start, end }) {
  const segs  = [];
  const today = new Date(); today.setHours(0,0,0,0);
  // Snap to preceding Monday
  const cur   = new Date(start);
  cur.setHours(0,0,0,0);
  cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));

  while (+cur < +end) {
    const segStart = Math.max(+cur, +start);
    const next     = new Date(+cur + 7 * 86400000);
    const segEnd   = Math.min(+next, +end);
    const wPx      = (segEnd - segStart) / 86400000 * (DAY_PX[_layout?.zoom ?? 'week'] ?? 22);
    const week     = _isoWeek(cur);
    const isToday  = +cur <= +today && +today < +next;
    const label    = wPx > 22 ? `W${week}` : '';
    segs.push({ startMs: segStart, endMs: segEnd, label, isToday });
    cur.setDate(cur.getDate() + 7);
  }
  return segs;
}

function _segsByDay({ start, end }) {
  const segs  = [];
  const today = new Date(); today.setHours(0,0,0,0);
  const cur   = new Date(start);
  cur.setHours(0,0,0,0);

  const dayPx = DAY_PX[_layout?.zoom ?? 'day'] ?? 44;

  while (+cur < +end) {
    const segStart  = +cur;
    const segEnd    = +cur + 86400000;
    const dow       = cur.getDay();
    const isToday   = +cur === +today;
    const isWeekend = dow === 0 || dow === 6;
    const label     = dayPx > 22 ? String(cur.getDate()) : '';
    segs.push({ startMs: segStart, endMs: segEnd, label, isToday, isWeekend });
    cur.setDate(cur.getDate() + 1);
  }
  return segs;
}

// ============================================================================
// SVG UTILITY
// ============================================================================

function _svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ============================================================================
// CANVAS UTILITY
// ============================================================================

function _roundRect(ctx, x, y, w, h, r) {
  if (w < r * 2) r = w / 2;
  if (h < r * 2) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

function _truncate(text, maxW, ctx) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

function _getPalette(task) {
  return PALETTE[task.color] ?? PALETTE[DEFAULT_COLOR];
}

// ============================================================================
// HIT TESTING
// ============================================================================

/**
 * Return the task_id at canvas coordinates (x, y), or null.
 * @param {number} x
 * @param {number} y
 * @returns {string|null}
 */
export function hitTest(x, y) {
  if (!_layout) return null;
  const { visible, range, dayPx } = _layout;
  const rowIdx = Math.floor(y / ROW_H);
  if (rowIdx < 0 || rowIdx >= visible.length) return null;

  const { task } = visible[rowIdx];
  const x1 = _dateToX(task.start_date, range.start, dayPx);
  const x2 = _dateToX(task.end_date,   range.start, dayPx);

  if (task.type === 'milestone') {
    return Math.abs(x - x1) <= 10 ? task.id : null;
  }
  return x >= x1 - 2 && x <= x2 + 2 ? task.id : null;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function _onScroll() {
  window.dispatchEvent(new CustomEvent('canvasScroll', {
    detail: _element.scrollTop,
  }));
}

function _onCanvasClick(e) {
  if (!_layout) return;
  const rect = _canvasEl.getBoundingClientRect();
  const id = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  if (id !== null) {
    window.dispatchEvent(new CustomEvent('taskSelected', { detail: id }));
  }
}
