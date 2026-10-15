// Index immutable observation values incrementally. Hovering never walks the
// full history, redraws a chart, advances the clock, or changes the simulation.
const histories = new WeakMap();

function boundary(points, value, key, after = false) {
  let lo = 0,
    hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid][key] < value || (after && points[mid][key] === value)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function inspectionIndex(data) {
  let state = histories.get(data);
  if (
    !state ||
    data.length < state.length ||
    (state.length && (data[0] !== state.first || data[state.length - 1] !== state.last))
  ) {
    state = { length: 0, groups: [], byTime: new Map() };
    histories.set(data, state);
  }
  const dirty = new Set();
  let sortTimes = false;
  for (let i = state.length; i < data.length; i++) {
    const p = data[i];
    if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
    let group = state.byTime.get(p.t);
    if (!group) {
      group = { t: p.t, points: [] };
      if (state.groups.length && p.t < state.groups.at(-1).t) sortTimes = true;
      state.groups.push(group);
      state.byTime.set(p.t, group);
    }
    group.points.push(p);
    dirty.add(group);
  }
  for (const group of dirty) group.points.sort((a, b) => a.v - b.v);
  if (sortTimes) state.groups.sort((a, b) => a.t - b.t);
  state.length = data.length;
  state.first = data[0];
  state.last = data.at(-1);
  return state;
}

export function inspectAt(index, averages, from, to, time, value) {
  time = Math.max(from, Math.min(to, time));
  const groups = index.groups;
  const start = boundary(groups, from, 't'),
    end = boundary(groups, to, 't', true);
  let observation = null;
  if (start < end) {
    let at = Math.max(start, Math.min(end - 1, boundary(groups, time, 't')));
    if (at > start && Math.abs(groups[at - 1].t - time) <= Math.abs(groups[at].t - time)) at--;
    const points = groups[at].points;
    let row = Math.min(points.length - 1, boundary(points, value, 'v'));
    if (row > 0 && Math.abs(points[row - 1].v - value) <= Math.abs(points[row].v - value)) row--;
    observation = points[row];
  }
  const average = averages[boundary(averages, time, 't', true) - 1] ?? null;
  return { time, observation, average };
}

const canvases = new WeakMap();
let active = null,
  scheduled = false,
  installed = false;
const clock = (t) => {
  const tenths = Math.round(t * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};

export function clearChartInspection() {
  if (active) {
    active.layer.hidden = true;
    active.canvas.removeAttribute('aria-describedby');
  }
  active = null;
}

function show(state) {
  if (!state.canvas.isConnected || !state.model) return clearChartInspection();
  if (active !== state) clearChartInspection();
  active = state;
  const m = state.model;
  const x = Math.max(m.left, Math.min(m.right, state.x));
  const time = m.from + ((x - m.left) / (m.right - m.left)) * (m.to - m.from);
  const value = Math.max(0, ((m.bottom - state.y) / (m.bottom - m.top)) * m.max);
  const result = inspectAt(m.index, m.averages, m.from, m.to, time, value);
  state.layer.hidden = false;
  state.line.style.left = `${x}px`;
  state.line.style.top = `${m.top}px`;
  state.line.style.height = `${m.bottom - m.top}px`;
  const { observation: p, average } = result;
  state.title.textContent = `Simulation ${clock(result.time)}`;
  state.observation.textContent = p
    ? `Nearest observation: ${p.v.toFixed(1)} s · at ${clock(p.t)}${p.v > m.max ? ' (above axis)' : ''}`
    : 'No individual observation in the visible time window';
  state.average.textContent = average
    ? `Trailing average: ${average.v.toFixed(1)} s`
    : 'Trailing average: unavailable at this time';
  const details = [];
  if (p?.id != null) details.push(`Passenger ${p.id}`);
  if (p?.bus != null) details.push(`Bus ${p.bus + 1}`);
  if (p?.stop != null) details.push(`Stop ${p.stop + 1}`);
  state.detail.textContent = details.join(' · ');
  state.dot.hidden = !p || p.v < 0 || p.v > m.max;
  if (!state.dot.hidden) {
    state.dot.style.left = `${m.left + ((p.t - m.from) / (m.to - m.from)) * (m.right - m.left)}px`;
    state.dot.style.top = `${m.bottom - (p.v / m.max) * (m.bottom - m.top)}px`;
    state.dot.style.borderColor = m.color;
  }
  state.tip.style.left = '0px';
  state.tip.style.top = '0px';
  const frame = state.frame.getBoundingClientRect(),
    tip = state.tip.getBoundingClientRect();
  const tipX = Math.max(0, Math.min(x + 12, frame.width - tip.width));
  const below = Math.min(m.bottom, state.y) + 16;
  const tipY =
    frame.top + below + tip.height <= innerHeight - 8
      ? below
      : Math.max(0, state.y - tip.height - 12);
  state.tip.style.left = `${tipX}px`;
  state.tip.style.top = `${tipY}px`;
  state.canvas.setAttribute('aria-describedby', state.tip.id);
}

function queue(state) {
  active = state;
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (active) show(active);
  });
}

export function updateChartInspection(canvas, data, view, geometry) {
  let state = canvases.get(canvas);
  if (!state) {
    const frame = document.createElement('div');
    frame.className = 'chart-frame';
    canvas.before(frame);
    frame.append(canvas);
    const layer = document.createElement('div');
    layer.className = 'chart-inspection';
    layer.hidden = true;
    const line = document.createElement('div'),
      dot = document.createElement('div');
    line.className = 'chart-crosshair';
    dot.className = 'chart-selected-dot';
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.id = `inspect-${canvas.id}`;
    tip.setAttribute('role', 'tooltip');
    const title = document.createElement('strong'),
      observation = document.createElement('span'),
      average = document.createElement('span'),
      detail = document.createElement('small');
    tip.append(title, observation, average, detail);
    layer.append(line, dot, tip);
    frame.append(layer);
    state = { canvas, frame, layer, line, dot, tip, title, observation, average, detail };
    canvases.set(canvas, state);
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-description',
      'Hover or tap to inspect. Left and right arrows move through time; Escape closes the readout.',
    );
    const point = (event) => {
      state.keyboard = false;
      const r = canvas.getBoundingClientRect(),
        m = state.model;
      state.x = event.clientX - r.left;
      state.y = event.clientY - r.top;
      if (state.x < m.left || state.x > m.right || state.y < m.top || state.y > m.bottom) {
        if (active === state) clearChartInspection();
        return;
      }
      if (active !== state) clearChartInspection();
      queue(state);
    };
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch') point(event);
    });
    canvas.addEventListener('pointerdown', point);
    canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch' && active === state) clearChartInspection();
    });
    canvas.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        clearChartInspection();
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      state.keyboard = true;
      const m = state.model,
        step = (m.right - m.left) / 100;
      if (active !== state) {
        clearChartInspection();
        state.x = (m.left + m.right) / 2;
      }
      state.x =
        event.key === 'Home'
          ? m.left
          : event.key === 'End'
            ? m.right
            : Math.max(
                m.left,
                Math.min(m.right, state.x + (event.key === 'ArrowRight' ? step : -step)),
              );
      state.y = (m.top + m.bottom) / 2;
      queue(state);
    });
    canvas.addEventListener('blur', () => {
      if (active === state) clearChartInspection();
    });
  }
  state.model = { ...geometry, index: inspectionIndex(data), averages: view.averages };
  if (active === state) show(state);
  if (!installed) {
    installed = true;
    document.addEventListener('pointerdown', (e) => {
      if (active && !active.frame.contains(e.target)) clearChartInspection();
    });
    document.addEventListener(
      'scroll',
      () => {
        if (active?.keyboard) show(active);
        else clearChartInspection();
      },
      true,
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') clearChartInspection();
    });
    window.addEventListener('resize', clearChartInspection);
  }
}
