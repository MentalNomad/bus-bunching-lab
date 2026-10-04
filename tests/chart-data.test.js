import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartData, sharedScale } from '../dist/chart-data.js';
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
