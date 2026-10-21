import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';
import { normalizeServiceAction } from '../dist/service-plan.js';

const dropoff = (extra = {}) => ({ stops: 2, untilRecovered: false, maxSeconds: 600, ...extra });
const pattern = (extra = {}) => ({
  ...dropoff(),
  leadStops: 0,
  every: 2,
  ...extra,
});
function passenger(s, dest, { stop, born = s.time, wait = 0 } = {}) {
  const p = { id: ++s.created, born, queued: s.time, wait, dest };
  if (stop !== undefined) s.stops[stop].queue.push(p);
  else s.buses[0].load.push(p);
  return p;
}
function conserve(s) {
  const x = s.summary();
  assert.equal(x.created, x.completed + x.waiting + x.onboard);
  assert(x.totalPassengerTime >= s.systemSum);
  assert(x.affectedPassengers <= x.passedOver);
}

test('forward and backward gaps wrap, handle coincident buses, and a single bus', () => {
  const s = new Simulation({ buses: 3, rate: 0 });
  for (const [i, target] of [1, 3, 8].entries()) {
    Object.assign(s.buses[i], { phase: 'hold', target });
  }
  assert.deepEqual(s.gaps(s.buses[0]), { ahead: 2, behind: 5 });
  assert.deepEqual(s.gaps(s.buses[2]), { ahead: 5, behind: 5 });
  s.buses[1].target = 1;
  assert.deepEqual(s.gaps(s.buses[0]), { ahead: 0, behind: 5 });
  const solo = new Simulation({ buses: 1, rate: 0 });
  assert.deepEqual(solo.gaps(solo.buses[0]), { ahead: 12, behind: 12 });
});

test('service validation is strict, copies instructions and fails before mutation', () => {
  const s = new Simulation({ rate: 0 });
  const value = pattern();
  const normalized = normalizeServiceAction('pattern', value, s.c);
  assert.deepEqual(normalized, value);
  assert.notEqual(normalized, value);
  for (const invalid of [
    { ...value, stops: 0 },
    { ...value, stops: 401 },
    { ...value, stops: 1.5 },
    { ...value, maxSeconds: Infinity },
    { ...value, maxSeconds: 604801 },
    { ...value, untilRecovered: 'false' },
    { ...value, leadStops: 12 },
    { ...value, every: 1 },
    { ...value, every: 13 },
    { ...value, unknown: 1 },
    { ...value, leadStops: undefined },
    null,
    [],
  ]) {
    const before = structuredClone(s);
    assert.throws(() => s.action(0, 'pattern', invalid));
    assert.deepEqual(structuredClone(s), before);
  }
  assert.throws(() => s.action(0, 'dropoff', { stops: 1 }));
  assert.throws(() => s.action(0, 'normal', 2));
  s.action(0, 'pattern', value);
  value.every = 12;
  assert.equal(s.buses[0].servicePlan.every, 2);
});

test('drop-off only finishes boarding underway, honors every destination, then ends at its span', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, board: 5, debark: 1 });
  const aboard = passenger(s, 3, { stop: 1 });
  const first = passenger(s, 2, { stop: 1 });
  const second = passenger(s, 3, { stop: 2 });
  s.advance(10);
  assert.equal(s.buses[0].service.p, aboard);
  s.action(0, 'dropoff', dropoff());
  s.advance(5);
  assert(s.buses[0].load.includes(aboard));
  assert(s.stops[1].queue.includes(first));
  assert.equal(s.buses[0].servicePlan.remaining, 1);
  s.advance(10);
  assert.equal(s.buses[0].servicePlan, null);
  assert(s.stops[2].queue.includes(second));
  assert.equal(s.passedOver, 2);
  s.advance(11);
  assert.equal(s.completed, 1);
  assert.equal(s.series[0].id, aboard.id);
  assert.equal(s.transfers, 0);
  conserve(s);
});

test('announced lead-in admits only served first destinations, including across the route boundary', () => {
  const s = new Simulation({ buses: 1, rate: 0, travel: 10, board: 0, debark: 0 });
  // Anchor is stop 1 (label 2). Next six locations are 2..7; 8,9 skip;
  // 10 serves; 11,0 skip; 1 serves on the following lap.
  for (let dest = 0; dest < 12; dest++) if (dest !== 1) passenger(s, dest, { stop: 1 });
  s.action(0, 'pattern', pattern({ leadStops: 6, every: 3, stops: 6 }));
  s.advance(10);
  assert.deepEqual(
    s.buses[0].load.map((p) => p.dest).sort((a, b) => a - b),
    [2, 3, 4, 5, 6, 7, 10],
  );
  assert.deepEqual(
    s.stops[1].queue.map((p) => p.dest),
    [0, 8, 9, 11],
  );
  assert.equal(s.passedOver, 4);
  assert.equal(s.buses[0].servicePlan.leadRemaining, 6);
  assert.equal(s.transfers, 0);
  s.advance(120);
  assert.equal(s.buses[0].servicePlan, null);
  conserve(s);
});

test('a finite skip block accepts riders whose destinations occur after normal service resumes', () => {
  const s = new Simulation({ buses: 1, rate: 0, board: 0, debark: 0, travel: 10 });
  const skipped = passenger(s, 2, { stop: 1 });
  const after = passenger(s, 4, { stop: 1 });
  s.action(0, 'pattern', pattern({ every: 12, stops: 2 }));
  s.advance(10);
  assert(s.stops[1].queue.includes(skipped));
  assert(s.buses[0].load.includes(after));
  s.advance(20);
  assert.equal(s.buses[0].servicePlan, null);
  s.advance(10);
  assert.equal(s.completed, 1);
  assert.equal(s.series[0].id, after.id);
  assert.equal(s.transfers, 0);
});

test('nominal skipped stops honor original riders and remain drop-off only', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, board: 0, debark: 2 });
  const rider = passenger(s, 2);
  const queue = passenger(s, 3, { stop: 2 });
  s.action(0, 'pattern', pattern({ stops: 3 }));
  s.advance(21);
  assert.equal(s.buses[0].service.p, rider);
  assert.equal(s.buses[0].servicePlan.remaining, 3);
  assert(s.stops[2].queue.includes(queue));
  s.advance(1);
  assert.equal(s.completed, 1);
  assert.equal(s.transfers, 0);
  assert.equal(s.passedOver, 1);
  assert(s.stops[2].queue.includes(queue));
  assert.equal(s.series[0].v, 22);
  conserve(s);
});

test('a protected in-progress boarding is not reversed by an announced skip plan', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, board: 5, debark: 1 });
  const p = passenger(s, 2, { stop: 1 });
  s.advance(11);
  s.action(0, 'pattern', pattern());
  s.advance(15);
  assert.equal(s.completed, 1);
  assert.equal(s.series[0].id, p.id);
  assert.equal(s.transfers, 0);
  conserve(s);
});

test('read-only stop-plan display follows the next encounter, protects boarded riders and respects finite spans', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, board: 5 });
  passenger(s, 2, { stop: 1 });
  s.advance(11);
  s.action(0, 'pattern', pattern({ every: 3, stops: 2 }));
  const b = s.buses[0];
  const before = structuredClone(s);
  assert.equal(s.stopPlan(b, 1), 'normal', 'the declaration anchor is served normally');
  assert.equal(s.stopPlan(b, 2), 'protected', 'the rider boarding has a promised drop-off');
  assert.equal(s.stopPlan(b, 3), 'skip');
  assert.equal(s.stopPlan(b, 4), 'normal', 'normal service resumes after the finite span');
  assert.deepEqual(structuredClone(s), before);
  s.advance(4);
  assert.equal(b.phase, 'travel');
  assert.equal(s.stopPlan(b, 2), 'protected', 'traveling to the next stop preserves the same plan');
  assert.equal(s.stopPlan(b, 3), 'skip');
  s.advance(11);
  assert.equal(s.stopPlan(b, 2), 'normal', 'the next-lap encounter is beyond this finite plan');
});

test('service cap expires between stops, and while held it wakes boarding without canceling the hold', () => {
  const s = new Simulation({ buses: 1, rate: 0, travel: 10, board: 1 });
  s.action(0, 'dropoff', dropoff({ maxSeconds: 5 }));
  s.advance(5);
  assert.equal(s.buses[0].servicePlan, null);
  assert.equal(s.position(s.buses[0]), 0.5);
  s.action(0, 'hold', 100);
  s.advance(5);
  const p = passenger(s, 3, { stop: 1 });
  s.action(0, 'dropoff', dropoff({ maxSeconds: 5 }));
  s.advance(6);
  assert.equal(s.buses[0].servicePlan, null);
  assert(s.buses[0].load.includes(p));
  assert.equal(s.buses[0].holdUntil, 110);
  assert.equal(s.buses[0].phase, 'hold');
});

test('normal service cancels all service restrictions but preserves a scheduled hold', () => {
  const s = new Simulation({ buses: 1, rate: 0, travel: 10 });
  s.action(0, 'hold', 100);
  s.action(0, 'express', 3);
  s.action(0, 'normal', 1);
  const b = s.buses[0];
  assert.equal(b.pendingHold, 100);
  s.action(0, 'pattern', pattern());
  s.action(0, 'normal', 1);
  assert.equal(b.servicePlan, null);
  s.advance(10);
  assert.equal(b.phase, 'hold');
  assert.equal(b.holdUntil, 110);
});

test('ongoing patterns and drop-off-only service continue across laps and end at their time cap or cancellation', () => {
  for (const type of ['dropoff', 'pattern']) {
    const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 1 });
    const instruction =
      type === 'pattern'
        ? pattern({ stops: null, maxSeconds: 20 })
        : dropoff({ stops: null, maxSeconds: 20 });
    s.action(0, type, instruction);
    s.advance(15);
    assert(s.buses[0].servicePlan);
    assert.equal(s.buses[0].servicePlan.remaining, null);
    s.advance(5);
    assert.equal(s.buses[0].servicePlan, null);
    s.action(0, type, instruction);
    s.advance(1);
    s.action(0, 'normal', 1);
    assert.equal(s.buses[0].servicePlan, null);
  }
});

test('expiration during protected door movement completes that passenger safely', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, debark: 10 });
  const p = passenger(s, 1);
  s.action(0, 'dropoff', dropoff({ maxSeconds: 15 }));
  s.advance(15);
  assert.equal(s.buses[0].servicePlan, null);
  assert.equal(s.buses[0].service.p, p);
  assert.equal(s.summary().onboard, 1);
  s.advance(5);
  assert.equal(s.completed, 1);
  assert.equal(s.transfers, 0);
  conserve(s);
});

test('until-recovered modes end on forward recovery even while the rear gap remains short', () => {
  for (const type of ['dropoff', 'pattern']) {
    const s = new Simulation({ buses: 3, rate: 0, travel: 10 });
    Object.assign(s.buses[1], { phase: 'hold', target: 2, holdUntil: 1000, due: 1000 });
    Object.assign(s.buses[2], { phase: 'hold', target: 10, holdUntil: 1000, due: 1000 });
    s.action(
      0,
      type,
      type === 'pattern' ? pattern({ untilRecovered: true }) : dropoff({ untilRecovered: true }),
    );
    s.advance(10);
    assert.equal(s.buses[0].servicePlan, null);
    assert(s.backwardGap(s.buses[0]) < 4 * 0.9);
  }
});

test('passed-over counts visits once and distinct affected riders once, including whole skipped stops', () => {
  const s = new Simulation({
    stops: 3,
    buses: 1,
    rate: 0,
    travel: 1,
    board: 0,
    debark: 0,
    ride: 1,
  });
  passenger(s, 2, { stop: 1 });
  passenger(s, 0, { stop: 2 });
  s.action(0, 'dropoff', dropoff({ stops: 7 }));
  s.advance(7);
  assert.equal(s.passedOver, 5);
  assert.equal(s.affectedPassengers, 2);
  const skipped = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 1 });
  passenger(skipped, 3, { stop: 2 });
  skipped.action(0, 'pattern', pattern());
  skipped.advance(2);
  assert.equal(skipped.passedOver, 1);
  assert.equal(skipped.affectedPassengers, 1);
  assert.equal(
    skipped.buses[0].dwell.length,
    1,
    'a wholly skipped stop does not record station dwell',
  );
  const legacy = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 1 });
  passenger(legacy, 3, { stop: 2 });
  legacy.action(0, 'express', 1);
  legacy.advance(2);
  assert.equal(legacy.passedOver, 1);
});

test('passenger-time totals count queues, load, boarding and debarking exactly once', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, board: 4, debark: 3 });
  passenger(s, 1);
  passenger(s, 2, { stop: 1 });
  passenger(s, 3, { stop: 4 });
  s.advance(11);
  assert.equal(s.buses[0].service.kind, 'off');
  assert.equal(s.summary().totalPassengerTime, 33);
  assert.equal(s.summary().oldestWait, 11);
  assert.equal(s.summary().meanCurrentWait, 11);
  s.advance(3);
  assert.equal(s.buses[0].service.kind, 'on');
  assert.equal(s.summary().totalPassengerTime, 13 + 14 + 14);
  assert.equal(s.summary().waiting, 1);
  s.advance(4);
  assert.equal(s.summary().totalPassengerTime, 13 + 18 + 18);
  conserve(s);
});

test('new modes preserve passenger/time conservation and chunk independence at demanding route extremes', () => {
  for (const config of [
    { stops: 3, buses: 16, rate: 20, travel: 1, board: 0, debark: 0, ride: 1 },
    { stops: 40, buses: 1, rate: 1, travel: 1, board: 2, debark: 1, ride: 39 },
  ]) {
    const a = new Simulation({ ...config, arrival: 'poisson', rideMode: 'random' });
    const b = new Simulation(a.c);
    for (const s of [a, b]) {
      s.action(
        0,
        'pattern',
        pattern({ leadStops: config.stops - 1, every: config.stops, stops: 400, maxSeconds: 100 }),
      );
      if (config.buses > 1) s.action(1, 'dropoff', dropoff({ stops: 400, maxSeconds: 100 }));
    }
    a.advance(600);
    for (let i = 0; i < 120; i++) b.advance(5);
    assert.deepEqual(a.summary(), b.summary());
    assert.deepEqual(a.series, b.series);
    assert.equal(a.transfers, 0);
    conserve(a);
  }
});
