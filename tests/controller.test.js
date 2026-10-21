import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../dist/engine.js';
import { normalizeControllerOptions, CONTROLLER_DEFAULTS } from '../dist/controller-options.js';
import {
  evaluateControllerBatch,
  safeguardControllerVisit,
  predictEligibleService,
  recordControllerDeparture,
  recordControllerBoarding,
  recordControllerDenial,
} from '../dist/controller.js';

function stopped(positions = [1, 1, 1, 1], options = {}, config = {}) {
  const sim = new Simulation({ rate: 3, ...config });
  sim.time = 100;
  sim.stops.forEach((s) => {
    s.next = Infinity;
  });
  sim.buses.forEach((b, i) =>
    Object.assign(b, {
      target: positions[i],
      phase: 'service',
      stopStart: 100,
      due: Infinity,
      overheadUntil: 100,
      visits: 0,
      policyVisit: `${positions[i]}:1`,
      visitOpen: true,
      holdUntil: 0,
      autoHoldUntil: 0,
      alight: [],
      service: null,
    }),
  );
  sim.configureController(options, { start: 0, end: 1000 });
  return sim;
}

function arrivals(sim) {
  return sim.buses.map((b) => ({ type: 'arrival', bus: b.id, stop: b.target, t: sim.time }));
}

function history(sim) {
  for (let stop = 0; stop < sim.c.stops; stop++)
    for (let dest = 0; dest < sim.c.stops; dest++)
      if (dest !== stop)
        sim.controller.history[`${stop}:${dest}`] = {
          t: sim.time - 10,
          previous: sim.time - 130,
          headway: 120,
          bus: 3,
          visit: 'old',
        };
}

function passenger(id, dest = 5, extra = {}) {
  return { id, born: 0, queued: 0, wait: 0, dest, ...extra };
}

test('temporal options validate units, budgets and exact keys before state mutation', () => {
  const options = normalizeControllerOptions({ response: 'boarding' }, { stops: 12 });
  assert.equal(options.maxHold, CONTROLLER_DEFAULTS.maxHold);
  assert.equal(options.response, 'boarding');
  assert.throws(() => normalizeControllerOptions({ strange: 1 }), /Unknown/);
  for (const invalid of [
    { maxHold: Infinity },
    { maxHold: 46 },
    { maxDenials: 0.5 },
    { cooldownStops: -1 },
    { benefitFactor: 0.5 },
    { leadStops: 12 },
    { serveEvery: 13 },
  ])
    assert.throws(() => normalizeControllerOptions(invalid, { stops: 12 }));
  const sim = stopped();
  const before = structuredClone(sim.controller);
  assert.throws(() => sim.configureController({ maxVisitHold: -1 }), /maxVisitHold/);
  assert.deepEqual(sim.controller, before);
});

test('simultaneous convoy keeps ordered leader free and staggers bounded followers', () => {
  const sim = stopped();
  evaluateControllerBatch(sim, arrivals(sim));
  assert.deepEqual(
    sim.buses.map((b) => b.autoHoldUntil),
    [130, 120, 110, 0],
  );
  assert.equal(sim.buses[3].holdUntil, 0);
  assert.equal(sim.controller.metrics.requestedHoldSeconds, 60);
  const held = sim.controller.decisions.filter((d) => d.kind === 'hold');
  assert.equal(held.length, 3);
  assert.deepEqual(
    held.map((d) => d.convoy.rank),
    [3, 2, 1],
  );
  assert.ok(held.every((d) => d.predictedAdditionalSeconds === d.requestedSeconds));
  assert.ok(held.every((d) => d.estimatedQueueSaving > d.estimatedRearCost));
});

test('partial coincident groups keep their front free across bus IDs, the route seam and later visits', () => {
  const cases = [
    { positions: [0, 0, 0, 1], holds: [20, 10, 0, 0], leaders: [2] },
    { positions: [0, 1, 0, 0], holds: [20, 0, 10, 0], leaders: [3] },
    { positions: [11, 0, 11, 11], holds: [20, 0, 10, 0], leaders: [3] },
    { positions: [0, 0, 1, 1], holds: [10, 0, 10, 0], leaders: [1, 3] },
  ];
  for (const fixture of cases) {
    const sim = stopped(fixture.positions, { targetSeconds: 1000 });
    for (const visit of [0, 3]) {
      sim.time = 100 + visit * 100;
      for (const bus of sim.buses) {
        bus.visits = visit;
        bus.policyVisit = `${bus.target}:${visit + 1}`;
        bus.autoHoldUntil = 0;
      }
      history(sim);
      evaluateControllerBatch(sim, arrivals(sim));
      assert.deepEqual(
        sim.buses.map((bus) => Math.max(0, bus.autoHoldUntil - sim.time)),
        fixture.holds,
      );
      for (const id of fixture.leaders) {
        const leader = sim.controller.decisions.findLast((d) => d.bus === id);
        assert.equal(leader.kind, 'suppressed');
        assert.equal(leader.coincidentLeader, true);
        assert.match(leader.reason, /leader retains departure/);
        assert.equal(sim.controller.buses[id].spentHold, 0);
      }
    }
  }
});

test('a newly formed partial group releases its front automatic hold while preserving doors and manual holds', () => {
  for (const manual of [false, true]) {
    const sim = stopped([5, 9, 0, 1], { targetSeconds: 1000 }, { board: 20 });
    history(sim);
    const bus = sim.buses[2];
    bus.service = { kind: 'on', p: passenger(1), start: 100 };
    bus.due = 120;
    evaluateControllerBatch(sim, arrivals(sim));
    assert.equal(bus.autoHoldUntil, 130);
    assert.equal(sim.controller.buses[2].spentHold, 30);
    sim.time = 101;
    sim.buses[0].target = sim.buses[1].target = 0;
    if (manual) bus.holdUntil = 150;
    evaluateControllerBatch(sim, [{ type: 'release', bus: 2, t: 101 }]);
    assert.equal(bus.autoHoldUntil, 101);
    assert.equal(bus.holdUntil, manual ? 150 : 0);
    assert.equal(bus.service.p.id, 1);
    assert.equal(bus.due, 120);
    assert.equal(sim.controller.buses[2].spentHold, 30);
    const release = sim.controller.decisions.find((d) => d.bus === 2 && d.kind === 'release');
    assert.equal(release.coincidentLeader, true);
    assert.match(release.reason, /leader retains departure/);
    evaluateControllerBatch(sim, [{ type: 'release', bus: 2, t: 101 }]);
    assert.equal(
      sim.controller.decisions.filter((d) => d.bus === 2 && d.kind === 'hold').length,
      1,
    );
  }
});

test('arrival evidence, budgets and decisions survive structured clone without own functions', () => {
  const sim = stopped();
  evaluateControllerBatch(sim, arrivals(sim));
  const copy = Object.assign(Object.create(Object.getPrototypeOf(sim)), structuredClone(sim));
  assert.deepEqual(copy.controller, sim.controller);
  evaluateControllerBatch(copy, [{ type: 'release', bus: 0 }]);
  assert.equal(copy.controller.metrics.requestedHoldSeconds, 60, 'same visit cannot extend a hold');
});

test('missing temporal history leaves an isolated short-gap bus in normal service', () => {
  const sim = stopped([0, 1, 5, 9]);
  evaluateControllerBatch(sim, arrivals(sim));
  assert.ok(sim.buses.every((b) => b.autoHoldUntil === 0));
  assert.ok(sim.controller.decisions.some((d) => d.reason.includes('missing temporal history')));
});

test('cost heuristic rejects onboard delay and counts known boarding absorbed by service', () => {
  const expensive = stopped();
  expensive.buses[0].load = Array.from({ length: 200 }, (_, i) => passenger(i));
  evaluateControllerBatch(expensive, arrivals(expensive));
  assert.equal(expensive.buses[0].autoHoldUntil, 0);
  assert.ok(
    expensive.controller.decisions.some((d) => d.bus === 0 && d.reason.includes('benefit')),
  );

  const absorbed = stopped();
  absorbed.stops[1].queue = Array.from({ length: 15 }, (_, i) => passenger(i));
  evaluateControllerBatch(absorbed, arrivals(absorbed));
  const d = absorbed.controller.decisions.find((d) => d.bus === 0 && d.kind === 'suppressed');
  assert.equal(d.predictedAdditionalSeconds, 0);
  assert.equal(d.predictedAbsorbedSeconds, 30);
  assert.equal(d.aboardIncludingBoarding, 15);
  assert.equal(d.estimatedQueueSaving, 0);
  assert.equal(d.estimatedRearCost, 0);
  assert.equal(absorbed.controller.buses[0].spentHold, 0);
  assert.equal(absorbed.controller.buses[0].lastHoldVisit, -1000000);
  assert.equal(absorbed.buses[0].autoHoldUntil, 0);
});

test('partial absorption uses added delay consistently for costs and benefits', () => {
  const sim = stopped(undefined, { targetSeconds: 1000 });
  // Required door work is already underway; none of the other buses can share
  // or remove it. A 30-second request would add only 20 seconds of dwell.
  const bus = sim.buses[0];
  bus.service = { kind: 'on', p: passenger(1, 5), start: 100 };
  bus.due = 110;
  evaluateControllerBatch(sim, arrivals(sim));
  const d = sim.controller.decisions.find((d) => d.bus === 0 && d.kind === 'hold');
  assert.equal(d.requestedSeconds, 30);
  assert.equal(d.predictedAbsorbedSeconds, 10);
  assert.equal(d.predictedAdditionalSeconds, 20);
  assert.equal(d.predictedOnboardCost, 20);
  assert.equal(d.estimatedQueueSaving, 0.05 * 20 * (1000 - 20 / 2));
  assert.equal(d.estimatedRearCost, (0.05 * 20 * 20) / 2);
});

test('a hold absorbed by unshareable door work consumes neither budget nor cooldown', () => {
  const sim = stopped();
  const bus = sim.buses[0];
  bus.service = { kind: 'on', p: passenger(1, 5), start: 100 };
  bus.due = 130;
  evaluateControllerBatch(sim, arrivals(sim));
  const d = sim.controller.decisions.find((d) => d.bus === 0);
  assert.equal(d.kind, 'suppressed');
  assert.match(d.reason, /fully absorbed/);
  assert.equal(d.predictedAbsorbedSeconds, 30);
  assert.equal(d.predictedAdditionalSeconds, 0);
  assert.equal(d.estimatedQueueSaving, 0);
  assert.equal(d.predictedOnboardCost, 0);
  assert.equal(d.estimatedRearCost, 0);
  assert.equal(sim.controller.buses[0].spentHold, 0);
  assert.equal(sim.controller.buses[0].visitHold, 0);
  assert.equal(sim.controller.buses[0].lastHoldVisit, -1000000);
  assert.equal(sim.controller.buses[0].lastDecisionVisit, null);
});

test('a suppressed arrival can be reconsidered at the real release opportunity of the same visit', () => {
  const sim = stopped(undefined, { targetSeconds: 1000 });
  const bus = sim.buses[0],
    p = passenger(1, 5);
  bus.service = { kind: 'on', p, start: 100 };
  bus.due = 130;
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(sim.controller.buses[0].spentHold, 0);
  assert.equal(sim.controller.buses[0].lastDecisionVisit, null);
  sim.time = 130;
  bus.service = null;
  bus.load.push(p);
  evaluateControllerBatch(sim, [{ type: 'release', bus: 0, t: 130 }]);
  assert.equal(bus.autoHoldUntil, 160);
  assert.equal(sim.controller.buses[0].spentHold, 30);
  assert.equal(sim.controller.buses[0].lastDecisionVisit, bus.policyVisit);
  sim.time = 160;
  for (let attempt = 0; attempt < 3; attempt++)
    evaluateControllerBatch(sim, [{ type: 'release', bus: 0, t: 160 }]);
  assert.equal(sim.controller.buses[0].spentHold, 30, 'only accepted actions consume the visit');
  assert.equal(sim.controller.decisions.filter((d) => d.bus === 0 && d.kind === 'hold').length, 1);
});

test('new riders can invalidate a remaining hold without interrupting their doors or recharging the visit', () => {
  for (const manual of [false, true]) {
    const sim = stopped([0, 1, 5, 9], { targetSeconds: 120 });
    for (let dest = 1; dest < 12; dest++)
      sim.controller.history[`0:${dest}`] = {
        t: 40,
        previous: null,
        headway: null,
        bus: 3,
        visit: 'previous',
      };
    evaluateControllerBatch(sim, arrivals(sim));
    const bus = sim.buses[0];
    assert.equal(bus.autoHoldUntil, 130);
    sim.advance(10);
    if (manual) sim.action(0, 'hold', 40);
    for (let id = 1; id <= 3; id++) {
      const p = passenger(id, 5, { born: 110, queued: 110, origin: 0 });
      sim.stops[0].queue.push(p);
      sim.births.push({ id, born: 110, origin: 0, dest: 5 });
      sim.created++;
    }
    // Real passenger-arrival events wake a bus waiting with open service.
    sim.wakeService(bus);
    sim.advance(0);
    sim.advance(2);
    assert.equal(sim.time, 112);
    assert.equal(
      bus.autoHoldUntil,
      110,
      'the real arrival wake-up permits reassessment before new doors',
    );
    assert.equal(bus.service.kind, 'on', 'the next required boarding proceeds');
    assert.equal(sim.controller.buses[0].spentHold, 30);
    const released = sim.controller.decisions.find((d) => d.bus === 0 && d.kind === 'release');
    assert.ok(released);
    if (manual) {
      assert.equal(bus.holdUntil, 150);
      assert.equal(released.predictedAdditionalSeconds, 0);
    } else {
      assert.equal(released.predictedAdditionalSeconds, 14);
      assert.equal(released.predictedOnboardCost, 42);
      assert.ok(Math.abs(released.estimatedQueueSaving - 30.1) < 1e-10);
    }
    sim.advance(manual ? 38 : 4);
    assert.equal(bus.phase, 'travel');
    assert.equal(bus.dwell.at(-1).t, manual ? 150 : 116);
    assert.equal(bus.load.length, 3);
    assert.equal(
      sim.controller.decisions.filter((d) => d.bus === 0 && d.kind === 'hold').length,
      1,
    );
  }
});

test('an active hold releases when new manual follower delays exceed the eligibility horizon', () => {
  const sim = stopped([0, 1, 5, 9], { targetSeconds: 1000 }, { board: 20 });
  for (let dest = 1; dest < 12; dest++)
    sim.controller.history[`0:${dest}`] = {
      t: 40,
      previous: null,
      headway: null,
      bus: 3,
      visit: 'previous',
    };
  const bus = sim.buses[0];
  bus.service = { kind: 'on', p: passenger(1, 5, { queued: 92 }), start: 92 };
  bus.due = 112;
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(bus.autoHoldUntil, 130);
  sim.advance(10);
  for (const follower of sim.buses.slice(1)) sim.action(follower.id, 'hold', 1000);
  sim.advance(2);
  const release = sim.controller.decisions.find((d) => d.bus === 0 && d.kind === 'release');
  assert.ok(release.follower.eta > 300);
  assert.equal(bus.autoHoldUntil, 112);
  assert.equal(bus.load.length, 1, 'the in-progress boarding completed normally');
  assert.equal(bus.phase, 'travel');
  assert.ok(sim.buses.slice(1).every((b) => b.pendingHold === 1000));
  assert.equal(sim.controller.buses[0].spentHold, 30);
  assert.equal(sim.controller.decisions.filter((d) => d.bus === 0 && d.kind === 'hold').length, 1);
});

test('every candidate predicts from the pre-release hold snapshot regardless of bus ID order', () => {
  for (const holderId of [0, 3]) {
    const candidateId = 1,
      remaining = [0, 1, 2, 3].filter((id) => ![holderId, candidateId].includes(id));
    const positions = [];
    positions[holderId] = 0;
    positions[candidateId] = 8;
    remaining.forEach((id, index) => {
      positions[id] = 9 + index;
    });
    const sim = stopped(positions, { targetSeconds: 1000 }, { travel: 10 });
    history(sim);
    sim.buses[holderId].autoHoldUntil = 600;
    for (const id of remaining)
      sim.action(id, 'dropoff', {
        stops: 400,
        untilRecovered: false,
        maxSeconds: 600,
      });
    evaluateControllerBatch(sim, arrivals(sim));
    const candidate = sim.controller.decisions.find((d) => d.bus === candidateId);
    assert.equal(candidate.kind, 'suppressed');
    assert.equal(candidate.follower.bus, holderId);
    assert.equal(candidate.follower.eta, 580, 'another release cannot improve this batch forecast');
    assert.equal(sim.buses[holderId].autoHoldUntil, 100, 'the queued release still applies');
    assert.equal(sim.buses[candidateId].autoHoldUntil, 0);
  }
});

test('automatic plan restoration cannot advertise new coverage inside the same decision batch', () => {
  for (const restoredId of [0, 3]) {
    const candidateId = 1,
      remaining = [0, 1, 2, 3].filter((id) => ![restoredId, candidateId].includes(id));
    const positions = [];
    positions[restoredId] = 0;
    positions[candidateId] = 8;
    remaining.forEach((id, index) => {
      positions[id] = 9 + index;
    });
    const sim = stopped(positions, { targetSeconds: 1000, maxServiceGap: 1 }, { travel: 10 });
    history(sim);
    for (const id of [restoredId, ...remaining])
      sim.action(
        id,
        'dropoff',
        {
          stops: 400,
          untilRecovered: false,
          maxSeconds: 600,
        },
        { automatic: id === restoredId },
      );
    evaluateControllerBatch(sim, arrivals(sim));
    const candidate = sim.controller.decisions.find((d) => d.bus === candidateId);
    assert.equal(candidate.kind, 'suppressed');
    assert.equal(candidate.follower, null);
    assert.equal(sim.buses[restoredId].servicePlan, null, 'the queued safe restoration applies');
    assert.equal(sim.buses[candidateId].autoHoldUntil, 0);
  }
});

test('cooldown spans downstream visits and total hold budget never resets on arrival', () => {
  const sim = stopped(undefined, { repeatBudget: 50, cooldownStops: 2 });
  for (let visit = 0; visit < 10; visit++) {
    sim.time = 100 + visit * 100;
    for (const b of sim.buses)
      Object.assign(b, {
        visits: visit,
        autoHoldUntil: 0,
        policyVisit: `${b.target}:${visit + 1}`,
        stopStart: sim.time,
      });
    evaluateControllerBatch(sim, arrivals(sim));
  }
  const holds = sim.controller.decisions.filter((d) => d.bus === 0 && d.kind === 'hold');
  assert.deepEqual(
    holds.map((d) => d.t),
    [100, 400],
  );
  assert.equal(sim.controller.buses[0].spentHold, 50);
  assert.ok(Object.values(sim.controller.buses).every((s) => s.spentHold <= 50));
});

test('ending an automatic hold preserves an independent manual hold and active door work', () => {
  const sim = stopped();
  evaluateControllerBatch(sim, arrivals(sim));
  const bus = sim.buses[0];
  bus.holdUntil = 999;
  bus.service = { kind: 'on', p: passenger(1), start: sim.time };
  bus.due = 102;
  sim.controller.schedule.end = 99;
  evaluateControllerBatch(sim, [{ type: 'release', bus: 0 }]);
  assert.equal(bus.autoHoldUntil, 100);
  assert.equal(bus.holdUntil, 999);
  assert.equal(bus.service.p.id, 1);
});

test('tail recovery restores normal service without requiring a normal rear gap', () => {
  const sim = stopped([0, 3, 6, 7], { response: 'dropoff' });
  const bus = sim.buses[0];
  sim.action(
    0,
    'dropoff',
    { stops: 4, untilRecovered: false, maxSeconds: 600 },
    { automatic: true },
  );
  assert.equal(sim.gaps(bus).ahead, 3);
  assert.equal(sim.gaps(bus).behind, 5);
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(bus.servicePlan, null);
  assert.ok(
    sim.controller.decisions.some(
      (d) => d.kind === 'restore' && d.reason === 'forward gap recovered',
    ),
  );
});

test('acceleration requires a usable follower for each affected stop and destination', () => {
  for (const response of ['boarding', 'dropoff', 'pattern']) {
    const sim = stopped([0, 6, 8, 10], { response });
    history(sim);
    evaluateControllerBatch(sim, arrivals(sim));
    assert.equal(sim.buses[0].servicePlan?.type, response);
    assert.ok(sim.controller.buses[0].coverage.length);

    const ineligible = stopped([0, 6, 8, 10], { response });
    history(ineligible);
    for (const bus of ineligible.buses.slice(1))
      ineligible.action(bus.id, 'dropoff', {
        stops: 400,
        untilRecovered: false,
        maxSeconds: 600,
      });
    evaluateControllerBatch(ineligible, arrivals(ineligible));
    assert.equal(ineligible.buses[0].servicePlan, null);
    assert.ok(ineligible.controller.decisions.some((d) => d.reason.includes('eligible following')));
  }
});

test('full followers cannot authorize restrictions; known earlier drop-offs can release seats', () => {
  const sim = stopped([0, 6, 8, 10], { response: 'dropoff' }, { capacity: 1 });
  history(sim);
  for (const b of sim.buses.slice(1)) b.load = [passenger(b.id, (b.target + 11) % 12)];
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(sim.buses[0].servicePlan, null);
  assert.equal(predictEligibleService(sim, sim.buses[3], 0, 1), null);
  sim.buses[3].load[0].dest = 11;
  assert.ok(predictEligibleService(sim, sim.buses[3], 0, 1));
});

test('following capacity must cover the known eligible queue, including intermediate boardings', () => {
  const sim = stopped([0, 6, 8, 10], { response: 'dropoff' }, { capacity: 1 });
  history(sim);
  sim.stops[0].queue.push(passenger(1, 1), passenger(2, 1));
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(sim.buses[0].servicePlan, null);
  assert.ok(sim.controller.decisions.some((d) => d.reason.includes('capacity insufficient')));
  sim.stops[11].queue.push(passenger(3, 1));
  assert.equal(predictEligibleService(sim, sim.buses[3], 0, 1), null);
});

test('prediction includes sequential overhead and known alighting without charging current overhead twice', () => {
  const sim = stopped([0, 6, 8, 10], {}, { stopOverhead: 5 });
  const bus = sim.buses[3];
  bus.overheadUntil = 105;
  bus.load = [passenger(1, 10)];
  bus.alight = [...bus.load];
  assert.equal(predictEligibleService(sim, bus, 0, 1).eta, 96);
});

test('a follower prediction includes the origin overhead before its first boarding opportunity', () => {
  const sim = new Simulation({
    buses: 1,
    rate: 0,
    travel: 40,
    stopOverhead: 120,
    board: 2,
  });
  const p = passenger(1, 2);
  sim.stops[1].queue.push(p);
  const predicted = predictEligibleService(sim, sim.buses[0], 1, 2);
  assert.equal(predicted.eta, 160);
  assert.equal(predicted.arrivalAt, 40);
  assert.equal(predicted.serviceAt, 160);
  sim.advance(159);
  assert.equal(sim.buses[0].service, null);
  sim.advance(1);
  assert.equal(sim.buses[0].service.kind, 'on');
  assert.equal(sim.buses[0].service.start, predicted.serviceAt);
});

test('onward follower service includes a queued first-stop hold and next-segment slowdown', () => {
  const held = new Simulation({ buses: 1, rate: 0, travel: 40 });
  held.action(0, 'hold', 300);
  held.stops[2].queue.push(passenger(1, 3));
  const heldPrediction = predictEligibleService(held, held.buses[0], 2, 3);
  assert.equal(heldPrediction.serviceAt, 380);
  held.advance(380);
  assert.equal(held.buses[0].service?.start, heldPrediction.serviceAt);

  const slow = new Simulation({ buses: 1, rate: 0, travel: 40 });
  slow.action(0, 'hold', 1);
  slow.advance(40);
  slow.action(0, 'slow', 4);
  slow.stops[2].queue.push(passenger(1, 3));
  const slowPrediction = predictEligibleService(slow, slow.buses[0], 2, 3);
  assert.equal(slowPrediction.serviceAt, 201);
  slow.advance(161);
  assert.equal(slow.buses[0].service?.start, slowPrediction.serviceAt);
});

test('no-overtaking uses a conservative normal-service fallback instead of an unsafe free-travel estimate', () => {
  const sim = new Simulation({ rate: 0, overtaking: false });
  sim.action(0, 'hold', 1000);
  assert.equal(predictEligibleService(sim, sim.buses[3], 2, 3), null);
  sim.configureController({}, { start: 0, end: 1500 });
  sim.advance(1200);
  assert.equal(sim.controller.metrics.requestedHoldSeconds, 0);
  assert.ok(
    sim.controller.decisions.some((d) => d.predictionLimitations?.includes('joint trajectory')),
  );
});

test('following capacity accounts for allowance expiry before arrival and during boarding', () => {
  for (const maxSeconds of [1, 41]) {
    const sim = new Simulation({ buses: 1, rate: 0, capacity: 3 });
    sim.action(0, 'boarding', { passengers: 1, stops: 3, untilRecovered: false, maxSeconds });
    sim.stops[1].queue.push(passenger(1, 5), passenger(2, 5), passenger(3, 5));
    assert.equal(predictEligibleService(sim, sim.buses[0], 2, 3), null);
    sim.advance(86);
    assert.equal(sim.buses[0].load.length, 3);
  }
});

test('following capacity releases a bounded boarding allowance at later stop locations', () => {
  const sim = new Simulation({ buses: 1, rate: 0, capacity: 3 });
  sim.action(0, 'boarding', { passengers: 1, stops: 1, untilRecovered: false, maxSeconds: 600 });
  sim.stops[2].queue.push(passenger(1, 5), passenger(2, 5), passenger(3, 5));
  assert.equal(predictEligibleService(sim, sim.buses[0], 3, 4), null);
  sim.advance(126);
  assert.equal(sim.buses[0].load.length, 3);
});

test('bounded restrictions require coverage only where their service actually changes', () => {
  const sim = stopped([0, 6, 8, 10], { response: 'dropoff', restrictionStops: 1 });
  for (let dest = 1; dest < 12; dest++)
    sim.controller.history[`0:${dest}`] = {
      t: 90,
      previous: 0,
      headway: 90,
      bus: 3,
      visit: 'old',
    };
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(sim.buses[0].servicePlan?.type, 'dropoff');
});

test('service history excludes full and drop-off-only visits and counts empty usable visits', () => {
  const sim = stopped([0, 6, 8, 10], {}, { capacity: 1 });
  const bus = sim.buses[0];
  bus.load = [passenger(1, 3)];
  recordControllerDeparture(sim, bus);
  assert.equal(Object.keys(sim.controller.history).length, 0);
  bus.load = [];
  sim.action(0, 'dropoff', { stops: 3, untilRecovered: false, maxSeconds: 600 });
  recordControllerDeparture(sim, bus);
  assert.equal(Object.keys(sim.controller.history).length, 0);
  sim.action(0, 'normal', 1);
  recordControllerDeparture(sim, bus);
  assert.equal(Object.keys(sim.controller.history).length, 11);
});

test('completed observed service-gap breaches are distinct from denied-opportunity breaches', () => {
  const sim = stopped([0, 6, 8, 10], { maxServiceGap: 600 }, { capacity: 10 });
  const bus = sim.buses[0];
  recordControllerBoarding(sim, bus, passenger(1, 2));
  recordControllerBoarding(sim, bus, passenger(2, 3));
  sim.time = 701;
  bus.policyVisit = '0:2';
  sim.action(3, 'hold', 20);
  recordControllerBoarding(sim, bus, passenger(3, 2));
  recordControllerBoarding(sim, bus, passenger(4, 2));
  recordControllerBoarding(sim, bus, passenger(5, 3));
  assert.equal(sim.controller.metrics.observedServiceGapBreaches, 2);
  assert.equal(sim.controller.metrics.serviceGapBreaches, 0);
  const breaches = sim.controller.decisions.filter((d) => d.kind === 'breach');
  assert.equal(breaches.length, 2, 'one count per destination interval, not per boarding');
  assert.deepEqual(
    breaches.map((d) => d.destination),
    [2, 3],
  );
  assert.equal(breaches[0].from, 100);
  assert.equal(breaches[0].to, 701);
  assert.equal(breaches[0].gap, 601);
  assert.equal(breaches[0].limit, 600);
  assert.equal(breaches[0].currentContext.capacity, 10);
  assert.equal(breaches[0].currentContext.manualInstructions[0].bus, 3);
  assert.match(breaches[0].currentContext.qualifier, /does not attribute/);
});

test('denial safeguard persists across modes and restores automatic service before another denial', () => {
  const sim = stopped([0, 6, 8, 10], { response: 'boarding', maxDenials: 2 });
  history(sim);
  const bus = sim.buses[0];
  sim.action(
    0,
    'boarding',
    { passengers: 1, stops: 3, untilRecovered: false, maxSeconds: 600 },
    { automatic: true },
  );
  bus.servicePlan.visitAllowanceUsed = 1;
  const p = passenger(99, 1, { born: 5, queued: 90, policyDenials: 1, capacityDenials: 1 });
  sim.stops[0].queue.push(p);
  assert.equal(safeguardControllerVisit(sim, bus), true);
  assert.equal(bus.servicePlan, null);
  assert.equal(p.born, 5);
  assert.equal(p.policyDenials, 1);
  assert.equal(p.capacityDenials, 1);
  assert.ok(sim.canBoard(bus, p));
});

test('unavoidable capacity or manual denial breaches identify their cause', () => {
  const sim = stopped(undefined, { maxDenials: 0 });
  const p = passenger(99, 1, { policyDenials: 0, capacityDenials: 1 });
  recordControllerDenial(sim, sim.buses[0], p, 'capacity');
  assert.equal(sim.controller.metrics.capacityDenials, 1);
  assert.equal(sim.controller.decisions.at(-1).reason, 'capacity prevents service');
  p.policyDenials = 1;
  recordControllerDenial(sim, sim.buses[0], p, 'policy');
  assert.equal(sim.controller.decisions.at(-1).reason, 'manual restriction prevents service');
});

test('event control observes zero-dwell stops and replay agrees across advance partitions', () => {
  const create = () => {
    const sim = new Simulation({
      board: 0,
      debark: 0,
      arrival: 'poisson',
      rideMode: 'random',
      rate: 2,
      seed: 5167,
      arrivalCutoff: 600,
    });
    sim.configureController({ maxHold: 20 }, { start: 100, end: 700 });
    return sim;
  };
  const whole = create(),
    parts = create();
  whole.advance(1200);
  for (let i = 0; i < 120; i++) parts.advance(10);
  assert.deepEqual(whole.births, parts.births);
  assert.deepEqual(whole.controller.decisions, parts.controller.decisions);
  assert.equal(
    whole.summary().created,
    whole.summary().completed + whole.summary().waiting + whole.summary().onboard,
  );
  assert.ok(
    whole.controller.decisions.some((d) => d.t % 30 !== 0),
    'events are not restricted to polling ticks',
  );
});

test('the corrected window is start-inclusive and end-exclusive and releases only automatic parts', () => {
  const sim = stopped();
  sim.controller.schedule = { start: 100, end: 120 };
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(sim.buses[0].autoHoldUntil, 130);
  sim.time = 120;
  sim.buses[0].holdUntil = 150;
  evaluateControllerBatch(sim, []);
  assert.equal(sim.buses[0].autoHoldUntil, 120);
  assert.equal(sim.buses[0].holdUntil, 150);
  assert.equal(sim.controller.metrics.requestedHoldSeconds, 60);
});

test('prediction consumes neither demand RNG nor future realized arrivals', () => {
  const sim = stopped([0, 6, 8, 10]);
  const randomState = sim.randomState;
  for (const stop of sim.stops)
    Object.defineProperty(stop, 'next', {
      get() {
        throw Error('future realized arrivals are unavailable to the controller');
      },
    });
  assert.ok(predictEligibleService(sim, sim.buses[3], 0, 1));
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(sim.randomState, randomState);
});

test('polling is an explicit cadence for the same heuristic and respects release at window end', () => {
  const sim = stopped(undefined, { decisionMode: 'polling', pollSeconds: 30 });
  sim.controller.schedule = { start: 110, end: 150 };
  sim.controller.nextPoll = 110;
  evaluateControllerBatch(sim, arrivals(sim));
  assert.equal(sim.controller.metrics.requestedHoldSeconds, 0);
  sim.time = 110;
  evaluateControllerBatch(sim, []);
  assert.equal(sim.controller.metrics.requestedHoldSeconds, 60);
  assert.equal(sim.controller.nextPoll, 140);
  sim.time = 150;
  evaluateControllerBatch(sim, []);
  assert.ok(sim.buses.every((b) => b.autoHoldUntil <= 150));
  assert.equal(sim.controller.nextPoll, Infinity);
});
