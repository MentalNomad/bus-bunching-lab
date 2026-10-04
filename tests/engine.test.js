import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';
function conserve(s) {
  const x = s.summary();
  assert.equal(x.created, x.completed + x.waiting + x.onboard);
  for (const b of s.buses) {
    assert(b.load.every((p) => p.wait >= 0));
    assert(b.dwell.every((p) => p.v >= 0));
  }
  assert(s.series.every((p) => p.v >= p.wait));
}
test('passenger conservation with fixed and stochastic demand, holds, slowdown and express', () => {
  for (const arrival of ['fixed', 'poisson']) {
    const s = new Simulation({ arrival });
    for (let i = 0; i < 200; i++) {
      if (i === 10) s.action(0, 'hold', 60);
      if (i === 30) s.action(1, 'express', 3);
      if (i === 60) s.action(2, 'slow', 3);
      if (i === 100) s.action(0, 'express', 5);
      s.advance(15);
      conserve(s);
    }
    assert(s.completed > 0);
    assert(s.transfers > 0);
  }
});
test('deterministic seeds and independence from rendering step size', () => {
  const a = new Simulation({ arrival: 'poisson', rideMode: 'random' }),
    b = new Simulation(a.c);
  a.advance(1800);
  for (let i = 0; i < 180; i++) b.advance(10);
  assert.deepEqual(a.summary(), b.summary());
  assert.deepEqual(a.series, b.series);
});
test('fixed delay breaks the balanced route', () => {
  const baseline = new Simulation(),
    delayed = new Simulation();
  baseline.advance(1200);
  delayed.advance(1200);
  assert.deepEqual(baseline.summary(), delayed.summary());
  delayed.action(0, 'hold', 60);
  baseline.advance(1800);
  delayed.advance(1800);
  assert(delayed.summary().gapCV > baseline.summary().gapCV + 0.2);
  assert(delayed.summary().meanWait > baseline.summary().meanWait);
  console.log('Balanced vs delayed:', baseline.summary(), delayed.summary());
});
test('express unloads riders bound for skipped stops and retains arrival timestamps', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, board: 2, debark: 1 });
  const p = { id: 1, born: 0, queued: 0, wait: 7, dest: 3 };
  s.created = 1;
  s.buses[0].load.push(p);
  s.action(0, 'express', 2);
  s.advance(11);
  assert.equal(s.transfers, 1);
  assert.equal(s.stops[1].queue[0], p);
  assert.equal(p.born, 0);
  assert.equal(p.wait, 7);
  s.advance(120);
  assert.equal(s.completed, 1);
  assert.equal(s.series.length, 1);
  assert(s.series[0].wait > 7);
  conserve(s);
});
test('holding clock advances and service includes hold time', () => {
  const s = new Simulation({ rate: 0, buses: 1, travel: 10 });
  s.action(0, 'hold', 30);
  s.advance(20);
  assert.equal(s.buses[0].phase, 'hold');
  s.advance(20);
  assert.equal(s.buses[0].dwell[0].v, 30);
});
test('zero service times and zero demand are valid', () => {
  const s = new Simulation({ board: 0, debark: 0 });
  s.advance(10000);
  conserve(s);
  const empty = new Simulation({ rate: 0 });
  empty.advance(10000);
  assert.equal(empty.created, 0);
});
test('invalid interventions leave state intact', () => {
  const s = new Simulation();
  assert.throws(() => s.action(0, 'express', 12));
  assert.throws(() => s.action(50, 'hold', 10));
  assert.throws(() => s.action(0, 'hold', NaN));
  assert.throws(() => s.action(0, 'slow', 0.5));
  assert.equal(s.log.length, 0);
});
test('slowing an active segment preserves position and increases remaining time', () => {
  const s = new Simulation({ rate: 0 });
  s.advance(10);
  const b = s.buses[0],
    pos = s.position(b),
    remaining = b.due - s.time;
  s.action(0, 'slow', 3);
  assert.equal(s.position(b), pos);
  assert.equal(b.due - s.time, remaining * 3);
  s.advance(remaining * 3);
  assert.equal(b.from, 1);
});
