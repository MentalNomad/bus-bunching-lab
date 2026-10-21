/* Discrete-event model. Times are seconds; destination-eligible FIFO queues. */
import { normalizeServiceAction } from './service-plan.js?v=20261021a';
export const MAX_SIMULATION_SECONDS = 604800;
export const MAX_COMBINED_DELAY = MAX_SIMULATION_SECONDS;
export const MAX_PASSENGERS = 250000;
export const MAX_STOP_VISITS = 250000;
// Charts can notice completed visits without polling every unfinished passenger.
// Keep this metadata outside serialized observation data and CSV exports.
function observations() {
  return Object.defineProperty([], 'commitRevision', { value: 0, writable: true });
}

import { normalizeModelOptions } from './model-options.js?v=20261021a';
import {
  configureTemporalController,
  evaluateControllerBatch,
  safeguardControllerVisit,
  recordControllerDeparture,
  recordControllerDenial,
  recordControllerBoarding,
  recordControllerHoldDelay,
} from './controller.js?v=20261021a';

export class Simulation {
  constructor(config = {}) {
    config = { ...config, ...normalizeModelOptions(config) };
    this.c = {
      stops: 12,
      travel: 40,
      buses: 4,
      rate: 3,
      arrival: 'fixed',
      board: 2,
      debark: 1,
      ride: 4,
      rideMode: 'fixed',
      seed: 42,
      ...config,
    };
    const c = this.c;
    for (const [key, min, max] of [
      ['stops', 3, 40],
      ['travel', 1, 600],
      ['buses', 1, 16],
      ['rate', 0, 60],
      ['board', 0, 30],
      ['debark', 0, 30],
      ['ride', 1, c.stops - 1],
      ['seed', 1, 2147483647],
    ])
      if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max) throw Error(`Invalid ${key}`);
    for (const k of ['stops', 'buses', 'ride', 'seed'])
      if (!Number.isInteger(c[k])) throw Error(`${k} must be an integer`);
    if (!['fixed', 'poisson'].includes(c.arrival) || !['fixed', 'random'].includes(c.rideMode))
      throw Error('Invalid distribution');
    this.time = 0;
    this.randomState = c.seed;
    this.created = 0;
    this.births = [];
    this.integratedPassengerTime = 0;
    this.integratedQueueTime = 0;
    this.integratedOnboardTime = 0;
    this.completed = 0;
    this.transfers = 0;
    this.passedOver = 0;
    this.affectedPassengers = 0;
    this.waitSum = 0;
    this.systemSum = 0;
    this.series = observations();
    this.completedPassengers = [];
    this.log = [];
    this.stops = Array.from({ length: c.stops }, (_, id) => ({
      id,
      queue: [],
      next: c.rate ? this.interval() : Infinity,
    }));
    if (c.arrivalCutoff !== undefined && c.arrivalCutoff !== null)
      for (const s of this.stops) if (s.next > c.arrivalCutoff) s.next = Infinity;
    this.buses = Array.from({ length: c.buses }, (_, id) => {
      const pos = (id * c.stops) / c.buses;
      const from = Math.floor(pos);
      return {
        id,
        pos,
        from,
        target: (from + 1) % c.stops,
        phase: 'travel',
        start: 0,
        due: (1 - (pos - from)) * c.travel,
        origin: pos,
        load: [],
        dwell: [],
        wait: observations(),
        holdUntil: 0,
        pendingHold: 0,

        pendingSlow: 1,
        stopStart: 0,
        service: null,
        alight: [],
        visits: 0,
        servicePlan: null,
      };
    });
    this.policyDenials = 0;
    this.capacityDenials = 0;
    this.autoHoldRequested = 0;
    this.autoHoldRealized = 0;
    this.serviceHistory = [];
    this.eventRevision = 0;
    for (const b of this.buses)
      Object.assign(b, {
        autoHoldUntil: 0,
        overheadUntil: 0,
        stoppingUntil: 0,
        boardedThisVisit: 0,
        arrivalSequence: 0,
        policyVisit: '',
        visitOpen: false,
        x: b.pos,
        roadSpeed: 1 / this.c.travel,
        actualSpeed: 1 / this.c.travel,
        motionAnchorX: b.pos,
        motionAnchorTime: 0,
        targetX: Math.floor(b.pos) + 1,
        autoHoldRequested: 0,
        autoHoldRealized: 0,
      });
    this.roadOrder = this.buses
      .map((b) => b.id)
      .sort((a, b) => this.buses[a].x - this.buses[b].x || a - b);
  }
  neighborSnapshot() {
    if (!this.c.overtaking) {
      // A road queue may meet across the seam after its buses have travelled
      // different lap counts. Its persistent circular order and lifted positions
      // determine the leader; re-sorting equal displayed positions by ID would
      // assign the long empty arc to a physically blocked follower.
      const physical = this.roadOrder.map((id) => this.buses[id]);
      const edges = physical.map((b, i) => {
        const leader = physical[(i + 1) % physical.length];
        return Math.max(0, leader.x + (i === physical.length - 1 ? this.c.stops : 0) - b.x);
      });
      let wrap = edges.findIndex(
        (gap, i) =>
          gap > 0 &&
          this.position(physical[(i + 1) % physical.length]) <= this.position(physical[i]),
      );
      if (wrap < 0) wrap = physical.length - 1;
      const order = Array.from(
        { length: physical.length },
        (_, i) => physical[(wrap + 1 + i) % physical.length].id,
      );
      const byId = {};
      for (let i = 0; i < physical.length; i++) {
        const b = physical[i];
        byId[b.id] = {
          id: b.id,
          position: this.position(b),
          rank: order.indexOf(b.id),
          aheadId: physical[(i + 1) % physical.length].id,
          behindId: physical[(i + physical.length - 1) % physical.length].id,
          ahead: edges[i],
          behind: edges[(i + physical.length - 1) % physical.length],
        };
      }
      return { time: this.time, length: this.c.stops, order, byId };
    }
    const ordered = this.buses
      .map((b) => ({ id: b.id, position: this.position(b) }))
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const byId = {};
    for (let i = 0; i < ordered.length; i++) {
      const here = ordered[i],
        ahead = ordered[(i + 1) % ordered.length],
        behind = ordered[(i + ordered.length - 1) % ordered.length];
      byId[here.id] = {
        ...here,
        rank: i,
        aheadId: ahead.id,
        behindId: behind.id,
        ahead: ahead.position - here.position + (i === ordered.length - 1 ? this.c.stops : 0),
        behind: here.position - behind.position + (i === 0 ? this.c.stops : 0),
      };
    }
    return { time: this.time, length: this.c.stops, order: ordered.map((b) => b.id), byId };
  }
  forwardGap(b) {
    return this.neighborSnapshot().byId[b.id].ahead;
  }
  backwardGap(b) {
    return this.neighborSnapshot().byId[b.id].behind;
  }
  gaps(b) {
    const { ahead, behind } = this.neighborSnapshot().byId[b.id];
    return { ahead, behind };
  }
  configureController(options, schedule = {}) {
    configureTemporalController(this, options, {
      ...schedule,
      end: Math.min(
        schedule.end ?? MAX_SIMULATION_SECONDS,
        this.c.arrivalCutoff ?? MAX_SIMULATION_SECONDS,
      ),
    });
  }
  capacityAvailable(b) {
    return this.c.capacity === null
      ? Infinity
      : Math.max(0, this.c.capacity - b.load.length - (b.service?.kind === 'on' ? 1 : 0));
  }
  action(id, type, value, context = {}) {
    const b = this.buses[id];
    if (!b) throw Error('Choose a bus');
    if (['dropoff', 'pattern', 'boarding', 'normal'].includes(type)) {
      const instruction = normalizeServiceAction(type, value, this.c);
      if (type === 'boarding') {
        this.clearServicePlan(b);

        b.servicePlan = {
          ...instruction,
          type,
          announcedAt: this.time,
          expiresAt: this.time + instruction.maxSeconds,
          anchor: b.target,
          anchored: b.phase !== 'travel',
          location: 0,
          visitAllowanceUsed: 0,
          automatic: !!context.automatic,
        };
        this.updateServicePlan(b);
        this.wakeService(b);
        this.note(`Bus ${id + 1}: at most ${instruction.passengers} new boardings per stop visit.`);
      } else {
        this.applyAction(id, type, value);
        if (b.servicePlan) b.servicePlan.automatic = !!context.automatic;
      }
      // A command at the arrival boundary can turn a pass into a served visit.
      // Charge its overhead once, including when there is nobody waiting.
      if (b.phase !== 'travel' && b.visitOpen && !b.servicePlan?.skip && !b.servedVisit) {
        b.servedVisit = true;
        this.prepareStop(b);
      }
      return;
    }
    // Consecutive skip blocks preserve every accepted destination.
    if (type === 'express') {
      if (!Number.isInteger(value) || value < 1 || value >= this.c.stops)
        throw Error('Skip 1 to number of stops minus 1');
      this.action(
        id,
        'pattern',
        {
          leadStops: 0,
          every: this.c.stops,
          stops: value,
          untilRecovered: false,
          maxSeconds: MAX_SIMULATION_SECONDS,
        },
        context,
      );
      return;
    }
    if (type === 'recovery') {
      if (!Number.isFinite(value) || value <= 0) throw Error('Enter a positive value');
      this.action(
        id,
        'pattern',
        {
          leadStops: 0,
          every: 2,
          stops: null,
          untilRecovered: true,
          maxSeconds: MAX_SIMULATION_SECONDS,
        },
        context,
      );
      return;
    }
    if (!this.c.overtaking && type === 'slow' && b.phase === 'travel') {
      if (!Number.isFinite(value) || value < 1 || value > 10) throw Error('Slowdown must be 1–10×');
      const remaining = ((b.targetX - b.x) / b.roadSpeed) * value;
      if (remaining > MAX_SIMULATION_SECONDS)
        throw Error('Combined segment travel cannot exceed seven days (604,800 seconds).');
      b.roadSpeed /= value;
      this.updateRoadMotion();
      this.note(`Bus ${id + 1}: ${value}× travel time on current segment.`);
      return;
    }
    this.applyAction(id, type, value);
  }
  serviceStatus(b) {
    if (b.servicePlan?.type === 'boarding')
      return `boarding limit: ${b.servicePlan.passengers} new riders per visit`;
    return this.describeServicePlan(b);
  }
  canBoard(b, p) {
    if (b.servicePlan?.type === 'boarding')
      return b.servicePlan.visitAllowanceUsed < b.servicePlan.passengers;
    return this.acceptsDestination(b, p);
  }
  wakeService(b) {
    if (b.phase === 'hold') {
      b.phase = 'service';
      b.due = this.time;
    }
  }
  applyAutomaticHold(b, seconds, context = {}) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
      throw Error('Invalid automatic hold.');
    if (b.phase === 'travel') return false;
    b.autoHoldUntil = Math.max(b.autoHoldUntil, this.time + seconds);
    b.autoHoldRequested += seconds;
    this.autoHoldRequested += seconds;
    b.lastAutomaticHold = { t: this.time, seconds, ...structuredClone(context) };
    return true;
  }
  releaseAutomaticHold(b, reason = '') {
    b.autoHoldUntil = this.time;
    if (b.phase === 'hold') this.wakeService(b);
    if (reason) b.automaticReleaseReason = reason;
  }
  position(b) {
    if (this.c.overtaking || b.x === undefined) return this.interpolatedPosition(b);
    return ((b.x % this.c.stops) + this.c.stops) % this.c.stops;
  }
  moveClock(next) {
    const dt = next - this.time;
    for (const b of this.buses) {
      // Automatic dwell is additional only after all required work and manual
      // holding end. Road blocking is a separate cause and is excluded.
      if (
        dt > 0 &&
        b.phase === 'hold' &&
        !b.service &&
        b.holdUntil <= this.time &&
        b.overheadUntil <= this.time &&
        b.autoHoldUntil > this.time &&
        !b.roadBlocked
      ) {
        const extra = Math.min(next, b.autoHoldUntil) - this.time;
        if (extra > 0) {
          b.autoHoldRealized += extra;
          this.autoHoldRealized += extra;
          recordControllerHoldDelay(this, b, extra);
        }
      }
      if (!this.c.overtaking && b.phase === 'travel')
        b.x = b.motionAnchorX + b.actualSpeed * (next - b.motionAnchorTime);
    }
    this.integrateClock(next);
  }
  updateRoadMotion() {
    if (this.c.overtaking) return Infinity;
    const order = this.roadOrder;
    const previousSpeed = this.buses.map((b) => b.actualSpeed);
    // A contact can round to just before the same stop's stored arrival. Retain
    // that finite timer only beside its leader at this stop (multiple berths).
    const previousDue = this.buses.map((b) => b.due);
    for (const b of this.buses) b.actualSpeed = b.phase === 'travel' ? b.roadSpeed : 0;
    // Propagate each stopped/slower leader through a coincident queue. The one
    // wrap edge retains a full lap and therefore cannot impose a circular lock.
    for (let pass = 0; pass < order.length; pass++) {
      let changed = false;
      for (let i = order.length - 1; i >= 0; i--) {
        const b = this.buses[order[i]],
          leader = this.buses[order[(i + 1) % order.length]];
        const gap = leader.x + (i === order.length - 1 ? this.c.stops : 0) - b.x;
        if (gap <= 1e-10 && b.actualSpeed > leader.actualSpeed) {
          b.actualSpeed = leader.actualSpeed;
          changed = true;
        }
      }
      if (!changed) break;
    }
    let contact = Infinity;
    for (const b of this.buses)
      if (b.actualSpeed !== previousSpeed[b.id]) {
        b.motionAnchorX = b.x;
        b.motionAnchorTime = this.time;
      }
    for (let i = 0; i < order.length; i++) {
      const b = this.buses[order[i]],
        leader = this.buses[order[(i + 1) % order.length]];
      const gap = leader.x + (i === order.length - 1 ? this.c.stops : 0) - b.x;
      b.roadBlocked = b.phase === 'travel' && b.actualSpeed < b.roadSpeed;
      if (b.phase === 'travel')
        b.due =
          b.actualSpeed > 0
            ? b.motionAnchorTime + Math.max(0, b.targetX - b.motionAnchorX) / b.actualSpeed
            : Math.abs(b.targetX - b.x) <= 1e-10 &&
                Math.abs(leader.x + (i === order.length - 1 ? this.c.stops : 0) - b.targetX) <=
                  1e-10 &&
                Number.isFinite(previousDue[b.id])
              ? Math.max(this.time, previousDue[b.id])
              : Infinity;
      if (gap > 1e-10 && b.actualSpeed > leader.actualSpeed)
        contact = Math.min(
          contact,
          (leader.motionAnchorX -
            leader.actualSpeed * leader.motionAnchorTime +
            (i === order.length - 1 ? this.c.stops : 0) -
            b.motionAnchorX +
            b.actualSpeed * b.motionAnchorTime) /
            (b.actualSpeed - leader.actualSpeed),
        );
    }
    return contact;
  }
  arrive(b) {
    if (!this.c.overtaking) b.x = b.targetX;
    const plan = b.servicePlan;
    if (plan) {
      if (plan.anchored) plan.location++;
      else plan.anchored = true;
      plan.visitAllowanceUsed = 0;
      if (plan.untilRecovered && this.forwardGap(b) <= (this.c.stops / this.c.buses) * 1.1)
        this.clearServicePlan(b, 'forward spacing recovered');
      else this.updateServicePlan(b, true);
    }
    b.phase = 'service';
    b.stopStart = this.time;
    b.waitStart = b.wait.length;
    b.systemStart = this.series.length;
    b.holdUntil = this.time + b.pendingHold;
    b.pendingHold = 0;
    b.autoHoldUntil = 0;
    b.alight = b.load.filter((p) => p.dest === b.target);
    b.boardedThisVisit = 0;
    b.arrivalSequence++;
    b.policyVisit = `${b.target}:${b.arrivalSequence}`;
    b.visitOpen = true;
    b.deniedThisVisit = [];
    b.nominalSkip = !!b.servicePlan?.skip;
    // Even empty served stops pay overhead once. Protected drop-offs make a
    // nominally skipped visit served. Overhead precedes door work, while both
    // may be absorbed by a concurrently ticking hold deadline.
    b.servedVisit = !b.nominalSkip || !!b.alight.length || b.holdUntil > this.time;
    this.prepareStop(b);
    b.due = this.time;
  }
  prepareStop(b) {
    b.stoppingUntil = this.time + (b.servedVisit ? this.c.stoppingDelay : 0);
    b.overheadUntil = b.stoppingUntil + (b.servedVisit ? this.c.stopOverhead : 0);
  }
  depart(b) {
    this.countPassedOver(b);
    recordControllerDeparture(this, b);
    const skip = !b.servedVisit && this.time === b.stopStart;
    if (skip) {
      this.finishPlanLocation(b);
      b.phase = 'travel';
    }
    // Record grouped observations and advance one segment.
    // It calls countPassedOver once again, which is made idempotent per visit.
    const slow = b.pendingSlow;
    const starting = b.servedVisit ? this.c.startingDelay : 0;
    this.beginSegment(b);
    // A lumped acceleration penalty stretches the next linear road segment.
    // Bypassed locations pay neither braking nor acceleration time.
    b.due += starting;
    b.visitOpen = false;
    if (!this.c.overtaking) {
      b.targetX = b.x + 1;
      b.roadSpeed = 1 / (this.c.travel * slow + starting);
    }
  }
  countPassedOver(b) {
    if (!b.deniedThisVisit) b.deniedThisVisit = [];
    for (const p of this.stops[b.target].queue) {
      const cause = !this.canBoard(b, p)
        ? 'policy'
        : this.capacityAvailable(b) <= 0
          ? 'capacity'
          : null;
      if (!cause || b.deniedThisVisit.includes(p.id)) continue;
      b.deniedThisVisit.push(p.id);
      this.passedOver++;
      if (!p.passedOver) {
        p.passedOver = true;
        this.affectedPassengers++;
      }
      if (cause === 'policy') {
        this.policyDenials++;
        p.policyDenials = (p.policyDenials || 0) + 1;
      } else {
        this.capacityDenials++;
        p.capacityDenials = (p.capacityDenials || 0) + 1;
      }
      recordControllerDenial(this, b, p, cause);
    }
  }
  startService(b) {
    if (b.service) return;
    if (this.time < b.overheadUntil) {
      b.phase = 'hold';
      b.due = b.overheadUntil;
      return;
    }
    if (b.alight.length) {
      b.service = { kind: 'off', p: b.alight.shift(), start: this.time };
      b.due = this.time + this.c.debark;
      return;
    }
    let index =
      this.capacityAvailable(b) > 0
        ? this.stops[b.target].queue.findIndex((p) => this.canBoard(b, p))
        : -1;
    if (index < 0 && safeguardControllerVisit(this, b)) {
      b.nominalSkip = !!b.servicePlan?.skip;
      if (!b.nominalSkip && !b.servedVisit) {
        b.servedVisit = true;
        this.prepareStop(b);
        if (b.overheadUntil > this.time) {
          b.phase = 'hold';
          b.due = b.overheadUntil;
          return;
        }
      }
      index =
        this.capacityAvailable(b) > 0
          ? this.stops[b.target].queue.findIndex((p) => this.canBoard(b, p))
          : -1;
    }
    if (index >= 0) {
      const p = this.stops[b.target].queue.splice(index, 1)[0];
      recordControllerBoarding(this, b, p);
      if (b.servicePlan?.type === 'boarding') b.servicePlan.visitAllowanceUsed++;
      b.boardedThisVisit++;
      b.service = { kind: 'on', p, start: this.time };
      b.due = this.time + this.c.board;
      return;
    }
    const deadline = Math.max(b.holdUntil, b.autoHoldUntil, b.overheadUntil);
    if (deadline > this.time) {
      b.phase = 'hold';
      b.due = deadline;
    } else this.depart(b);
  }
  advance(seconds, { atBoundary } = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid time');
    const end = this.time + seconds;
    if (end > MAX_SIMULATION_SECONDS)
      throw Error('Simulation time cannot exceed seven days (604,800 seconds).');
    let eventsSeen = 0,
      boundaryDone = false;
    while (true) {
      const contact = this.updateRoadMotion();
      // Find the next genuine event before clipping to a caller's view horizon.
      // Rendering/advance(0) alone must not complete work within the tolerance.
      let next = contact;
      if (this.controller) {
        if (Number.isFinite(this.controller.nextPoll))
          next = Math.min(next, this.controller.nextPoll);
        if (!this.controller.engineStartHandled && this.controller.schedule.start >= this.time)
          next = Math.min(next, this.controller.schedule.start);
        if (!this.controller.engineEndHandled && this.controller.schedule.end >= this.time)
          next = Math.min(next, this.controller.schedule.end);
      }
      for (const s of this.stops) next = Math.min(next, s.next);
      for (const b of this.buses) {
        next = Math.min(next, b.due);
        if (b.servicePlan) next = Math.min(next, b.servicePlan.expiresAt);
        if (b.phase !== 'travel')
          for (const deadline of [b.holdUntil, b.autoHoldUntil, b.overheadUntil])
            if (deadline > this.time) next = Math.min(next, deadline);
      }
      const modelEventAtTime = next <= end;
      next = Math.min(end, next);
      if (next < this.time - 1e-8) throw Error('An event was scheduled in the past.');
      if (next > this.time && this.created >= MAX_PASSENGERS)
        throw Error('Passenger limit reached (250,000).');
      if (
        modelEventAtTime &&
        next > this.time &&
        this.buses.reduce((n, b) => n + b.visits, 0) >= MAX_STOP_VISITS
      )
        throw Error('Stop visit limit reached (250,000).');
      this.moveClock(Math.max(next, this.time));
      const events = [];
      let controlBoundary = false;
      if (this.controller) {
        if (!this.controller.engineStartHandled && this.time >= this.controller.schedule.start) {
          this.controller.engineStartHandled = true;
          controlBoundary = true;
        }
        if (!this.controller.engineEndHandled && this.time >= this.controller.schedule.end) {
          this.controller.engineEndHandled = true;
          controlBoundary = true;
        }
        if (this.controller.nextPoll <= this.time) controlBoundary = true;
      }
      // Coupled mandatory events share one state before any automatic decision.
      for (const s of this.stops)
        if (s.next <= this.time) {
          let ride = this.c.ride;
          if (this.c.rideMode === 'random')
            ride = 1 + Math.floor(this.random() * Math.min(this.c.stops - 1, 2 * this.c.ride - 1));
          const p = {
            id: ++this.created,
            born: this.time,
            queued: this.time,
            wait: 0,
            origin: s.id,
            dest: (s.id + ride) % this.c.stops,
          };
          s.queue.push(p);
          this.births.push({ id: p.id, born: p.born, origin: p.origin, dest: p.dest });
          s.next = this.time + this.interval();
          if (this.c.arrivalCutoff !== null && s.next > this.c.arrivalCutoff) s.next = Infinity;
          for (const b of this.buses)
            if (b.phase === 'hold' && b.target === s.id) this.wakeService(b);
        }
      for (const b of this.buses)
        if (b.servicePlan?.expiresAt <= this.time)
          this.clearServicePlan(b, 'service time limit reached');
      for (const b of this.buses) {
        if (
          (modelEventAtTime ||
            controlBoundary ||
            (atBoundary && this.time === end && !boundaryDone)) &&
          b.due <= this.time + 1e-10
        ) {
          if (b.phase === 'travel') {
            this.arrive(b);
            events.push({ type: 'arrival', bus: b.id, stop: b.target, t: this.time });
          } else {
            // Coupled real events use one numerical batch time. Required timers
            // completed in that batch must not reschedule an artificial visit.
            for (const deadline of ['overheadUntil', 'holdUntil', 'autoHoldUntil'])
              if (b[deadline] <= this.time + 1e-10) b[deadline] = Math.min(b[deadline], this.time);
            this.finishService(b);
            b.phase = 'service';
            b.due = Infinity;
            events.push({ type: 'release', bus: b.id, stop: b.target, t: this.time });
          }
        }
      }
      if (this.time === end && !boundaryDone) {
        boundaryDone = true;
        if (atBoundary) {
          atBoundary(this);
          controlBoundary = true;
        }
      }
      // Required zero-duration tasks finish at this timestamp, but automatic
      // control evaluates once, preventing a zero-time repeated-hold loop.
      if (events.length || controlBoundary) {
        if (controlBoundary)
          for (const b of this.buses)
            if (b.phase !== 'travel')
              events.push({ type: 'boundary', bus: b.id, stop: b.target, t: this.time });
        this.eventRevision++;
        evaluateControllerBatch(this, events);
      }
      if (modelEventAtTime || controlBoundary)
        for (const b of this.buses) {
          let zeroTasks = 0;
          while (b.phase !== 'travel' && !b.service) {
            this.startService(b);
            if (!b.service || b.due > this.time) break;
            this.finishService(b);
            if (++zeroTasks > MAX_PASSENGERS + 1)
              throw Error('Too many zero-duration service tasks.');
          }
        }
      if (++eventsSeen > 2000000) throw Error('Too many events; reduce demand');
      if (this.time === end) break;
    }
  }
  summary() {
    return {
      ...this.passengerSummary(),

      policyDenials: this.policyDenials,
      capacityDenials: this.capacityDenials,
      autoHoldRequested: this.autoHoldRequested,
      autoHoldRealized: this.autoHoldRealized,
    };
  }
  random() {
    this.randomState = (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return (this.randomState + 0.5) / 4294967296;
  }
  interval() {
    return this.c.arrival === 'fixed'
      ? 60 / this.c.rate
      : (-Math.log(1 - this.random()) * 60) / this.c.rate;
  }
  note(message) {
    this.log.unshift({ t: this.time, message });
    this.log = this.log.slice(0, 60);
  }
  clearServicePlan(b, reason = '') {
    if (!b.servicePlan) return;
    b.servicePlan = null;
    this.wakeService(b);
    if (reason) this.note(`Bus ${b.id + 1}: ${reason}; normal service resumes.`);
  }
  patternSkips(plan, location) {
    const active = location - plan.leadStops;
    return (
      active > 0 &&
      (plan.untilRecovered || plan.stops === null || active <= plan.stops) &&
      active % plan.every !== 0
    );
  }
  updateServicePlan(b, atStop = false) {
    const plan = b.servicePlan;
    if (!plan) return;
    const active = plan.type === 'pattern' ? plan.location - plan.leadStops : plan.location + 1;
    plan.leadRemaining = plan.type === 'pattern' ? Math.max(0, plan.leadStops - plan.location) : 0;
    const servedCurrent = plan.anchored && b.phase === 'travel' && !atStop ? 0 : 1;
    plan.remaining =
      plan.untilRecovered || plan.stops === null
        ? null
        : Math.max(0, plan.stops - Math.max(0, active - servedCurrent));
    plan.phase = !plan.anchored ? 'pending' : active <= 0 ? 'lead-in' : 'active';
    plan.skip = plan.anchored && plan.type === 'pattern' && this.patternSkips(plan, plan.location);
  }
  stopPlan(b, stopId) {
    if (!Number.isInteger(stopId) || stopId < 0 || stopId >= this.c.stops)
      throw Error('Choose a route stop');
    const distance = (stopId - b.target + this.c.stops) % this.c.stops;
    const plan = b.servicePlan;
    if (plan?.type === 'pattern') {
      const location = plan.location + distance + (b.phase === 'travel' && plan.anchored ? 1 : 0);
      if (!this.patternSkips(plan, location)) return 'normal';
      return b.load.some((p) => p.dest === stopId) ||
        (b.service?.kind === 'on' && b.service.p.dest === stopId)
        ? 'protected'
        : 'skip';
    }
    return 'normal';
  }
  finishPlanLocation(b) {
    const plan = b.servicePlan;
    if (!plan || plan.untilRecovered || plan.stops === null) return;
    const active = plan.type === 'pattern' ? plan.location - plan.leadStops : plan.location + 1;
    if (active >= plan.stops) this.clearServicePlan(b, 'service span completed');
  }
  finishService(b) {
    const task = b.service;
    if (!task) return;
    b.service = null;
    const p = task.p;
    if (task.kind === 'off') {
      b.load.splice(b.load.indexOf(p), 1);

      this.completed++;
      this.waitSum += p.wait;
      this.systemSum += this.time - p.born;
      const r = { t: this.time, v: this.time - p.born, wait: p.wait, id: p.id, bus: b.id };
      this.series.push(r);
      this.completedPassengers.push(r);
    } else {
      p.wait += task.start - p.queued;
      b.wait.push({ t: task.start, v: p.wait, id: p.id, stop: b.target });
      b.load.push(p);
    }
  }
  applyAction(id, type, value) {
    const b = this.buses[id];
    if (!b) throw Error('Choose a bus');
    if (['dropoff', 'pattern', 'normal'].includes(type)) {
      const instruction = normalizeServiceAction(type, value, this.c);
      this.clearServicePlan(b);

      // A passenger already using the door completes that movement. Everyone
      // else aboard keeps their destination instead of being forced to transfer.
      b.alight = b.load.filter(
        (p) => p.dest === b.target && !(b.service?.kind === 'off' && b.service.p === p),
      );
      if (type !== 'normal') {
        b.servicePlan = {
          ...instruction,
          type,
          announcedAt: this.time,
          expiresAt: this.time + instruction.maxSeconds,
          anchor: b.target,
          anchored: b.phase !== 'travel',
          location: 0,
        };
        this.updateServicePlan(b);
        this.note(
          `Bus ${id + 1}: ${this.serviceStatus(b)}; maximum ${instruction.maxSeconds}s from announcement.`,
        );
      } else this.note(`Bus ${id + 1}: normal service resumes.`);
      this.wakeService(b);
      return;
    }
    if (!Number.isFinite(value) || value <= 0) throw Error('Enter a positive value');
    if (type === 'hold') {
      if (value > 3600) throw Error('Maximum hold is 3,600 seconds');
      const remaining =
        (b.phase === 'travel' ? b.pendingHold : Math.max(0, b.holdUntil - this.time)) + value;
      if (remaining > MAX_COMBINED_DELAY)
        throw Error('Combined hold cannot exceed seven days (604,800 seconds).');
      if (b.phase === 'travel') b.pendingHold = remaining;
      else {
        b.holdUntil = this.time + remaining;
        if (b.phase === 'hold') b.due = b.holdUntil;
      }
      this.note(
        `Bus ${id + 1}: hold ${value}s ${b.phase === 'travel' ? 'at next stop' : 'at this stop'}.`,
      );
    } else if (type === 'slow') {
      if (value < 1 || value > 10) throw Error('Slowdown must be 1–10×');
      const remaining = (b.phase === 'travel' ? b.due - this.time : this.c.travel) * value;
      if (remaining > MAX_COMBINED_DELAY)
        throw Error('Combined segment travel cannot exceed seven days (604,800 seconds).');
      if (b.phase === 'travel') {
        const pos = this.position(b);
        b.due = this.time + remaining;
        b.origin = pos;
        b.start = this.time;
      } else b.pendingSlow = value;
      this.note(
        `Bus ${id + 1}: ${value}× travel time on ${b.phase === 'travel' ? 'current' : 'next'} segment.`,
      );
    } else throw Error('Unknown action');
  }
  interpolatedPosition(b) {
    if (b.phase !== 'travel') return b.target;
    const distance = (b.target - b.origin + this.c.stops) % this.c.stops || this.c.stops;
    return (
      (b.origin + distance * Math.min(1, (this.time - b.start) / (b.due - b.start))) % this.c.stops
    );
  }
  integrateClock(next) {
    const dt = next - this.time;
    const queued = this.stops.reduce((n, s) => n + s.queue.length, 0);
    const onboard = this.buses.reduce(
      (n, b) => n + b.load.length + (b.service?.kind === 'on' ? 1 : 0),
      0,
    );
    this.integratedQueueTime += queued * dt;
    this.integratedOnboardTime += onboard * dt;
    this.integratedPassengerTime += (queued + onboard) * dt;
    this.time = next;
  }
  describeServicePlan(b) {
    const plan = b.servicePlan;
    if (!plan) return '';
    if (plan.type === 'dropoff')
      return `drop-off only ${plan.untilRecovered ? 'until spacing recovers' : plan.stops === null ? 'until canceled or its time limit' : `for ${plan.remaining} stop locations`}`;
    const lead = plan.leadRemaining ? ` after ${plan.leadRemaining} lead-in stops` : '';
    return `announced pattern: serve every ${plan.every} stops${lead}${plan.untilRecovered ? ', until spacing recovers' : plan.stops === null ? ', until canceled or its time limit' : `, ${plan.remaining} pattern locations remaining`}`;
  }
  acceptsDestination(b, p) {
    const plan = b.servicePlan;
    if (plan) {
      if (plan.type === 'dropoff') return false;
      if (plan.skip) return false;
      const distance = (p.dest - b.target + this.c.stops) % this.c.stops || this.c.stops;
      return !this.patternSkips(plan, plan.location + distance);
    }
    return true;
  }
  beginSegment(b) {
    if (b.phase !== 'travel') {
      this.countPassedOver(b);
      for (let i = b.waitStart ?? 0; i < b.wait.length; i++) b.wait[i].commitT = this.time;
      if (b.wait.length > (b.waitStart ?? 0)) b.wait.commitRevision++;
      let committed = false;
      for (let i = b.systemStart ?? 0; i < this.series.length; i++)
        if (this.series[i].bus === b.id && this.series[i].commitT === undefined) {
          this.series[i].commitT = this.time;
          committed = true;
        }
      if (committed) this.series.commitRevision++;
      b.dwell.push({
        t: this.time,
        v: this.time - b.stopStart,
        stop: b.target,
        commitT: this.time,
      });
      b.visits++;
      this.finishPlanLocation(b);
    }
    b.from = b.target;
    b.origin = b.target;
    b.target = (b.target + 1) % this.c.stops;
    b.start = this.time;
    b.due = this.time + this.c.travel * b.pendingSlow;
    b.pendingSlow = 1;
    b.phase = 'travel';
    this.updateServicePlan(b);
  }
  passengerSummary() {
    const waiting = this.stops.reduce((s, x) => s + x.queue.length, 0);
    const onboard = this.buses.reduce(
      (s, b) => s + b.load.length + (b.service?.kind === 'on' ? 1 : 0),
      0,
    );
    const positions = this.buses.map((b) => this.position(b)).sort((a, b) => a - b);
    const gaps = positions.map((p, i) =>
      i === positions.length - 1 ? positions[0] + this.c.stops - p : positions[i + 1] - p,
    );
    if (gaps.length === 1) gaps[0] = this.c.stops;
    const mean = this.c.stops / this.c.buses;
    let currentWaitSum = 0,
      oldestWait = 0,
      unfinishedTime = 0;
    for (const stop of this.stops)
      for (const p of stop.queue) {
        const wait = this.time - p.queued;
        currentWaitSum += wait;
        oldestWait = Math.max(oldestWait, wait);
        unfinishedTime += this.time - p.born;
      }
    for (const b of this.buses) {
      for (const p of b.load) unfinishedTime += this.time - p.born;
      if (b.service?.kind === 'on') unfinishedTime += this.time - b.service.p.born;
    }
    return {
      time: this.time,
      created: this.created,
      completed: this.completed,
      waiting,
      onboard,
      transfers: this.transfers,
      passedOver: this.passedOver,
      affectedPassengers: this.affectedPassengers,
      oldestWait,
      meanCurrentWait: waiting ? currentWaitSum / waiting : 0,
      totalPassengerTime: this.systemSum + unfinishedTime,
      meanWait: this.completed ? this.waitSum / this.completed : 0,
      meanSystem: this.completed ? this.systemSum / this.completed : 0,
      gapCV: Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length) / mean,
    };
  }
}
