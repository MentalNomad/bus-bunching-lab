import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Experiment, scenarios } from '../dist/experiment.js';
import { serializeScenario, parseScenario } from '../dist/scenario-format.js';
import { summarizeCohort } from '../dist/measurements.js';

test('scenarios declare every model assumption, temporal option and finite horizon', () => {
  const e = new Experiment({}, 'temporal-recovery');
  const text = serializeScenario(e.definition, e.config);
  const data = JSON.parse(text);
  assert.equal(Object.hasOwn(data, 'version'), false);
  assert.equal(data.recovery_policy.rule, 'passenger-cost');
  assert.equal(data.recovery_policy.options.decisionMode, 'events');
  assert.equal(data.observation.arrival_cutoff_seconds, 3600);
  const definition = parseScenario(text);
  const copy = new Experiment(definition.config, 'custom', definition);
  e.advanceTo(1800);
  copy.advanceTo(1800);
  assert.deepEqual(copy.sim.summary(), e.sim.summary());
  assert.deepEqual(copy.sim.controller, e.sim.controller);
  copy.seek(1200);
  copy.advanceTo(1800);
  assert.deepEqual(copy.sim.controller, e.sim.controller);
  assert.deepEqual(Experiment.restore(e.export()).sim.controller, e.sim.controller);
});

test('new commands at a viewed event boundary replay with manual priority and preserve demand', () => {
  const d = {
    id: 'boundary',
    name: 'Boundary',
    description: '',
    config: { board: 0, debark: 0 },
    events: [],
    policy: 'temporal',
    policyOptions: {},
    policySchedule: { start: 0, end: 1000 },
  };
  const e = new Experiment(d.config, d.id, d);
  e.advanceTo(40);
  e.action(0, 'hold', 20);
  e.action(1, 'boarding', { passengers: 2, stops: 2, untilRecovered: false, maxSeconds: 100 });
  const restored = Experiment.restore(e.export());
  assert.deepEqual(restored.sim.summary(), e.sim.summary());
  assert.deepEqual(restored.sim.controller, e.sim.controller);
  e.advanceTo(800);
  restored.advanceTo(800);
  assert.deepEqual(restored.sim.summary(), e.sim.summary());
  assert.deepEqual(restored.sim.births, e.sim.births);
});

test('strict validation rejects unknown fields and malformed options before replacing a run', () => {
  const e = new Experiment({}, 'temporal-recovery');
  const valid = JSON.parse(serializeScenario(e.definition, e.config));
  const mutations = [
    (d) => {
      d.model.unsupported = true;
    },
    (d) => {
      d.model.stop_overhead_seconds = null;
    },
    (d) => {
      d.model.bus_capacity = 0;
    },
    (d) => {
      d.model.allow_overtaking = 'false';
    },
    (d) => {
      d.observation.cohort_start_seconds = 1300;
    },
    (d) => {
      d.observation.arrival_cutoff_seconds = 3500;
    },
    (d) => {
      d.recovery_policy.options.extra = 1;
    },
    (d) => {
      d.recovery_policy.options.maxHold = 100000;
    },
    (d) => {
      d.recovery_policy.rule = 'hold';
    },
    (d) => {
      d.model.extra = true;
    },
    (d) => {
      d.observation.drain_max_seconds = 0;
    },
  ];
  for (const mutate of mutations) {
    const data = structuredClone(valid);
    mutate(data);
    assert.throws(() => parseScenario(JSON.stringify(data)));
  }
  assert.equal(e.sim.time, 0);
  assert.equal(e.commands.length, 0);
  assert.throws(() => e.action(0, 'hold', 1), /cohort/);
  assert.equal(e.commands.length, 0);
  const early = structuredClone(e.definition);
  early.config = { ...e.config, arrivalCutoff: null };
  early.policySchedule.start = 0;
  assert.throws(() => new Experiment(early.config, early.id, early), /cohort/);
});

test('finite drain reports incomplete bounds and boarding recipes roundtrip without transfers', () => {
  const definition = {
    id: 'short-drain',
    name: 'Short drain',
    description: '',
    config: { arrivalCutoff: 60, cohortStart: 0 },
    events: [
      {
        t: 20,
        bus: 0,
        type: 'boarding',
        value: { passengers: 1, stops: 3, untilRecovered: false, maxSeconds: 400 },
      },
    ],
  };
  const e = new Experiment(definition.config, definition.id, definition);
  const parsed = parseScenario(serializeScenario(e.definition, e.config));
  assert.deepEqual(parsed.events, definition.events);
  const short = e.drain(1);
  assert.equal(short.complete, false);
  assert.equal(short.completeMean, null);
  assert.match(short.incompleteReason, /unfinished/);
  const full = e.drain(10000);
  assert.equal(full.complete, true);
  assert.equal(full.unfinished, 0);
  assert.equal(e.sim.transfers, 0);
  assert.ok(Object.values(summarizeCohort(e.sim).diagnostics).slice(0, 4).every(Boolean));
});

test('every new preset supports demand-preserving observation exports', () => {
  for (const s of scenarios) {
    const e = new Experiment({}, s.id);
    e.advanceTo(1600);
    assert.ok(summarizeCohort(e.sim).diagnostics.conserved);
    const copy = Experiment.restore(e.export());
    assert.deepEqual(copy.sim.summary(), e.sim.summary());
  }
});

test('all controller guide downloads are complete recipes with reproducible copies', async () => {
  const guide = await readFile(new URL('../dist/scenario-guide.html', import.meta.url), 'utf8');
  for (const file of [
    'passenger-cost-holds.json',
    'bounded-boarding.json',
    'protected-skips.json',
    'physical-assumptions.json',
  ]) {
    assert.ok(guide.includes(`examples/${file}`));
    const text = await readFile(new URL(`../dist/examples/${file}`, import.meta.url), 'utf8');
    assert.equal(Object.hasOwn(JSON.parse(text), 'version'), false);
    const definition = parseScenario(text);
    const e = new Experiment(definition.config, 'guide-corrected', definition);
    e.advanceTo(1700);
    const replay = Experiment.restore(e.export());
    assert.deepEqual(replay.sim.summary(), e.sim.summary());
    assert.deepEqual(replay.sim.births, e.sim.births);
  }
});

test('temporal windows use event bounds rather than a fictional 30-second polling count', () => {
  const definition = {
    id: 'long-event-window',
    name: 'Long event window',
    description: '',
    config: { rate: 0 },
    events: [],
    policy: 'temporal',
    policyOptions: {},
    policySchedule: { start: 0, end: 604800 },
  };
  const e = new Experiment(definition.config, definition.id, definition);
  assert.equal(e.sim.controller.schedule.end, 604800);
  const parsed = parseScenario(serializeScenario(e.definition, e.config));
  assert.doesNotThrow(() => new Experiment(parsed.config, parsed.id, parsed));
  const invalid = structuredClone(definition);
  invalid.policySchedule.end = 604801;
  assert.throws(() => new Experiment(invalid.config, invalid.id, invalid), /window/);
});
