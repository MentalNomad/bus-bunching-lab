// All durations are simulation seconds. Values are illustrative, not calibrated.
export const CONTROLLER_DEFAULTS = Object.freeze({
  response: 'hold',
  decisionMode: 'events',
  pollSeconds: 30,
  maxHold: 30,
  maxVisitHold: 45,
  repeatBudget: 90,
  cooldownStops: 2,
  benefitFactor: 1.2,
  targetSeconds: 0,
  maxFollowerEta: 300,
  maxDenials: 2,
  maxServiceGap: 600,
  boardingPassengers: 5,
  restrictionStops: 3,
  leadStops: 2,
  serveEvery: 2,
  restrictionMaxSeconds: 600,
});

export function defaultControllerOptions() {
  return { ...CONTROLLER_DEFAULTS };
}

export function normalizeControllerOptions(options = {}, config = { stops: 12 }) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw Error('Temporal controller options must be an object.');
  for (const key of Object.keys(options))
    if (!Object.hasOwn(CONTROLLER_DEFAULTS, key))
      throw Error(`Unknown temporal controller option: ${key}.`);
  const result = { ...CONTROLLER_DEFAULTS, ...options };
  if (!['hold', 'boarding', 'dropoff', 'pattern'].includes(result.response))
    throw Error('Temporal response must be hold, boarding, dropoff, or pattern.');
  if (!['events', 'polling'].includes(result.decisionMode))
    throw Error('Temporal decision mode must be events or polling.');
  const limits = {
    pollSeconds: [1, 3600],
    maxHold: [0, 3600],
    maxVisitHold: [0, 3600],
    repeatBudget: [0, 86400],
    cooldownStops: [0, 400, true],
    benefitFactor: [1, 100],
    targetSeconds: [0, 86400],
    maxFollowerEta: [1, 86400],
    maxDenials: [0, 100, true],
    maxServiceGap: [1, 86400],
    boardingPassengers: [1, 500, true],
    restrictionStops: [1, 400, true],
    leadStops: [0, config.stops - 1, true],
    serveEvery: [2, config.stops, true],
    restrictionMaxSeconds: [1, 604800],
  };
  for (const [key, [min, max, integer]] of Object.entries(limits)) {
    const value = result[key];
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      throw Error(`${key} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
  }
  if (result.maxHold > result.maxVisitHold)
    throw Error('Per-action hold cannot exceed the per-visit hold limit.');
  return result;
}
