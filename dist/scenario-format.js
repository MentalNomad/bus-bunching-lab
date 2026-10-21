import { Simulation } from './engine.js?v=20261021a';

import { normalizeServiceAction } from './service-plan.js?v=20261021a';

import { normalizeControllerOptions } from './controller-options.js?v=20261021a';

import { normalizeModelOptions } from './model-options.js?v=20261021a';

import { normalizeGapPolicy } from './dispatch-rules.js?v=20261021a';

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

    case 'boarding_limit':
      return ['passengers', 'stops', 'until_recovered', 'max_seconds'];

    case 'normal_service':
      return [];

    default:
      return null;
  }
}

function decodeAction(data, config, label, timed = false) {
  const fields = actionFields(data?.action);

  if (!fields) throw Error(`${label}: unknown action.`);

  required(data, [...(timed ? ['at_seconds', 'bus'] : []), 'action', ...fields], label);

  if (data.action === 'boarding_limit') {
    const value = {
      passengers: data.passengers,
      stops: data.stops,
      untilRecovered: data.until_recovered,
      maxSeconds: data.max_seconds,
    };

    new Simulation(config).action(0, 'boarding', value);

    return { type: 'boarding', value };
  }

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
  if (type === 'boarding')
    return {
      action: 'boarding_limit',
      passengers: value.passengers,
      stops: value.stops,
      until_recovered: value.untilRecovered,
      max_seconds: value.maxSeconds,
    };

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

const rules = {
  hold: 'hold',

  'alternating-express': 'express',

  'fixed-count-express': 'express-count',

  'two-gap': 'two-gap',

  'passenger-cost': 'temporal',
};

const modelFields = {
  stop_overhead_seconds: 'stopOverhead',
  stopping_delay_seconds: 'stoppingDelay',
  starting_delay_seconds: 'startingDelay',

  bus_capacity: 'capacity',

  allow_overtaking: 'overtaking',

  calibration_notes: 'provenance',
};

export const ruleDescriptions = {
  hold: 'Polling comparison only: immediate circular neighbors, stable ID ties; leave the leader free. At most one action per visit, 30 seconds per action and 90 seconds per bus over the run, with two visits of cooldown. This spatial heuristic is separate from passenger-cost event control.',

  'alternating-express':
    'Polling comparison: activate bounded alternating service above 125% of ideal forward gap; honor accepted drop-offs; stop acceleration when forward gap is at most 110% of ideal, or at expiry. Ordered immediate-neighbor gaps include the long convoy arc.',

  'fixed-count-express':
    'Polling comparison: above 125% ideal forward gap, skip ceil(gap minus ideal) locations, honoring accepted drop-offs. A spatial heuristic without passenger-cost optimization.',

  'two-gap':
    'Polling comparison: use one ordered snapshot, once per visit. Holding has leader protection, 30-second action limit, 90-second total budget and two-visit cooldown. Service restrictions preserve accepted drop-offs; no temporal coverage guarantee is claimed. Use passenger-cost for destination safeguards.',

  'passenger-cost':
    'Event-based heuristic at stop arrivals and release opportunities. Use observed usable service and predicted eligible follower times, bounded onboard-cost versus queue-benefit holding, repeat budgets, destination-specific coverage and repeated-denial safeguards. Unknown or unsuitable coverage restores normal service. Predictions use current information, not future demand. This is illustrative and not an optimizer.',
};

export function serializeScenario(scenario, config, commands = []) {
  checkInterventionCount(scenario.events.length + commands.length);

  const model = normalizeModelOptions(config);

  let recovery = null;

  if (scenario.policy) {
    const rule = Object.keys(rules).find((k) => rules[k] === scenario.policy);
    if (!rule) throw Error('Unknown recovery rule.');

    const schedule = scenario.policySchedule || { start: 1500, end: 3600, interval: 30 };

    recovery = {
      rule,
      rule_explanation: ruleDescriptions[rule],
      start_seconds: schedule.start,
      end_seconds: schedule.end,
    };

    if (scenario.policy === 'temporal')
      recovery.options = normalizeControllerOptions(scenario.policyOptions, config);
    else {
      recovery.check_every_seconds = schedule.interval;

      if (scenario.policy === 'two-gap') {
        const o = normalizeGapPolicy(scenario.policyOptions, config);

        recovery.condition = {
          ahead: o.ahead,
          behind: o.behind,
          small_ratio: o.small,
          large_ratio: o.large,
        };

        recovery.response = encodeAction(o.response.type, o.response.value);
      }
    }
  }

  const data = {
    format: 'Bus Bunching Lab scenario',

    notes:
      'Units: seconds from time zero; bus numbers start at 1. At equal timestamps, mandatory arrivals and completions precede listed manual actions, then one automatic decision batch, then door starts and departures. Cutoff includes arrivals at that timestamp, cancels later demand and ends new automatic decisions. The temporal control window is start inclusive, end exclusive; its automatic components restore normal service at end. Manual bounded instructions may finish or expire during drain. Cohort includes all present just before its boundary plus births through cutoff, retaining original whole-journey clocks. until_recovered uses forward gap at most 110% of ideal; a convoy leader owns the long wrap arc. Stopping precedes overhead and sequential door service; both overlap holds. Starting extends the following travel segment after service/holds. True bypasses incur neither stopping nor starting penalties. A boarding_limit permits the specified number of new boardings per visit; existing boarding finishes. See scenario-guide.html for bounds and definitions.',

    name: scenario.name,
    description: scenario.description,

    setup: Object.fromEntries(Object.entries(fields).map(([label, key]) => [label, config[key]])),

    model: Object.fromEntries(
      Object.entries(modelFields).map(([label, key]) => [label, model[key]]),
    ),

    observation: {
      cohort_start_seconds: model.cohortStart,
      arrival_cutoff_seconds: model.arrivalCutoff,
      drain_max_seconds: scenario.drainMaxSeconds ?? 86400,
    },

    interventions: [...scenario.events, ...commands]
      .map((e) => ({ at_seconds: e.t, bus: e.bus + 1, ...encodeAction(e.type, e.value) }))
      .sort((a, b) => a.at_seconds - b.at_seconds),

    recovery_policy: recovery,
  };

  parseDocument(data); // Export obeys the same strict contract as import.

  return JSON.stringify(data, null, 2);
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
  return parseDocument(data);
}

function parseDocument(data) {
  required(
    data,
    [
      'format',
      'name',
      'description',
      'setup',
      'model',
      'observation',
      'interventions',
      'recovery_policy',
      ...(data.notes === undefined ? [] : ['notes']),
    ],
    'scenario',
  );

  if (data.format !== 'Bus Bunching Lab scenario') throw Error('Unknown scenario format.');

  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100)
    throw Error('Give the scenario a name of 1–100 characters.');

  if (typeof data.description !== 'string' || data.description.length > 4000)
    throw Error('Description must be text of at most 4,000 characters.');

  if (data.notes !== undefined && (typeof data.notes !== 'string' || data.notes.length > 4000))
    throw Error('Notes must be text of at most 4,000 characters.');

  required(data.setup, Object.keys(fields), 'setup');

  required(data.model, Object.keys(modelFields), 'model');

  required(
    data.observation,
    ['cohort_start_seconds', 'arrival_cutoff_seconds', 'drain_max_seconds'],
    'observation',
  );

  const config = Object.fromEntries(
    Object.entries(fields).map(([label, key]) => [key, data.setup[label]]),
  );

  Object.assign(
    config,
    Object.fromEntries(Object.entries(modelFields).map(([label, key]) => [key, data.model[label]])),
    {
      cohortStart: data.observation.cohort_start_seconds,
      arrivalCutoff: data.observation.arrival_cutoff_seconds,
    },
  );

  if (Object.values(data.model).some((v) => v === undefined))
    throw Error('Incomplete model options.');

  Object.assign(config, normalizeModelOptions(config));

  new Simulation(config);

  number(data.observation.drain_max_seconds, 1, 604800, 'Drain time bound');

  if (!Array.isArray(data.interventions) || data.interventions.length > 1000)
    throw Error('Interventions must be a list of at most 1,000 events.');

  const events = data.interventions
    .map((e, i) => {
      const label = `intervention ${i + 1}`;

      const action = decodeAction(e, config, label, true);

      number(e.at_seconds, config.cohortStart, config.arrivalCutoff ?? 604800, `${label} time`);

      number(e.bus, 1, config.buses, `${label} bus`, true);

      return { t: e.at_seconds, bus: e.bus - 1, ...action };
    })
    .sort((a, b) => a.t - b.t);

  let policy, policySchedule, policyOptions;

  if (data.recovery_policy !== null) {
    const p = data.recovery_policy;

    const temporal = p?.rule === 'passenger-cost',
      two = p?.rule === 'two-gap';

    keys(
      p,
      [
        'rule',
        'rule_explanation',
        'start_seconds',
        'end_seconds',
        ...(temporal ? ['options'] : ['check_every_seconds']),
        ...(two ? ['condition', 'response'] : []),
      ],
      'recovery policy',
    );

    policy = Object.hasOwn(rules, p.rule) ? rules[p.rule] : null;
    if (!policy) throw Error('Unknown recovery rule.');

    if (
      p.rule_explanation !== undefined &&
      (typeof p.rule_explanation !== 'string' || p.rule_explanation.length > 4000)
    )
      throw Error('Rule explanation must be at most 4,000 characters.');

    number(p.start_seconds, config.cohortStart, config.arrivalCutoff ?? 604800, 'Policy start');

    number(p.end_seconds, p.start_seconds, config.arrivalCutoff ?? 604800, 'Policy end');

    policySchedule = { start: p.start_seconds, end: p.end_seconds };

    if (temporal) {
      if (!Object.hasOwn(p, 'options'))
        throw Error(
          'Missing temporal controller options. Use an object of explicit values or {} for controller defaults.',
        );
      policyOptions = normalizeControllerOptions(p.options, config);
    } else {
      number(p.check_every_seconds, 1, 604800, 'Policy check interval');

      if ((p.end_seconds - p.start_seconds) / p.check_every_seconds > 10000)
        throw Error('Policy allows at most 10,001 checks.');

      policySchedule.interval = p.check_every_seconds;

      if (two) {
        required(p.condition, ['ahead', 'behind', 'small_ratio', 'large_ratio'], 'gap condition');

        policyOptions = normalizeGapPolicy(
          {
            ahead: p.condition.ahead,
            behind: p.condition.behind,
            small: p.condition.small_ratio,
            large: p.condition.large_ratio,
            response: decodeAction(p.response, config, 'policy response'),
          },
          config,
        );
      }
    }
  }

  return {
    id: 'custom',
    name: data.name.trim(),
    description: data.description,
    config,
    events,
    drainMaxSeconds: data.observation.drain_max_seconds,
    ...(policy ? { policy, policySchedule, ...(policyOptions ? { policyOptions } : {}) } : {}),
  };
}
