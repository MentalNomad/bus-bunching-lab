// Model revisions are explicit: old saved scenarios retain the original physics.
export const MODEL_SEMANTICS = ['legacy-v2', 'ordered-v3'];
export function normalizeModelOptions(config = {}) {
  const semantics = config.semantics === undefined ? 'legacy-v2' : config.semantics;
  if (!MODEL_SEMANTICS.includes(semantics)) throw Error('Unknown model semantics.');
  const overhead = config.stopOverhead === undefined ? 0 : config.stopOverhead;
  const stoppingDelay = config.stoppingDelay === undefined ? 0 : config.stoppingDelay;
  const startingDelay = config.startingDelay === undefined ? 0 : config.startingDelay;
  const capacity = config.capacity ?? null;
  const overtaking = config.overtaking === undefined ? true : config.overtaking;
  const cutoff = config.arrivalCutoff ?? null;
  const cohortStart = config.cohortStart === undefined ? 0 : config.cohortStart;
  if (!Number.isFinite(overhead) || overhead < 0 || overhead > 120)
    throw Error('Stop overhead must be 0–120 seconds.');
  for (const [name, value] of [
    ['Stopping', stoppingDelay],
    ['Starting', startingDelay],
  ])
    if (!Number.isFinite(value) || value < 0 || value > 120)
      throw Error(`${name} delay must be 0–120 seconds.`);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 500))
    throw Error('Capacity must be null (unlimited), or 1–500 seats.');
  if (typeof overtaking !== 'boolean') throw Error('Overtaking must be true or false.');
  if (cutoff !== null && (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 604800))
    throw Error('Arrival cutoff must be null, or 0–604,800 seconds.');
  if (!Number.isFinite(cohortStart) || cohortStart < 0 || cohortStart > (cutoff ?? 604800))
    throw Error('Cohort start must be between zero and the arrival cutoff.');
  if (
    config.provenance !== undefined &&
    (typeof config.provenance !== 'string' || config.provenance.length > 1000)
  )
    throw Error('Model provenance must be text of at most 1,000 characters.');
  if (
    semantics === 'legacy-v2' &&
    (overhead || stoppingDelay || startingDelay || capacity !== null || !overtaking)
  )
    throw Error(
      'Optional physical assumptions require the corrected model. Make a corrected copy first.',
    );
  return {
    semantics,
    stopOverhead: overhead,
    stoppingDelay,
    startingDelay,
    capacity,
    overtaking,
    arrivalCutoff: cutoff,
    cohortStart,
    provenance: config.provenance ?? 'Illustrative teaching model; not empirically calibrated.',
  };
}
