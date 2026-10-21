import { normalizeControllerOptions } from './controller-options.js';

const EPS = 1e-8;
const MAX_DECISIONS = 100000;

export function configureTemporalController(sim, options = {}, schedule = {}) {
  const normalized = normalizeControllerOptions(options, sim.c);
  const start = schedule.start ?? 0;
  const end = schedule.end ?? 604800;
  if (![start, end].every(Number.isFinite) || start < 0 || end < start || end > 604800)
    throw Error('Temporal control requires a start/end window of 0–604,800 seconds.');
  // Plain data only: replay, seek and structuredClone retain every budget/history.
  sim.controller = {
    options: normalized,
    schedule: { start, end },
    nextPoll: normalized.decisionMode === 'polling' ? start : Infinity,
    history: {},
    buses: {},
    decisions: [],
    metrics: {
      requestedHoldSeconds: 0,
      realizedHoldSeconds: 0,
      policyDenials: 0,
      capacityDenials: 0,
      serviceGapBreaches: 0,
      // Completed stop/destination service intervals, separate from the denied
      // opportunities that exceed denial/wait safeguards in serviceGapBreaches.
      observedServiceGapBreaches: 0,
      suppressedActions: 0,
      maximumObservedEligibleServiceGap: 0,
      maximumRepeatedDenials: 0,
      maximumPolicyDenials: 0,
      maximumCapacityDenials: 0,
    },
  };
  return sim.controller;
}

function busState(sim, bus) {
  return (sim.controller.buses[bus.id] ??= {
    spentHold: 0,
    lastHoldVisit: -1000000,
    visitHold: 0,
    visit: null,
    lastDecisionVisit: null,
    restrictedAt: null,
    coverage: [],
  });
}

function visitKey(bus) {
  return bus.policyVisit ?? `${bus.target}:${bus.stopStart}:${bus.visits}`;
}

function decision(sim, bus, kind, reason, context = {}) {
  const record = { t: sim.time, bus: bus.id, stop: bus.target, kind, reason, ...context };
  sim.controller.decisions.push(record);
  // The engine has its own event/visit limits; fail visibly instead of hiding history.
  if (sim.controller.decisions.length > MAX_DECISIONS)
    throw Error('Temporal decision limit reached (100,000). Export, then reset.');
  if (kind === 'suppressed') sim.controller.metrics.suppressedActions++;
  return record;
}

function capacity(sim, bus) {
  if (typeof sim.capacityAvailable === 'function') return sim.capacityAvailable(bus);
  const used = bus.load.length + (bus.service?.kind === 'on' ? 1 : 0);
  return sim.c.capacity == null ? Infinity : Math.max(0, sim.c.capacity - used);
}

function planLocation(sim, bus, stop) {
  const distance = (stop - bus.target + sim.c.stops) % sim.c.stops;
  return (
    (bus.servicePlan?.location ?? 0) +
    distance +
    (bus.phase === 'travel' && bus.servicePlan?.anchored ? 1 : 0)
  );
}

function patternSkips(plan, location) {
  const active = location - plan.leadStops;
  return (
    active > 0 &&
    (plan.untilRecovered || plan.stops == null || active <= plan.stops) &&
    active % plan.every !== 0
  );
}

// Prospective eligibility uses only the announced plan, known loads, and clock.
// It does not read stop.next, generate demand, or assume a future queue size.
function servesDestination(sim, bus, origin, dest, eta = 0) {
  const plan = bus.servicePlan;
  if (plan && plan.expiresAt > sim.time + eta) {
    const location = planLocation(sim, bus, origin);
    const active = plan.type === 'pattern' ? location - plan.leadStops : location + 1;
    if (!plan.untilRecovered && plan.stops != null && active > plan.stops) return true;
    if (plan.type === 'dropoff') return false;
    if (
      plan.type === 'boarding' &&
      origin === bus.target &&
      bus.phase !== 'travel' &&
      (plan.visitAllowanceUsed ?? bus.boardedThisVisit ?? 0) >= plan.passengers
    )
      return false;
    if (plan.type === 'pattern') {
      if (patternSkips(plan, location)) return false;
      const ride = (dest - origin + sim.c.stops) % sim.c.stops || sim.c.stops;
      if (patternSkips(plan, location + ride)) return false;
    }
  }
  return true;
}

function remainingKnownService(sim, bus) {
  if (bus.phase === 'travel') return 0;
  const current = bus.service ? Math.max(0, bus.due - sim.time) : 0;
  const off = (bus.alight?.length ?? 0) * sim.c.debark;
  const overhead = Math.max(0, (bus.overheadUntil ?? 0) - sim.time);
  return overhead + current + off;
}

// The same marginal-delay calculation governs imposition and reassessment.
// It is an illustrative local heuristic, not a forecast of realized demand.
function holdingCostContext(sim, bus, requestedSeconds, context) {
  const eligibleQueue = sim.stops[bus.target].queue.filter((p) => sim.canBoard(bus, p)).length;
  const boarding = Math.min(eligibleQueue, capacity(sim, bus));
  const required = remainingKnownService(sim, bus) + boarding * sim.c.board;
  const absorbed = Math.max(required, Math.max(0, bus.holdUntil - sim.time));
  const extra = Math.max(0, requestedSeconds - absorbed);
  const aboard = bus.load.length + (bus.service?.kind === 'on' ? 1 : 0) + boarding;
  const aheadSeconds = context.convoy ? 0 : context.history.sincePrevious;
  return {
    ...context,
    requestedSeconds,
    predictedAbsorbedSeconds: Math.min(requestedSeconds, absorbed),
    predictedAdditionalSeconds: extra,
    aboardIncludingBoarding: aboard,
    predictedOnboardCost: aboard * extra,
    estimatedQueueSaving:
      (sim.c.rate / 60) * extra * Math.max(0, context.target.seconds - aheadSeconds - extra / 2),
    estimatedRearCost: ((sim.c.rate / 60) * extra * Math.max(0, extra - context.follower.eta)) / 2,
    benefitFactor: sim.controller.options.benefitFactor,
  };
}

function passengerBenefitCoversCost(context) {
  return (
    context.estimatedQueueSaving >
    context.benefitFactor * (context.predictedOnboardCost + context.estimatedRearCost)
  );
}

export function predictEligibleService(sim, bus, origin, dest) {
  // A free-travel estimate cannot upper-bound a follower constrained by other
  // buses' trajectories. Until a joint road/door forecast exists, this optional
  // physical model deliberately keeps automatic policies in normal service.
  if (!sim.c.overtaking) return null;
  let eta;
  let arrivalEta = null;
  const hops = (origin - bus.target + sim.c.stops) % sim.c.stops;
  if (bus.phase === 'travel') {
    const remaining = Math.max(0, bus.due - sim.time);
    eta = remaining;
  } else {
    // A bus at a different stop must finish its currently known service/holds.
    eta = Math.max(
      remainingKnownService(sim, bus),
      Math.max(0, bus.holdUntil - sim.time),
      Math.max(0, (bus.autoHoldUntil ?? 0) - sim.time),
    );
  }
  if (!Number.isFinite(eta)) return null; // For example, a physically blocked follower.
  const knownLoad = [...bus.load];
  if (bus.service?.kind === 'on') knownLoad.push(bus.service.p);
  // Traverse known intermediate stops. Known queued riders can consume seats;
  // future arrivals remain explicitly unknown, rather than pre-read from demand.
  for (let hop = 0; hop <= hops; hop++) {
    const stop = (bus.target + hop) % sim.c.stops;
    const reachedAt = eta;
    if (hop === hops) arrivalEta = hop === 0 && bus.phase !== 'travel' ? 0 : eta;
    const alighting = knownLoad.filter((p) => p.dest === stop);
    for (const p of alighting) knownLoad.splice(knownLoad.indexOf(p), 1);
    const plan = bus.servicePlan;
    const skip =
      plan?.type === 'pattern' &&
      plan.expiresAt > sim.time + eta &&
      patternSkips(plan, planLocation(sim, bus, stop));
    if (hop > 0 || bus.phase === 'travel') eta += alighting.length * sim.c.debark;
    const served =
      hop === 0 && bus.phase !== 'travel'
        ? (bus.servedVisit ?? (!skip || alighting.length > 0))
        : !skip || alighting.length > 0 || (hop === 0 && (bus.pendingHold ?? 0) > 0);
    if ((hop > 0 || bus.phase === 'travel') && served)
      eta += (sim.c.stopOverhead ?? 0) + (sim.c.stoppingDelay ?? 0);
    if (hop === hops) break;
    let boarded = 0;
    const queue = [...sim.stops[stop].queue];
    const holdDeadline =
      hop === 0 && bus.phase === 'travel' ? reachedAt + (bus.pendingHold ?? 0) : eta;
    while (queue.length && (sim.c.capacity == null || knownLoad.length < sim.c.capacity)) {
      const activeAllowance =
        plan?.type === 'boarding' &&
        plan.expiresAt > sim.time + eta &&
        (plan.untilRecovered ||
          plan.stops == null ||
          planLocation(sim, bus, stop) + 1 <= plan.stops);
      const allowance = activeAllowance
        ? Math.max(
            0,
            plan.passengers -
              (hop === 0 && bus.phase !== 'travel' ? (plan.visitAllowanceUsed ?? 0) : 0),
          )
        : Infinity;
      const index =
        boarded < allowance
          ? queue.findIndex((p) => servesDestination(sim, bus, stop, p.dest, eta))
          : -1;
      if (index < 0) {
        // An instruction can expire during a known hold. The bus then admits
        // the remaining known queue rather than retaining a stale allowance.
        const expiry = (plan?.expiresAt ?? Infinity) - sim.time;
        if (expiry > eta && expiry <= holdDeadline) {
          eta = expiry;
          continue;
        }
        break;
      }
      knownLoad.push(queue.splice(index, 1)[0]);
      boarded++;
      eta += sim.c.board;
    }
    // A hold queued while travelling begins at the first arrival. Boarding can
    // occur during it, but an onward service cannot depart before it expires.
    if (hop === 0 && bus.phase === 'travel')
      eta = Math.max(eta, reachedAt + (bus.pendingHold ?? 0));
    eta +=
      sim.c.travel * (hop === 0 ? (bus.pendingSlow ?? 1) : 1) +
      (served ? (sim.c.startingDelay ?? 0) : 0);
  }
  if (!servesDestination(sim, bus, origin, dest, eta)) return null;
  const room = sim.c.capacity == null ? Infinity : Math.max(0, sim.c.capacity - knownLoad.length);
  if (room <= 0) return null;
  return {
    bus: bus.id,
    eta,
    serviceEta: eta,
    serviceAt: sim.time + eta,
    arrivalEta,
    arrivalAt: sim.time + arrivalEta,
    availableSeats: room === Infinity ? null : room,
    qualifier:
      'Conditional first usable service estimate, not an observed headway; known travel, load, service and holds are included, future boarding and dwell are unknown.',
  };
}

function followingServices(sim, bus, stop, dest, snapshot) {
  const order = [];
  let id = snapshot.byId[bus.id].behindId;
  for (let i = 0; i < sim.buses.length - 1; i++) {
    const candidate = sim.buses[id];
    const estimate = predictEligibleService(sim, candidate, stop, dest);
    if (estimate) order.push(estimate);
    id = snapshot.byId[id].behindId;
  }
  return order.sort((a, b) => a.eta - b.eta || a.bus - b.bus);
}

function followingService(sim, bus, stop, dest, snapshot) {
  return followingServices(sim, bus, stop, dest, snapshot)[0] ?? null;
}

function historyKey(stop, dest) {
  return `${stop}:${dest}`;
}

function observeOpportunity(sim, bus, dest) {
  if (!sim.controller) return;
  const key = historyKey(bus.target, dest);
  const previous = sim.controller.history[key];
  // Successive passengers on the same visit are one service opportunity.
  if (previous?.bus === bus.id && previous.visit === visitKey(bus)) return;
  if (previous)
    sim.controller.metrics.maximumObservedEligibleServiceGap = Math.max(
      sim.controller.metrics.maximumObservedEligibleServiceGap,
      sim.time - previous.t,
    );
  if (previous && sim.time - previous.t > sim.controller.options.maxServiceGap) {
    sim.controller.metrics.observedServiceGapBreaches++;
    decision(sim, bus, 'breach', 'observed destination-eligible service gap exceeded', {
      stop: bus.target,
      destination: dest,
      from: previous.t,
      to: sim.time,
      gap: sim.time - previous.t,
      limit: sim.controller.options.maxServiceGap,
      currentContext: {
        capacity: sim.c.capacity,
        availableSeats: capacity(sim, bus) === Infinity ? null : capacity(sim, bus),
        manualInstructions: sim.buses
          .filter(
            (b) =>
              b.holdUntil > sim.time ||
              b.pendingHold ||
              b.pendingSlow !== 1 ||
              (b.servicePlan && !b.servicePlan.automatic),
          )
          .map((b) => ({
            bus: b.id,
            holdUntil: b.holdUntil,
            pendingHold: b.pendingHold,
            pendingSlow: b.pendingSlow,
            servicePlan: b.servicePlan?.automatic ? null : (b.servicePlan?.type ?? null),
          })),
        qualifier:
          'Current snapshot only; this does not attribute the preceding gap to these constraints.',
      },
    });
  }
  sim.controller.history[key] = {
    t: sim.time,
    previous: previous?.t ?? null,
    headway: previous ? Math.max(0, sim.time - previous.t) : null,
    bus: bus.id,
    visit: visitKey(bus),
  };
}

export function recordControllerBoarding(sim, bus, passenger) {
  observeOpportunity(sim, bus, passenger.dest);
}

export function recordControllerDeparture(sim, bus) {
  if (!sim.controller) return;
  // A departing full/drop-off-only bus offers no hypothetical boarding service.
  if (capacity(sim, bus) > 0)
    for (let dest = 0; dest < sim.c.stops; dest++)
      if (dest !== bus.target && servesDestination(sim, bus, bus.target, dest))
        observeOpportunity(sim, bus, dest);
}

export function recordControllerDenial(sim, bus, passenger, cause) {
  if (!sim.controller) return;
  const type = cause === 'capacity' ? 'capacityDenials' : 'policyDenials';
  sim.controller.metrics[type]++;
  sim.controller.metrics.maximumRepeatedDenials = Math.max(
    sim.controller.metrics.maximumRepeatedDenials,
    (passenger.policyDenials ?? 0) + (passenger.capacityDenials ?? 0),
  );
  sim.controller.metrics.maximumPolicyDenials = Math.max(
    sim.controller.metrics.maximumPolicyDenials,
    passenger.policyDenials ?? 0,
  );
  sim.controller.metrics.maximumCapacityDenials = Math.max(
    sim.controller.metrics.maximumCapacityDenials,
    passenger.capacityDenials ?? 0,
  );
  const options = sim.controller.options;
  const denials = (passenger.policyDenials ?? 0) + (passenger.capacityDenials ?? 0);
  if (denials > options.maxDenials || sim.time - passenger.queued > options.maxServiceGap) {
    sim.controller.metrics.serviceGapBreaches++;
    decision(
      sim,
      bus,
      'breach',
      cause === 'capacity'
        ? 'capacity prevents service'
        : bus.servicePlan?.automatic
          ? 'automatic restriction failed safeguard'
          : 'manual restriction prevents service',
      {
        passenger: passenger.id,
        cause,
        policyDenials: passenger.policyDenials ?? 0,
        capacityDenials: passenger.capacityDenials ?? 0,
        queueAge: sim.time - passenger.queued,
      },
    );
  }
}

export function recordControllerHoldDelay(sim, bus, seconds) {
  if (sim.controller && seconds > 0) sim.controller.metrics.realizedHoldSeconds += seconds;
}

function temporalHistory(sim, bus) {
  const entries = Object.entries(sim.controller.history)
    .filter(([key, h]) => key.startsWith(`${bus.target}:`) && h.bus !== bus.id)
    .map(([, h]) => h);
  if (!entries.length) return null;
  const latest = Math.max(...entries.map((h) => h.t));
  const headways = entries.map((h) => h.headway).filter((h) => h != null && h > EPS);
  return {
    sincePrevious: Math.max(0, sim.time - latest),
    observedHeadway: headways.length ? headways.reduce((a, b) => a + b, 0) / headways.length : null,
  };
}

function targetHeadway(sim, history) {
  const configured = sim.controller.options.targetSeconds;
  if (configured) return { seconds: configured, source: 'configured target' };
  if (history?.observedHeadway)
    return { seconds: history.observedHeadway, source: 'observed eligible-service headway' };
  const demand = sim.c.rate / 60;
  const dwell = demand * (sim.c.board + sim.c.debark);
  const denominator = sim.c.buses - sim.c.stops * dwell;
  const travelBudget = sim.c.travel + (sim.c.stoppingDelay ?? 0) + (sim.c.startingDelay ?? 0);
  return {
    seconds:
      denominator > 0
        ? (sim.c.stops * travelBudget) / denominator
        : (sim.c.stops * travelBudget) / sim.c.buses,
    source:
      denominator > 0
        ? 'illustrative fluid target, not observed headway'
        : 'free-travel fallback; illustrative demand is overloaded',
  };
}

function coincidentRank(sim, bus, snapshot, events) {
  const own = snapshot.byId[bus.id];
  if (own.ahead > EPS) return null;
  let rank = 0,
    id = bus.id;
  const members = [id];
  while (snapshot.byId[id].ahead <= EPS && rank < sim.buses.length) {
    id = snapshot.byId[id].aheadId;
    members.push(id);
    rank++;
  }
  if (!rank || rank >= sim.buses.length) return null;
  // Simultaneous stop arrivals are an observed zero temporal separation, not an
  // inferred distance*time headway. Release events retain this visit evidence.
  const arrivalTimes = members.map((member) => sim.controller.buses[member]?.arrivedAt);
  if (
    arrivalTimes.some((t) => t == null) ||
    Math.max(...arrivalTimes) - Math.min(...arrivalTimes) > EPS
  )
    return null;
  return { rank, leader: id, observedArrivalAt: arrivalTimes[0] };
}

function releaseAuto(sim, bus, reason, context = {}) {
  if ((bus.autoHoldUntil ?? 0) <= sim.time) return;
  sim.releaseAutomaticHold(bus, reason);
  decision(sim, bus, 'release', reason, context);
}

function restrictions(sim, bus) {
  const o = sim.controller.options;
  if (o.response === 'boarding')
    return {
      passengers: o.boardingPassengers,
      stops: o.restrictionStops,
      untilRecovered: false,
      maxSeconds: o.restrictionMaxSeconds,
    };
  const value = {
    stops: o.restrictionStops,
    untilRecovered: false,
    maxSeconds: o.restrictionMaxSeconds,
  };
  if (o.response === 'pattern')
    Object.assign(value, { leadStops: o.leadStops, every: o.serveEvery });
  return value;
}

function restrictionWouldDeny(sim, bus, type, value, stop, dest) {
  const clone = {
    ...bus,
    servicePlan: {
      ...value,
      type,
      location: 0,
      anchor: bus.target,
      anchored: true,
      expiresAt: sim.time + value.maxSeconds,
    },
  };
  if (type === 'boarding') {
    // The allowance may be exhausted by later arrivals, but only during its
    // actual bounded span. Locations beyond the instruction remain normal.
    const active = planLocation(sim, clone, stop) + 1;
    return value.untilRecovered || value.stops == null || active <= value.stops;
  }
  return !servesDestination(sim, clone, stop, dest);
}

function checkCoverage(sim, bus, snapshot, proposed = null) {
  const o = sim.controller.options;
  const coverage = new Set();
  const plan = proposed ?? bus.servicePlan;
  if (!plan) return { ok: true, coverage: [] };
  // Check every affected stop/destination, including future arrivals. This is a
  // conditional service prediction, rechecked at each real stop before denial.
  for (
    let offset = 0;
    offset < Math.min(sim.c.stops, o.restrictionStops + o.leadStops + 1);
    offset++
  ) {
    const stop = (bus.target + offset) % sim.c.stops;
    for (let dest = 0; dest < sim.c.stops; dest++) {
      if (dest === stop) continue;
      const deny = proposed
        ? restrictionWouldDeny(sim, bus, plan.type, plan, stop, dest)
        : !servesDestination(sim, bus, stop, dest);
      if (!deny) continue;
      const estimates = followingServices(sim, bus, stop, dest, snapshot);
      const follower = estimates.find((estimate) => {
        if (estimate.availableSeats === null) return true;
        const eligibleQueue = sim.stops[stop].queue.filter((p) =>
          servesDestination(sim, sim.buses[estimate.bus], stop, p.dest, estimate.eta),
        ).length;
        return estimate.availableSeats >= eligibleQueue;
      });
      if (!follower || follower.eta > o.maxFollowerEta)
        return {
          ok: false,
          reason:
            estimates.length && !follower
              ? 'following capacity insufficient for known queue'
              : 'no credible eligible following service',
          stop,
          dest,
          follower,
        };
      const history = sim.controller.history[historyKey(stop, dest)];
      if (!history)
        return { ok: false, reason: 'missing eligible-service history', stop, dest, follower };
      if (sim.time + follower.eta - history.t > o.maxServiceGap)
        return {
          ok: false,
          reason: 'predicted eligible-service gap exceeds limit',
          stop,
          dest,
          follower,
          lastServiceAt: history.t,
        };
      for (const p of sim.stops[stop].queue) {
        if (p.dest !== dest) continue;
        if ((p.policyDenials ?? 0) + (p.capacityDenials ?? 0) >= o.maxDenials)
          return { ok: false, reason: 'repeated-denial limit', stop, dest, passenger: p.id };
        if (sim.time + follower.eta - p.queued > o.maxServiceGap)
          return {
            ok: false,
            reason: 'passenger wait safeguard',
            stop,
            dest,
            passenger: p.id,
            follower,
          };
      }
      coverage.add(follower.bus);
    }
  }
  return { ok: true, coverage: [...coverage] };
}

export function safeguardControllerVisit(sim, bus) {
  if (!sim.controller || !bus.servicePlan?.automatic) return false;
  const snapshot = sim.neighborSnapshot();
  const check = checkCoverage(sim, bus, snapshot);
  if (check.ok) return false;
  sim.clearServicePlan(bus, `automatic safeguard: ${check.reason}`);
  busState(sim, bus).coverage = [];
  decision(sim, bus, 'restore', check.reason, check);
  return true;
}

export function evaluateControllerBatch(sim, events = []) {
  if (!sim.controller) return;
  const state = sim.controller,
    o = state.options;
  const snapshot = sim.neighborSnapshot();
  const relevant = new Set();
  for (const event of events) {
    if (event.bus == null) continue;
    relevant.add(event.bus);
    const b = sim.buses[event.bus],
      s = busState(sim, b);
    if (event.type === 'arrival') {
      s.arrivedAt = sim.time;
      s.arrivedStop = b.target;
    }
  }
  if (o.decisionMode === 'polling') {
    if (sim.time + EPS < state.nextPoll && sim.time < state.schedule.end) return;
    do {
      state.nextPoll += o.pollSeconds;
    } while (state.nextPoll <= sim.time + EPS);
    if (state.nextPoll >= state.schedule.end) state.nextPoll = Infinity;
    for (const bus of sim.buses) if (bus.phase !== 'travel') relevant.add(bus.id);
  }
  // Schedule boundaries need reassessment, but never create polling decisions.
  for (const b of sim.buses)
    if ((b.autoHoldUntil ?? 0) > sim.time || b.servicePlan?.automatic) relevant.add(b.id);
  const inWindow = sim.time >= state.schedule.start && sim.time < state.schedule.end;
  const protectedFollowers = new Set(
    sim.buses.flatMap((b) => (b.servicePlan?.automatic ? busState(sim, b).coverage : [])),
  );
  const plans = [];
  for (const id of [...relevant].sort((a, b) => a - b)) {
    const bus = sim.buses[id],
      s = busState(sim, bus),
      gaps = snapshot.byId[id];
    if (bus.phase === 'travel') continue;
    const key = visitKey(bus);
    if (s.visit !== key) {
      s.visit = key;
      s.visitHold = 0;
    }
    if (bus.servicePlan?.automatic) {
      const recovered = gaps.ahead <= (sim.c.stops / sim.c.buses) * 1.05;
      if (recovered || !inWindow) {
        plans.push({
          bus,
          type: 'restore',
          reason: recovered ? 'forward gap recovered' : 'automatic control window ended',
          context: { ahead: gaps.ahead, behind: gaps.behind },
        });
        continue;
      }
      const check = checkCoverage(sim, bus, snapshot);
      if (!check.ok) {
        plans.push({ bus, type: 'restore', reason: check.reason, context: check });
        continue;
      }
    }
    const history = temporalHistory(sim, bus);
    const convoy = coincidentRank(sim, bus, snapshot, events);
    const target = targetHeadway(sim, history);
    const follower = followingService(
      sim,
      bus,
      bus.target,
      (bus.target + 1) % sim.c.stops,
      snapshot,
    );
    const context = {
      ahead: gaps.ahead,
      behind: gaps.behind,
      aheadId: gaps.aheadId,
      behindId: gaps.behindId,
      history,
      target,
      follower,
      convoy,
      // Every coincident group has a front, even when the next bus is closer
      // than the desired spacing. Leave that front's departure opportunity
      // free so follower staggering can open the group from the front.
      coincidentLeader: gaps.behind <= EPS && gaps.ahead > EPS,
      estimateQualifier: 'Conditional heuristic; unknown future arrivals/dwell are not forecast.',
      predictionLimitations: sim.c.overtaking
        ? null
        : 'No joint trajectory/service bound for no-overtaking; automatic interventions fall back to normal service.',
    };
    if ((bus.autoHoldUntil ?? 0) > sim.time) {
      const lostJustification =
        !inWindow ||
        context.coincidentLeader ||
        gaps.ahead >= (sim.c.stops / sim.c.buses) * 0.95 ||
        (!history && !convoy) ||
        !follower ||
        follower.eta > o.maxFollowerEta;
      if (lostJustification)
        plans.push({
          bus,
          type: 'release',
          reason: context.coincidentLeader
            ? 'coincident group leader retains departure opportunity'
            : 'automatic hold no longer justified',
          context,
        });
      else {
        const remainingContext = holdingCostContext(
          sim,
          bus,
          bus.autoHoldUntil - sim.time,
          context,
        );
        if (remainingContext.predictedAdditionalSeconds <= EPS)
          plans.push({
            bus,
            type: 'release',
            reason: 'remaining automatic hold absorbed by required service or manual hold',
            context: remainingContext,
          });
        else if (!passengerBenefitCoversCost(remainingContext))
          plans.push({
            bus,
            type: 'release',
            reason: 'remaining automatic hold passenger cost exceeds estimated benefit',
            context: remainingContext,
          });
      }
      continue;
    }
    if (!inWindow || s.lastDecisionVisit === key) continue;
    if (bus.servicePlan || bus.pendingHold || bus.holdUntil > sim.time) {
      decision(sim, bus, 'suppressed', 'existing instruction or manual hold', context);
      continue;
    }
    if (o.response === 'hold' && context.coincidentLeader) {
      decision(
        sim,
        bus,
        'suppressed',
        'coincident group leader retains departure opportunity',
        context,
      );
      continue;
    }
    if (!history && !convoy) {
      decision(sim, bus, 'suppressed', 'missing temporal history; normal service', context);
      continue;
    }
    if (o.response === 'hold') {
      // An isolated bus with sufficient forward space also remains free.
      if (gaps.ahead >= (sim.c.stops / sim.c.buses) * 0.95) {
        decision(
          sim,
          bus,
          'suppressed',
          'forward gap already sufficient; leader remains free',
          context,
        );
        continue;
      }
      if (protectedFollowers.has(id) || !follower || follower.eta > o.maxFollowerEta) {
        decision(
          sim,
          bus,
          'suppressed',
          'no usable following service or bus reserved for coverage',
          context,
        );
        continue;
      }
      if (bus.visits - s.lastHoldVisit <= o.cooldownStops) {
        decision(sim, bus, 'suppressed', 'successive-stop hold cooldown', context);
        continue;
      }
      const deficit = convoy
        ? target.seconds * Math.min(0.75, convoy.rank / sim.c.buses)
        : target.seconds - history.sincePrevious;
      const requested = Math.max(
        0,
        Math.min(o.maxHold, o.maxVisitHold - s.visitHold, o.repeatBudget - s.spentHold, deficit),
      );
      if (requested <= EPS) {
        decision(
          sim,
          bus,
          'suppressed',
          'hold budget exhausted or temporal gap sufficient',
          context,
        );
        continue;
      }
      // Stagger a simultaneous group by rank, rather than imposing the same cap.
      const staggered = convoy ? (requested * convoy.rank) / (sim.c.buses - 1) : requested;
      const costContext = holdingCostContext(sim, bus, staggered, context);
      if (costContext.predictedAdditionalSeconds <= EPS) {
        decision(
          sim,
          bus,
          'suppressed',
          'hold fully absorbed by required service; no added spacing benefit',
          costContext,
        );
        continue;
      }
      if (!passengerBenefitCoversCost(costContext)) {
        decision(
          sim,
          bus,
          'suppressed',
          'estimated passenger benefit does not cover added cost',
          costContext,
        );
        continue;
      }
      plans.push({ bus, type: 'hold', value: staggered, context: costContext });
    } else {
      if (
        gaps.ahead <= (sim.c.stops / sim.c.buses) * 1.1 ||
        gaps.behind >= (sim.c.stops / sim.c.buses) * 0.9 ||
        protectedFollowers.has(id)
      ) {
        decision(sim, bus, 'suppressed', 'two-gap acceleration condition not met', context);
        continue;
      }
      const value = restrictions(sim, bus);
      const check = checkCoverage(sim, bus, snapshot, { ...value, type: o.response });
      if (!check.ok) {
        decision(sim, bus, 'suppressed', check.reason, { ...context, ...check });
        continue;
      }
      for (const followerId of check.coverage) protectedFollowers.add(followerId);
      plans.push({
        bus,
        type: o.response,
        value,
        context: { ...context, coverage: check.coverage },
      });
    }
  }
  // Apply only after all candidates observed the same timestamp state.
  for (const plan of plans.sort((a, b) => a.bus.id - b.bus.id)) {
    const s = busState(sim, plan.bus);
    if (plan.type === 'release') {
      releaseAuto(sim, plan.bus, plan.reason, plan.context);
      continue;
    }
    if (plan.type === 'restore') {
      sim.clearServicePlan(plan.bus, plan.reason);
      s.coverage = [];
      decision(sim, plan.bus, 'restore', plan.reason, plan.context);
      continue;
    }
    s.lastDecisionVisit = visitKey(plan.bus);
    if (plan.type === 'hold') {
      sim.applyAutomaticHold(plan.bus, plan.value, plan.context);
      s.spentHold += plan.value;
      s.visitHold += plan.value;
      s.lastHoldVisit = plan.bus.visits;
      state.metrics.requestedHoldSeconds += plan.value;
      decision(sim, plan.bus, 'hold', 'bounded passenger-cost follower hold', plan.context);
    } else {
      sim.action(plan.bus.id, plan.type, plan.value, { automatic: true });
      s.restrictedAt = sim.time;
      s.coverage = plan.context.coverage;
      decision(sim, plan.bus, 'restrict', 'two-gap acceleration with eligible following service', {
        ...plan.context,
        response: plan.type,
        value: plan.value,
      });
    }
  }
}

export function controllerSummary(sim) {
  if (!sim.controller) return null;
  return {
    ...sim.controller.metrics,
    mode: 'passenger-cost',
    decisionMode: sim.controller.options.decisionMode,
    targetSeconds: sim.controller.options.targetSeconds,
    recordedDecisions: sim.controller.decisions.length,
  };
}
