import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseScenario,
  serializeScenario,
  MAX_SCENARIO_TEXT_LENGTH,
} from '../dist/scenario-format.js';
import { normalizeGapPolicy } from '../dist/dispatch-rules.js';
import { Experiment } from '../dist/experiment.js';
import { historicalScenarios as scenarios } from '../dist/historical-scenarios.js';

const files = ['two-gap-holds', 'drop-off-only', 'announced-skip'];
const examples = await Promise.all(
  files.map(async (name) =>
    JSON.parse(
      await readFile(new URL(`../dist/examples/historical/${name}.json`, import.meta.url), 'utf8'),
    ),
  ),
);
const copy = (value) => structuredClone(value);
const parse = (value) => parseScenario(JSON.stringify(value));

test('all three v2 guide downloads roundtrip and replay deterministically, including rewind and copies', () => {
  for (const data of examples) {
    const definition = parse(data);
    const exported = serializeScenario(definition, definition.config);
    assert.equal(JSON.parse(exported).version, 2);
    const imported = parseScenario(exported);
    assert.deepEqual(imported, definition);
    const first = new Experiment({}, 'v2-guide', definition);
    first.advanceTo(3600);
    const replay = new Experiment({}, 'v2-replay', imported);
    replay.advanceTo(3600);
    assert.deepEqual(first.sim.summary(), replay.sim.summary(), data.name);
    assert.deepEqual(first.sim.completedPassengers, replay.sim.completedPassengers, data.name);
    assert(first.sim.completed > 0);
    assert.equal(first.sim.transfers, 0, `${data.name}: new modes preserve accepted drop-offs`);
    if (definition.policy === 'two-gap')
      assert(
        first.sim.log.some((entry) => entry.message.startsWith('Two-gap rule:')),
        `${data.name}: demonstrate an actual activation`,
      );
    if (
      definition.policyOptions?.response.type === 'dropoff' ||
      definition.events.some((event) => event.type === 'pattern')
    ) {
      assert(first.sim.passedOver > 0, `${data.name}: expose the cost to waiting passengers`);
      assert(first.sim.affectedPassengers > 0);
    }
    const copied = Experiment.restore(first.export());
    assert.deepEqual(copied.sim.summary(), first.sim.summary(), `${data.name}: copy`);
    copied.seek(1300);
    copied.advanceTo(3600);
    assert.deepEqual(copied.sim.summary(), first.sim.summary(), `${data.name}: rewind`);
    assert.equal(
      first.sim.created,
      first.sim.completed + first.sim.summary().waiting + first.sim.summary().onboard,
    );
    assert(!first.sim.log.some((entry) => entry.message.startsWith('Skipped ')));
  }
});

test('v2 downloads use the same recipe as the three archived historical demonstrations', () => {
  const ids = ['two-gap-holds', 'dropoff', 'announced-express'];
  examples.forEach((example, index) => {
    const imported = parse(example);
    const preset = scenarios.find((scenario) => scenario.id === ids[index]);
    assert(preset, `${ids[index]} must be loadable from the library`);
    const builtIn = new Experiment({}, preset.id, preset);
    assert.deepEqual(imported.config, builtIn.config);
    assert.deepEqual(imported.events, preset.events);
    assert.deepEqual(imported.policy, preset.policy);
    assert.deepEqual(imported.policyOptions, preset.policyOptions);
    assert.deepEqual(imported.policySchedule, preset.policySchedule);
  });
});

test('legacy recipes remain version 1, v2 can contain legacy actions, and only new features require v2', () => {
  const original = scenarios.find((scenario) => scenario.id === 'delay');
  const legacy = JSON.parse(
    serializeScenario(original, new Experiment({}, original.id, original).config),
  );
  assert.equal(legacy.version, 1);
  const expected = parse(legacy);
  legacy.version = 2;
  assert.deepEqual(parse(legacy), expected);
  const newAction = copy(examples[2]);
  newAction.version = 1;
  assert.throws(() => parse(newAction), /unknown action/);
  const newPolicy = copy(examples[0]);
  newPolicy.version = 1;
  assert.throws(() => parse(newPolicy));
});

test('new actions preserve stable equal-time order, ongoing spans and explicit cancellation', () => {
  const data = copy(examples[2]);
  data.recovery_policy = null;
  data.interventions = [
    {
      at_seconds: 100,
      bus: 1,
      action: 'drop_off_only',
      stops: null,
      until_recovered: false,
      max_seconds: 604800,
    },
    { at_seconds: 100, bus: 1, action: 'normal_service' },
    {
      at_seconds: 100,
      bus: 1,
      action: 'announced_skip',
      lead_stops: 0,
      serve_every: 2,
      for_stops: null,
      until_recovered: false,
      max_seconds: 3600,
    },
  ];
  const parsed = parse(data);
  assert.deepEqual(
    parsed.events.map((event) => event.type),
    ['dropoff', 'normal', 'pattern'],
  );
  assert.equal(parsed.events[0].value.stops, null);
  assert.equal(parsed.events[1].value, 1);
  assert.deepEqual(parseScenario(serializeScenario(parsed, parsed.config)), parsed);
});

test('new action schema rejects missing, misspelled, wrong-type and out-of-range fields', () => {
  const original = examples[2];
  const mutations = [
    (d) => delete d.interventions[1].lead_stops,
    (d) => delete d.interventions[1].until_recovered,
    (d) => (d.interventions[1].until_recovered = 'false'),
    (d) => (d.interventions[1].until_recovered = 1),
    (d) => (d.interventions[1].lead_stops = -1),
    (d) => (d.interventions[1].lead_stops = 12),
    (d) => (d.interventions[1].lead_stops = 1.5),
    (d) => (d.interventions[1].serve_every = 1),
    (d) => (d.interventions[1].serve_every = 13),
    (d) => (d.interventions[1].serve_every = '3'),
    (d) => (d.interventions[1].for_stops = 0),
    (d) => (d.interventions[1].for_stops = 401),
    (d) => (d.interventions[1].for_stops = 1.5),
    (d) => (d.interventions[1].max_seconds = 0),
    (d) => (d.interventions[1].max_seconds = 604801),
    (d) => (d.interventions[1].max_seconds = '60'),
    (d) => (d.interventions[1].extra = 1),
    (d) => (d.interventions[1] = { at_seconds: 100, bus: 1, action: 'normal_service', stops: 1 }),
    (d) =>
      (d.interventions[1] = {
        at_seconds: 100,
        bus: 1,
        action: 'drop_off_only',
        stops: 3,
        until_recovered: false,
        max_seconds: 600,
        lead_stops: 0,
      }),
  ];
  for (const mutation of mutations) {
    const invalid = copy(original);
    mutation(invalid);
    assert.throws(() => parse(invalid), JSON.stringify(invalid.interventions[1]));
  }
});

test('two-gap schema rejects ineffective conditions and malformed responses or schedules', () => {
  const original = examples[0];
  const mutations = [
    (p) => delete p.condition,
    (p) => delete p.condition.behind,
    (p) => (p.condition.ahead = 'Small'),
    (p) => (p.condition = { ...p.condition, ahead: 'any', behind: 'any' }),
    (p) => (p.condition.small_ratio = 0),
    (p) => (p.condition.small_ratio = 1.1),
    (p) => (p.condition.large_ratio = 0.9),
    (p) => (p.condition.large_ratio = 10.1),
    (p) => (p.condition.small_ratio = p.condition.large_ratio = 1),
    (p) => (p.condition.unknown = 0),
    (p) => (p.response = { action: 'normal_service' }),
    (p) => (p.response = { action: 'slow', multiplier: 2 }),
    (p) => (p.response = { action: 'express', stops: 2 }),
    (p) => (p.response = { action: 'hold', seconds: 0 }),
    (p) => (p.response = { action: 'hold', seconds: 3601 }),
    (p) => (p.response.bus = 1),
    (p) => (p.start_seconds = -1),
    (p) => (p.end_seconds = 100),
    (p) => (p.check_every_seconds = 0),
    (p) => (p.rule_explanation = {}),
    (p) => (p.rule_explanation = 'x'.repeat(4001)),
  ];
  for (const mutation of mutations) {
    const invalid = copy(original);
    mutation(invalid.recovery_policy);
    assert.throws(() => parse(invalid));
  }
});

test('direct two-gap presets share strict import validation and cannot mutate normalized options', () => {
  const options = parse(examples[1]).policyOptions;
  const normalized = normalizeGapPolicy(options, { stops: 12 });
  assert.deepEqual(normalized, options);
  options.response.value.stops = 400;
  assert.equal(normalized.response.value.stops, 3);
  for (const mutate of [
    (o) => (o.extra = true),
    (o) => (o.response.extra = true),
    (o) => delete o.response.value.maxSeconds,
    (o) => (o.response.value.untilRecovered = 'true'),
  ]) {
    const invalid = copy(normalized);
    mutate(invalid);
    assert.throws(() => normalizeGapPolicy(invalid, { stops: 12 }));
  }
});

test('a full 1,000-pattern lesson remains importable after readable export and stored reload', () => {
  const data = copy(examples[2]);
  data.name = 'A'.repeat(100);
  data.description = 'Lesson notes. '.repeat(307).slice(0, 4000);
  data.notes = 'N'.repeat(4000);
  data.interventions = Array.from({ length: 1000 }, (_, index) => ({
    at_seconds: index * 600,
    bus: (index % 4) + 1,
    action: 'announced_skip',
    lead_stops: 11,
    serve_every: 12,
    for_stops: 400,
    until_recovered: false,
    max_seconds: 604800,
  }));
  const compact = JSON.stringify(data);
  assert(compact.length < 200000, 'the compact recipe was previously accepted');
  const imported = parseScenario(compact);
  const exported = serializeScenario(imported, imported.config);
  assert(exported.length > 200000, 'readable export exercises the old size-limit failure');
  assert(exported.length <= MAX_SCENARIO_TEXT_LENGTH);
  const stored = JSON.stringify([{ id: 'custom-abc123', text: exported }]);
  const restored = parseScenario(JSON.parse(stored)[0].text);
  assert.deepEqual(restored, imported);
  assert.deepEqual(parseScenario(serializeScenario(restored, restored.config)), imported);
});

test('scenario text accepts the exact size boundary and rejects one additional character', () => {
  const text = JSON.stringify(examples[0]);
  const boundary = text.padEnd(MAX_SCENARIO_TEXT_LENGTH, ' ');
  assert.deepEqual(parseScenario(boundary), parseScenario(text));
  assert.throws(() => parseScenario(boundary + ' '), /at most 500,000 characters/);
});
