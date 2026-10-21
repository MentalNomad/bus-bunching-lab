import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseScenario, serializeScenario, ruleDescriptions } from '../dist/scenario-format.js';
import { Experiment } from '../dist/experiment.js';
import { Simulation } from '../dist/engine.js';

test('every downloadable example uses one complete language and reproduces its passenger outcomes', async () => {
  const files = (await readdir(new URL('../dist/examples/', import.meta.url))).filter((f) =>
    f.endsWith('.json'),
  );
  assert.equal(files.length, 19);
  for (const file of files) {
    const text = await readFile(new URL(`../dist/examples/${file}`, import.meta.url), 'utf8');
    const data = JSON.parse(text);
    assert.equal(Object.hasOwn(data, 'version'), false, file);
    assert.equal(Object.hasOwn(data.model, 'semantics'), false, file);
    if (data.recovery_policy)
      assert(Object.hasOwn(ruleDescriptions, data.recovery_policy.rule), file);
    const definition = parseScenario(text);
    const first = new Experiment({}, 'download', definition);
    const imported = parseScenario(serializeScenario(definition, first.config));
    const replay = new Experiment({}, 'download-copy', imported);
    first.advanceTo(3600);
    replay.advanceTo(3600);
    assert.deepEqual(replay.sim.summary(), first.sim.summary(), file);
    assert.deepEqual(replay.sim.completedPassengers, first.sim.completedPassengers, file);
    assert.equal(first.sim.transfers, 0, file);
    assert(first.sim.completed > 0, file);
    assert.deepEqual(Experiment.restore(first.export()).sim.summary(), first.sim.summary(), file);
  }
});

test('the lab, importer and guide present one language without model-conversion controls', async () => {
  const names = [
    'index.html',
    'scenario-guide.html',
    'scenario-ui.js',
    'model-ui.js',
    'help.js',
    'app.js',
  ];
  for (const name of names) {
    const source = await readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /legacy|historical|convertModel|convertScenario|ordered-v3|legacy-v2|formats? [123]|version [123]|-v[123]/i,
      name,
    );
  }
});

test('imports reject obsolete selectors and rule spellings instead of choosing alternate behavior', () => {
  const e = new Experiment();
  const original = JSON.parse(serializeScenario(e.definition, e.config));
  for (const mutate of [
    (d) => (d.version = 1),
    (d) => (d.version = 3),
    (d) => (d.model.semantics = 'legacy-v2'),
    (d) => (d.model.semantics = 'ordered-v3'),
    (d) =>
      (d.recovery_policy = {
        rule: 'hold-v1',
        start_seconds: 0,
        end_seconds: 60,
        check_every_seconds: 30,
      }),
    (d) =>
      (d.recovery_policy = {
        rule: 'ordered-two-gap-v3',
        start_seconds: 0,
        end_seconds: 60,
        check_every_seconds: 30,
      }),
  ]) {
    const data = structuredClone(original);
    mutate(data);
    assert.throws(() => parseScenario(JSON.stringify(data)));
  }
  const copy = e.export();
  copy.scenarioId = 'unavailable-preset';
  assert.deepEqual(Experiment.restore(copy).sim.summary(), e.sim.summary());
  delete copy.scenarioText;
  assert.throws(() => Experiment.restore(copy));
});

test('replacing a skip plan preserves accepted destinations and completes an active drop-off', () => {
  const s = new Simulation({ stops: 6, buses: 1, rate: 0, travel: 10, debark: 5, ride: 1 });
  const passengers = [1, 3, 4].map((dest, i) => ({ id: i + 1, born: 0, queued: 0, wait: 0, dest }));
  s.created = passengers.length;
  s.buses[0].load.push(...passengers);
  s.advance(10);
  assert.equal(s.buses[0].service.p, passengers[0]);
  s.action(0, 'express', 1);
  s.action(0, 'express', 3);
  s.advance(5);
  assert.equal(s.completed, 1);
  assert.deepEqual(s.buses[0].load, passengers.slice(1));
  assert.equal(s.stops[1].queue.length, 0);
  s.advance(200);
  assert.equal(s.completed, passengers.length);
  assert.equal(s.transfers, 0);
  assert.equal(s.summary().waiting + s.summary().onboard, 0);
});
