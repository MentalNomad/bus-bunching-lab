import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';
import { Experiment, scenarios } from '../dist/experiment.js';
import { parseScenario, serializeScenario } from '../dist/scenario-format.js';

function healthy(e) {
  const s = e.sim.summary();
  assert.equal(s.created, s.completed + s.waiting + s.onboard);
  assert.equal(e.sim.stops.length, e.config.stops);
  assert.equal(e.sim.buses.length, e.config.buses);
  for (const key of ['meanWait', 'meanSystem', 'gapCV']) assert(Number.isFinite(s[key]));
  for (const b of e.sim.buses) {
    assert(e.sim.position(b) >= 0 && e.sim.position(b) < e.config.stops);
    assert(b.load.every((p) => p.dest >= 0 && p.dest < e.config.stops));
  }
}

test('all built-in scenarios run at every stop/bus boundary combination with both demand patterns', () => {
  for (const scenario of scenarios.filter((s) => !s.aliasFor))
    for (const stops of [3, 40])
      for (const buses of [1, 16])
        for (const arrival of ['fixed', 'poisson']) {
          const config = { stops, buses, ride: Math.min(4, stops - 1), arrival };
          // Explicit multi-bus scripts cannot silently discard future actions.
          if (scenario.events.some((event) => event.bus >= buses)) {
            assert.throws(() => new Experiment(config, scenario.id), /Bus \d+ does not exist/);
            continue;
          }
          // A saved announcement is explicit: shrinking the route must reject
          // its six-stop lead-in rather than silently change the lesson.
          if (scenario.id === 'announced-express' && stops <= 6) {
            assert.throws(() => new Experiment(config, scenario.id), /Lead-in/);
            continue;
          }
          const e = new Experiment(config, scenario.id);
          e.advanceTo(3700);
          healthy(e);
        }
});
test('stop and bus sanity limits reject non-integers, non-finite values and out-of-range counts', () => {
  for (const stops of [0, 2, 41, 3.5, NaN, Infinity, '12'])
    assert.throws(() => new Simulation({ stops, ride: 1 }));
  for (const buses of [0, 17, 1.5, NaN, Infinity, '4'])
    assert.throws(() => new Simulation({ buses }));
  assert.throws(() => new Simulation({ stops: 3, ride: 3 }), /ride/);
  for (const stops of [3, 40]) {
    const s = new Simulation({ stops, ride: stops - 1 });
    s.action(0, 'express', stops - 1);
    assert.throws(() => s.action(0, 'express', stops));
  }
});
test('repeated setup changes rebuild cleanly, keep the scenario, and preserve replay/copy independence', () => {
  let e = new Experiment({}, 'express');
  for (const [stops, buses] of [
    [3, 1],
    [40, 16],
    [8, 3],
    [3, 16],
    [12, 4],
  ]) {
    e.advanceTo(e.sim.time + 200);
    const previous = e,
      previousState = structuredClone(previous.sim);
    e = e.restart({ ...e.config, stops, buses, ride: Math.min(4, stops - 1) });
    assert.equal(e.scenarioId, 'express');
    assert.equal(e.sim.time, 0);
    assert.equal(e.commands.length, 0);
    assert.equal(e.furthest, 0);
    assert.equal(e.sim.created, 0);
    assert.deepEqual(structuredClone(previous.sim), previousState);
    e.advanceTo(1800);
    healthy(e);
    const state = structuredClone(e.sim);
    e.seek(60);
    e.advanceTo(1800);
    assert.deepEqual(structuredClone(e.sim), state);
    assert.deepEqual(structuredClone(Experiment.restore(e.export()).sim), state);
  }
});
function imported() {
  const base = new Experiment(),
    text = JSON.parse(serializeScenario(base.definition, base.config));
  text.name = 'Imported interventions';
  text.interventions = [
    { at_seconds: 600, bus: 4, action: 'hold', seconds: 60 },
    { at_seconds: 900, bus: 1, action: 'express', stops: 5 },
  ];
  return parseScenario(JSON.stringify(text));
}
test('changing an imported preset rejects missing future buses and oversized future skips immediately', () => {
  const s = imported(),
    e = new Experiment(s.config, 'custom-test', s);
  e.advanceTo(60);
  e.action(1, 'slow', 2);
  const before = structuredClone(e.sim),
    history = structuredClone(e.export());
  assert.throws(
    () => e.restart({ ...e.config, buses: 3 }),
    /Scheduled intervention 1 at 600s: Bus 4 does not exist/,
  );
  assert.throws(
    () => e.restart({ ...e.config, stops: 5, ride: 4 }),
    /Scheduled intervention 2 at 900s: skipping 5 stops/,
  );
  assert.deepEqual(structuredClone(e.sim), before);
  assert.deepEqual(e.export(), history);
  const valid = e.restart({ ...e.config, stops: 6, buses: 4, ride: 4 });
  valid.advanceTo(1800);
  healthy(valid);
  assert(valid.sim.log.some((x) => x.message.includes('hold 60s')));
  assert(valid.sim.log.some((x) => x.t === 900 && x.message.includes('5 pattern locations')));
});
test('invalid future hold, slowdown and time fail before a scenario starts', () => {
  for (const event of [
    { t: 600, bus: 0, type: 'hold', value: 3601 },
    { t: 600, bus: 0, type: 'slow', value: 11 },
    { t: -1, bus: 0, type: 'hold', value: 1 },
  ])
    assert.throws(
      () =>
        new Experiment({}, 'custom-test', {
          name: 'Invalid future command',
          config: {},
          events: [event],
        }),
      /Scheduled intervention/,
    );
});
