import { Simulation, MAX_SIMULATION_SECONDS } from './engine.js?v=20261015c';

import {
  parseScenario,
  serializeScenario,
  checkInterventionCount,
} from './scenario-format.js?v=20261015c';

import { normalizeControllerOptions } from './controller-options.js?v=20261015c';

import { summarizeCohort } from './measurements.js?v=20261015c';

import { normalizeGapPolicy } from './dispatch-rules.js?v=20261015c';

export const scenarios = [
  {
    id: 'balanced',

    name: 'Balanced · fixed arrivals (historical)',

    description: 'An evenly spaced baseline with regular arrivals. No interventions.',

    config: {},

    events: [],
  },

  {
    id: 'delay',

    name: 'One delay → bunching',

    description:
      'At minute 20, Bus 1 is held for 60 seconds. Watch its queue grow and the following bus catch up.',

    config: {},

    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],
  },

  {
    id: 'variance',

    name: 'Random demand → bunching',

    description:
      'Poisson arrivals and varied ride lengths gradually disturb the spacing, without any imposed delay. Seed 42 reproduces the run.',

    config: { arrival: 'poisson', rideMode: 'random' },

    events: [],
  },

  {
    id: 'holds',

    name: 'Recover with bus holds',

    description:
      '12 stops, 4 evenly spaced buses and fixed passenger arrivals. At minute 20, Bus 1 receives a 60-second hold. From minute 25 through 60, dispatch checks every 30 seconds and holds buses at service stops when their forward gap is below 95% of the ideal 3 stops. Holds are proportional to the deficit and capped at 120 seconds. Watch queue waits and onboard delay as spacing recovers.',

    config: {},

    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],

    policy: 'hold',
  },

  {
    id: 'express',

    name: 'Recover with temporary express',

    description:
      '12 stops, 4 evenly spaced buses and fixed passenger arrivals. At minute 20, Bus 1 receives a 60-second hold. From minute 25 through 60, dispatch activates alternating express when a bus has more than 3.75 stops of forward gap. It serves one stop, skips the next, and rechecks at each stop until its gap is 3 stops or less. Only riders bound for the next planned skipped stop transfer. Compare spacing, transfers and total passenger time.',

    config: {},

    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],

    policy: 'express',
  },

  {
    id: 'express-count',

    name: 'Compare · fixed-count express',

    description:
      '12 stops, 4 evenly spaced buses and fixed arrivals. Bus 1 is held 60 seconds at minute 20. From minute 25 through 60, dispatch checks every 30 seconds. At a service stop, a bus with more than 3.75 stops of forward gap skips ceil(gap − 3) stops, then resumes service. This is a fixed-count heuristic: skipping avoids dwell, not segment travel, so the gap need not recover to 3. Compare with alternating express.',

    config: {},

    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],

    policy: 'express-count',
  },

  {
    id: 'two-gap-holds',

    name: 'Two gaps → selective holds',

    description:
      '12 stops, 4 buses, fixed arrivals and seed 42. At minute 20, hold Bus 1 for 60 seconds. From minute 25 through 60, check every 15 seconds. Hold a bus at a service stop for 30 seconds only when its gap ahead is below 90% of the ideal gap and its gap behind exceeds 110%. Both conditions must hold. Compare passenger time accrued, unfinished trips and spacing with One delay → bunching.',

    config: {},

    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],

    policy: 'two-gap',

    policySchedule: { start: 1500, end: 3600, interval: 15 },

    policyOptions: {
      ahead: 'small',

      behind: 'large',

      small: 0.9,

      large: 1.1,

      response: { type: 'hold', value: 30 },
    },
  },

  {
    id: 'dropoff',

    name: 'Recover with drop-off-only service',

    description:
      '12 stops, 4 buses, fixed arrivals and seed 42. Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 15 seconds. A bus at a stop with more than 110% of the ideal gap ahead and less than 90% behind admits no new riders for 3 stop locations, with a 600-second safety cap. Every onboard rider keeps their drop-off. Watch passed-over passengers, current queue waits and total passenger time; at least one unrestricted bus remains.',

    config: {},

    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],

    policy: 'two-gap',

    policySchedule: { start: 1500, end: 3600, interval: 15 },

    policyOptions: {
      ahead: 'large',

      behind: 'small',

      small: 0.9,

      large: 1.1,

      response: { type: 'dropoff', value: { stops: 3, untilRecovered: false, maxSeconds: 600 } },
    },
  },

  {
    id: 'announced-express',

    name: 'Announce → serve every third stop',

    description:
      '12 stops, 4 buses, fixed arrivals and seed 42. Hold Bus 1 for 60 seconds at minute 20. At minute 25, it announces a pattern at its current or next service stop: serve the next 6 stop locations, then skip two and serve one for 12 locations, with an 1800-second cap. Boarding immediately respects the future pattern; all accepted drop-offs are honored as exceptions. Compare passed-over riders and passenger time with immediate express; this is a demonstration, not an optimized policy.',

    config: {},

    events: [
      { t: 1200, type: 'hold', bus: 0, value: 60 },

      {
        t: 1500,

        type: 'pattern',

        bus: 0,

        value: { leadStops: 6, every: 3, stops: 12, untilRecovered: false, maxSeconds: 1800 },
      },
    ],
  },
];

// New presets opt into corrected semantics; existing IDs remain historical.

const correctedBase = { semantics: 'ordered-v3', arrival: 'poisson', rideMode: 'random' };

scenarios.unshift({
  id: 'balanced-corrected',
  name: 'Balanced · fixed arrivals',
  description:
    '12 stops, 4 evenly spaced buses, 40-second segments, fixed arrivals and fixed four-stop rides. No scheduled intervention or automatic recovery. This corrected-model baseline lets you observe steady service, then add a delay or compare another lesson. Stopping and starting penalties default to zero and can be changed in Route setup.',
  config: { semantics: 'ordered-v3', arrival: 'fixed', rideMode: 'fixed' },
  events: [],
});

scenarios.push(
  {
    id: 'corrected-variance',
    name: 'Random demand · corrected model',
    description:
      '12 stops, 4 buses, 40-second segments and seed 42. Poisson arrivals and random rides gradually disturb the spacing. Uses ordered-v3, no automatic control, unlimited seats, zero stop overhead and overtaking. Run several laps, then compare recovery policies.',
    config: correctedBase,
    events: [],
  },

  {
    id: 'temporal-recovery',
    name: 'Event control · bounded passenger-cost holds',
    description:
      '12 stops, 4 buses, random demand and seed 42. Hold Bus 1 for 60 seconds at minute 20. From minute 25 to 120, evaluate stop events using usable-service history and eligible followers. Holds cost onboard time, are capped at 30 seconds per action, 45 per visit and 90 per bus across the run, with two visits of cooldown. Arrivals stop after minute 120; continue to drain. Illustrative heuristic, not an optimizer.',
    config: { ...correctedBase, arrivalCutoff: 7200, cohortStart: 1200 },
    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],
    policy: 'temporal-v3',
    policySchedule: { start: 1500, end: 7200 },
    policyOptions: {},
  },

  {
    id: 'temporal-boarding',
    name: 'Event control · bounded boarding',
    description:
      '12 stops, 4 buses and random demand. Bus 1 is held 60 seconds at minute 20. From minute 25 through 120, a late bus may accept at most five new riders per visit for three locations, only with plausible destination-eligible following service. Repeated denials and eligible-service gaps can restore normal boarding. Existing boarding and accepted drop-offs finish. Demand ends at minute 120; drain before comparing full journey times.',
    config: { ...correctedBase, arrivalCutoff: 7200, cohortStart: 1200 },
    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],
    policy: 'temporal-v3',
    policySchedule: { start: 1500, end: 7200 },
    policyOptions: { response: 'boarding' },
  },

  {
    id: 'temporal-pattern',
    name: 'Event control · safeguarded announced skips',
    description:
      '12 stops, 4 buses and random demand. Bus 1 receives a 60-second hold at minute 20. From minute 25 through 120, a late bus may announce two normal future locations, then alternating service for three active locations, with a 600-second cap. Accepted drop-offs remain protected. Destination-specific follower and denial checks may suppress or end a plan. Demand ends at minute 120; compare complete passenger cohorts after drain.',
    config: { ...correctedBase, arrivalCutoff: 7200, cohortStart: 1200 },
    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],
    policy: 'temporal-v3',
    policySchedule: { start: 1500, end: 7200 },
    policyOptions: { response: 'pattern' },
  },

  {
    id: 'physical-assumptions',
    name: 'Explore · seats, stop overhead and road order',
    description:
      '12 stops, 4 buses, seed 42, random demand, 30 seats per bus, 8 seconds of overhead before door service, and no overtaking on roads. Multiple buses can serve the same stop. A 60-second hold affects Bus 1 at minute 20. No automatic control. Demand ends at minute 60. These values are illustrative; change one physical assumption at a time and inspect unfinished trips and capacity denials.',
    config: {
      ...correctedBase,
      capacity: 30,
      stopOverhead: 8,
      overtaking: false,
      arrivalCutoff: 3600,
      cohortStart: 1200,
      provenance:
        'Illustrative 30-seat, 8-second teaching example; not calibrated against an observed route.',
    },
    events: [{ t: 1200, type: 'hold', bus: 0, value: 60 }],
  },
);

// Replay from the seed and timestamped commands restores passengers, random state,

// active service references, observations and scheduled dispatch exactly.

export class Experiment {
  constructor(config = {}, scenarioId = 'balanced', definition = null) {
    const scenario = definition || scenarios.find((x) => x.id === scenarioId);

    if (!scenario) throw Error('Unknown scenario');

    this.definition = structuredClone(scenario);

    this.scenarioId = scenarioId;

    this.config = new Simulation({ ...scenario.config, ...config }).c;

    const ordered = this.config.semantics === 'ordered-v3';

    if (
      ordered &&
      scenario.config.semantics !== 'ordered-v3' &&
      scenario.events.some((e) => ['dropoff', 'pattern', 'normal'].includes(e.type))
    )
      throw Error('Service-plan model semantics must be converted explicitly.');
    const orderedPolicies = [
      'ordered-hold',
      'ordered-express',
      'ordered-express-count',
      'ordered-two-gap',
      'temporal-v3',
    ];

    if (scenario.policy && ordered !== orderedPolicies.includes(scenario.policy))
      throw Error('Recovery rule does not match model semantics. Convert the scenario explicitly.');

    if (scenario.policy === 'temporal-v3')
      this.definition.policyOptions = normalizeControllerOptions(
        scenario.policyOptions,
        this.config,
      );
    else if (['two-gap', 'ordered-two-gap'].includes(scenario.policy))
      this.definition.policyOptions = normalizeGapPolicy(scenario.policyOptions, this.config);
    else if (
      scenario.policy &&
      !['hold', 'express', 'express-count', ...orderedPolicies].includes(scenario.policy)
    )
      throw Error('Unknown automatic dispatch policy.');

    if (scenario.policySchedule) {
      const { start, end, interval } = scenario.policySchedule;
      const temporal = scenario.policy === 'temporal-v3';
      if (
        ![start, end].every(Number.isFinite) ||
        start < 0 ||
        end < start ||
        end > MAX_SIMULATION_SECONDS
      )
        throw Error('Invalid automatic dispatch window: use seconds between zero and seven days.');
      if (
        !temporal &&
        (!Number.isFinite(interval) ||
          interval < 1 ||
          interval > MAX_SIMULATION_SECONDS ||
          (end - start) / interval > 10000)
      )
        throw Error('Invalid polling schedule: use a seven-day window and at most 10,001 checks.');
    }

    if (scenario.policy) {
      const schedule = scenario.policy
        ? scenario.policySchedule || { start: 1500, end: 3600 }
        : null;

      if (
        schedule &&
        (schedule.start < (this.config.cohortStart ?? 0) ||
          schedule.end > (this.config.arrivalCutoff ?? MAX_SIMULATION_SECONDS))
      )
        throw Error(
          'Control window must start at or after the cohort boundary and end by the arrival cutoff or run limit.',
        );
    }

    if (
      scenario.drainMaxSeconds !== undefined &&
      (!Number.isFinite(scenario.drainMaxSeconds) ||
        scenario.drainMaxSeconds < 1 ||
        scenario.drainMaxSeconds > MAX_SIMULATION_SECONDS)
    )
      throw Error('Drain bound must be 1–604,800 seconds.');
    checkInterventionCount(scenario.events.length);

    for (const [index, event] of scenario.events.entries()) {
      const context = `Scheduled intervention ${index + 1} at ${event.t}s`;

      if (
        event.t < (this.config.cohortStart ?? 0) ||
        (this.config.arrivalCutoff != null && event.t > this.config.arrivalCutoff)
      )
        throw Error(
          `${context}: interventions must lie between cohort start and inclusive arrival cutoff.`,
        );

      if (!Number.isFinite(event.t) || event.t < 0 || event.t > 604800)
        throw Error(`${context}: time must be between 0 and 604,800 seconds.`);

      if (!Number.isInteger(event.bus) || event.bus < 0 || event.bus >= this.config.buses)
        throw Error(
          `${context}: Bus ${event.bus + 1} does not exist with ${this.config.buses} ${this.config.buses === 1 ? 'bus' : 'buses'}. Increase the bus count or edit the scenario text.`,
        );

      if (
        event.type === 'express' &&
        (!Number.isInteger(event.value) || event.value < 1 || event.value >= this.config.stops)
      )
        throw Error(
          `${context}: skipping ${event.value} stops is invalid on a ${this.config.stops}-stop route. Use 1–${this.config.stops - 1} skips or edit the scenario text.`,
        );

      try {
        new Simulation(this.config).action(event.bus, event.type, event.value);
      } catch (error) {
        throw Error(`${context} (Bus ${event.bus + 1}): ${error.message}`);
      }
    }

    this.commands = [];

    this.furthest = 0;

    this.rebuild(0);
  }

  restart(config = this.config) {
    return new Experiment(config, this.scenarioId, this.definition);
  }

  static restore(data) {
    if (
      data?.version !== 1 ||
      !Number.isFinite(data.time) ||
      data.time < 0 ||
      data.time > MAX_SIMULATION_SECONDS ||
      !Array.isArray(data.commands)
    )
      throw Error('Invalid experiment copy');

    const furthest = data.furthest ?? data.time;

    if (!Number.isFinite(furthest) || furthest < data.time || furthest > MAX_SIMULATION_SECONDS)
      throw Error('Invalid experiment copy timeline');

    const e = new Experiment(
      data.config,

      data.scenarioId,

      data.scenarioText ? parseScenario(data.scenarioText) : null,
    );

    checkInterventionCount(e.definition.events.length + data.commands.length);

    for (const x of data.commands) {
      if (!x || !Number.isFinite(x.t) || x.t < 0 || x.t > furthest)
        throw Error('Invalid command time');

      if (
        x.t < (e.config.cohortStart ?? 0) ||
        (e.config.arrivalCutoff != null && x.t > e.config.arrivalCutoff)
      )
        throw Error('Copied command lies outside observation control window.');

      new Simulation(e.config).action(x.bus, x.type, x.value);
    }

    e.commands = structuredClone(data.commands).sort((a, b) => a.t - b.t);

    e.furthest = furthest;

    e.rebuild(data.time);

    return e;
  }

  export() {
    return {
      version: 1,

      config: this.config,

      scenarioId: this.scenarioId,

      scenarioText: serializeScenario(this.definition, this.config),

      time: this.sim.time,

      furthest: this.furthest,

      commands: structuredClone(this.commands),
    };
  }

  schedule() {
    const scenario = this.definition,
      events = [
        ...scenario.events.map((x) => ({ ...x, source: 'preset' })),

        ...this.commands.map((x) => ({ ...x, source: 'manual' })),
      ];

    if (scenario.policy && scenario.policy !== 'temporal-v3') {
      const { start = 1500, end = 3600, interval = 30 } = scenario.policySchedule || {};

      for (let i = 0; start + i * interval <= end; i++)
        events.push({
          t: start + i * interval,

          type: 'policy',

          policy: scenario.policy,

          source: 'preset',
        });
    }

    // Live manual dispatch follows any checks that already ran at this instant.

    // Preserve that same order when replaying or importing exported commands.

    if (this.config.semantics === 'ordered-v3')
      return events.sort(
        (a, b) => a.t - b.t || (a.type === 'policy' ? 1 : b.type === 'policy' ? -1 : 0),
      );

    return events.sort(
      (a, b) => a.t - b.t || (a.type === 'policy' ? -1 : b.type === 'policy' ? 1 : 0),
    );
  }

  rebuild(target) {
    // Keep the displayed model intact if replay fails. Only install a complete result.

    const replacement = Object.assign(Object.create(Experiment.prototype), this, {
      sim: new Simulation(this.config),

      events: this.schedule(),

      cursor: 0,

      policyVisits: new Map(),
    });

    replacement.policyBudgets = new Map();

    if (this.definition.policy === 'temporal-v3')
      replacement.sim.configureController(
        this.definition.policyOptions,
        this.definition.policySchedule || { start: 1500, end: 3600 },
      );

    replacement.advanceTo(target);

    this.sim = replacement.sim;

    this.events = replacement.events;

    this.cursor = replacement.cursor;

    this.furthest = replacement.furthest;

    this.policyVisits = replacement.policyVisits;

    this.policyBudgets = replacement.policyBudgets;
  }

  advanceModel(target, atBoundary) {
    // The event guard applies to each small batch, regardless of seek/copy distance.

    while (target - this.sim.time > 60) this.sim.advance(60);

    this.sim.advance(target - this.sim.time, atBoundary ? { atBoundary } : undefined);
  }

  advanceTo(target) {
    if (!Number.isFinite(target) || target < this.sim.time) throw Error('Invalid target time');

    if (target > MAX_SIMULATION_SECONDS)
      throw Error('Seven-day run limit reached. Export the data, then reset to start another run.');

    try {
      while (this.cursor < this.events.length && this.events[this.cursor].t <= target) {
        const event = this.events[this.cursor];

        if (this.config.semantics === 'ordered-v3') {
          this.advanceModel(event.t, () => {
            while (this.cursor < this.events.length && this.events[this.cursor].t === event.t)
              this.applyScheduled(this.events[this.cursor++]);
          });

          continue;
        }

        this.advanceModel(event.t);

        if (event.type === 'policy') this.dispatch(event.policy);
        else {
          // A combined delay may become invalid only when its scheduled time arrives.

          // Keep this visible in the dispatch log and allow the lesson to continue.

          try {
            this.sim.action(event.bus, event.type, event.value);
          } catch (error) {
            this.sim.note(
              `Skipped ${event.source} dispatch for Bus ${event.bus + 1}: ${error.message}`,
            );
          }
        }

        this.cursor++;
      }

      this.advanceModel(target);
    } finally {
      this.furthest = Math.max(this.furthest, this.sim.time);
    }
  }

  applyScheduled(event) {
    if (event.type === 'policy') return this.dispatch(event.policy);

    try {
      this.sim.action(event.bus, event.type, event.value);
    } catch (error) {
      this.sim.note(`Skipped ${event.source} dispatch for Bus ${event.bus + 1}: ${error.message}`);
    }
  }

  drain(maxSeconds = this.definition.drainMaxSeconds ?? 86400) {
    if (this.config.arrivalCutoff == null)
      throw Error('Set a finite arrival cutoff before draining.');

    if (!Number.isFinite(maxSeconds) || maxSeconds < 1 || maxSeconds > MAX_SIMULATION_SECONDS)
      throw Error('Drain bound must be 1–604,800 seconds.');

    let reason = null;

    try {
      if (this.sim.time < this.config.arrivalCutoff) this.advanceTo(this.config.arrivalCutoff);

      const end = Math.min(MAX_SIMULATION_SECONDS, this.sim.time + maxSeconds);

      while (this.sim.created > this.sim.completed && this.sim.time < end)
        this.advanceTo(Math.min(end, this.sim.time + 60));

      if (this.sim.created > this.sim.completed)
        reason = 'Drain time bound reached with unfinished passengers.';
    } catch (error) {
      reason = error.message;
    }

    return { ...summarizeCohort(this.sim), incompleteReason: reason };
  }

  seek(target) {
    if (!Number.isFinite(target)) throw Error('Invalid time');

    target = Math.max(0, Math.min(this.furthest, target));

    if (target < this.sim.time) this.rebuild(target);
    else this.advanceTo(target);
  }

  action(bus, type, value) {
    const t = this.sim.time,
      commands = this.commands.filter((x) => x.t <= t);

    checkInterventionCount(this.definition.events.length + commands.length + 1);

    if (
      t < (this.config.cohortStart ?? 0) ||
      (this.config.arrivalCutoff != null && t > this.config.arrivalCutoff)
    )
      throw Error('New interventions must lie between cohort start and inclusive arrival cutoff.');

    if (this.config.semantics === 'ordered-v3') {
      // A live command at an already-rendered timestamp has the same priority as
      // an imported command there. Rebuild the boundary so automatic decisions
      // cannot depend on whether that timestamp was viewed before the click.
      const probe = Object.assign(
        Object.create(Object.getPrototypeOf(this.sim)),
        structuredClone(this.sim),
      );
      probe.action(bus, type, value);
      commands.push({ t, bus, type, value: structuredClone(value) });
      const replacement = Object.assign(Object.create(Experiment.prototype), this, {
        commands,
        furthest: t,
      });
      replacement.rebuild(t);
      Object.assign(this, replacement);
      return;
    }
    this.sim.action(bus, type, value); // Engine validation completes before any mutation.

    commands.push({ t, bus, type, value: structuredClone(value) });

    this.commands = commands;

    this.furthest = t;

    this.events = this.schedule();

    this.cursor = this.events.findIndex((event) => event.t > t);

    if (this.cursor < 0) this.cursor = this.events.length;

    this.sim.advance(0);
  }

  dispatch(policy) {
    if (policy.startsWith('ordered-')) return this.dispatchOrdered(policy);

    // Only explicit legacy-v2 rules reach this historical minimum-gap adapter.
    if (policy === 'two-gap') return this.dispatchTwoGap();

    const s = this.sim,
      n = s.c.stops,
      ideal = n / s.c.buses;

    for (const b of s.buses) {
      if (
        b.phase === 'travel' ||
        b.pendingHold ||
        b.holdUntil > s.time ||
        b.express ||
        b.pendingExpress ||
        b.recoveryExpress ||
        b.servicePlan
      )
        continue;

      const p = s.position(b);

      let gap = n;

      for (const other of s.buses)
        if (other !== b) gap = Math.min(gap, (s.position(other) - p + n) % n);

      if (policy === 'hold' && gap < ideal * 0.95) {
        s.action(b.id, 'hold', Math.min(120, Math.max(1, (ideal - gap) * s.c.travel * 2.5)));
      }

      if (policy === 'express' && gap > ideal * 1.25) {
        s.action(b.id, 'recovery', 1);
      }

      if (policy === 'express-count' && gap > ideal * 1.25) {
        s.action(b.id, 'express', Math.min(n - 1, Math.max(1, Math.ceil(gap - ideal))));
      }
    }
  }

  dispatchOrdered(policy) {
    const s = this.sim,
      snapshot = s.neighborSnapshot(),
      ideal = s.c.stops / s.c.buses;

    const options = this.definition.policyOptions;

    const holds =
      policy === 'ordered-hold' ||
      (policy === 'ordered-two-gap' && options.response.type === 'hold');

    const coincidentLeader = ({ ahead, behind }) => behind <= 1e-8 && ahead > 1e-8;

    const releaseLeaders = holds
      ? snapshot.order
          .filter(
            (id) =>
              coincidentLeader(snapshot.byId[id]) && (s.buses[id].autoHoldUntil ?? 0) > s.time,
          )
          .map((id) => s.buses[id])
      : [];

    const matches = (kind, gap) =>
      kind === 'any' ||
      (kind === 'small' ? gap < ideal * options.small : gap > ideal * options.large);

    let unrestricted = s.buses.filter(
      (b) => !b.servicePlan && !b.express && !b.pendingExpress,
    ).length;

    const candidates = snapshot.order
      .map((id) => ({ b: s.buses[id], ...snapshot.byId[id] }))
      .filter(
        ({ b, ahead, behind }) =>
          b.phase !== 'travel' &&
          !b.servicePlan &&
          !b.pendingHold &&
          b.holdUntil <= s.time &&
          (b.autoHoldUntil ?? 0) <= s.time &&
          this.policyVisits.get(b.id) !== b.stopStart &&
          (policy !== 'ordered-two-gap' ||
            (matches(options.ahead, ahead) && matches(options.behind, behind))),
      );

    for (const { b, ahead, behind } of candidates) {
      let type, value;

      if (policy === 'ordered-two-gap') ({ type, value } = options.response);
      else if (policy === 'ordered-hold' && ahead < ideal * 0.95) {
        type = 'hold';
        value = Math.max(1, (ideal - ahead) * s.c.travel * 2.5);
      } else if (ahead > ideal * 1.25 && policy === 'ordered-express') {
        type = 'pattern';
        value = { leadStops: 0, every: 2, stops: null, untilRecovered: true, maxSeconds: 600 };
      } else if (ahead > ideal * 1.25 && policy === 'ordered-express-count') {
        type = 'express';
        value = Math.min(s.c.stops - 1, Math.max(1, Math.ceil(ahead - ideal)));
      }

      if (!type) continue;

      const budget = this.policyBudgets.get(b.id) || { spent: 0, lastVisit: -100000 };

      if (type === 'hold') {
        if (
          coincidentLeader({ ahead, behind }) ||
          ahead >= ideal ||
          b.visits - budget.lastVisit <= 2 ||
          budget.spent >= 90
        )
          continue;

        value = Math.min(30, value, 90 - budget.spent);

        s.applyAutomaticHold(b, value, { rule: policy, spatialAhead: ahead });

        budget.spent += value;
        budget.lastVisit = b.visits;
        this.policyBudgets.set(b.id, budget);
      } else {
        if (unrestricted <= 1) continue;

        s.action(b.id, type, value, { automatic: true });
        unrestricted--;
      }

      this.policyVisits.set(b.id, b.stopStart);

      s.note(`Ordered polling: Bus ${b.id + 1}, gap ${ahead.toFixed(2)} stops; ${type}.`);
    }

    for (const bus of releaseLeaders)
      s.releaseAutomaticHold(bus, 'coincident group leader retains departure opportunity');
  }

  dispatchTwoGap() {
    const s = this.sim,
      options = this.definition.policyOptions,
      ideal = s.c.stops / s.c.buses;

    const matches = (kind, gap) =>
      kind === 'any' ||
      (kind === 'small' ? gap < ideal * options.small : gap > ideal * options.large);

    const restricted = (b) =>
      Boolean(b.servicePlan || b.express || b.pendingExpress || b.recoveryExpress);

    let localBuses = s.buses.filter((b) => !restricted(b)).length;

    // Decide from a single positional snapshot, before any of these actions run.

    const candidates = s.buses

      .map((b) => ({ b, ...s.gaps(b) }))

      .filter(
        ({ b, ahead, behind }) =>
          b.phase !== 'travel' &&
          !restricted(b) &&
          !b.pendingHold &&
          b.holdUntil <= s.time &&
          this.policyVisits.get(b.id) !== b.stopStart &&
          matches(options.ahead, ahead) &&
          matches(options.behind, behind),
      );

    for (const { b, ahead, behind } of candidates) {
      const { type, value } = options.response;

      if (type !== 'hold' && localBuses <= 1) continue;

      s.action(b.id, type, value);

      this.policyVisits.set(b.id, b.stopStart);

      if (type !== 'hold') localBuses--;

      s.note(
        `Two-gap rule: Bus ${b.id + 1}, ahead ${ahead.toFixed(2)} / behind ${behind.toFixed(2)} stops; ${type === 'dropoff' ? 'drop-off-only' : type === 'pattern' ? 'announced skip pattern' : 'hold'}.`,
      );
    }
  }

  upcoming() {
    return this.events[this.cursor];
  }
}
