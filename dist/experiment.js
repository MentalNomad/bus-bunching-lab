import { Simulation, MAX_SIMULATION_SECONDS } from './engine.js?v=20261021a';

import {
  parseScenario,
  serializeScenario,
  checkInterventionCount,
} from './scenario-format.js?v=20261021a';

import { normalizeControllerOptions } from './controller-options.js?v=20261021a';

import { summarizeCohort } from './measurements.js?v=20261021a';

import { normalizeGapPolicy } from './dispatch-rules.js?v=20261021a';

import { scenarios } from './scenarios.js?v=20261021a';
export { scenarios };

// Replay from the seed and timestamped commands restores passengers, random state,

// active service references, observations and scheduled dispatch exactly.

export class Experiment {
  constructor(config = {}, scenarioId = 'balanced-corrected', definition = null) {
    const scenario = definition || scenarios.find((x) => x.id === scenarioId);

    if (!scenario) throw Error('Unknown scenario');

    this.definition = structuredClone(scenario);

    this.scenarioId = scenarioId;

    this.config = new Simulation({ ...scenario.config, ...config }).c;

    const policies = ['hold', 'express', 'express-count', 'two-gap', 'temporal'];
    if (scenario.policy && !policies.includes(scenario.policy))
      throw Error('Unknown automatic dispatch policy.');
    if (scenario.policy === 'temporal')
      this.definition.policyOptions = normalizeControllerOptions(
        scenario.policyOptions,
        this.config,
      );
    else if (scenario.policy === 'two-gap')
      this.definition.policyOptions = normalizeGapPolicy(scenario.policyOptions, this.config);

    if (scenario.policySchedule) {
      const { start, end, interval } = scenario.policySchedule;
      const temporal = scenario.policy === 'temporal';
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

      parseScenario(data.scenarioText),
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

    if (scenario.policy && scenario.policy !== 'temporal') {
      const { start = 1500, end = 3600, interval = 30 } = scenario.policySchedule || {};

      for (let i = 0; start + i * interval <= end; i++)
        events.push({
          t: start + i * interval,

          type: 'policy',

          policy: scenario.policy,

          source: 'preset',
        });
    }

    // Manual instructions precede automatic checks at the same timestamp.
    return events.sort(
      (a, b) => a.t - b.t || (a.type === 'policy' ? 1 : b.type === 'policy' ? -1 : 0),
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

    if (this.definition.policy === 'temporal')
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
        const time = this.events[this.cursor].t;
        this.advanceModel(time, () => {
          while (this.cursor < this.events.length && this.events[this.cursor].t === time)
            this.applyScheduled(this.events[this.cursor++]);
        });
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
  }

  dispatch(policy) {
    const s = this.sim,
      snapshot = s.neighborSnapshot(),
      ideal = s.c.stops / s.c.buses;

    const options = this.definition.policyOptions;

    const holds = policy === 'hold' || (policy === 'two-gap' && options.response.type === 'hold');

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

    let unrestricted = s.buses.filter((b) => !b.servicePlan).length;

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
          (policy !== 'two-gap' ||
            (matches(options.ahead, ahead) && matches(options.behind, behind))),
      );

    for (const { b, ahead, behind } of candidates) {
      let type, value;

      if (policy === 'two-gap') ({ type, value } = options.response);
      else if (policy === 'hold' && ahead < ideal * 0.95) {
        type = 'hold';
        value = Math.max(1, (ideal - ahead) * s.c.travel * 2.5);
      } else if (ahead > ideal * 1.25 && policy === 'express') {
        type = 'pattern';
        value = { leadStops: 0, every: 2, stops: null, untilRecovered: true, maxSeconds: 600 };
      } else if (ahead > ideal * 1.25 && policy === 'express-count') {
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

  upcoming() {
    return this.events[this.cursor];
  }
}
