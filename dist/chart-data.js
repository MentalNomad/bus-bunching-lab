// Observation arrays append in time order; commitT is filled in when a visit
// finishes. Cache completed history and revisit only unfinished observations.
// A rebuilt simulation owns new arrays, so abandoned caches can be collected.
const histories = new WeakMap();
function boundary(data, time, after = false) {
  let lo = 0,
    hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data[mid].t < time || (after && data[mid].t === time)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function compareGroups(a, b) {
  return a.t - b.t || a.first - b.first;
}
function history(data) {
  let h = histories.get(data);
  if (
    !h ||
    data.length < h.length ||
    (h.length && (h.first !== data[0] || h.last !== data[h.length - 1]))
  ) {
    h = {
      length: 0,
      first: null,
      last: null,
      ordered: true,
      max: 10,
      pending: new Map(),
      groups: [],
      byKey: new Map(),
      batch: null,
      individual: null,
    };
    histories.set(data, h);
  }
  let changed = Infinity,
    sort = false;
  const commit = (p, index) => {
    const t = p.commitT;
    if (t === undefined) return false;
    const key = `${t}:${p.bus ?? 0}`;
    let g = h.byKey.get(key);
    if (!g) {
      g = { t, first: index, indices: [], values: [], index: h.groups.length };
      if (g.index && compareGroups(h.groups[g.index - 1], g) > 0) sort = true;
      h.groups.push(g);
      h.byKey.set(key, g);
    }
    changed = Math.min(changed, g.index);
    // A caller can publish an earlier unfinished observation after other values
    // at the same departure time. Preserve their original observation order.
    if (index < g.first) {
      g.first = index;
      sort = true;
    }
    let at = g.indices.length;
    while (at && g.indices[at - 1] > index) at--;
    g.indices.splice(at, 0, index);
    g.values.splice(at, 0, p.v);
    return true;
  };
  // Engine arrays signal commit mutations. Generic caller arrays have no signal,
  // so inspect their unfinished records on each read for compatibility.
  if (data.commitRevision === undefined || data.commitRevision !== h.commitRevision)
    for (const [index, p] of h.pending) if (commit(p, index)) h.pending.delete(index);
  for (let i = h.length; i < data.length; i++) {
    const p = data[i];
    if (i && p.t < data[i - 1].t) h.ordered = false;
    h.max = Math.max(h.max, p.v);
    if (!commit(p, i)) h.pending.set(i, p);
  }
  if (sort) {
    h.groups.sort(compareGroups);
    for (let i = 0; i < h.groups.length; i++) h.groups[i].index = i;
    changed = 0;
  }
  if (h.batch && changed < h.batch.points.length) h.batch = null;
  h.length = data.length;
  h.first = data[0];
  h.last = data.at(-1);
  h.commitRevision = data.commitRevision;
  return h;
}
function averageHistory(h, data, windowSize, mode) {
  const batch = mode === 'batch',
    key = batch ? 'batch' : 'individual';
  let state = h[key];
  // Keep the active window for each mode; changing its size recomputes once.
  if (!state || state.windowSize !== windowSize)
    state = h[key] = { windowSize, points: [], start: 0, sum: 0, count: 0 };
  const groups = batch ? h.groups : data;
  for (let i = state.points.length; i < groups.length; i++) {
    const g = groups[i],
      values = batch ? g.values : [g.v];
    for (const v of values) {
      state.sum += v;
      state.count++;
    }
    while (state.start < i) {
      const old = batch ? groups[state.start].values : [groups[state.start].v];
      if (state.count - old.length < windowSize) break;
      for (const v of old) {
        state.sum -= v;
        state.count--;
      }
      state.start++;
    }
    state.points.push({ t: g.t, v: state.sum / state.count, count: state.count });
  }
  return state.points;
}
function view(raw, recent, averages, now) {
  const from = Math.max(0, now - 3600),
    end = boundary(averages, now, true),
    start = boundary(averages, from),
    last = averages[end - 1];
  const visible = averages.slice(start, end);
  if (start && start <= end) visible.unshift({ ...averages[start - 1], t: from });
  let low = null,
    high = null;
  for (const p of recent) {
    low = low === null ? p.v : Math.min(low, p.v);
    high = high === null ? Math.max(0, p.v) : Math.max(high, p.v);
  }
  return {
    raw,
    averages: visible,
    low,
    high,
    recentCount: recent.length,
    average: last?.v ?? null,
    averageTime: last?.t ?? null,
    averageCount: last?.count ?? 0,
  };
}
// Preserve the public helper's behavior for caller-supplied, unordered arrays.
// Simulation histories take the incremental path below.
function unorderedData(data, now, windowSize, mode) {
  const from = Math.max(0, now - 3600),
    raw = data.filter((p) => p.t >= from && p.t <= now),
    recent = data.filter((p) => p.t >= Math.max(0, now - 60) && p.t <= now),
    groups = [];
  if (mode === 'batch') {
    const byKey = new Map();
    for (const p of data) {
      if (p.commitT === undefined || p.commitT > now) continue;
      const key = `${p.commitT}:${p.bus ?? 0}`;
      if (!byKey.has(key)) byKey.set(key, { t: p.commitT, values: [] });
      byKey.get(key).values.push(p.v);
    }
    for (const g of byKey.values()) groups.push(g);
    groups.sort((a, b) => a.t - b.t);
  } else for (const p of data) if (p.t <= now) groups.push({ t: p.t, values: [p.v] });
  const averages = [];
  let start = 0,
    sum = 0,
    count = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    for (const v of g.values) {
      sum += v;
      count++;
    }
    while (start < i && count - groups[start].values.length >= windowSize) {
      for (const v of groups[start++].values) {
        sum -= v;
        count--;
      }
    }
    averages.push({ t: g.t, v: sum / count, count });
  }
  const last = averages.at(-1),
    visible = averages.filter((p) => p.t >= from),
    carry = averages.findLast((p) => p.t < from);
  if (carry) visible.unshift({ ...carry, t: from });
  return {
    ...view(raw, recent, [], now),
    averages: visible,
    average: last?.v ?? null,
    averageTime: last?.t ?? null,
    averageCount: last?.count ?? 0,
  };
}
// Whole-stop groups keep each boarding / debarking batch together. Raw samples
// retain their actual times; only the display is limited to the latest hour.
export function chartData(data, now, windowSize = 20, mode = 'batch') {
  const h = history(data);
  if (!h.ordered) return unorderedData(data, now, windowSize, mode);
  const end = boundary(data, now, true),
    raw = data.slice(boundary(data, Math.max(0, now - 3600)), end),
    recent = data.slice(boundary(data, Math.max(0, now - 60)), end);
  return view(raw, recent, averageHistory(h, data, windowSize, mode), now);
}
export function sharedScale(datasets, now, windowSize = 20, mode = 'batch', fixed = 0) {
  if (Number.isFinite(fixed) && fixed > 0) return fixed;
  // A mean cannot exceed its largest observation, so the full-history maximum
  // already covers both series and never shrinks as the hour window advances.
  let max = 10;
  for (const data of datasets) max = Math.max(max, history(data).max);
  return Math.ceil((max * 1.1 - 1e-9) / 10) * 10;
}
