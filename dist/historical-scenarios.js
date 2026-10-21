// Frozen definitions for old copies without a self-contained scenario recipe.
// New teaching presets live in scenarios.js; versions 1 and 2 keep zero maneuver penalties.
export const historicalScenarios = [
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
    events: [
      {
        t: 1200,
        type: 'hold',
        bus: 0,
        value: 60,
      },
    ],
  },
  {
    id: 'variance',
    name: 'Random demand → bunching',
    description:
      'Poisson arrivals and varied ride lengths gradually disturb the spacing, without any imposed delay. Seed 42 reproduces the run.',
    config: {
      arrival: 'poisson',
      rideMode: 'random',
    },
    events: [],
  },
  {
    id: 'holds',
    name: 'Recover with bus holds',
    description:
      '12 stops, 4 evenly spaced buses and fixed passenger arrivals. At minute 20, Bus 1 receives a 60-second hold. From minute 25 through 60, dispatch checks every 30 seconds and holds buses at service stops when their forward gap is below 95% of the ideal 3 stops. Holds are proportional to the deficit and capped at 120 seconds. Watch queue waits and onboard delay as spacing recovers.',
    config: {},
    events: [
      {
        t: 1200,
        type: 'hold',
        bus: 0,
        value: 60,
      },
    ],
    policy: 'hold',
  },
  {
    id: 'express',
    name: 'Recover with temporary express',
    description:
      '12 stops, 4 evenly spaced buses and fixed passenger arrivals. At minute 20, Bus 1 receives a 60-second hold. From minute 25 through 60, dispatch activates alternating express when a bus has more than 3.75 stops of forward gap. It serves one stop, skips the next, and rechecks at each stop until its gap is 3 stops or less. Only riders bound for the next planned skipped stop transfer. Compare spacing, transfers and total passenger time.',
    config: {},
    events: [
      {
        t: 1200,
        type: 'hold',
        bus: 0,
        value: 60,
      },
    ],
    policy: 'express',
  },
  {
    id: 'express-count',
    name: 'Compare · fixed-count express',
    description:
      '12 stops, 4 evenly spaced buses and fixed arrivals. Bus 1 is held 60 seconds at minute 20. From minute 25 through 60, dispatch checks every 30 seconds. At a service stop, a bus with more than 3.75 stops of forward gap skips ceil(gap − 3) stops, then resumes service. This is a fixed-count heuristic: skipping avoids dwell, not segment travel, so the gap need not recover to 3. Compare with alternating express.',
    config: {},
    events: [
      {
        t: 1200,
        type: 'hold',
        bus: 0,
        value: 60,
      },
    ],
    policy: 'express-count',
  },
  {
    id: 'two-gap-holds',
    name: 'Two gaps → selective holds',
    description:
      '12 stops, 4 buses, fixed arrivals and seed 42. At minute 20, hold Bus 1 for 60 seconds. From minute 25 through 60, check every 15 seconds. Hold a bus at a service stop for 30 seconds only when its gap ahead is below 90% of the ideal gap and its gap behind exceeds 110%. Both conditions must hold. Compare passenger time accrued, unfinished trips and spacing with One delay → bunching.',
    config: {},
    events: [
      {
        t: 1200,
        type: 'hold',
        bus: 0,
        value: 60,
      },
    ],
    policy: 'two-gap',
    policySchedule: {
      start: 1500,
      end: 3600,
      interval: 15,
    },
    policyOptions: {
      ahead: 'small',
      behind: 'large',
      small: 0.9,
      large: 1.1,
      response: {
        type: 'hold',
        value: 30,
      },
    },
  },
  {
    id: 'dropoff',
    name: 'Recover with drop-off-only service',
    description:
      '12 stops, 4 buses, fixed arrivals and seed 42. Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 15 seconds. A bus at a stop with more than 110% of the ideal gap ahead and less than 90% behind admits no new riders for 3 stop locations, with a 600-second safety cap. Every onboard rider keeps their drop-off. Watch passed-over passengers, current queue waits and total passenger time; at least one unrestricted bus remains.',
    config: {},
    events: [
      {
        t: 1200,
        type: 'hold',
        bus: 0,
        value: 60,
      },
    ],
    policy: 'two-gap',
    policySchedule: {
      start: 1500,
      end: 3600,
      interval: 15,
    },
    policyOptions: {
      ahead: 'large',
      behind: 'small',
      small: 0.9,
      large: 1.1,
      response: {
        type: 'dropoff',
        value: {
          stops: 3,
          untilRecovered: false,
          maxSeconds: 600,
        },
      },
    },
  },
  {
    id: 'announced-express',
    name: 'Announce → serve every third stop',
    description:
      '12 stops, 4 buses, fixed arrivals and seed 42. Hold Bus 1 for 60 seconds at minute 20. At minute 25, it announces a pattern at its current or next service stop: serve the next 6 stop locations, then skip two and serve one for 12 locations, with an 1800-second cap. Boarding immediately respects the future pattern; all accepted drop-offs are honored as exceptions. Compare passed-over riders and passenger time with immediate express; this is a demonstration, not an optimized policy.',
    config: {},
    events: [
      {
        t: 1200,
        type: 'hold',
        bus: 0,
        value: 60,
      },
      {
        t: 1500,
        type: 'pattern',
        bus: 0,
        value: {
          leadStops: 6,
          every: 3,
          stops: 12,
          untilRecovered: false,
          maxSeconds: 1800,
        },
      },
    ],
  },
];
