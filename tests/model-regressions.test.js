import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';

test('composed slowdowns reject excessive remaining travel before changing the bus or log', () => {
  const s = new Simulation({ rate: 0, travel: 10 });
  for (let i = 0; i < 4; i++) s.action(0, 'slow', 10);
  const before = structuredClone(s);
  assert.throws(() => s.action(0, 'slow', 10), /604,800|seven days/i);
  assert.deepEqual({ ...s }, before);
  assert(Number.isFinite(s.position(s.buses[0])));
});

test('composed holds reject excessive pending and active holds before mutation', () => {
  for (const stopped of [false, true]) {
    const s = new Simulation({ rate: 0, buses: 1, travel: 10 });
    if (stopped) {
      s.action(0, 'hold', 3600);
      s.advance(10);
    }
    for (let i = 0; i < (stopped ? 167 : 168); i++) s.action(0, 'hold', 3600);
    const before = structuredClone(s);
    assert.throws(() => s.action(0, 'hold', 3600), /604,800|seven days/i);
    assert.deepEqual({ ...s }, before);
  }
});

test('simulation time and passenger budgets fail without processing a forbidden event', () => {
  const s = new Simulation({ rate: 0 });
  const before = structuredClone(s);
  assert.throws(() => s.advance(604801), /604,800|seven days/i);
  assert.deepEqual({ ...s }, before);
  const crowded = new Simulation({ rate: 60 });
  crowded.created = 250000;
  const state = structuredClone(crowded);
  assert.throws(() => crowded.advance(1), /Passenger limit reached/);
  assert.deepEqual({ ...crowded }, state);
});

test('stop observation budget preserves the next event and existing history', () => {
  const s = new Simulation({ rate: 0, buses: 1, travel: 1 });
  s.advance(1);
  s.buses[0].visits = 250000;
  s.advance(0.5);
  const b = s.buses[0];
  assert.throws(() => s.advance(0.5), /Stop visit limit reached/);
  assert.equal(b.visits, 250000);
  assert.equal(b.dwell.length, 1);
  assert.equal(s.time, 1.5);
  assert.equal(b.phase, 'travel');
  assert.equal(b.due, 2);
  assert.equal(b.service, null);
});

test('resource limits finish simultaneous events and their last timestamp can be replayed', () => {
  for (const config of [
    { stops: 3, buses: 1, rate: 60, travel: 600, board: 30, ride: 1 },
    { stops: 40, buses: 16, rate: 0, travel: 1 },
  ]) {
    const s = new Simulation(config);
    assert.throws(() => s.advance(100000), /limit reached/);
    const expected = s.summary(),
      replay = new Simulation(config);
    replay.advance(s.time);
    assert.deepEqual(replay.summary(), expected);
    assert.deepEqual(replay.series, s.series);
    assert.deepEqual(
      replay.buses.map((b) => b.dwell),
      s.buses.map((b) => b.dwell),
    );
    s.advance(0);
    assert.deepEqual(s.summary(), expected);
    assert.throws(() => s.advance(1), /limit reached/);
    assert.deepEqual(s.summary(), expected);
  }
});
