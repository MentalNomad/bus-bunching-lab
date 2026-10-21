import { Experiment, scenarios } from '../dist/experiment.js';
import { orderedBirthIdentity } from '../dist/measurements.js';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Compare complete, matched passenger cohorts. Spatial outcomes are sampled
// before arrivals stop; draining an empty route would give a misleading picture.
export function observeLesson(definition, { seed, overrides = {} } = {}) {
  const d = structuredClone(definition);
  const cutoff = d.config.arrivalCutoff ?? 3600;
  Object.assign(d.config, { arrivalCutoff: cutoff, cohortStart: 1200 }, overrides);
  if (seed !== undefined) d.config.seed = seed;
  if (d.policySchedule) d.policySchedule.end = Math.min(d.policySchedule.end, cutoff);
  const e = new Experiment(d.config, d.id, d);
  const service = { served: 0, bypassed: 0 };
  // Observation only: retain the original methods and do not alter their inputs.
  const depart = e.sim.depart.bind(e.sim);
  e.sim.depart = (bus) => {
    service[bus.servedVisit ? 'served' : 'bypassed']++;
    depart(bus);
  };
  const dispatch = [];
  const note = e.sim.note.bind(e.sim);
  e.sim.note = (message) => {
    dispatch.push({ t: e.sim.time, message });
    note(message);
  };
  const samples = [];
  for (let t = 0; t <= cutoff; t += 15) {
    e.advanceTo(t);
    const { gapCV, waiting, oldestWait } = e.sim.summary();
    samples.push({ t, gapCV, waiting, oldestWait });
  }
  const atCutoff = e.sim.summary();
  const decisions = {};
  for (const row of e.sim.controller?.decisions ?? [])
    decisions[row.kind] = (decisions[row.kind] ?? 0) + 1;
  const serviceAtCutoff = { ...service };
  const cohort = e.drain(14400);
  const late = samples.filter((x) => x.t >= cutoff - 900);
  return {
    id: d.id,
    seed: e.config.seed,
    cutoff,
    atCutoff,
    lateGapCV: late.reduce((n, x) => n + x.gapCV, 0) / late.length,
    peakGapCV: Math.max(...samples.filter((x) => x.t >= 1200).map((x) => x.gapCV)),
    service: serviceAtCutoff,
    decisions,
    dispatch,
    samples,
    cohort: {
      complete: cohort.complete,
      count: cohort.created,
      unfinished: cohort.unfinished,
      mean: cohort.completeMean,
      p95: cohort.completeP95,
      maximum: cohort.completeMax,
      wait: cohort.completeMeanWait,
      onboard: cohort.completeMeanOnboard,
    },
    demandHash: createHash('sha256').update(orderedBirthIdentity(e.sim)).digest('hex'),
    diagnostics: cohort.diagnostics,
  };
}

export function auditLesson(definition, options) {
  const treatment = observeLesson(definition, options);
  const uncontrolled = structuredClone(definition);
  // Retain the minute-20 disruption, remove later recovery actions and policy.
  uncontrolled.events = uncontrolled.events.filter((x) => x.t <= 1200);
  delete uncontrolled.policy;
  delete uncontrolled.policyOptions;
  delete uncontrolled.policySchedule;
  const comparison = observeLesson(uncontrolled, options);
  const matched =
    treatment.demandHash === comparison.demandHash &&
    treatment.cohort.count === comparison.cohort.count;
  if (!matched) throw Error(`${definition.id}: passenger cohorts do not match.`);
  for (const r of [treatment, comparison]) {
    if (
      !r.cohort.complete ||
      !r.diagnostics.conserved ||
      !r.diagnostics.passengerTimeIntegral ||
      !r.diagnostics.queueTimeIntegral ||
      !r.diagnostics.onboardTimeIntegral ||
      r.dispatch.some((x) => x.message.startsWith('Skipped '))
    )
      throw Error(`${definition.id}: incomplete, inconsistent or unusable lesson.`);
  }
  return {
    treatment,
    comparison,
    matched,
    meanChangePercent: 100 * (treatment.cohort.mean / comparison.cohort.mean - 1),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = scenarios.filter((s) => !s.aliasFor).map((s) => auditLesson(s));
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(
      'Matched cohorts: boundary minute 20; inclusive cutoff minute 60; drain up to four hours.',
    );
    console.log('Gap CV: mean of 15-second samples during minutes 45–60, before drain.');
    console.log(
      '| Lesson | Ride length (stops) | Late gap CV | Journey mean (s) | Matching uncontrolled mean (s) | Change | Actual bypasses |',
    );
    console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
    for (const { treatment: t, comparison: c, meanChangePercent: change } of results) {
      const config = scenarios.find((s) => s.id === t.id).config;
      const rides =
        config.rideMode === 'random'
          ? `1–${Math.min(config.stops - 1, 2 * config.ride - 1)} random`
          : `${config.ride} fixed`;
      console.log(
        `| ${t.id} | ${rides} | ${t.lateGapCV.toFixed(3)} | ${t.cohort.mean.toFixed(1)} | ${c.cohort.mean.toFixed(1)} | ${change.toFixed(1)}% | ${t.service.bypassed} |`,
      );
    }
  }
}
