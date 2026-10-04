import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';

test('replacing an express plan cancels queued transfers but completes active unloading', () => {
  const s = new Simulation({
    stops: 6,
    buses: 1,
    rate: 60,
    travel: 10,
    board: 1,
    debark: 2,
    ride: 3,
  });
  s.advance(20);
  s.action(0, 'express', 3);
  s.advance(1);
  const active = s.buses[0].service.p;
  s.action(0, 'express', 1);
  s.advance(2);
  assert.equal(s.transfers, 1);
  assert(s.stops[1].queue.includes(active));
  s.advance(22);
  assert.equal(s.transfers, 1);
  assert(s.buses[0].load.some((p) => p.dest === 4));
});

test('replacing an express plan with a larger plan also replaces its transfer queue', () => {
  const s = new Simulation({
    stops: 6,
    buses: 1,
    rate: 0,
    travel: 10,
    board: 1,
    debark: 2,
    ride: 3,
  });
  const passengers = [2, 3, 4, 5].map((dest, i) => ({
    id: i + 1,
    born: 0,
    queued: 0,
    wait: 0,
    dest,
  }));
  s.created = passengers.length;
  s.buses[0].load.push(...passengers);
  s.action(0, 'hold', 30);
  s.action(0, 'express', 1);
  s.advance(11);
  s.action(0, 'express', 3);
  s.advance(6);
  assert.equal(s.transfers, 3);
  assert.deepEqual(s.buses[0].load, [passengers[3]]);
  assert.deepEqual(s.stops[1].queue, passengers.slice(0, 3));
});

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
