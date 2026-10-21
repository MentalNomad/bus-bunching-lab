import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';
import { evaluateControllerBatch } from '../dist/controller.js';

function timerFixture(kind) {
  const sim = new Simulation({ buses: 1, rate: 0, stopOverhead: 1.5 });
  sim.time = 100;
  Object.assign(sim.buses[0], {
    target: 0,
    phase: 'hold',
    stopStart: 98.5,
    due: 100 + 2e-13,
    overheadUntil: 100,
    holdUntil: 0,
    autoHoldUntil: 0,
    policyVisit: '0:1',
    visitOpen: true,
    service: null,
    alight: [],
  });
  sim.buses[0][kind] = sim.buses[0].due;
  sim.configureController({}, { start: 0, end: 200 });
  sim.controller.engineStartHandled = true;
  return sim;
}

for (const kind of ['overheadUntil', 'holdUntil', 'autoHoldUntil'])
  test(`a pure view boundary cannot finish the future ${kind} deadline`, () => {
    const whole = timerFixture(kind),
      viewed = timerFixture(kind);
    whole.advance(1);
    const deadline = viewed.buses[0][kind];
    viewed.advance(0);
    viewed.advance(0);
    assert.equal(viewed.controller.decisions.length, 0);
    assert.equal(viewed.buses[0][kind], deadline);
    viewed.advance(1);
    assert.deepEqual(viewed.controller.decisions, whole.controller.decisions);
  });

test('future door completion survives repeated advance(0)', () => {
  const sim = new Simulation({ buses: 1, rate: 0, board: 2 });
  sim.time = 100;
  const bus = sim.buses[0];
  Object.assign(bus, {
    target: 0,
    phase: 'service',
    due: 100 + 2e-13,
    overheadUntil: 98,
    holdUntil: 0,
    autoHoldUntil: 0,
    policyVisit: '0:1',
    visitOpen: true,
    alight: [],
    service: {
      kind: 'on',
      start: 98 + 2e-13,
      p: { id: 1, born: 98, queued: 98, wait: 0, origin: 0, dest: 1 },
    },
  });
  const service = bus.service;
  sim.advance(0);
  sim.advance(0);
  assert.equal(bus.service, service);
  assert.equal(bus.load.length, 0);
  sim.advance(1);
  assert.equal(bus.load.length, 1);
});

test('a manual event reassesses active automatic holds before unfinished doors', () => {
  const sim = new Simulation({ rate: 3, board: 20 });
  sim.time = 100;
  sim.stops.forEach((stop) => {
    stop.next = Infinity;
  });
  [0, 1, 5, 9].forEach((target, id) =>
    Object.assign(sim.buses[id], {
      target,
      phase: 'service',
      stopStart: 100,
      due: 100,
      overheadUntil: 100,
      visits: 0,
      policyVisit: `${target}:1`,
      visitOpen: true,
      holdUntil: 0,
      autoHoldUntil: 0,
      alight: [],
      service: null,
    }),
  );
  const bus = sim.buses[0];
  bus.service = {
    kind: 'on',
    start: 92,
    p: { id: 1, born: 92, queued: 92, wait: 0, origin: 0, dest: 5 },
  };
  bus.due = 112;
  sim.configureController({ targetSeconds: 1000 }, { start: 0, end: 1000 });
  sim.controller.history['0:1'] = { t: 40, previous: 0, headway: 40, bus: 1, visit: 'prior' };
  evaluateControllerBatch(sim, [{ type: 'arrival', bus: 0, stop: 0, t: 100 }]);
  sim.advance(0);
  const service = bus.service;
  sim.advance(10, {
    atBoundary: () => {
      for (let id = 1; id < 4; id++) sim.action(id, 'hold', 1000);
    },
  });
  assert.equal(bus.autoHoldUntil, 110);
  assert.equal(bus.service, service);
  assert.equal(bus.due, 112);
  assert.equal(sim.controller.buses[0].spentHold, 30);
  assert.ok(sim.buses.slice(1).every((b) => b.pendingHold === 1000));
});

function heldStop() {
  const sim = new Simulation({
    stops: 12,
    buses: 2,
    rate: 0,
    travel: 7.3,
    board: 1.1,
    debark: 0.7,
    stopOverhead: 1.5,
    overtaking: false,
  });
  sim.action(0, 'hold', 1000);
  const p = { id: 1, born: 0, queued: 0, wait: 0, origin: 6, dest: 1 };
  sim.buses[1].load.push(p);
  sim.created = 1;
  sim.births.push({ id: 1, born: 0, origin: 6, dest: 1 });
  return sim;
}

test('a fractional follower arrival serves beside a held leader and survives a near-deadline view', () => {
  const whole = heldStop(),
    viewed = heldStop();
  whole.advance(100);
  viewed.advance(59);
  const follower = viewed.buses[1];
  assert.equal(follower.target, 1);
  assert.equal(follower.phase, 'travel');
  viewed.advance(follower.due - 2e-13 - viewed.time);
  viewed.advance(0);
  viewed.advance(0);
  if (follower.phase === 'travel') assert.ok(Number.isFinite(follower.due));
  viewed.advance(100 - viewed.time);
  assert.equal(viewed.completed, 1);
  assert.ok(viewed.completedPassengers[0].t < 100);
  assert.equal(viewed.buses[0].phase, 'hold');
  assert.ok(viewed.buses[0].holdUntil > 100);
  assert.deepEqual(viewed.completedPassengers, whole.completedPassengers);
  assert.ok(follower.x <= viewed.buses[0].x + 12 + 1e-10);
});
