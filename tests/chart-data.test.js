import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartData, dwellData, sharedScale } from '../dist/chart-data.js';
test('raw extrema reflect only the last minute; initial queue wait remains visible', () => {
  const d = [
    { t: 10, v: 50, commitT: 20 },
    { t: 70, v: 100, commitT: 80 },
    { t: 90, v: 140 },
  ];
  const x = chartData(d, 100, 20);
  assert.equal(x.low, 100);
  assert.equal(x.high, 140);
  assert.equal(x.average, 75);
  assert.equal(x.averageCount, 2);
  assert.equal(x.raw.length, 3);
});
test('whole stop groups never slice a passenger batch and unfinished groups do not change average', () => {
  const d = [
    { t: 1, v: 10, commitT: 10 },
    { t: 2, v: 30, commitT: 10 },
    { t: 3, v: 50, commitT: 10 },
    { t: 11, v: 100 },
  ];
  assert.equal(chartData(d, 12, 2).average, 30);
  assert.equal(chartData(d, 12, 2).averageCount, 3);
  d[3].commitT = 15;
  assert.equal(chartData(d, 15, 2).average, 47.5);
  assert.equal(chartData(d, 15, 2, 'individual').average, 75);
});
test('shared axis includes every bus and never shrinks with the visible time window', () => {
  const a = [{ t: 1, v: 200, commitT: 1 }],
    b = [{ t: 2, v: 20, commitT: 2 }];
  assert.equal(sharedScale([a, b], 100), 220);
  assert.equal(sharedScale([a, b], 10000), 220);
  assert.equal(sharedScale([a, b], 100, 20, 'batch', 300), 300);
});

test('dwell readouts use previous served visit and exact three-visit and route-count windows', () => {
  const data = [10, 20, 90, 40, 50, 900].map((v, i) => ({ t: (i + 1) * 10, v, stop: i * 2 }));
  const result = dwellData(data, 50, 4);
  assert.equal(result.previous, data[4]);
  assert.equal(result.short.average, 60);
  assert.equal(result.short.averageCount, 3);
  assert.equal(result.route.average, 50);
  assert.equal(result.route.averageCount, 4);
  assert.equal(result.short.averageTime, 50);
  assert.equal(result.route.averageTime, 50);
  // Missing station numbers represent skips; they contribute neither zeros nor extra visits.
  assert.equal(result.previous.stop, 8);
});

test('dwell startup distinguishes no observations, partial windows and genuine zero dwell', () => {
  const empty = dwellData([], 100, 12);
  assert.equal(empty.previous, null);
  assert.equal(empty.short.average, null);
  assert.equal(empty.route.average, null);
  const data = [
    { t: 10, v: 0, stop: 1 },
    { t: 30, v: 100, stop: 2 },
  ];
  const first = dwellData(data, 10, 12);
  assert.equal(first.previous.v, 0);
  assert.equal(first.short.average, 0);
  assert.equal(first.short.averageCount, 1);
  assert.equal(first.route.averageCount, 1);
  const second = dwellData(data, 30, 12);
  assert.equal(second.short.average, 50);
  assert.equal(second.route.average, 50);
  assert.equal(second.route.averageCount, 2);
});

test('dwell windows follow route count, appended visits and rewind, even beyond the displayed hour', () => {
  const data = [10, 20, 90, 40, 50].map((v, i) => ({ t: (i + 1) * 10, v, stop: i }));
  assert.equal(dwellData(data, 50, 5).route.average, 42);
  assert.equal(dwellData(data, 50, 3).route.average, 60);
  data.push({ t: 60, v: 120, stop: 5 });
  const appended = dwellData(data, 60, 5);
  assert.equal(appended.short.average, 70);
  assert.equal(appended.route.average, 64);
  const rewound = dwellData(data, 20, 5);
  assert.equal(rewound.previous.t, 20);
  assert.equal(rewound.short.average, 15);
  assert.equal(rewound.route.average, 15);
  const later = dwellData(data, 5000, 5);
  assert.equal(later.short.raw.length, 0);
  assert.equal(later.previous.v, 120);
  assert.equal(later.short.average, 70);
  assert.equal(later.route.average, 64);
  data.length = 1;
  assert.equal(dwellData(data, 5000, 5).route.average, 10);
});

test('dwell windows accept unordered callers without mutating the supplied history', () => {
  const data = [
    { t: 30, v: 90 },
    { t: 10, v: 10 },
    { t: 20, v: 20 },
  ];
  const result = dwellData(data, 20, 12);
  assert.equal(result.previous, data[2]);
  assert.equal(result.route.average, 15);
  assert.deepEqual(
    data.map((p) => p.t),
    [30, 10, 20],
  );
});

test('two dwell windows stay incremental instead of rereading the full history on each redraw', () => {
  let reads = 0;
  const data = Array.from({ length: 20000 }, (_, i) => ({
    t: i,
    commitT: i,
    get v() {
      reads++;
      return i % 100;
    },
  }));
  dwellData(data, 19999, 12);
  reads = 0;
  for (let i = 0; i < 20; i++) dwellData(data, 19999, 12);
  assert(reads < 100, `cached windows reread ${reads} values`);
  data.push({ t: 20000, v: 300 });
  assert.equal(dwellData(data, 20000, 12).short.average, (98 + 99 + 300) / 3);
});
