import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scenarios, Experiment } from '../dist/experiment.js';
import { parseScenario } from '../dist/scenario-format.js';
import { auditLesson } from '../tools/audit-scenarios.mjs';

test('current lessons use explicit five-second maneuvers and self-contained recipes', async () => {
  const e = new Experiment();
  assert.equal(e.scenarioId, 'balanced-corrected');
  for (const s of scenarios) {
    const run = new Experiment({}, s.id);
    assert.equal(run.config.stoppingDelay, 5, s.id);
    assert.equal(run.config.startingDelay, 5, s.id);
  }
  const downloads = {
    'balanced-route': 'balanced-corrected',
    'coordinated-holds': 'holds',
    'alternating-recovery': 'express',
    'two-gap-holds': 'two-gap-holds',
    'drop-off-only': 'dropoff',
    'announced-skip': 'announced-express',
    'passenger-cost-holds': 'temporal-recovery',
    'bounded-boarding': 'temporal-boarding',
    'protected-skips': 'temporal-pattern',
    'physical-assumptions': 'physical-assumptions',
    'short-announced-skips': 'short-announced-skips',
    'dropoff-overcorrection': 'dropoff-overcorrection',
    'guarded-holds': 'guarded-holds',
  };
  for (const [file, id] of Object.entries(downloads)) {
    const text = await readFile(new URL(`../dist/examples/${file}.json`, import.meta.url), 'utf8');
    const d = parseScenario(text),
      expected = new Experiment({}, id);
    assert.equal(Object.hasOwn(JSON.parse(text), 'version'), false);
    assert.deepEqual(d.config, expected.config, file);
    assert.deepEqual(d.events, expected.definition.events, file);
    assert.equal(d.policy, expected.definition.policy, file);
    assert.deepEqual(d.policyOptions, expected.definition.policyOptions, file);
    assert.deepEqual(d.policySchedule, expected.definition.policySchedule, file);
  }
});

test('lesson claims hold for matched complete default cohorts, including failures and actual skips', () => {
  const results = Object.fromEntries(
    scenarios.filter((s) => !s.aliasFor).map((s) => [s.id, auditLesson(s)]),
  );
  assert(results['balanced-corrected'].treatment.lateGapCV < 1e-9);
  assert(results.delay.treatment.lateGapCV > 0.8);
  assert(results.variance.treatment.lateGapCV > 1);
  for (const id of ['holds', 'dropoff', 'short-announced-skips']) {
    const r = results[id];
    assert(r.meanChangePercent < -5, `${id}: improve total passenger time`);
    assert(r.treatment.lateGapCV < 0.25, `${id}: sustain substantially improved spacing`);
  }
  for (const id of ['express', 'express-count', 'temporal-boarding', 'temporal-pattern'])
    assert(results[id].meanChangePercent < 0, `${id}: documented partial improvement`);
  for (const id of [
    'express',
    'express-count',
    'short-announced-skips',
    'announced-express',
    'temporal-pattern',
  ])
    assert(results[id].treatment.service.bypassed > 0, `${id}: must actually bypass locations`);
  assert(
    results['two-gap-holds'].treatment.lateGapCV > 0.7,
    'bounded polling is a limited correction',
  );
  assert(
    results['announced-express'].meanChangePercent > 3,
    'long notice is a cost counterexample',
  );
  const excessive = results['dropoff-overcorrection'];
  assert(excessive.meanChangePercent > 20);
  assert(excessive.treatment.lateGapCV < excessive.comparison.lateGapCV);
  assert(excessive.treatment.atCutoff.passedOver > 0);
  assert(results['temporal-recovery'].treatment.decisions.hold > 0);
  assert(results['temporal-recovery'].meanChangePercent < -10);
  assert(results['temporal-boarding'].treatment.decisions.restrict > 0);
  assert.equal(results['guarded-holds'].treatment.decisions.hold ?? 0, 0);
  assert(results['guarded-holds'].treatment.decisions.suppressed > 0);
  assert(Math.abs(results['guarded-holds'].meanChangePercent) < 1e-9);
});
