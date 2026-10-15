import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectionIndex, inspectAt } from '../dist/chart-inspection.js';

test('inspection picks a real nearest observation and holds the last published average', () => {
  const points = [
    { t: 10, v: 20, id: 1 },
    { t: 20, v: 40, id: 2 },
    { t: 20, v: 90, id: 3 },
  ];
  const averages = [
    { t: 15, v: 25 },
    { t: 30, v: 50 },
  ];
  const index = inspectionIndex(points);
  const result = inspectAt(index, averages, 0, 60, 19, 85);
  assert.equal(result.observation, points[2]);
  assert.equal(result.average, averages[0]);
  assert.equal(result.time, 19);
  assert.equal(inspectAt(index, averages, 0, 60, 12, 0).average, null);
  assert.deepEqual(
    points.map((p) => p.v),
    [20, 40, 90],
    'original history stays untouched',
  );
});

test('empty windows do not borrow invisible dots; averages can carry across the left boundary', () => {
  const data = [
    { t: 10, v: 5 },
    { t: 200, v: 80 },
  ];
  const averages = [{ t: 60, v: 5 }];
  const result = inspectAt(inspectionIndex(data), averages, 60, 120, 90, 30);
  assert.equal(result.observation, null);
  assert.equal(result.average.v, 5);
  assert.equal(inspectAt(inspectionIndex([]), [], 0, 60, 0, 0).observation, null);
});

test('incremental indexing handles appended equal-time samples, unordered callers and rewind', () => {
  const data = [
    { t: 20, v: 40 },
    { t: 10, v: 10 },
  ];
  inspectionIndex(data);
  data.push({ t: 20, v: 5 });
  const index = inspectionIndex(data);
  assert.equal(inspectAt(index, [], 0, 60, 20, 6).observation, data[2]);
  assert.deepEqual(
    data.map((p) => p.t),
    [20, 10, 20],
  );
  data.length = 1;
  assert.equal(inspectAt(inspectionIndex(data), [], 0, 60, 10, 0).observation, data[0]);
  data[0] = { t: 5, v: 12 };
  assert.equal(inspectAt(inspectionIndex(data), [], 0, 60, 10, 0).observation.v, 12);
});

test('pointer lookup uses logarithmic searches even for a huge coincident passenger group', () => {
  const data = Array.from({ length: 100000 }, (_, i) => ({ t: 10, v: i }));
  const index = inspectionIndex(data);
  let reads = 0;
  const original = index.groups[0].points;
  index.groups[0].points = new Proxy(original, {
    get(target, key) {
      if (/^\d+$/.test(String(key))) reads++;
      return target[key];
    },
  });
  for (let i = 0; i < 100; i++) {
    assert.equal(inspectAt(index, [], 0, 60, 10, 54321.2).observation.v, 54321);
  }
  assert(reads < 3000, 'does not scan all passengers per pointer event');
});
