import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';

const ordered = (options = {}) => new Simulation({ semantics: 'ordered-v3', rate: 0, ...options });
function rider(sim, dest, stop, born = sim.time) {
  const p = { id: ++sim.created, born, queued: sim.time, wait: 0, dest, origin: stop ?? 0 };
  sim.births.push({ id: p.id, born, origin: p.origin, dest });
  if (stop === undefined) sim.buses[0].load.push(p);
  else sim.stops[stop].queue.push(p);
  return p;
}
function invariants(sim) {
  const snap = sim.neighborSnapshot();
  const rows = Object.values(snap.byId);
  assert.equal(
    rows.reduce((sum, r) => sum + r.ahead, 0),
    sim.c.stops,
  );
  assert.equal(
    rows.reduce((sum, r) => sum + r.behind, 0),
    sim.c.stops,
  );
  for (const row of rows) {
    assert(Number.isFinite(row.ahead) && row.ahead >= 0);
    assert.equal(row.ahead, snap.byId[row.aheadId].behind);
  }
}
test('ordered gaps retain one wrap arc across all/partial ties, seam, one/two buses', () => {
  for (const positions of [[1, 1, 1, 1], [0, 0, 3, 9], [0, 11], [4]]) {
    const sim = ordered({ buses: positions.length });
    for (const [i, target] of positions.entries())
      Object.assign(sim.buses[i], { phase: 'hold', target });
    const ids = sim.buses.map((b) => b.id);
    invariants(sim);
    assert.deepEqual(
      sim.buses.map((b) => b.id),
      ids,
    );
    if (positions.every((p) => p === positions[0]))
      assert.deepEqual(
        Object.values(sim.neighborSnapshot().byId).map((r) => r.ahead),
        positions.map((_, i) => (i === positions.length - 1 ? 12 : 0)),
      );
  }
});
test('genuine overtaking changes corrected immediate neighbor order', () => {
  const sim = ordered({ buses: 3, travel: 10 });
  sim.action(1, 'hold', 200);
  const initial = sim.neighborSnapshot().order;
  sim.advance(70);
  invariants(sim);
  assert.notDeepEqual(sim.neighborSnapshot().order, initial);
});
test('corrected recovery follows forward gap only and does not falsely recover convoy leader', () => {
  const sim = ordered({ buses: 4, travel: 10 });
  for (const b of sim.buses)
    Object.assign(b, { phase: 'hold', target: 1, holdUntil: 1000, due: 1000 });
  const instruction = { stops: null, untilRecovered: true, maxSeconds: 600 };
  sim.action(0, 'dropoff', instruction);
  sim.action(3, 'dropoff', instruction);
  // Revisit directly tests the policy contract without needing an artificial
  // manually-created convoy to move under its own inherited timestamps.
  sim.arrive(sim.buses[0]);
  sim.arrive(sim.buses[3]);
  assert.equal(sim.buses[0].servicePlan, null);
  assert(sim.buses[3].servicePlan);
  assert.equal(sim.forwardGap(sim.buses[3]), 12);
});
test('overhead precedes sequential doors, is paid empty, and overlaps manual hold', () => {
  const sim = ordered({ buses: 1, travel: 10, stopOverhead: 5, board: 2 });
  rider(sim, 2, 1);
  sim.action(0, 'hold', 6);
  sim.advance(14);
  assert.equal(sim.buses[0].service, null);
  sim.advance(1);
  assert.equal(sim.buses[0].service.kind, 'on');
  sim.advance(2);
  assert.equal(sim.buses[0].dwell[0].v, 7);
  const empty = ordered({ buses: 1, travel: 10, stopOverhead: 5 });
  empty.advance(15);
  assert.equal(empty.buses[0].dwell[0].v, 5);
  const skip = ordered({ buses: 1, travel: 10, stopOverhead: 5 });
  skip.action(0, 'express', 2);
  skip.advance(35);
  assert.equal(skip.position(skip.buses[0]), 3);
  assert.equal(skip.buses[0].dwell.length, 1);
});
test('capacity reserves an in-progress boarding and releases after alighting finishes', () => {
  const sim = ordered({ stops: 6, buses: 1, travel: 10, capacity: 1, board: 5, debark: 3 });
  const first = rider(sim, 2, 1),
    second = rider(sim, 3, 1),
    third = rider(sim, 3, 2);
  sim.advance(10);
  assert.equal(sim.capacityAvailable(sim.buses[0]), 0);
  sim.advance(15);
  assert.equal(sim.buses[0].service.kind, 'off');
  assert.equal(sim.capacityAvailable(sim.buses[0]), 0);
  sim.advance(3);
  assert.equal(sim.buses[0].service.p, third);
  assert(sim.stops[1].queue.includes(second));
  assert.equal(sim.completedPassengers[0].id, first.id);
  assert.equal(sim.capacityDenials, 1);
});
test('per-visit boarding allowance excludes a door movement already underway and preserves FIFO', () => {
  const sim = ordered({ buses: 1, travel: 10, board: 5 });
  const passengers = Array.from({ length: 4 }, () => rider(sim, 3, 1));
  sim.advance(11);
  sim.action(0, 'boarding', { passengers: 1, stops: 1, untilRecovered: false, maxSeconds: 600 });
  sim.advance(9);
  assert.deepEqual(
    sim.buses[0].load.map((p) => p.id),
    passengers.slice(0, 2).map((p) => p.id),
  );
  assert.deepEqual(
    sim.stops[1].queue.map((p) => p.id),
    passengers.slice(2).map((p) => p.id),
  );
  assert.equal(sim.policyDenials, 2);
});
test('no-overtaking constrains trajectories through slowdown, seam, road queue and restart', () => {
  const sim = ordered({ stops: 6, buses: 3, travel: 10, overtaking: false, board: 0, debark: 0 });
  sim.action(1, 'slow', 10);
  sim.action(2, 'hold', 60);
  let previous = sim.buses.map((b) => b.x);
  for (let step = 0; step < 800; step++) {
    sim.advance(0.5);
    const x = sim.buses.map((b) => b.x);
    assert(x[0] <= x[1] + 1e-8 && x[1] <= x[2] + 1e-8 && x[2] <= x[0] + 6 + 1e-8);
    assert(x.every((position, id) => position >= previous[id] - 1e-8));
    previous = x;
  }
  assert(
    sim.buses.every((b) => b.x > 20),
    'blocked departures restart and cross the seam',
  );
});
test('a no-overtaking convoy across the seam preserves its physical leader in the shared snapshot', () => {
  const sim = ordered({ travel: 40, overtaking: false });
  sim.action(0, 'hold', 1000);
  sim.advance(600);
  invariants(sim);
  assert.equal(sim.forwardGap(sim.buses[0]), 12);
  assert.equal(sim.backwardGap(sim.buses[0]), 0);
  assert.deepEqual(sim.neighborSnapshot().order, [1, 2, 3, 0]);
  assert(sim.buses.slice(1).every((b) => b.roadBlocked));
  const before = structuredClone(sim);
  sim.neighborSnapshot();
  assert.deepEqual(structuredClone(sim), before);
});
test('same-timestamp mandatory arrival precedes manual commands and zero-door release', () => {
  const sim = ordered({ buses: 1, travel: 10, board: 0, debark: 0 });
  rider(sim, 2, 1);
  let called = 0;
  sim.advance(10, {
    atBoundary(s) {
      called++;
      assert.equal(s.buses[0].phase, 'service');
      assert.equal(s.buses[0].service, null);
      s.action(0, 'hold', 20);
    },
  });
  assert.equal(called, 1);
  assert.equal(sim.buses[0].load.length, 1);
  assert.equal(sim.buses[0].phase, 'hold');
  assert.equal(sim.buses[0].holdUntil, 30);
});
test('arrival cutoff is inclusive, cancels future events and preserves full demand stream across physics', () => {
  const legacy = new Simulation({ arrivalCutoff: 60, arrival: 'fixed', rate: 3 });
  legacy.advance(600);
  assert.equal(legacy.created, 36);
  assert(legacy.stops.every((s) => s.next === Infinity));
  const a = ordered({ arrival: 'poisson', rideMode: 'random', rate: 3, arrivalCutoff: 600 });
  const b = ordered({ ...a.c, capacity: 5, stopOverhead: 7, overtaking: false });
  a.advance(1500);
  b.advance(1500);
  assert.deepEqual(a.births, b.births);
  for (const s of [legacy, a, b]) {
    const summary = s.summary();
    assert.equal(s.created, s.completed + summary.waiting + summary.onboard);
    assert(Math.abs(s.integratedPassengerTime - summary.totalPassengerTime) < 1e-6);
    assert(
      Math.abs(s.integratedPassengerTime - s.integratedQueueTime - s.integratedOnboardTime) < 1e-6,
    );
  }
});
test('corrected runs remain deterministic across rendering schedules and serialization', () => {
  for (const overtaking of [true, false]) {
    const a = ordered({
      arrival: 'poisson',
      rideMode: 'random',
      rate: 3,
      capacity: 15,
      stopOverhead: 3,
      overtaking,
      arrivalCutoff: 600,
    });
    const b = ordered(a.c);
    for (const s of [a, b])
      s.action(0, 'pattern', {
        leadStops: 2,
        every: 3,
        stops: 8,
        untilRecovered: false,
        maxSeconds: 500,
      });
    a.advance(2000);
    for (let i = 0; i < 400; i++) b.advance(5);
    assert.deepEqual(a.births, b.births);
    assert.deepEqual(a.summary(), b.summary());
    assert.deepEqual(a.series, b.series);
    assert.doesNotThrow(() => structuredClone(a));
  }
});
test('invalid physical options and boarding instructions fail before mutation', () => {
  for (const config of [
    { semantics: null },
    { stopOverhead: null },
    { overtaking: null },
    { cohortStart: null },
    { provenance: null },
    { capacity: 0 },
    { capacity: 501 },
    { stopOverhead: -1 },
    { stopOverhead: Infinity },
    { overtaking: 'false' },
    { arrivalCutoff: NaN },
    { cohortStart: 2, arrivalCutoff: 1 },
  ])
    assert.throws(() => ordered(config));
  assert.throws(() => new Simulation({ capacity: 10 }));
  const sim = ordered();
  const before = structuredClone(sim);
  assert.throws(() =>
    sim.action(0, 'boarding', { passengers: -1, stops: 2, untilRecovered: false, maxSeconds: 60 }),
  );
  assert.deepEqual(structuredClone(sim), before);
});
