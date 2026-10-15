import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';
import { Experiment } from '../dist/experiment.js';
import { predictEligibleService } from '../dist/controller.js';
import { parseScenario, serializeScenario } from '../dist/scenario-format.js';

const config = {
  semantics: 'ordered-v3',
  stops: 6,
  buses: 1,
  rate: 0,
  ride: 2,
  travel: 10,
  board: 0,
  debark: 1,
  seed: 42,
  stopOverhead: 2,
  stoppingDelay: 3,
  startingDelay: 4,
};
const skip = { leadStops: 0, every: 6, stops: 1, untilRecovered: false, maxSeconds: 300 };

test('served stops pay stopping before doors and starting on the following segment', () => {
  for (const overtaking of [true, false]) {
    const s = new Simulation({ ...config, overtaking });
    s.advance(10);
    assert.equal(s.buses[0].stoppingUntil, 13);
    assert.equal(s.buses[0].overheadUntil, 15);
    s.advance(5);
    assert.equal(s.buses[0].target, 2);
    assert.equal(s.buses[0].due, 29);
    assert.equal(s.buses[0].dwell[0].v, 5);
    s.advance(14);
    assert.equal(s.buses[0].stopStart, 29);
    assert.equal(s.buses[0].overheadUntil, 34);
  }
});

test('a bypass pays neither maneuver delay; protected drop-offs and manual holds make it served', () => {
  for (const overtaking of [true, false]) {
    const bypass = new Simulation({ ...config, overtaking });
    bypass.action(0, 'pattern', skip);
    bypass.advance(29);
    assert.equal(bypass.buses[0].target, 3);
    assert.equal(bypass.buses[0].due, 39);
    assert.equal(bypass.buses[0].dwell.length, 1);

    const protectedStop = new Simulation({ ...config, overtaking });
    const p = { id: 1, origin: 0, dest: 2, born: 0, queued: 0, wait: 0 };
    protectedStop.buses[0].load.push(p);
    protectedStop.births.push({ id: 1, origin: 0, dest: 2, born: 0 });
    protectedStop.created = 1;
    protectedStop.action(0, 'pattern', skip);
    protectedStop.advance(35);
    assert.equal(protectedStop.completedPassengers[0].t, 35);
    assert.equal(protectedStop.buses[0].due, 49);
    assert.equal(protectedStop.transfers, 0);

    const held = new Simulation({ ...config, overtaking });
    held.action(0, 'pattern', skip);
    held.advance(15);
    held.action(0, 'hold', 10);
    held.advance(24);
    assert.equal(held.buses[0].due, 53);
  }
});

test('manual restoration at a pass boundary charges the maneuver costs exactly once', () => {
  const s = new Simulation(config);
  s.action(0, 'pattern', skip);
  s.advance(29, { atBoundary: () => s.action(0, 'normal', 1) });
  assert.equal(s.buses[0].overheadUntil, 34);
  s.advance(5);
  assert.equal(s.buses[0].due, 48);
  assert.equal(s.buses[0].dwell[1].v, 5);
});

test('eligible-service estimates include maneuvers and omit them for bypassed locations', () => {
  for (const pattern of [false, true]) {
    const s = new Simulation(config);
    if (pattern) s.action(0, 'pattern', skip);
    s.configureController({}, { start: 0, end: 0 });
    const predicted = predictEligibleService(s, s.buses[0], 3, 4);
    assert.equal(predicted.serviceAt, pattern ? 44 : 53);
    s.advance(60);
    assert.equal(s.controller.history['3:4'].t, predicted.serviceAt);
  }
});

test('maneuvers preserve demand, accounting, partitions, scenario roundtrips, rewind and copies', () => {
  const c = {
    ...config,
    buses: 2,
    rate: 2,
    arrival: 'poisson',
    rideMode: 'random',
    arrivalCutoff: 200,
  };
  const definition = {
    id: 'maneuvers',
    name: 'Maneuver example',
    description: '',
    config: c,
    events: [],
  };
  const recipe = JSON.parse(serializeScenario(definition, c));
  assert.equal(recipe.model.stopping_delay_seconds, 3);
  assert.equal(recipe.model.starting_delay_seconds, 4);
  const parsed = parseScenario(JSON.stringify(recipe));
  const a = new Experiment(c, definition.id, definition);
  const b = new Experiment(parsed.config, parsed.id, parsed);
  a.advanceTo(500);
  for (let t = 1; t <= 500; t++) b.advanceTo(t);
  assert.deepEqual(a.sim.series, b.sim.series);
  assert.deepEqual(a.sim.summary(), b.sim.summary());
  assert.deepEqual(Experiment.restore(a.export()).sim.series, a.sim.series);
  b.seek(100);
  b.advanceTo(500);
  assert.deepEqual(a.sim.series, b.sim.series);
  const noPenalties = new Simulation({ ...c, stoppingDelay: 0, startingDelay: 0 });
  noPenalties.advance(500);
  assert.deepEqual(a.sim.births, noPenalties.births);
  const s = a.sim.summary();
  assert.equal(s.completed + s.waiting + s.onboard, a.sim.created);
  assert(Math.abs(s.totalPassengerTime - a.sim.integratedPassengerTime) < 1e-6);

  delete recipe.model.stopping_delay_seconds;
  delete recipe.model.starting_delay_seconds;
  assert.equal(parseScenario(JSON.stringify(recipe)).config.stoppingDelay, 0);
});

test('maneuver inputs reject malformed values and preserve historical semantics', () => {
  for (const key of ['startingDelay', 'stoppingDelay']) {
    for (const value of [null, -1, 121, Infinity, '3'])
      assert.throws(() => new Simulation({ ...config, [key]: value }));
    assert.throws(() => new Simulation({ [key]: 3 }), /corrected model/);
  }
});

test('fractional maneuver penalties preserve nonpassing trajectories and partition-independent passenger outcomes', () => {
  const c = {
    ...config,
    buses: 3,
    capacity: 5,
    overtaking: false,
    travel: 7.3,
    board: 0.5,
    debark: 0.3,
    stopOverhead: 0.3,
    stoppingDelay: 2.25,
    startingDelay: 1.7,
    rate: 1.7,
    arrival: 'poisson',
    rideMode: 'random',
    arrivalCutoff: 300,
  };
  const a = new Simulation(c),
    b = new Simulation(c);
  for (const s of [a, b]) {
    s.action(0, 'hold', 30);
    s.action(1, 'slow', 4);
    s.action(2, 'pattern', { ...skip, every: 2, stops: 3 });
  }
  a.advance(600);
  let prior = b.buses.map((bus) => bus.x);
  for (let t = 0; t < 600; t += 10) {
    b.advance(10);
    const x = b.roadOrder.map((id) => b.buses[id].x);
    assert(x[0] <= x[1] + 1e-8 && x[1] <= x[2] + 1e-8 && x[2] <= x[0] + 6 + 1e-8);
    for (const bus of b.buses) assert(bus.x >= prior[bus.id] - 1e-8);
    prior = b.buses.map((bus) => bus.x);
  }
  assert.deepEqual(a.births, b.births);
  assert.deepEqual(
    a.series.map((p) => [p.id, p.bus]),
    b.series.map((p) => [p.id, p.bus]),
  );
  for (let i = 0; i < a.series.length; i++)
    for (const key of ['t', 'v', 'wait'])
      assert(Math.abs(a.series[i][key] - b.series[i][key]) < 1e-8);
  for (const s of [a, b]) {
    const summary = s.summary();
    assert.equal(s.created, s.completed + summary.waiting + summary.onboard);
    assert(Math.abs(summary.totalPassengerTime - s.integratedPassengerTime) < 1e-6);
  }
});
