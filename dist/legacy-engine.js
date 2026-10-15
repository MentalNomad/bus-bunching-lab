/* Discrete-event model. Times are seconds; unlimited capacity; FIFO queues. */
import { normalizeServiceAction } from './service-plan.js?v=20261015c';
export const MAX_SIMULATION_SECONDS = 604800;
export const MAX_COMBINED_DELAY = MAX_SIMULATION_SECONDS;
export const MAX_PASSENGERS = 250000;
export const MAX_STOP_VISITS = 250000;
// Charts can notice completed visits without polling every unfinished passenger.
// Keep this metadata outside serialized observation data and CSV exports.
function observations() {
  return Object.defineProperty([], 'commitRevision', { value: 0, writable: true });
}

export class Simulation {
  constructor(config = {}) {
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
        express: 0,
        pendingExpress: 0,
        pendingSlow: 1,
        stopStart: 0,
        service: null,
        alight: [],
        visits: 0,
        servicePlan: null,
      };
    });
  }
  random() {
    this.randomState = (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return (this.randomState + 0.5) / 4294967296;
  }
  moveClock(next) {
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
  interval() {
    return this.c.arrival === 'fixed'
      ? 60 / this.c.rate
      : (-Math.log(1 - this.random()) * 60) / this.c.rate;
  }
  note(message) {
    this.log.unshift({ t: this.time, message });
    this.log = this.log.slice(0, 60);
  }
  action(id, type, value) {
    const b = this.buses[id];
    if (!b) throw Error('Choose a bus');
    if (['dropoff', 'pattern', 'normal'].includes(type)) {
      const instruction = normalizeServiceAction(type, value, this.c);
      this.clearServicePlan(b);
      b.express = 0;
      b.pendingExpress = 0;
      b.recoveryExpress = false;
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
    } else if (type === 'express') {
      if (!Number.isInteger(value) || value >= this.c.stops)
        throw Error('Skip 1 to number of stops minus 1');
      this.clearServicePlan(b);
      b.recoveryExpress = false;
      b.pendingExpress = value;
      this.note(
        `Bus ${id + 1}: temporary express past ${value} stops after ${b.phase === 'travel' ? 'next' : 'current'} stop.`,
      );
      if (b.phase === 'hold') {
        this.prepareExpress(b);
        b.phase = 'service';
        b.due = this.time;
      }
    } else if (type === 'recovery') {
      this.clearServicePlan(b);
      b.recoveryExpress = true;
      b.pendingExpress = 1;
      this.note(
        `Bus ${id + 1}: alternating express until forward gap recovers to ${(this.c.stops / this.c.buses).toFixed(1)} stops.`,
      );
      if (b.phase === 'hold') {
        this.prepareExpress(b);
        b.phase = 'service';
        b.due = this.time;
      }
    } else throw Error('Unknown action');
  }
  position(b) {
    if (b.phase !== 'travel') return b.target;
    const distance = (b.target - b.origin + this.c.stops) % this.c.stops || this.c.stops;
    return (
      (b.origin + distance * Math.min(1, (this.time - b.start) / (b.due - b.start))) % this.c.stops
    );
  }
  prepareExpress(b) {
    if (!b.pendingExpress) return;
    b.express = b.pendingExpress;
    b.pendingExpress = 0;
    const skip = new Set(
      Array.from({ length: b.express }, (_, i) => (b.target + i + 1) % this.c.stops),
    );
    b.alight = b.load.filter(
      (p) =>
        (p.dest === b.target || skip.has(p.dest)) &&
        !(b.service?.kind === 'off' && b.service.p === p),
    );
  }
  forwardGap(b) {
    let gap = this.c.stops;
    const p = this.position(b);
    for (const other of this.buses)
      if (other !== b)
        gap = Math.min(gap, (this.position(other) - p + this.c.stops) % this.c.stops);
    return gap;
  }
  backwardGap(b) {
    let gap = this.c.stops;
    const p = this.position(b);
    for (const other of this.buses)
      if (other !== b)
        gap = Math.min(gap, (p - this.position(other) + this.c.stops) % this.c.stops);
    return gap;
  }
  gaps(b) {
    return { ahead: this.forwardGap(b), behind: this.backwardGap(b) };
  }
  wakeService(b) {
    if (b.phase === 'hold') {
      b.phase = 'service';
      b.due = this.time;
    }
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
  serviceStatus(b) {
    const plan = b.servicePlan;
    if (!plan) return '';
    if (plan.type === 'dropoff')
      return `drop-off only ${plan.untilRecovered ? 'until spacing recovers' : plan.stops === null ? 'until canceled or its time limit' : `for ${plan.remaining} stop locations`}`;
    const lead = plan.leadRemaining ? ` after ${plan.leadRemaining} lead-in stops` : '';
    return `announced pattern: serve every ${plan.every} stops${lead}${plan.untilRecovered ? ', until spacing recovers' : plan.stops === null ? ', until canceled or its time limit' : `, ${plan.remaining} pattern locations remaining`}`;
  }
  canBoard(b, p) {
    const plan = b.servicePlan;
    if (plan) {
      if (plan.type === 'dropoff') return false;
      if (plan.skip) return false;
      const distance = (p.dest - b.target + this.c.stops) % this.c.stops || this.c.stops;
      return !this.patternSkips(plan, plan.location + distance);
    }
    return !Array.from({ length: b.express }, (_, i) => (b.target + i + 1) % this.c.stops).includes(
      p.dest,
    );
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
    if (plan) return 'normal';
    const skips = b.express || b.pendingExpress;
    const startsHere = b.phase === 'travel' && b.express > 0;
    return distance >= (startsHere ? 0 : 1) && distance < skips + (startsHere ? 0 : 1)
      ? 'skip'
      : 'normal';
  }
  countPassedOver(b) {
    for (const p of this.stops[b.target].queue) {
      if (b.express <= 0 && this.canBoard(b, p)) continue;
      this.passedOver++;
      if (!p.passedOver) {
        p.passedOver = true;
        this.affectedPassengers++;
      }
    }
  }
  arrive(b) {
    if (b.servicePlan) {
      const plan = b.servicePlan;
      if (plan.anchored) plan.location++;
      else plan.anchored = true;
      const ideal = this.c.stops / this.c.buses;
      const recovered =
        plan.untilRecovered &&
        this.forwardGap(b) <= ideal * 1.1 &&
        this.backwardGap(b) >= ideal * 0.9;
      if (recovered) this.clearServicePlan(b, 'spacing recovered');
      else this.updateServicePlan(b, true);
    }
    if (b.recoveryExpress && this.forwardGap(b) <= this.c.stops / this.c.buses) {
      b.recoveryExpress = false;
      b.express = 0;
      b.pendingExpress = 0;
      this.note(`Bus ${b.id + 1}: forward gap recovered; normal service resumes.`);
    }
    if (b.express > 0) {
      this.countPassedOver(b);
      b.express--;
      this.depart(b);
      return;
    }
    if (b.servicePlan?.skip && !b.load.some((p) => p.dest === b.target) && !b.pendingHold) {
      this.countPassedOver(b);
      this.finishPlanLocation(b);
      this.depart(b);
      return;
    }
    b.phase = 'service';
    b.stopStart = this.time;
    b.waitStart = b.wait.length;
    b.systemStart = this.series.length;
    b.holdUntil = this.time + b.pendingHold;
    b.pendingHold = 0;
    b.alight = b.load.filter((p) => p.dest === b.target);
    if (b.recoveryExpress) b.pendingExpress = 1;
    this.prepareExpress(b);
    b.due = this.time;
  }
  depart(b) {
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
      if (p.dest === b.target) {
        this.completed++;
        this.waitSum += p.wait;
        this.systemSum += this.time - p.born;
        const r = { t: this.time, v: this.time - p.born, wait: p.wait, id: p.id, bus: b.id };
        this.series.push(r);
        this.completedPassengers.push(r);
      } else {
        p.queued = this.time;
        this.stops[b.target].queue.push(p);
        this.transfers++;
      }
    } else {
      p.wait += task.start - p.queued;
      b.wait.push({ t: task.start, v: p.wait, id: p.id, stop: b.target });
      b.load.push(p);
    }
  }
  service(b) {
    this.finishService(b);
    this.prepareExpress(b);
    const stop = this.stops[b.target];
    if (b.alight.length) {
      b.service = { kind: 'off', p: b.alight.shift(), start: this.time };
      b.due = this.time + this.c.debark;
      return;
    }
    const index = stop.queue.findIndex((p) => this.canBoard(b, p));
    if (index >= 0) {
      b.service = { kind: 'on', p: stop.queue.splice(index, 1)[0], start: this.time };
      b.due = this.time + this.c.board;
      return;
    }
    if (this.time < b.holdUntil) {
      b.phase = 'hold';
      b.due = b.holdUntil;
    } else this.depart(b);
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid time');
    const end = this.time + seconds;
    if (end > MAX_SIMULATION_SECONDS)
      throw Error(
        'Simulation time cannot exceed seven days (604,800 seconds). Export the data, then reset.',
      );
    let count = 0;
    while (true) {
      let next = end + 1;
      let stop = null,
        bus = null,
        expiry = null;
      for (const s of this.stops)
        if (s.next < next) {
          next = s.next;
          stop = s;
          bus = null;
        }
      for (const b of this.buses)
        if (b.due < next) {
          next = b.due;
          bus = b;
          stop = null;
        }
      for (const b of this.buses)
        if (b.servicePlan && b.servicePlan.expiresAt <= next) {
          next = b.servicePlan.expiresAt;
          expiry = b;
          bus = null;
          stop = null;
        }
      if (next > end) break;
      // Finish a timestamp together so replaying/exporting the last accepted time
      // always succeeds. At most one arrival per stop / departure per bus may
      // cross a budget at that same timestamp.
      if (next > this.time) {
        if (this.created >= MAX_PASSENGERS)
          throw Error(
            'Passenger limit reached (250,000). Export the data, then reset or reduce demand.',
          );
        if (this.buses.reduce((n, b) => n + b.visits, 0) >= MAX_STOP_VISITS)
          throw Error(
            'Stop visit limit reached (250,000). Export the data, then reset or reduce the bus count.',
          );
      }
      if (++count > 2000000) throw Error('Too many events; reduce demand');
      this.moveClock(next);
      if (expiry) this.clearServicePlan(expiry, 'service time limit reached');
      else if (stop) {
        let ride = this.c.ride;
        if (this.c.rideMode === 'random')
          ride = 1 + Math.floor(this.random() * Math.min(this.c.stops - 1, 2 * this.c.ride - 1));
        const passenger = {
          id: ++this.created,
          born: this.time,
          queued: this.time,
          wait: 0,
          dest: (stop.id + ride) % this.c.stops,
          origin: stop.id,
        };
        stop.queue.push(passenger);
        this.births.push({
          id: passenger.id,
          born: passenger.born,
          origin: stop.id,
          dest: passenger.dest,
        });
        stop.next = this.time + this.interval();
        if (
          this.c.arrivalCutoff !== undefined &&
          this.c.arrivalCutoff !== null &&
          stop.next > this.c.arrivalCutoff
        )
          stop.next = Infinity;
        for (const b of this.buses)
          if (b.phase === 'hold' && b.target === stop.id) {
            b.phase = 'service';
            b.due = this.time;
          }
      } else if (bus.phase === 'travel') this.arrive(bus);
      else {
        bus.phase = 'service';
        this.service(bus);
      }
    }
    this.moveClock(end);
  }
  summary() {
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
