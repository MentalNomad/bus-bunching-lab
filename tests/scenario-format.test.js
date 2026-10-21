import test from 'node:test';
import assert from 'node:assert/strict';
import { Experiment, scenarios } from '../dist/experiment.js';
import { parseScenario, serializeScenario } from '../dist/scenario-format.js';

test('every built-in scenario exports and imports with identical passenger outcomes and policies', () => {
  for (const s of scenarios) {
    const original = new Experiment({}, s.id);
    const imported = parseScenario(serializeScenario(s, original.config));
    const restored = new Experiment(imported.config, 'custom-roundtrip', imported);
    original.advanceTo(3600);
    restored.advanceTo(3600);
    assert.deepEqual(restored.sim.summary(), original.sim.summary());
    assert.deepEqual(restored.sim.series, original.sim.series);
  }
});
test('exported scenario incorporates edited setup and timed manual interventions in stable order', () => {
  const e = new Experiment({ seed: 123, arrival: 'poisson' }, 'delay');
  e.advanceTo(200);
  e.action(1, 'slow', 2);
  e.action(2, 'express', 2);
  e.advanceTo(1800);
  const imported = parseScenario(serializeScenario(e.definition, e.config, e.commands));
  assert.equal(imported.config.seed, 123);
  assert.deepEqual(
    imported.events.map((x) => x.t),
    [200, 200, 1200],
  );
  assert.deepEqual(
    imported.events.map((x) => x.bus),
    [1, 2, 0],
  );
  const replay = new Experiment(imported.config, 'custom', imported);
  replay.advanceTo(1800);
  assert.deepEqual(replay.sim.summary(), e.sim.summary());
});
test('custom policy schedule and definition survive copies and deterministic backstep', () => {
  const e = new Experiment({}, 'holds'),
    data = JSON.parse(serializeScenario(e.definition, e.config));
  data.recovery_policy = {
    rule: 'hold',
    start_seconds: 100,
    end_seconds: 220,
    check_every_seconds: 40,
  };
  const s = parseScenario(JSON.stringify(data));
  s.name = 'Educator lesson';
  const custom = new Experiment(s.config, 'custom-lesson', s);
  assert.deepEqual(
    custom.events.filter((x) => x.type === 'policy').map((x) => x.t),
    [100, 140, 180, 220],
  );
  custom.advanceTo(300);
  const restored = Experiment.restore(custom.export());
  assert.equal(restored.definition.name, 'Educator lesson');
  assert.deepEqual(restored.sim.summary(), custom.sim.summary());
  restored.seek(60);
  restored.advanceTo(300);
  assert.deepEqual(restored.sim.summary(), custom.sim.summary());
});
test('invalid import fields, unknown rules, numbers, actions and versions are rejected', () => {
  const e = new Experiment(),
    valid = JSON.parse(serializeScenario(e.definition, e.config));
  const mutations = [
    (d) => (d.version = 4),
    (d) => (d.setup.random_seed = 0),
    (d) => (d.setup.extra = 1),
    (d) => (d.name = ''),
    (d) => (d.interventions = [{ at_seconds: 20, bus: 5, action: 'hold', seconds: 60 }]),
    (d) => (d.interventions = [{ at_seconds: 20, bus: 1, action: 'hold', seconds: -1 }]),
    (d) => (d.interventions = [{ at_seconds: 20, bus: 1, action: 'express', stops: 1.5 }]),
    (d) => (d.interventions = [{ at_seconds: -1, bus: 1, action: 'slow', multiplier: 2 }]),
    (d) =>
      (d.recovery_policy = {
        rule: 'toString',
        start_seconds: 0,
        end_seconds: 60,
        check_every_seconds: 30,
      }),
    (d) =>
      (d.recovery_policy = {
        rule: 'hold',
        start_seconds: 0,
        end_seconds: 60,
        check_every_seconds: 0,
      }),
    (d) => (d.interventions = [{ at_seconds: 20, bus: 1, action: 'hold', seconds: 60, typo: 1 }]),
  ];
  for (const mutate of mutations) {
    const d = structuredClone(valid);
    mutate(d);
    assert.throws(() => parseScenario(JSON.stringify(d)));
  }
  assert.throws(() => parseScenario('not JSON'), /valid JSON/);
});
