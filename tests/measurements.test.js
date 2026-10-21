import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeCohort,
  compareCohorts,
  measurementExport,
  measurementCSV,
  passengerObservationRecords,
  orderedBirthIdentity,
} from '../dist/measurements.js';

function ledger() {
  const boarder = { id: 2, born: 5, queued: 5, wait: 0, dest: 4 };
  return {
    c: { cohortStart: 10, arrivalCutoff: 20 },
    time: 20,
    created: 4,
    completed: 1,
    births: [
      { id: 1, born: 0, origin: 0, dest: 1 },
      { id: 2, born: 5, origin: 1, dest: 4 },
      { id: 3, born: 12, origin: 2, dest: 5 },
      { id: 4, born: 20, origin: 3, dest: 6 },
    ],
    completedPassengers: [{ id: 1, t: 10, v: 10, wait: 3, bus: 0 }],
    stops: [{ queue: [{ id: 4, born: 20, queued: 20, wait: 0, dest: 6 }] }],
    buses: [
      {
        load: [{ id: 3, born: 12, queued: 12, wait: 2, dest: 5 }],
        service: { kind: 'on', start: 18, p: boarder },
      },
    ],
    integratedPassengerTime: 33,
    integratedQueueTime: 18,
    integratedOnboardTime: 15,
  };
}

test('cohort includes existing riders, a completion at the boundary, and cutoff births', () => {
  const s = ledger();
  const x = summarizeCohort(s);
  assert.equal(x.created, 4);
  assert.equal(x.completed, 1);
  assert.equal(x.unfinished, 3);
  assert.equal(x.accruedPassengerSeconds, 33);
  assert.equal(x.queuePassengerSeconds, 18);
  assert.equal(x.onboardPassengerSeconds, 15);
  assert.equal(x.complete, false);
  assert.equal(x.completeMean, null);
  assert.equal(summarizeCohort(s, { arrivalCutoff: null }).complete, false);
  assert.equal(x.completeP95, null);
  assert.equal(x.completeMax, null);
  assert.equal(x.completedOnly.mean, 10);
  assert.equal(x.diagnostics.conserved, true);
  assert.equal(x.diagnostics.passengerTimeIntegral, true);
  assert.equal(x.diagnostics.queueTimeIntegral, true);
  assert.equal(x.diagnostics.onboardTimeIntegral, true);
  const p = passengerObservationRecords(s).find((p) => p.id === 2);
  assert.equal(p.waitSeconds, 13);
  assert.equal(p.onboardSeconds, 2);
});

test('unfinished tails remain null; only full drain closes the finite cohort', () => {
  const s = ledger();
  s.time = 40;
  s.completed = 4;
  s.completedPassengers.push(
    { id: 2, t: 30, v: 25, wait: 13 },
    { id: 3, t: 35, v: 23, wait: 2 },
    { id: 4, t: 40, v: 20, wait: 5 },
  );
  s.buses = [{ load: [] }];
  s.stops = [{ queue: [] }];
  s.integratedPassengerTime = 78;
  s.integratedQueueTime = 23;
  s.integratedOnboardTime = 55;
  const x = summarizeCohort(s);
  assert.equal(x.complete, true);
  assert.equal(x.completeMean, 19.5);
  assert.equal(x.completeP95, 25);
  assert.equal(x.completeMax, 25);
  assert.equal(x.completeMeanWait, 5.75);
  assert.equal(x.completeMeanOnboard, 13.75);
  assert.equal(x.completeMeanWait + x.completeMeanOnboard, x.completeMean);
  assert.equal(x.diagnostics.passengerTimeIntegral, true);
});

test('ongoing arrivals never label an empty observation a complete cohort', () => {
  const s = {
    ...ledger(),
    c: { cohortStart: 0, arrivalCutoff: null },
    time: 0,
    created: 0,
    completed: 0,
    births: [],
    completedPassengers: [],
    stops: [],
    buses: [],
    integratedPassengerTime: 0,
    integratedQueueTime: 0,
    integratedOnboardTime: 0,
  };
  const x = summarizeCohort(s);
  assert.equal(x.complete, false);
  assert.equal(x.cutoffReached, false);
  assert.equal(x.completeMean, null);
  s.c.arrivalCutoff = 20;
  assert.equal(summarizeCohort(s).complete, false);
  s.time = 20;
  assert.equal(summarizeCohort(s).complete, true);
  assert.equal(summarizeCohort(s).completeMean, null);
});

test('comparisons verify every ordered birth field and independent cohort membership', () => {
  const a = ledger(),
    b = structuredClone(a);
  assert.equal(compareCohorts(a, b).matched, true);
  assert.equal(compareCohorts(a, b).meanDifference, null);
  assert.equal(compareCohorts(a, b).accruedDifference, 0);
  b.births[1].dest = 7;
  assert.equal(compareCohorts(a, b).sameDemand, false);
  assert.equal(compareCohorts(a, b).matched, false);
  b.births[1].dest = 4;
  b.births.reverse();
  assert.notEqual(orderedBirthIdentity(a), orderedBirthIdentity(b));
  assert.equal(compareCohorts(a, b).matched, false);
  assert.equal(compareCohorts(a, a, { treatmentStarts: [9] }).earlyTreatment, true);
  assert.equal(compareCohorts(a, a, { treatmentStarts: [10] }).matched, true);
});

test('diagnostics catch disagreement with an independently accumulated population integral', () => {
  const s = ledger();
  s.integratedPassengerTime += 1;
  assert.equal(summarizeCohort(s).diagnostics.passengerTimeIntegral, false);
  s.buses[0].load.push(s.buses[0].service.p);
  assert.throws(() => summarizeCohort(s), /exactly one place/);
});

test('active boarding, queuing and onboard records retain their original birth clocks', () => {
  const a = ledger();
  a.buses[0].service.p.born = 6;
  assert.throws(() => summarizeCohort(a), /original passenger birth clock/);
  const b = ledger();
  b.stops[0].queue[0].born = 19;
  assert.throws(() => summarizeCohort(b), /original passenger birth clock/);
  const c = ledger();
  c.buses[0].load[0].born = 13;
  assert.throws(() => summarizeCohort(c), /original passenger birth clock/);
});

test('exports retain original birth clocks and explicitly identify incomplete results', () => {
  const s = ledger();
  const before = structuredClone(s);
  const x = measurementExport(s);
  assert.equal(x.format, 'BusBunchingLabObservation');
  assert.equal(x.passengers[1].born, 5);
  assert.equal(x.passengers[1].completionSeconds, null);
  const csv = measurementCSV(s);
  assert.match(csv, /complete,false\r\n/);
  assert.match(csv, /completeP95,\r\n/);
  assert.match(csv, /2,5,1,4,false,,15,13,2/);
  assert.deepEqual(s, before);
});

test('CSV and JSON exports describe assumptions, seed and control including safely escaped text', () => {
  const s = ledger();
  Object.assign(s.c, {
    stopOverhead: 10,
    capacity: 40,
    overtaking: false,
    seed: 817,
    provenance: '=untrusted,"quoted"\ntext',
  });
  s.controller = {
    options: { response: 'boarding', decisionMode: 'events', maxDenials: 2 },
    schedule: { start: 10, end: 20 },
    metrics: {
      requestedHoldSeconds: 30,
      realizedHoldSeconds: 5,
      maximumObservedEligibleServiceGap: 120,
      policyDenials: 7,
      capacityDenials: 3,
    },
    decisions: [{ t: 15, kind: 'suppressed' }],
  };
  const data = measurementExport(s);
  assert.equal(data.config.seed, 817);
  assert.equal(data.controller.options.maxDenials, 2);
  assert.equal(data.controller.decisions[0].t, 15);
  assert.notEqual(data.controller.decisions, s.controller.decisions);
  const csv = measurementCSV(s);
  assert.match(csv, /config.seed,817\r\n/);
  assert.match(csv, /config.capacity,40\r\n/);
  assert.match(csv, /config.overtaking,false\r\n/);
  assert.match(csv, /controllerRule,passenger-cost\r\n/);
  assert.match(csv, /controller.options.maxDenials,2\r\n/);
  assert.match(csv, /controller.schedule.end,20\r\n/);
  assert.match(csv, /controller.metrics.realizedHoldSeconds,5\r\n/);
  assert.match(csv, /controller.metrics.maximumObservedEligibleServiceGap,120\r\n/);
  assert(csv.includes('"\'=untrusted,""quoted""\ntext"'));
  assert.match(csv, /complete,false\r\n/);
});

test('real finite-arrival drain retains original demand and agrees with all independent integrals', async () => {
  const { Simulation } = await import('../dist/engine.js');
  const s = new Simulation({
    stops: 6,
    buses: 2,
    travel: 10,
    rate: 2,
    arrival: 'poisson',
    rideMode: 'random',
    ride: 2,
    board: 2,
    debark: 1,
    seed: 817,
    arrivalCutoff: 300,
    cohortStart: 60,
  });
  s.advance(300);
  const births = orderedBirthIdentity(s);
  const atCutoff = summarizeCohort(s);
  assert.equal(atCutoff.cutoffReached, true);
  assert(atCutoff.unfinished > 0);
  for (let t = 0; t < 3600 && s.created > s.completed; t += 30) s.advance(30);
  assert.equal(orderedBirthIdentity(s), births);
  const x = summarizeCohort(s);
  assert.equal(x.complete, true);
  assert.equal(x.unfinished, 0);
  assert.equal(x.diagnostics.conserved, true);
  assert.equal(x.diagnostics.passengerTimeIntegral, true);
  assert.equal(x.diagnostics.queueTimeIntegral, true);
  assert.equal(x.diagnostics.onboardTimeIntegral, true);
  assert(x.completeMean > x.completeMeanWait);
});
