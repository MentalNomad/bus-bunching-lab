import test from 'node:test';
import assert from 'node:assert/strict';
import { Experiment, scenarios } from '../dist/experiment.js';

test('fixed-arrival disruption slows exactly one full segment by four seconds near minute 25', () => {
  const definition = scenarios.find((s) => s.id === 'delay');
  assert.deepEqual(definition.events, [{ t: 1500, bus: 0, type: 'slow', value: 1.1 }]);
  assert.equal(definition.policy, undefined);
  const baseline = new Experiment(),
    delayed = new Experiment({}, 'delay');
  baseline.advanceTo(1499);
  delayed.advanceTo(1499);
  assert.deepEqual(delayed.sim, baseline.sim, 'the route stays balanced before the instruction');
  delayed.advanceTo(1500);
  assert.notEqual(delayed.sim.buses[0].phase, 'travel', 'queue the next full segment');
  assert.equal(delayed.sim.buses[0].target, 7);
  assert.equal(delayed.sim.buses[0].pendingSlow, 1.1);
  // Both buses finish the same stop service, then cover all of Stop 8 → Stop 9.
  baseline.advanceTo(1536);
  delayed.advanceTo(1536);
  const normal = baseline.sim.buses[0],
    slow = delayed.sim.buses[0];
  assert.equal(normal.phase, 'travel');
  assert.equal(slow.phase, 'travel');
  assert.equal(slow.start, normal.start);
  assert.equal(slow.origin, normal.origin);
  assert.equal(slow.target, normal.target);
  assert.equal(normal.due - normal.start, 45);
  assert.equal(slow.due - slow.start, 49);
  assert.equal(slow.due - normal.due, 4);
  assert.equal(slow.pendingSlow, 1, 'the slowdown is consumed by this one segment');
  delayed.advanceTo(1632);
  assert.equal(slow.phase, 'travel');
  assert.equal(slow.due - slow.start, 45, 'the following segment uses normal travel time');
  assert.equal(delayed.sim.log.filter((row) => row.message.includes('1.1× travel')).length, 1);
  assert(!delayed.sim.log.some((row) => row.message.includes('hold')));
});

test('the four-second delay cascades with fixed arrivals over a longer run', () => {
  const baseline = new Experiment(),
    delayed = new Experiment({}, 'delay');
  for (const t of [1500, 1800, 2400, 3600, 5400]) {
    baseline.advanceTo(t);
    delayed.advanceTo(t);
    const a = baseline.sim.summary(),
      b = delayed.sim.summary();
    assert(a.gapCV < 1e-9);
    assert.equal(b.created, a.created, 'demand stays identical');
    assert.equal(b.created, b.completed + b.waiting + b.onboard);
    if (t === 3600) assert(b.gapCV > 0.8);
    if (t === 5400) assert(b.gapCV > 1.6, 'all four buses form a convoy by minute 90');
  }
  const before = structuredClone(delayed.sim);
  delayed.seek(1499);
  delayed.advanceTo(5400);
  assert.deepEqual(
    structuredClone(delayed.sim),
    before,
    'replay preserves the scheduled full-segment slowdown',
  );
});
