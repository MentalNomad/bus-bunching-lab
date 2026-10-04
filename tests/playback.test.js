import test from 'node:test';
import assert from 'node:assert/strict';
import { Experiment } from '../dist/experiment.js';
import { MAX_SIMULATION_SECONDS } from '../dist/engine.js';
import { advanceMaxSpeed } from '../dist/playback.js';

test('Max advances in short bursts and yields even with a coarse clock', () => {
  const experiment = new Experiment({ rate: 0 });
  let clock = 0;
  assert.equal(
    advanceMaxSpeed(experiment, () => clock++),
    false,
  );
  assert.equal(experiment.sim.time, 8);
  assert.equal(
    advanceMaxSpeed(experiment, () => 0),
    false,
  );
  assert.equal(experiment.sim.time, 1008);
});

test('Max preserves seeded demand, scheduled recovery, interventions and replay', () => {
  const fast = new Experiment({ arrival: 'poisson', rideMode: 'random' }, 'express');
  const reference = new Experiment({ arrival: 'poisson', rideMode: 'random' }, 'express');
  for (const experiment of [fast, reference]) {
    experiment.advanceTo(0.25);
    experiment.action(1, 'slow', 2);
  }
  for (let frame = 0; frame < 4; frame++) advanceMaxSpeed(fast, () => 0);
  reference.advanceTo(fast.sim.time);
  assert.deepEqual(structuredClone(fast.sim), structuredClone(reference.sim));
  const expected = structuredClone(fast.sim);
  fast.seek(120);
  fast.advanceTo(reference.sim.time);
  assert.deepEqual(structuredClone(fast.sim), expected);
});

test('Max reaches the exact time limit from a fractional time and then stops', () => {
  const experiment = new Experiment({ rate: 0, buses: 1, travel: 600 });
  experiment.advanceTo(MAX_SIMULATION_SECONDS - 0.25);
  assert.equal(
    advanceMaxSpeed(experiment, () => 0),
    true,
  );
  assert.equal(experiment.sim.time, MAX_SIMULATION_SECONDS);
  const expected = structuredClone(experiment.sim);
  assert.equal(
    advanceMaxSpeed(experiment, () => 0),
    true,
  );
  assert.deepEqual(structuredClone(experiment.sim), expected);
});

test('Max propagates passenger and stop limits so playback can pause safely', () => {
  const crowded = new Experiment({ rate: 60 });
  crowded.sim.created = 250000;
  assert.throws(() => advanceMaxSpeed(crowded, () => 0), /Passenger limit reached/);
  assert.equal(crowded.sim.created, 250000);
  const frequent = new Experiment({ rate: 0, buses: 1, travel: 1 });
  frequent.advanceTo(1.5);
  frequent.sim.buses[0].visits = 250000;
  assert.throws(() => advanceMaxSpeed(frequent, () => 0), /Stop visit limit reached/);
  assert.equal(frequent.sim.buses[0].visits, 250000);
});
