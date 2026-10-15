import { Simulation } from './engine.js?v=20261015a';
import { normalizeServiceAction } from './service-plan.js?v=20261015a';
import { normalizeGapPolicy } from './dispatch-rules.js?v=20261015a';

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
// Leave room for the expanded, readable export of every accepted intervention.
// Individual field and event-count limits still bound the parsed recipe.
export const MAX_SCENARIO_TEXT_LENGTH = 500000;
export function checkInterventionCount(count) {
  if (count > MAX_INTERVENTIONS)
    throw Error(
      'A scenario can contain at most 1,000 interventions, including manual dispatches. Export this lesson and reset to start another run.',
    );
}
export const ruleDescriptions = {
  'two-gap-v2':
    'At each scheduled check, test both selected spatial gap conditions against stops / buses; all conditions must match. Small and large comparisons are strict. Only buses at service stops with no active hold or restrictive service qualify, at most once per stop visit. Evaluate candidates from the same snapshot and reserve at least one unrestricted full-service bus. New service modes preserve accepted drop-offs, stop when both gaps recover (ahead at most 110% and behind at least 90% of ideal) if requested, and always have a maximum duration.',
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
function required(x, fields, label) {
  keys(x, fields, label);
  for (const key of fields)
    if (!Object.hasOwn(x, key)) throw Error(`Missing ${label} field: ${key}.`);
}
function actionFields(action) {
  switch (action) {
    case 'hold':
      return ['seconds'];
    case 'slow':
      return ['multiplier'];
    case 'express':
      return ['stops'];
    case 'drop_off_only':
      return ['stops', 'until_recovered', 'max_seconds'];
    case 'announced_skip':
      return ['lead_stops', 'serve_every', 'for_stops', 'until_recovered', 'max_seconds'];
    case 'normal_service':
      return [];
    default:
      return null;
  }
}
function decodeAction(data, config, version, label, timed = false) {
  const fields = actionFields(data?.action);
  if (!fields || (version === 1 && !['hold', 'slow', 'express'].includes(data.action)))
    throw Error(`${label}: unknown action for scenario version ${version}.`);
  required(data, [...(timed ? ['at_seconds', 'bus'] : []), 'action', ...fields], label);
  if (data.action === 'normal_service') return { type: 'normal', value: 1 };
  if (data.action === 'drop_off_only') {
    const value = {
      stops: data.stops,
      untilRecovered: data.until_recovered,
      maxSeconds: data.max_seconds,
    };
    return { type: 'dropoff', value: normalizeServiceAction('dropoff', value, config) };
  }
  if (data.action === 'announced_skip') {
    const value = {
      leadStops: data.lead_stops,
      every: data.serve_every,
      stops: data.for_stops,
      untilRecovered: data.until_recovered,
      maxSeconds: data.max_seconds,
    };
    return { type: 'pattern', value: normalizeServiceAction('pattern', value, config) };
  }
  const value = data[fields[0]];
  new Simulation(config).action(0, data.action, value);
  return { type: data.action, value };
}
function encodeAction(type, value) {
  if (type === 'dropoff')
    return {
      action: 'drop_off_only',
      stops: value.stops,
      until_recovered: value.untilRecovered,
      max_seconds: value.maxSeconds,
    };
  if (type === 'pattern')
    return {
      action: 'announced_skip',
      lead_stops: value.leadStops,
      serve_every: value.every,
      for_stops: value.stops,
      until_recovered: value.untilRecovered,
      max_seconds: value.maxSeconds,
    };
  if (type === 'normal') return { action: 'normal_service' };
  return {
    action: type,
    ...(type === 'hold'
      ? { seconds: value }
      : type === 'slow'
        ? { multiplier: value }
        : { stops: value }),
  };
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
      ...encodeAction(e.type, e.value),
    }))
    .sort((a, b) => a.at_seconds - b.at_seconds);
  const rule =
      scenario.policy === 'two-gap'
        ? 'two-gap-v2'
        : Object.keys(rules).find((k) => rules[k] === scenario.policy),
    schedule = scenario.policySchedule || { start: 1500, end: 3600, interval: 30 };
  const version =
    rule === 'two-gap-v2' ||
    interventions.some((event) =>
      ['drop_off_only', 'announced_skip', 'normal_service'].includes(event.action),
    )
      ? 2
      : 1;
  const options = rule === 'two-gap-v2' ? normalizeGapPolicy(scenario.policyOptions, config) : null;
  return JSON.stringify(
    {
      format: 'Bus Bunching Lab scenario',
      version,
      notes:
        'Times are seconds from time zero; bus numbers start at 1. hold adds a stop hold; slow multiplies remaining current-segment travel, or next-segment travel if stopped. Legacy express skips consecutive stops and transfers affected onboard riders. Version 2 drop_off_only and announced_skip honor accepted drop-offs and restrict new boarding. Patterns anchor at the current service stop, or the next stop if moving, then serve lead_stops future locations before repeating skip serve_every minus 1 and serve 1. for_stops counts active locations after the lead; until_recovered uses both gaps instead; max_seconds caps the entire instruction. normal_service cancels restrictive service, preserving holds. Equal-time actions run in listed order after any recovery check. Ideal spatial gap = stops / buses. Recovery checks include endpoints when reached by their interval. Rule explanations are documentation. Start with empty queues and evenly spaced buses; unlimited capacity, overtaking allowed, sequential debarking then boarding. Fixed arrivals are synchronized; poisson arrivals have independent exponential intervals. Random rides are uniform integers from 1 to min(2 * ride_length_stops - 1, stops - 1).',
      name: scenario.name,
      description: scenario.description,
      setup,
      interventions,
      recovery_policy: rule
        ? {
            rule,
            rule_explanation: ruleDescriptions[rule],
            ...(options
              ? {
                  condition: {
                    ahead: options.ahead,
                    behind: options.behind,
                    small_ratio: options.small,
                    large_ratio: options.large,
                  },
                  response: encodeAction(options.response.type, options.response.value),
                }
              : {}),
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
  if (typeof text !== 'string' || text.length > MAX_SCENARIO_TEXT_LENGTH)
    throw Error('Scenario text must be at most 500,000 characters.');
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
  if (data.format !== 'Bus Bunching Lab scenario' || ![1, 2].includes(data.version))
    throw Error('Expected Bus Bunching Lab scenario version 1 or 2.');
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
      const action = decodeAction(e, config, data.version, label, true);
      number(e.at_seconds, 0, 604800, `${label} time`);
      number(e.bus, 1, config.buses, `${label} bus`, true);
      return { t: e.at_seconds, bus: e.bus - 1, ...action };
    })
    .sort((a, b) => a.t - b.t);
  let policy, policySchedule, policyOptions;
  if (data.recovery_policy !== null) {
    const p = data.recovery_policy;
    keys(
      p,
      [
        'rule',
        'rule_explanation',
        'start_seconds',
        'end_seconds',
        'check_every_seconds',
        ...(p?.rule === 'two-gap-v2' && data.version === 2 ? ['condition', 'response'] : []),
      ],
      'recovery policy',
    );
    policy =
      p.rule === 'two-gap-v2' && data.version === 2
        ? 'two-gap'
        : Object.hasOwn(rules, p.rule)
          ? rules[p.rule]
          : null;
    if (!policy)
      throw Error(
        'Unknown recovery rule. Use hold-v1, alternating-express-v1, fixed-count-express-v1, or two-gap-v2 (version 2).',
      );
    if (
      p.rule_explanation !== undefined &&
      (typeof p.rule_explanation !== 'string' || p.rule_explanation.length > 4000)
    )
      throw Error('Rule explanation must be text of at most 4,000 characters.');
    if (policy === 'two-gap') {
      required(p.condition, ['ahead', 'behind', 'small_ratio', 'large_ratio'], 'gap condition');
      const response = decodeAction(p.response, config, 2, 'policy response');
      policyOptions = normalizeGapPolicy(
        {
          ahead: p.condition.ahead,
          behind: p.condition.behind,
          small: p.condition.small_ratio,
          large: p.condition.large_ratio,
          response,
        },
        config,
      );
    }
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
    ...(policy ? { policy, policySchedule, ...(policyOptions ? { policyOptions } : {}) } : {}),
  };
}
