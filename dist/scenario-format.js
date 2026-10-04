import { Simulation } from './engine.js?v=20261004a';

const fields = {
  stops: 'stops',
  buses: 'buses',
  travel_seconds_per_segment: 'travel',
  passengers_per_stop_per_minute: 'rate',
  arrival_pattern: 'arrival',
  boarding_seconds_per_passenger: 'board',
  debarking_seconds_per_passenger: 'debark',
  ride_length_stops: 'ride',
  ride_pattern: 'rideMode',
  random_seed: 'seed',
};
const rules = {
  'hold-v1': 'hold',
  'alternating-express-v1': 'express',
  'fixed-count-express-v1': 'express-count',
};
export const MAX_INTERVENTIONS = 1000;
export function checkInterventionCount(count) {
  if (count > MAX_INTERVENTIONS)
    throw Error(
      'A scenario can contain at most 1,000 interventions, including manual dispatches. Export this lesson and reset to start another run.',
    );
}
export const ruleDescriptions = {
  'hold-v1':
    'At each check, consider buses at service stops with no active or queued hold or express service. If the forward gap is less than 0.95 × ideal gap, hold for min(120, max(1, (ideal gap − forward gap) × segment travel seconds × 2.5)) seconds.',
  'alternating-express-v1':
    'At each check, consider buses at service stops with no active or queued hold or express service. If the forward gap exceeds 1.25 × ideal gap, serve one stop and skip the next repeatedly. Recheck at each arrival; resume normal service when the forward gap is at most the ideal gap. Riders for the next skipped stop transfer before departure. Active express continues after the final activation check until recovered.',
  'fixed-count-express-v1':
    'At each check, consider buses at service stops with no active or queued hold or express service. If the forward gap exceeds 1.25 × ideal gap, skip ceil(forward gap − ideal gap) stops, limited to 1 through stops minus 1, after this service stop. Resume normal service afterward. Riders bound for skipped stops transfer before departure.',
};
function object(x, label) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error(`${label} must be an object.`);
}
function keys(x, allowed, label) {
  object(x, label);
  for (const k of Object.keys(x))
    if (!allowed.includes(k)) throw Error(`Unknown ${label} field: ${k}.`);
}
function number(x, min, max, label, integer = false) {
  if (!Number.isFinite(x) || x < min || x > max || (integer && !Number.isInteger(x)))
    throw Error(`${label} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
}
export function serializeScenario(scenario, config, commands = []) {
  checkInterventionCount(scenario.events.length + commands.length);
  const setup = Object.fromEntries(
    Object.entries(fields).map(([label, key]) => [label, config[key]]),
  );
  const interventions = [...scenario.events, ...commands]
    .map((e) => ({
      at_seconds: e.t,
      bus: e.bus + 1,
      action: e.type,
      ...(e.type === 'hold'
        ? { seconds: e.value }
        : e.type === 'slow'
          ? { multiplier: e.value }
          : { stops: e.value }),
    }))
    .sort((a, b) => a.at_seconds - b.at_seconds);
  const rule = Object.keys(rules).find((k) => rules[k] === scenario.policy),
    schedule = scenario.policySchedule || { start: 1500, end: 3600, interval: 30 };
  return JSON.stringify(
    {
      format: 'Bus Bunching Lab scenario',
      version: 1,
      notes:
        'Times are seconds from time zero; bus numbers start at 1. hold adds a stop hold (seconds); slow multiplies remaining current-segment travel, or next-segment travel if stopped; express skips consecutive stops after the current service stop, or next service stop if moving. Riders for skipped stops transfer and retain their initial arrival time. Events at equal times run in listed order, after any recovery check at that time. Ideal gap = stops / buses; forward gap is distance to the nearest bus ahead in stop units. Recovery checks include both start and end when reached by the interval. Rule explanations are documentation; the versioned rule name determines behavior. Start with empty queues and evenly spaced buses. Unlimited capacity, overtaking allowed, sequential debarking then boarding. Fixed arrivals are synchronized; poisson arrivals have independent exponential intervals. Random ride lengths are uniform integers from 1 to min(2 * ride_length_stops - 1, stops - 1).',
      name: scenario.name,
      description: scenario.description,
      setup,
      interventions,
      recovery_policy: rule
        ? {
            rule,
            rule_explanation: ruleDescriptions[rule],
            start_seconds: schedule.start,
            end_seconds: schedule.end,
            check_every_seconds: schedule.interval,
          }
        : null,
    },
    null,
    2,
  );
}
export function parseScenario(text) {
  if (typeof text !== 'string' || text.length > 200000)
    throw Error('Scenario text must be at most 200,000 characters.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error(
      'Text is not valid JSON. Copy the entire exported text, including its opening and closing braces.',
    );
  }
  keys(
    data,
    [
      'format',
      'version',
      'notes',
      'name',
      'description',
      'setup',
      'interventions',
      'recovery_policy',
    ],
    'scenario',
  );
  if (data.notes !== undefined && (typeof data.notes !== 'string' || data.notes.length > 4000))
    throw Error('Notes must be text of at most 4,000 characters.');
  if (data.format !== 'Bus Bunching Lab scenario' || data.version !== 1)
    throw Error('Expected Bus Bunching Lab scenario version 1.');
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100)
    throw Error('Give the scenario a name of 1–100 characters.');
  if (typeof data.description !== 'string' || data.description.length > 4000)
    throw Error('Description must be text of at most 4,000 characters.');
  keys(data.setup, Object.keys(fields), 'setup');
  const config = {};
  for (const [label, key] of Object.entries(fields)) {
    if (!(label in data.setup)) throw Error(`Missing setup field: ${label}.`);
    config[key] = data.setup[label];
  }
  new Simulation(config);
  if (!Array.isArray(data.interventions) || data.interventions.length > 1000)
    throw Error('Interventions must be a list of at most 1,000 events.');
  const events = data.interventions
    .map((e, i) => {
      const label = `intervention ${i + 1}`;
      const parameter = { hold: 'seconds', slow: 'multiplier', express: 'stops' }[e?.action];
      if (!parameter) throw Error(`${label}: action must be hold, slow, or express.`);
      keys(e, ['at_seconds', 'bus', 'action', parameter], label);
      number(e.at_seconds, 0, 604800, `${label} time`);
      number(e.bus, 1, config.buses, `${label} bus`, true);
      const value = e[parameter];
      new Simulation(config).action(e.bus - 1, e.action, value);
      return { t: e.at_seconds, bus: e.bus - 1, type: e.action, value };
    })
    .sort((a, b) => a.t - b.t);
  let policy, policySchedule;
  if (data.recovery_policy !== null) {
    const p = data.recovery_policy;
    keys(
      p,
      ['rule', 'rule_explanation', 'start_seconds', 'end_seconds', 'check_every_seconds'],
      'recovery policy',
    );
    policy = Object.hasOwn(rules, p.rule) ? rules[p.rule] : null;
    if (!policy)
      throw Error(
        'Unknown recovery rule. Use hold-v1, alternating-express-v1, or fixed-count-express-v1.',
      );
    number(p.start_seconds, 0, 604800, 'Policy start');
    number(p.end_seconds, p.start_seconds, 604800, 'Policy end');
    number(p.check_every_seconds, 1, 604800, 'Policy check interval');
    if ((p.end_seconds - p.start_seconds) / p.check_every_seconds > 10000)
      throw Error('Policy allows at most 10,001 checks.');
    policySchedule = {
      start: p.start_seconds,
      end: p.end_seconds,
      interval: p.check_every_seconds,
    };
  }
  return {
    id: 'custom',
    name: data.name.trim(),
    description: data.description,
    config,
    events,
    ...(policy ? { policy, policySchedule } : {}),
  };
}
