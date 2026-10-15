/* Passenger comparisons use original birth records, including riders already
 * aboard at the cohort boundary. Times are seconds; costs are passenger-seconds.
 * This module has no DOM dependency and never changes the simulation. */
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const sum = (xs) => xs.reduce((n, x) => n + x, 0);
const near = (a, b) =>
  finite(a) && finite(b) && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));

export function orderedBirthRecords(sim) {
  if (!Array.isArray(sim.births)) throw Error('Original passenger birth records are unavailable.');
  return sim.births.map(({ id, born, origin, dest }) => ({ id, born, origin, dest }));
}

// Deliberately retain every field and the order. Hash this string with SHA-256
// in a study runner; comparing only a seed, count, or moments is insufficient.
export function orderedBirthIdentity(sim) {
  return JSON.stringify(orderedBirthRecords(sim).map((p) => [p.id, p.born, p.origin, p.dest]));
}

function recordMaps(sim) {
  const births = orderedBirthRecords(sim);
  const birthMap = new Map();
  for (const p of births) {
    if (birthMap.has(p.id) || !finite(p.born) || p.born > sim.time)
      throw Error('Invalid or duplicate passenger birth record.');
    birthMap.set(p.id, p);
  }
  const completed = new Map();
  for (const p of sim.completedPassengers) {
    if (
      !birthMap.has(p.id) ||
      completed.has(p.id) ||
      !finite(p.t) ||
      p.t > sim.time ||
      !finite(p.v) ||
      !finite(p.wait) ||
      !near(p.v, p.t - birthMap.get(p.id).born)
    )
      throw Error('Invalid or duplicate passenger completion record.');
    completed.set(p.id, p);
  }
  const active = new Map();
  function add(p, waiting, queuedUntil) {
    if (!birthMap.has(p.id) || completed.has(p.id) || active.has(p.id))
      throw Error('A passenger must occupy exactly one place in the system.');
    if (p.born !== birthMap.get(p.id).born)
      throw Error('The original passenger birth clock changed.');
    const wait = p.wait + (waiting ? Math.max(0, queuedUntil - p.queued) : 0);
    const system = sim.time - birthMap.get(p.id).born;
    if (!finite(wait) || wait < 0 || wait > system + 1e-7)
      throw Error('Invalid accrued passenger wait.');
    active.set(p.id, { system, wait });
  }
  for (const stop of sim.stops) for (const p of stop.queue) add(p, true, sim.time);
  for (const b of sim.buses) {
    for (const p of b.load) add(p, false, 0);
    // Active alighting remains in load. Active boarding was removed from the
    // queue, but its pre-boarding wait is committed only when boarding finishes.
    if (b.service?.kind === 'on') add(b.service.p, true, b.service.start);
  }
  return { births, birthMap, completed, active };
}

function tail(xs) {
  if (!xs.length) return { mean: null, p95: null, max: null };
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    mean: sum(xs) / xs.length,
    p95: sorted[Math.ceil(0.95 * xs.length) - 1],
    max: sorted.at(-1),
  };
}

export function passengerObservationRecords(sim) {
  const { births, completed, active } = recordMaps(sim);
  return births.map((p) => {
    const done = completed.get(p.id);
    const present = active.get(p.id);
    if (!done && !present)
      throw Error('A created passenger has neither an active place nor a completion.');
    const systemSeconds = done ? done.v : present.system;
    const waitSeconds = done ? done.wait : present.wait;
    return {
      ...p,
      completed: !!done,
      completionSeconds: done?.t ?? null,
      systemSeconds,
      waitSeconds,
      onboardSeconds: systemSeconds - waitSeconds,
    };
  });
}

export function summarizeCohort(sim, options = {}) {
  const cohortStart = options.cohortStart ?? sim.c.cohortStart ?? 0;
  const arrivalCutoff = Object.hasOwn(options, 'arrivalCutoff')
    ? options.arrivalCutoff
    : (sim.c.arrivalCutoff ?? null);
  if (
    !finite(cohortStart) ||
    cohortStart < 0 ||
    (arrivalCutoff !== null && (!finite(arrivalCutoff) || arrivalCutoff < cohortStart))
  )
    throw Error('Invalid passenger cohort boundary.');
  const records = passengerObservationRecords(sim);
  // A completion exactly at the boundary belongs to the pre-boundary population.
  const cohort = records.filter(
    (p) =>
      (arrivalCutoff === null || p.born <= arrivalCutoff) &&
      (!p.completed || p.completionSeconds >= cohortStart),
  );
  const finished = cohort.filter((p) => p.completed);
  const cutoffReached = arrivalCutoff !== null && sim.time >= arrivalCutoff;
  const complete = cutoffReached && finished.length === cohort.length;
  const accrued = sum(cohort.map((p) => p.systemSeconds));
  const wait = sum(cohort.map((p) => p.waitSeconds));
  const allAccrued = sum(records.map((p) => p.systemSeconds));
  const allWait = sum(records.map((p) => p.waitSeconds));
  const allOnboard = allAccrued - allWait;
  const diagnostics = {
    conserved:
      records.length === sim.created && records.filter((p) => p.completed).length === sim.completed,
    passengerTimeIntegral: near(allAccrued, sim.integratedPassengerTime),
    queueTimeIntegral: near(allWait, sim.integratedQueueTime),
    onboardTimeIntegral: near(allOnboard, sim.integratedOnboardTime),
    allPassengerSeconds: allAccrued,
    integratedPassengerSeconds: finite(sim.integratedPassengerTime)
      ? sim.integratedPassengerTime
      : null,
    allQueueSeconds: allWait,
    integratedQueueSeconds: finite(sim.integratedQueueTime) ? sim.integratedQueueTime : null,
    allOnboardSeconds: allOnboard,
    integratedOnboardSeconds: finite(sim.integratedOnboardTime) ? sim.integratedOnboardTime : null,
  };
  const total = complete
    ? tail(cohort.map((p) => p.systemSeconds))
    : { mean: null, p95: null, max: null };
  return {
    horizon: sim.time,
    cohortStart,
    arrivalCutoff,
    cutoffReached,
    complete,
    definition:
      'Passengers present immediately before the cohort boundary (including completion exactly at it), plus all births through the inclusive arrival cutoff; original whole-journey clocks are retained.',
    created: cohort.length,
    completed: finished.length,
    unfinished: cohort.length - finished.length,
    accruedPassengerSeconds: accrued,
    queuePassengerSeconds: wait,
    onboardPassengerSeconds: accrued - wait,
    completeMean: total.mean,
    completeP95: total.p95,
    completeMax: total.max,
    completeMeanWait: complete && cohort.length ? wait / cohort.length : null,
    completeMeanOnboard: complete && cohort.length ? (accrued - wait) / cohort.length : null,
    completedOnly: { count: finished.length, ...tail(finished.map((p) => p.systemSeconds)) },
    diagnostics,
  };
}

export function compareCohorts(a, b, options = {}) {
  const left = summarizeCohort(a, options),
    right = summarizeCohort(b, options);
  const starts = options.treatmentStarts ?? [];
  const sameDemand = orderedBirthIdentity(a) === orderedBirthIdentity(b);
  const ids = (s) =>
    passengerObservationRecords(s)
      .filter(
        (p) =>
          (left.arrivalCutoff === null || p.born <= left.arrivalCutoff) &&
          (!p.completed || p.completionSeconds >= left.cohortStart),
      )
      .map((p) => p.id)
      .sort((x, y) => x - y);
  const sameCohort = JSON.stringify(ids(a)) === JSON.stringify(ids(b));
  const earlyTreatment = starts.some((t) => !finite(t) || t < left.cohortStart);
  const matched =
    sameDemand &&
    sameCohort &&
    left.cohortStart === right.cohortStart &&
    left.arrivalCutoff === right.arrivalCutoff &&
    !earlyTreatment;
  const complete = matched && left.complete && right.complete;
  return {
    matched,
    complete,
    sameDemand,
    sameCohort,
    earlyTreatment,
    left,
    right,
    meanDifference:
      complete && left.completeMean !== null && right.completeMean !== null
        ? right.completeMean - left.completeMean
        : null,
    accruedDifference:
      matched && left.horizon === right.horizon
        ? right.accruedPassengerSeconds - left.accruedPassengerSeconds
        : null,
  };
}

export function measurementExport(sim, options = {}) {
  const scalars = (object) =>
    Object.fromEntries(
      Object.entries(object ?? {}).filter(
        ([, value]) => value === null || ['number', 'string', 'boolean'].includes(typeof value),
      ),
    );
  return {
    format: 'BusBunchingLabObservation',
    version: 3,
    modelSemantics: sim.c.semantics ?? 'legacy-v2',
    config: scalars(sim.c),
    assumptions: {
      stopOverhead: sim.c.stopOverhead ?? 0,
      capacity: sim.c.capacity ?? null,
      overtaking: sim.c.overtaking ?? true,
      provenance: String(sim.c.provenance ?? 'illustrative'),
    },
    summary: summarizeCohort(sim, options),
    controller: sim.controller
      ? {
          rule: 'temporal-cost-v3',
          options: scalars(sim.controller.options),
          schedule: scalars(sim.controller.schedule),
          metrics: scalars(sim.controller.metrics),
          decisions: structuredClone(sim.controller.decisions ?? []),
        }
      : null,
    births: orderedBirthRecords(sim),
    passengers: passengerObservationRecords(sim),
  };
}

function csvValue(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value !== 'number') text = `'${text}`;
  return /[,"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function measurementCSV(sim, options = {}) {
  const { summary, passengers, modelSemantics, config, assumptions, controller } =
    measurementExport(sim, options);
  const metadata = [
    ['modelSemantics', modelSemantics],
    ...Object.entries(config).map(([key, value]) => [`config.${key}`, value]),
    ...Object.entries(assumptions).map(([key, value]) => [`assumptions.${key}`, value]),
    ['controllerRule', controller?.rule ?? 'none'],
    ...Object.entries(controller?.options ?? {}).map(([key, value]) => [
      `controller.options.${key}`,
      value,
    ]),
    ...Object.entries(controller?.schedule ?? {}).map(([key, value]) => [
      `controller.schedule.${key}`,
      value,
    ]),
    ...Object.entries(controller?.metrics ?? {}).map(([key, value]) => [
      `controller.metrics.${key}`,
      value,
    ]),
  ];
  const columns = [
    'id',
    'born',
    'origin',
    'dest',
    'completed',
    'completionSeconds',
    'systemSeconds',
    'waitSeconds',
    'onboardSeconds',
  ];
  const rows = [columns, ...passengers.map((p) => columns.map((k) => p[k]))];
  // Metadata makes an exported incomplete observation impossible to mistake for
  // a complete cohort result, while the passenger rows retain individual times.
  return (
    [
      'measurement,value',
      ...metadata.map((row) => row.map(csvValue).join(',')),
      ...Object.entries(summary)
        .filter(([, v]) => v === null || ['number', 'string', 'boolean'].includes(typeof v))
        .map(([k, v]) => [k, v].map(csvValue).join(',')),
      '',
      ...rows.map((r) => r.map(csvValue).join(',')),
    ].join('\r\n') + '\r\n'
  );
}
