import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Experiment, scenarios } from '../dist/experiment.js';
test('rewind and replay restore all model state including stochastic service references', () => {
  const e = new Experiment({}, 'variance');
  e.advanceTo(600);
  e.action(0, 'express', 2);
  e.advanceTo(900);
  const state = structuredClone(e.sim);
  e.seek(120);
  e.advanceTo(900);
  assert.deepEqual(structuredClone(e.sim), state);
});
test('editing the past creates a branch and drops future manual commands', () => {
  const e = new Experiment();
  e.advanceTo(100);
  e.action(0, 'hold', 60);
  e.advanceTo(200);
  e.action(1, 'slow', 2);
  e.seek(150);
  e.action(2, 'express', 2);
  assert.equal(e.commands.length, 2);
  assert.equal(e.furthest, 150);
  assert.equal(e.commands[1].type, 'express');
  e.advanceTo(300);
  assert(!e.sim.log.some((x) => x.message.includes('2× travel')));
});
test('serialized copies are independent and preserve future replay and seeded demand', () => {
  const a = new Experiment({}, 'holds');
  a.advanceTo(2400);
  a.action(0, 'express', 2);
  a.advanceTo(2500);
  a.seek(2200);
  const b = Experiment.restore(JSON.parse(JSON.stringify(a.export())));
  assert.deepEqual(structuredClone(a.sim), structuredClone(b.sim));
  a.advanceTo(3600);
  b.advanceTo(3600);
  assert.deepEqual(structuredClone(a.sim), structuredClone(b.sim));
  b.action(0, 'hold', 100);
  assert.notDeepEqual(a.sim.log, b.sim.log);
});
test('scheduled dispatch fires exactly once at its boundary and rewind repeats it', () => {
  const e = new Experiment({}, 'delay');
  e.advanceTo(1199);
  assert.equal(e.sim.log.length, 0);
  e.advanceTo(1200);
  assert.equal(e.sim.log.length, 1);
  e.advanceTo(1200);
  assert.equal(e.sim.log.length, 1);
  e.seek(1199);
  e.advanceTo(1200);
  assert.equal(e.sim.log.length, 1);
});
test('recovery presets improve spacing while keeping passenger costs visible', () => {
  const results = {};
  for (const scenario of scenarios) {
    const e = new Experiment({}, scenario.id);
    e.advanceTo(3600);
    const s = e.sim.summary();
    assert.equal(s.created, s.completed + s.waiting + s.onboard);
    results[scenario.id] = s;
  }
  assert(results.balanced.gapCV < 1e-10);
  assert(results.delay.gapCV > 1);
  assert(results.variance.gapCV > 1);
  assert(results.holds.gapCV < 0.15);
  assert(results.express.gapCV < 0.4);
  assert(results.express.transfers > 0);
  assert(results.holds.meanWait < results.delay.meanWait);
  console.log('60-minute scenario results', results);
});
test('invalid copies and commands fail without corrupting the timeline', () => {
  const e = new Experiment();
  e.advanceTo(100);
  assert.throws(() => e.action(1, 'express', 999));
  assert.equal(e.commands.length, 0);
  assert.equal(e.sim.time, 100);
  assert.throws(() => Experiment.restore({ version: 1, time: -1, commands: [] }));
});
