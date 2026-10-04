import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartData, sharedScale } from '../dist/chart-data.js';
import { Simulation } from '../dist/engine.js';

// This deliberately simple reference preserves the documented original grouping
// behavior, including simultaneous departures and an unfinished earlier visit.
function reference(data, now, windowSize = 20, mode = 'batch') {
  const from = Math.max(0, now - 3600),
    raw = data.filter((p) => p.t >= from && p.t <= now),
    recent = data.filter((p) => p.t >= Math.max(0, now - 60) && p.t <= now);
  let groups = [];
  if (mode === 'batch') {
    const byKey = new Map();
    for (const p of data) {
      if (p.commitT === undefined || p.commitT > now) continue;
      const key = `${p.commitT}:${p.bus ?? 0}`;
      if (!byKey.has(key)) byKey.set(key, { t: p.commitT, values: [] });
      byKey.get(key).values.push(p.v);
    }
    groups = Array.from(byKey.values()).sort((a, b) => a.t - b.t);
  } else for (const p of data) if (p.t <= now) groups.push({ t: p.t, values: [p.v] });
  const queue = [],
    averages = [];
  let sum = 0,
    count = 0;
  for (const g of groups) {
    queue.push(g);
    for (const v of g.values) {
      sum += v;
      count++;
    }
    while (queue.length > 1 && count - queue[0].values.length >= windowSize) {
      for (const v of queue.shift().values) {
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
    raw,
    averages: visible,
    low: recent.length ? recent.reduce((m, p) => Math.min(m, p.v), Infinity) : null,
    high: recent.length ? recent.reduce((m, p) => Math.max(m, p.v), 0) : null,
    recentCount: recent.length,
    average: last?.v ?? null,
    averageTime: last?.t ?? null,
    averageCount: last?.count ?? 0,
  };
}

test('cached charts match full grouping when visits commit, records append, and time rewinds', () => {
  const d = [
    { t: 1, v: 10, bus: 1 },
    { t: 2, v: 30, bus: 0, commitT: 10 },
    { t: 3, v: 50, bus: 1 },
    { t: 11, v: 100, bus: 0, commitT: 15 },
  ];
  const check = () => {
    for (const now of [0, 5, 12, 15, 20, 3605, 7200, 12])
      for (const mode of ['batch', 'individual'])
        for (const n of [2, 20])
          assert.deepEqual(chartData(d, now, n, mode), reference(d, now, n, mode));
  };
  check();
  d[0].commitT = 15;
  d[2].commitT = 15;
  check();
  d.push({ t: 3600, v: 11, bus: 0 }, { t: 3601, v: 31, bus: 0, commitT: 3602 });
  check();
  d[4].commitT = 3602;
  check();
  d.length = 2;
  check();
});

test('large histories render without spreading every group onto the call stack', () => {
  const d = Array.from({ length: 150000 }, (_, i) => ({ t: i, v: i % 41, commitT: i }));
  const view = chartData(d, 149999, 20);
  assert.equal(view.raw.length, 3601);
  assert.equal(view.averageCount, 20);
  assert.equal(view.average, reference(d.slice(-40), 149999, 20).average);
});

test('repeated chart and shared-axis reads only inspect the visible window and newly added history', () => {
  let reads = 0;
  const observed = (t, v) => ({
    get t() {
      reads++;
      return t;
    },
    get v() {
      reads++;
      return v;
    },
    get commitT() {
      reads++;
      return t;
    },
  });
  const d = Array.from({ length: 20000 }, (_, i) => observed(i * 10, i % 100));
  chartData(d, 199990, 20);
  sharedScale([d], 199990);
  reads = 0;
  chartData(d, 199990, 20);
  sharedScale([d], 199990);
  assert(reads < 1000, `re-read ${reads} historical fields`);
  reads = 0;
  d.push(observed(200000, 100));
  chartData(d, 200000, 20);
  assert(reads < 1000, `appending re-read ${reads} historical fields`);
  assert.equal(sharedScale([d], 0), 110);
});

test('unsorted caller data still keeps original individual order and grouped batch semantics', () => {
  const d = [
    { t: 8, v: 80, commitT: 10 },
    { t: 1, v: 10, commitT: 4 },
    { t: 5, v: 50, commitT: 10 },
  ];
  for (const now of [3, 9, 11])
    for (const mode of ['batch', 'individual'])
      assert.deepEqual(chartData(d, now, 2, mode), reference(d, now, 2, mode));
});

test('ongoing engine visits avoid polling unfinished history and publish it at departure', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 60, travel: 10, board: 1, ride: 3 });
  s.advance(100);
  const data = s.buses[0].wait;
  let reads = 0;
  for (const p of data) {
    let commitT = p.commitT;
    Object.defineProperty(p, 'commitT', {
      enumerable: true,
      get() {
        reads++;
        return commitT;
      },
      set(value) {
        commitT = value;
      },
    });
  }
  assert.equal(chartData(data, s.time).average, null);
  reads = 0;
  s.advance(10);
  assert.equal(chartData(data, s.time).average, null);
  assert.equal(reads, 0);
  // Stop new arrivals so the existing visit can finish and publish its group.
  s.c.rate = 0;
  s.advance(200);
  assert(s.buses[0].visits > 0);
  assert.deepEqual(chartData(data, s.time), reference(data, s.time));
  assert.equal(JSON.stringify(data).includes('commitRevision'), false);
});

test('live stochastic chart histories match the reference through service and interventions', () => {
  const s = new Simulation({
    arrival: 'poisson',
    rideMode: 'random',
    stops: 9,
    buses: 3,
    rate: 12,
    board: 0.4,
    debark: 0.3,
  });
  for (let i = 0; i < 100; i++) {
    if (i === 20) s.action(0, 'express', 3);
    if (i === 30) s.action(0, 'express', 1);
    if (i === 50) s.action(1, 'hold', 60);
    s.advance(45);
    for (const data of [s.series, ...s.buses.flatMap((b) => [b.wait, b.dwell])])
      for (const mode of ['batch', 'individual'])
        assert.deepEqual(chartData(data, s.time, 20, mode), reference(data, s.time, 20, mode));
  }
  for (const now of [3000, 0, 4500, 1200])
    assert.deepEqual(chartData(s.series, now), reference(s.series, now));
});
