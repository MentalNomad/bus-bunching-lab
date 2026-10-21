import test from 'node:test';
import assert from 'node:assert/strict';
import { Experiment } from '../dist/experiment.js';

function stoppedExperiment(response = { type: 'hold', value: 30 }) {
  const experiment = new Experiment({ rate: 0 }, 'test-two-gap', {
    name: 'Two-gap test',
    description: '',
    config: {},
    events: [],
    policy: 'two-gap',
    policyOptions: { ahead: 'small', behind: 'large', small: 0.9, large: 1.1, response },
    policySchedule: { start: 100, end: 200, interval: 10 },
  });
  [0, 1, 4, 8].forEach((target, index) => {
    Object.assign(experiment.sim.buses[index], {
      target,
      phase: 'service',
      due: Infinity,
      stopStart: 0,
    });
  });
  return experiment;
}

test('two-gap dispatch requires both directions and never holds twice on one visit', () => {
  const e = stoppedExperiment(),
    bus = e.sim.buses[0];
  assert.deepEqual(e.sim.gaps(bus), { ahead: 1, behind: 4 });
  e.dispatch('two-gap');
  assert.equal(bus.autoHoldUntil, 30);
  assert.equal(e.sim.buses[1].autoHoldUntil, 0, 'a small gap alone must not trigger');
  e.sim.time = 31;
  e.dispatch('two-gap');
  assert.equal(
    bus.autoHoldUntil,
    30,
    'elapsed hold does not allow another action at the same visit',
  );
  bus.stopStart = 31;
  e.dispatch('two-gap');
  bus.visits++;
  e.dispatch('two-gap');
  assert.equal(bus.autoHoldUntil, 30, 'a new visit still respects the two-visit cooldown');
  bus.visits += 2;
  bus.stopStart = 32;
  e.sim.time = 32;
  e.dispatch('two-gap');
  assert.equal(bus.autoHoldUntil, 62, 'a later eligible visit can qualify after cooldown');
});

test('strict thresholds exclude equality and any ignores only its selected direction', () => {
  const e = stoppedExperiment();
  e.definition.policyOptions = { ...e.definition.policyOptions, small: 1, behind: 'any' };
  const bus = e.sim.buses[0];
  e.sim.buses[1].target = 3;
  e.dispatch('two-gap');
  assert.equal(bus.holdUntil, 0, 'ahead equals the small threshold');
  e.sim.buses[1].target = 2;
  e.dispatch('two-gap');
  assert.equal(bus.autoHoldUntil, 30);
});

test('one snapshot can restrict several matching buses but reserves a full-service bus', () => {
  const e = stoppedExperiment({
    type: 'dropoff',
    value: { stops: 3, untilRecovered: false, maxSeconds: 600 },
  });
  e.definition.policyOptions.behind = 'any';
  for (const b of e.sim.buses) b.target = b.id;
  e.dispatch('two-gap');
  assert.equal(e.sim.buses.filter((b) => b.servicePlan).length, 3);
  assert.equal(e.sim.buses.filter((b) => !b.servicePlan).length, 1);
  e.sim.buses[3].target = 10;
  e.dispatch('two-gap');
  assert.equal(e.sim.buses.filter((b) => !b.servicePlan).length, 1);
});

test('automatic restrictions never remove the only bus from full service', () => {
  const e = stoppedExperiment({
    type: 'pattern',
    value: { leadStops: 0, every: 2, stops: null, untilRecovered: false, maxSeconds: 600 },
  });
  e.definition.policyOptions.ahead = 'large';
  e.definition.policyOptions.behind = 'any';
  e.definition.policyOptions.large = 1;
  e.sim.buses.splice(1);
  e.sim.c.buses = 1;
  e.dispatch('two-gap');
  assert.equal(e.sim.buses[0].servicePlan, null);
});

test('a changed setup rejects an incompatible announced recipe without changing the active run', () => {
  const e = new Experiment({}, 'announced-express');
  e.advanceTo(1500);
  const before = structuredClone(e.sim),
    history = e.export();
  assert.throws(() => e.restart({ ...e.config, stops: 3, ride: 2 }), /Lead-in/);
  assert.deepEqual(structuredClone(e.sim), before);
  assert.deepEqual(e.export(), history);
  const valid = e.restart({ ...e.config, stops: 8, ride: 4 });
  valid.advanceTo(3600);
  assert.equal(
    valid.sim.created,
    valid.sim.summary().waiting + valid.sim.summary().onboard + valid.sim.completed,
  );
});

test('recorded service instructions are copied rather than retaining editable caller objects', () => {
  const e = new Experiment();
  const value = { leadStops: 2, every: 3, stops: 8, untilRecovered: false, maxSeconds: 1000 };
  e.action(0, 'pattern', value);
  value.every = 12;
  assert.equal(e.commands[0].value.every, 3);
  e.advanceTo(1200);
  const before = structuredClone(e.sim);
  e.seek(0);
  e.advanceTo(1200);
  assert.deepEqual(structuredClone(e.sim), before);
});

function orderedExperiment(policy, positions) {
  const experiment = new Experiment({ rate: 0 }, 'ordered-test', {
    name: 'Ordered hold test',
    description: '',
    config: {},
    events: [],
    policy,
    policyOptions: {
      ahead: 'small',
      behind: 'any',
      small: 0.9,
      large: 1.1,
      response: { type: 'hold', value: 30 },
    },
    policySchedule: { start: 100, end: 1000, interval: 10 },
  });
  experiment.sim.time = 100;
  positions.forEach((target, id) =>
    Object.assign(experiment.sim.buses[id], {
      target,
      phase: 'service',
      due: Infinity,
      stopStart: 100,
      holdUntil: 0,
      autoHoldUntil: 0,
    }),
  );
  return experiment;
}

test('corrected spatial polling keeps each partial coincident group front free on later visits', () => {
  for (const policy of ['hold', 'two-gap'])
    for (const positions of [
      [0, 0, 0, 1],
      [11, 0, 11, 11],
    ]) {
      const e = orderedExperiment(policy, positions);
      const leader = positions[1] === 0 && positions[0] === 11 ? 3 : 2;
      for (const visit of [0, 3]) {
        e.sim.time = 100 + visit * 100;
        for (const bus of e.sim.buses) {
          bus.autoHoldUntil = 0;
          bus.stopStart = e.sim.time;
          bus.visits = visit;
        }
        e.dispatch(policy);
        assert.equal(e.sim.buses[leader].autoHoldUntil, 0);
        assert.equal(e.policyBudgets.get(leader)?.spent ?? 0, 0);
        assert.equal(e.sim.buses.filter((bus) => bus.autoHoldUntil > e.sim.time).length, 2);
      }
    }
});

test('corrected spatial polling releases only the automatic hold of a newly coincident front', () => {
  for (const policy of ['hold', 'two-gap']) {
    const e = orderedExperiment(policy, [5, 9, 0, 1]);
    const bus = e.sim.buses[2];
    e.dispatch(policy);
    assert.equal(bus.autoHoldUntil, 130);
    e.sim.time = 101;
    e.sim.buses[0].target = e.sim.buses[1].target = 0;
    bus.holdUntil = 150;
    bus.service = { kind: 'on', start: 100, p: { id: 1, dest: 5 } };
    bus.due = 120;
    e.dispatch(policy);
    assert.equal(bus.autoHoldUntil, 101);
    assert.equal(bus.holdUntil, 150);
    assert.equal(bus.service.p.id, 1);
    assert.equal(bus.due, 120);
    assert.equal(e.policyBudgets.get(2).spent, 30);
  }
});
