// Teaching presets share explicit maneuver penalties.
// Imported lessons declare their physical assumptions.
const base = {
  stops: 12,
  buses: 4,
  travel: 40,
  rate: 3,
  arrival: 'fixed',
  board: 2,
  debark: 1,
  ride: 4,
  rideMode: 'fixed',
  seed: 42,
  stoppingDelay: 5,
  startingDelay: 5,
};
const random = { ...base, arrival: 'poisson', rideMode: 'random' };
const delay = () => [{ t: 1200, type: 'hold', bus: 0, value: 60 }];
const pollingWindow = { start: 1500, end: 3600, interval: 5 };
const late = { ahead: 'large', behind: 'small', small: 0.9, large: 1.1 };
const common =
  '12 stops, 4 buses, 40-second segments, fixed arrivals at 3 passengers per stop per minute, four-stop rides, and 5-second stopping and starting delays. ';

export const scenarios = [
  {
    id: 'balanced-corrected',
    name: 'Balanced · fixed arrivals',
    description:
      common +
      'Buses begin evenly spaced; no disruption or automatic control. Run this baseline, then add a hold or load a disruption lesson. The maneuver penalties are paid at served stops, including empty ones; true bypasses avoid both.',
    config: { ...base },
    events: [],
  },
  {
    id: 'delay',
    name: 'One delay → bunching',
    description:
      common +
      'At minute 20, Bus 1 receives a 60-second hold at its current or next stop. No recovery is programmed. The delay is small at first; watch it compound through minutes 40–60 as the delayed bus meets larger queues and its follower catches up.',
    config: { ...base },
    events: delay(),
  },
  {
    id: 'variance',
    name: 'Random demand → bunching',
    description:
      '12 stops, 4 buses, 40-second segments, 5-second stopping and starting delays, Poisson arrivals averaging 3 passengers per stop per minute, and varied rides around four stops. Seed 42 reproduces the random demand. No imposed delay or recovery: watch the gaps grow over several laps, particularly minutes 20–60.',
    config: { ...random },
    events: [],
  },
  {
    id: 'holds',
    name: 'Recover with coordinated holds',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. At minute 25, give each of Buses 2, 3 and 4 a 60-second hold at its current or next stop. These are four timed instructions, with no automatic policy. Compare minutes 30–60 with One delay → bunching: delaying the other buses can reduce later passenger delay. This script is tuned to the fixed setup; it is not a general dispatcher and does not guarantee permanent spacing.',
    config: { ...base },
    events: [...delay(), ...[1, 2, 3].map((bus) => ({ t: 1500, type: 'hold', bus, value: 60 }))],
  },
  {
    id: 'express',
    name: 'Alternating express · partial recovery',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 30 seconds. At service stops, buses with more than 3.75 stops ahead may alternate skipping and serving until the forward gap is at most 3.3 stops, with a 600-second cap. Accepted drop-offs remain served; one unrestricted bus remains. This gives partial correction in the default run, not a complete cure. Compare actual bypasses, passed-over riders and passenger time with One delay → bunching.',
    config: { ...base },
    events: delay(),
    policy: 'express',
    policySchedule: { start: 1500, end: 3600, interval: 30 },
  },
  {
    id: 'express-count',
    name: 'Compare · fixed-count express',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 30 seconds. A bus at a service stop with more than 3.75 stops ahead skips ceil(gap − 3) locations, limited to 1–11, then resumes normal service. Accepted drop-offs override skips and one bus stays unrestricted. A bypass saves service plus the 5+5-second maneuver penalties, but not road travel. This count heuristic only partially corrects spacing; compare with alternating and short announced skips.',
    config: { ...base },
    events: delay(),
    policy: 'express-count',
    policySchedule: { start: 1500, end: 3600, interval: 30 },
  },
  {
    id: 'two-gap-holds',
    name: 'Two-gap holds · limited correction',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 15 seconds. A bus at a stop may receive a 30-second automatic hold only when the gap ahead is below 2.7 stops and the gap behind exceeds 3.3. Corrected polling also enforces a 90-second per-bus budget, two intervening visits and a free convoy leader. These limited holds do not fully recover the default run. Compare their passenger cost and residual bunching with coordinated holds.',
    config: { ...base },
    events: delay(),
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
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 5 seconds. At a service stop, a bus with more than 3.3 stops ahead and less than 2.7 behind admits no new riders for one stop location, with a 900-second safety cap. The condition is checked again on later visits, so a further one-stop correction can be assigned if needed. Every accepted drop-off is served and at least one bus remains unrestricted. Watch improved spacing alongside the riders passed over; compare One delay → bunching and Too much drop-off-only.',
    config: { ...base },
    events: delay(),
    policy: 'two-gap',
    policySchedule: { ...pollingWindow },
    policyOptions: {
      ...late,
      response: { type: 'dropoff', value: { stops: 1, untilRecovered: false, maxSeconds: 900 } },
    },
  },
  {
    id: 'announced-express',
    name: 'Announced skips · six-stop lead-in',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. At minute 25, Bus 1 announces six normally served future locations, followed by 12 locations serving every third stop, with an 1800-second cap from announcement. Boarding immediately respects the future pattern and all accepted drop-offs remain protected. The long lead-in really does bypass stops, but it starts too late to recover the default run and increases passenger time. Use this as a tradeoff lesson, then compare Recover with short announced skips.',
    config: { ...base },
    events: [
      ...delay(),
      {
        t: 1500,
        type: 'pattern',
        bus: 0,
        value: { leadStops: 6, every: 3, stops: 12, untilRecovered: false, maxSeconds: 1800 },
      },
    ],
  },
  {
    id: 'temporal-recovery',
    name: 'Event holds · short-trip correction',
    description:
      '12 stops, 4 buses, fixed arrivals at 3 passengers per stop per minute, one-stop rides, 40-second segments, and 5-second stopping and starting delays. Hold Bus 1 for 60 seconds at minute 20. From minute 21 to 60, stop events may trigger holds: 60 seconds per action/visit, 900 per bus, no visit cooldown, benefit factor 1 and a 600-second eligible-follower horizon. Short rides reduce onboard hold costs. This improves the fixed run without fully equalizing it. Arrivals end at minute 60; drain and compare with a copy whose recovery policy is null, keeping the one-stop rides.',
    config: { ...base, ride: 1, arrivalCutoff: 3600, cohortStart: 1200 },
    events: delay(),
    policy: 'temporal',
    policySchedule: { start: 1260, end: 3600 },
    policyOptions: {
      maxHold: 60,
      maxVisitHold: 60,
      repeatBudget: 900,
      cooldownStops: 0,
      benefitFactor: 1,
      maxFollowerEta: 600,
    },
  },
  {
    id: 'temporal-boarding',
    name: 'Event control · bounded boarding',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 21 to 60, stop events may limit a late bus to five new boardings per visit for at most six locations, with a 600-second cap and a destination-eligible follower within 600 seconds. Recovery, two repeated policy denials or a 600-second service-gap safeguard can restore boarding earlier. Accepted drop-offs remain served. Arrivals end at minute 60; drain before comparing with an otherwise identical uncontrolled copy. This is a useful partial recovery, not a guarantee for random demand.',
    config: { ...base, arrivalCutoff: 3600, cohortStart: 1200 },
    events: delay(),
    policy: 'temporal',
    policySchedule: { start: 1260, end: 3600 },
    policyOptions: { response: 'boarding', restrictionStops: 6, maxFollowerEta: 600 },
  },
  {
    id: 'temporal-pattern',
    name: 'Event skips · protected drop-offs',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 21 to 60, an eligible late bus may announce two lead-in locations then alternating service for at most six locations, capped at 600 seconds. A plausible destination-eligible follower must be within 600 seconds. Recovery and denial/service-gap safeguards can cancel the plan, often before its first bypass; accepted drop-offs always remain protected. Default-run recovery is partial and actual skips are few. Arrivals end at minute 60; drain and inspect decisions as well as passenger time.',
    config: { ...base, arrivalCutoff: 3600, cohortStart: 1200 },
    events: delay(),
    policy: 'temporal',
    policySchedule: { start: 1260, end: 3600 },
    policyOptions: { response: 'pattern', restrictionStops: 6, maxFollowerEta: 600 },
  },
  {
    id: 'physical-assumptions',
    name: 'Explore · seats, stop overhead and road order',
    description:
      '12 stops, 4 buses, 40-second segments, seed 42, random arrivals and rides, 5-second stopping and starting delays, 30 seats, an additional 8 seconds of fixed stop overhead, and no overtaking on roads. Multiple buses may serve one stop. Hold Bus 1 for 60 seconds at minute 20; no automatic control. Arrivals end at minute 60. Even-looking gaps can hide long capacity waits: inspect pass-overs, unfinished riders and drained whole-journey times. Change one physical assumption at a time; values are illustrative, not calibrated.',
    config: {
      ...random,
      capacity: 30,
      stopOverhead: 8,
      overtaking: false,
      arrivalCutoff: 3600,
      cohortStart: 1200,
      provenance:
        'Illustrative 30-seat, 8-second overhead and 5+5-second maneuver teaching example; not empirically calibrated.',
    },
    events: delay(),
  },
  {
    id: 'short-announced-skips',
    name: 'Recover with short announced skips',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 5 seconds. A bus at a stop with more than 3.3 stops ahead and less than 2.7 behind announces one lead-in location, then two pattern locations: skip one and serve one, capped at 900 seconds. The bounded pattern may be assigned again on a later visit. Accepted drop-offs override skips; at least one bus stays unrestricted. Actual bypasses occur in the default run and both spacing and passenger time improve relative to One delay → bunching. Compare with the long six-stop lead-in.',
    config: { ...base },
    events: delay(),
    policy: 'two-gap',
    policySchedule: { ...pollingWindow },
    policyOptions: {
      ...late,
      response: {
        type: 'pattern',
        value: { leadStops: 1, every: 2, stops: 2, untilRecovered: false, maxSeconds: 900 },
      },
    },
  },
  {
    id: 'dropoff-overcorrection',
    name: 'Too much drop-off-only → longer trips',
    description:
      common +
      'Hold Bus 1 for 60 seconds at minute 20. From minute 25 through 60, check every 5 seconds for a gap above 3.3 stops ahead and below 2.7 behind. Restrict qualifying buses to drop-offs for six locations, with a 900-second cap and no early recovery exit; keep one unrestricted bus. Spacing looks better than the uncontrolled delay, but many riders are passed over and total journey time rises in this fixed lesson. Compare Recover with drop-off-only service, which uses just one location per correction and rechecks the gaps before another.',
    config: { ...base },
    events: delay(),
    policy: 'two-gap',
    policySchedule: { ...pollingWindow },
    policyOptions: {
      ...late,
      response: { type: 'dropoff', value: { stops: 6, untilRecovered: false, maxSeconds: 900 } },
    },
  },
  {
    id: 'guarded-holds',
    name: 'Safeguards · when holds are declined',
    description:
      '12 stops, 4 buses, 40-second segments, Poisson arrivals averaging 3 per stop per minute, varied four-stop rides, seed 42 and 5-second stopping and starting delays. Hold Bus 1 for 60 seconds at minute 20. From minute 25 to 60, the event controller considers holds capped at 30 seconds per action, 45 per visit and 90 per bus, with two visits of cooldown and a 300-second follower horizon. In this seed it declines automatic holds: service often absorbs them or estimated passenger benefit is insufficient. This is a safeguard/failure-to-recover lesson, not a cure. Arrivals end at minute 60; inspect the decision log and unfinished passengers, then drain.',
    config: { ...random, arrivalCutoff: 3600, cohortStart: 1200 },
    events: delay(),
    policy: 'temporal',
    policySchedule: { start: 1500, end: 3600 },
    policyOptions: {},
  },
];

// Keep old public URLs usable without cluttering the picker with duplicates.
for (const [id, target] of [
  ['balanced', 'balanced-corrected'],
  ['corrected-variance', 'variance'],
]) {
  scenarios.push({
    ...structuredClone(scenarios.find((s) => s.id === target)),
    id,
    aliasFor: target,
  });
}
