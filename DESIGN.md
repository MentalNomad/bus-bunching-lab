# Corrected controller and measurement contracts

The `ordered-v3` model repairs circular neighbor ordering and adds event control,
complete passenger comparisons, bounded boarding, and optional physical assumptions.
These are illustrative teaching rules, not calibrated transit forecasts or an optimal
dispatch policy. The frozen research package outside this repository is unchanged.

## Compatibility and ordering

`engine.js` is an explicit factory. A configuration with no `semantics` uses
`legacy-v2`; saved format 1/2 lessons retain their original minimum-distance gaps,
two-sided recovery checks, sampled dispatch, and express transfers. The legacy
adapter adds measurement ledgers and optional finite demand without changing old
numerical outcomes. New corrected presets and format 3 documents explicitly declare
`semantics: "ordered-v3"`. Converting creates a separate recipe; it does not alter
the saved original or claim that its outcomes should match. Current built-in
definitions live in `scenarios.js` and may evolve; export a complete recipe to
pin a version. `historical-scenarios.js` preserves pre-recipe copies whose
payload predates embedded scenario text. Current teaching presets all use
five-second stopping and starting delays. Import/engine defaults remain zero.

Corrected free-overtaking gaps sort a copy of displayed positions, then exact ties
by ascending bus ID. Each bus has one immediate successor and predecessor. The
last tied bus owns the long arc. There is exactly one circular wrap edge; each
direction's gaps sum to the route length. Four coincident buses on 12 stops have
forward gaps `[0, 0, 0, 12]`; a single bus has 12 in both directions. The ID-indexed
bus array is never sorted. No epsilon comparator or rendering history determines
the ordering. Under no overtaking, the serialized initial circular `roadOrder`
and unwrapped positions retain the physical leader when a queue meets across the
route seam; sorting tied displayed positions alone would lose that information.

All corrected manual `until_recovered` instructions end when the immediate
forward gap is at most 110% of `stops / buses`, or at expiry. With
`until_recovered: true`, the stop-span count is ignored; with false it bounds
the instruction instead of testing recovery.
A tail bus can finish recovery with a large rear gap. A convoy leader still owns
the long gap and does not falsely recover. Historical instructions retain their
declared legacy semantics.

## Event and temporal control

At a shared timestamp the corrected engine processes passenger arrivals, plan
expirations, bus arrivals and previously started door completions. Listed manual
commands then run, followed by one automatic decision batch from a common
snapshot. New door operations and departures run last in bus-ID order. Zero-time
doors finish safely at that timestamp without repeated automatic decisions.

`temporal-cost-v3` uses the control window `[start_seconds, end_seconds)`.
Demand at `arrival_cutoff_seconds` is included; later arrivals are canceled,
not simulated with a changed rate. The cutoff also ends new corrected automatic
control. At the end boundary, automatic holds and automatic restrictions restore
normal service. Manual holds and bounded manual service plans continue safely
until their own completion, cancellation or expiry. An alighting or boarding
already underway always completes. `decisionMode: "polling"` samples the same
new heuristic at `pollSeconds` for cadence comparisons; old sampled policies
remain separate versioned rules.

Temporal history records actual usable stop/destination opportunities: actual
boarding, or a departure that has a spare seat and permits that destination.
A full, drop-off-only or incompatible-pattern visit is not advertised as usable.
Observed service intervals are seconds between these recorded opportunities;
they are not spatial gaps multiplied by segment travel. Follower estimates use
current segment progress, known service/overhead, holds, announced plans and
known seat releases. Future arrivals and future boarding/dwell are unknown.
The estimates are conditional, and may be wrong under later congestion or demand.
Prediction consumes no demand random numbers and never reads future arrivals.
Without credible history/coverage the conservative fallback is normal service.
Holding candidates require a forward spatial gap below 95% of ideal and a
positive temporal deficit. Service-saving candidates require a forward gap above
110% of ideal and a rear gap below 90%. Automatic restrictions restore when the
forward gap reaches 105% of ideal, coverage fails, or the control window ends;
manual `until_recovered` retains its separate 110% rule. Equality does not satisfy
a strict start condition. Per-visit/time caps and normal-service cancellation
still apply.
The current predictor returns no eligible-follower estimate when overtaking is
disabled: a joint road-and-door forecast has not been implemented. Temporal
automatic policies therefore leave normal service in that optional model. Manual
interventions and the continuous no-overtaking physics still operate; comparisons
with that setting test physical behavior, not effective automatic recovery.

## Passenger-cost holding

The heuristic estimates known remaining service, newly boardable queued riders,
hold time absorbed by that work, additional onboard delay, illustrative queue-wait
savings, and impact on following service. It holds only when estimated savings
exceed `benefitFactor` times estimated direct/rear costs. A coincident group has
an ordered leader free of automatic holds and staggered follower requests.
This applies to partial groups too, even when the positive gap in front of that
group is smaller than ideal. If a previously held bus becomes a group front,
only its automatic hold is released; required doors and manual holds remain.
Corrected spatial polling holds use the same group-front protection while
retaining their separate polling formula. This is transparent cost screening,
not a full network optimization or a guarantee of benefit.
Predicted queue benefit, direct onboard cost and rear-service cost all use the
same additional hold beyond known required service. A fully absorbed request has
no predicted spacing benefit and is suppressed before spending budget or starting
cooldown. Requested deadline seconds remain separate from this marginal effect.
A suppressed arrival can be reconsidered at a later genuine completion/release
event in that visit. Only an accepted action spends the visit opportunity. Active
holds reassess the remaining marginal cost when load or service changes; losing
that justification releases only automatic time, without undoing a door operation,
a manual hold, or the already-recorded requested budget.

Per-action, cumulative per-visit and lifetime per-bus budgets are finite. A
cooldown counts successive completed visits; arriving at another stop does not
reset the lifetime budget. Reassessment can release only `autoHoldUntil`, leaving
manual `holdUntil` and current doors intact. Requested seconds and realized
extra dwell are separate: realized automatic dwell accrues after required work,
overhead and manual holding end. Blocked road travel is a separate cause.
Decision records preserve the gaps, observed history, conditional follower,
cost estimates and reasons for action, suppression, restoration or breach.

## Boarding, destinations and safeguards

`boarding_limit` permits a fixed count of new boarding starts per visit, including
later arrivals during that visit. An already-started boarding is excluded from a
newly issued allowance and completes. Counts reset on a new visit. FIFO is among
currently destination-eligible riders; ineligible riders remain in their queue
with their original birth clocks. `drop_off_only` permits no new boarding.
`announced_skip` immediately screens new destinations against an announced
lead-in and every-Kth-location pattern. Existing accepted destinations always
receive drop-offs, including exceptions at nominally skipped stops. A corrected
`express` command becomes a protected consecutive skip block; forced transfers
remain isolated in the legacy adapter.

Before an automatic restriction, and before actual pass-over, safeguards inspect
affected stops, destinations and waiting riders, including a plausible eligible
following bus, denial counts, current queue age and recorded eligible-service gaps.
Automatic restrictions are suppressed or safely restored when coverage fails.
One unrestricted bus somewhere on the loop is insufficient evidence. Repeated
denials persist on each passenger through plan changes. A denied opportunity is
counted once per passenger per actual bus visit, not once per decision tick.
Capacity and policy denials are separate. Manual restrictions are not silently
canceled; impossible coverage due to capacity/manual commands is recorded as a
breach. These are operational safeguards with conditional forecasts, not absolute
wait guarantees under overload or arbitrary manual instructions.

The exported `serviceGapBreaches` counter counts actual denied opportunities
where the passenger already exceeds the repeated-denial or queue-age bound.
Separately, `observedServiceGapBreaches` counts completed stop/destination service
intervals longer than `maxServiceGap`, once per interval. These observed gaps can
exceed the limit even with no policy active. Their log records current physical
and manual-instruction context without claiming it proves the cause. The longest
observed gap measures completed intervals; an ongoing gap is not a completed
interval. Prediction screening and breach reporting do not guarantee a maximum
wait under overload.

## Finite cohorts and accounting

Every birth records `(id, born, origin, dest)` in order, independently of policy.
Matched policy comparisons require the full ordered demand records to agree,
not merely equal seeds or passenger counts. A cohort includes everyone present
immediately before the common `cohort_start_seconds` boundary (including a trip
completing exactly there), plus all births through the inclusive common cutoff.
It includes riders already aboard and preserves their whole journey from the
original birth time. Choose the cohort boundary before the first treatment.

An observation states horizon, cohort/cutoff, created/completed/unfinished counts,
queue/onboard/total accrued passenger-seconds and completeness. Completed-only
averages remain explicitly labeled. Full-cohort mean, p95 and maximum are available
only after the cutoff is reached and every member finishes; they are null for
incomplete drain. `drain_max_seconds` bounds extra advance after cutoff. Resource
limits and unfinished counts must accompany incomplete results.

The engine independently integrates queue plus onboard population over every
clock interval. A boarding passenger is removed from the queue and counted aboard
from boarding start; an alighting passenger stays aboard until completion. Thus
`created = completed + queued + onboard`, and the integral agrees with completed
journey totals plus elapsed original-birth time of unfinished people. Queue time
ends at boarding start; onboard time includes boarding, travel, holds and alighting.
Numerical integral comparisons allow floating-point roundoff. Spatial regularity
is secondary to passenger costs and unfinished demand.

## Optional physical assumptions

Original format 3 model and observation fields are explicit. The optional stopping/starting fields default to zero when absent from older version 3 recipes. Optional physics require
`ordered-v3`. Defaults retain zero overhead, unlimited capacity and overtaking.

| JSON model/observation field | Default                     | Bounds and meaning                                                   |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `semantics`                  | Explicit in format 3        | `legacy-v2` or `ordered-v3`                                          |
| `stop_overhead_seconds`      | 0                           | 0–120 seconds, once per served visit, even empty                     |
| `stopping_delay_seconds`     | 0                           | 0–120 seconds lost entering each served stop, before overhead/doors  |
| `starting_delay_seconds`     | 0                           | 0–120 seconds added to the next segment after each served stop       |
| `bus_capacity`               | `null`                      | Unlimited, or integer 1–500 seats                                    |
| `allow_overtaking`           | `true`                      | Boolean; false constrains continuous road motion                     |
| `calibration_notes`          | Illustrative teaching model | Text, at most 1,000 characters; record evidence if calibrated        |
| `cohort_start_seconds`       | 0                           | 0 through cutoff, or through 604,800 with no cutoff                  |
| `arrival_cutoff_seconds`     | `null`                      | Continuous arrivals, or 0–604,800 seconds inclusive                  |
| `drain_max_seconds`          | 86,400                      | 1–604,800 seconds after cutoff, subject to the seven-day clock limit |

Stopping delay precedes overhead and sequential boarding/alighting; both can
be absorbed by an already ticking hold deadline. Starting delay is added after
all service and holds to the next segment duration. Motion on that segment stays
linear at its effective speed: these are lumped time penalties, not a physical
acceleration model. Initial buses already traveling pay no starting penalty.
Genuinely skipped stops pay neither maneuver penalty. Empty served stops and
protected drop-offs pay both. Raw model/import defaults are zero; built-in
lesson inputs start at five seconds each. Nonzero values
require ordered-v3, preserving historical recipes and the frozen research.

Overhead precedes sequential boarding/alighting and overlaps hold deadlines.
A protected drop-off or a manual stop hold makes a nominal skip a served visit. A fully skipped stop pays no
overhead but still traverses every road segment. Capacity reserves a seat when
boarding starts and releases it when alighting finishes; nobody is discarded or
boarded above capacity. No-overtaking uses anchored piecewise-linear trajectories
and contact events, constraining motion throughout segments, including slowdown
and route wrap. Blocked buses restart when leaders move. Multiple buses can serve
one stop simultaneously; this is not a single-berth model. Road order, anchors and
budgets are plain serialized replay data.

## Temporal option reference

The keys below are inside `recovery_policy.options`. Durations are seconds;
counts are integers where stated. Defaults are illustrative and were fixed
before the accompanying validation-seed comparisons.

| Key                     | Default  | Accepted values / purpose                                                  |
| ----------------------- | -------- | -------------------------------------------------------------------------- |
| `response`              | `hold`   | `hold`, `boarding`, `dropoff`, `pattern`                                   |
| `decisionMode`          | `events` | `events` or `polling`                                                      |
| `pollSeconds`           | 30       | 1–3,600; used only in polling mode                                         |
| `maxHold`               | 30       | 0–3,600 per action, at most `maxVisitHold`                                 |
| `maxVisitHold`          | 45       | 0–3,600 cumulative requested seconds at one visit                          |
| `repeatBudget`          | 90       | 0–86,400 requested seconds per bus over the run                            |
| `cooldownStops`         | 2        | Integer 0–400 completed visits between eligible holds                      |
| `benefitFactor`         | 1.2      | 1–100 multiplier on estimated direct and rear cost                         |
| `targetSeconds`         | 0        | 0–86,400; zero uses observed headway, or illustrative fluid fallback       |
| `maxFollowerEta`        | 300      | 1–86,400 maximum predicted following-service seconds                       |
| `maxDenials`            | 2        | Integer 0–100; suppress a restriction before exceeding this lifetime count |
| `maxServiceGap`         | 600      | 1–86,400 for eligible-service gap/current queue-wait screening             |
| `boardingPassengers`    | 5        | Integer 1–500 new riders per visit for automatic boarding response         |
| `restrictionStops`      | 3        | Integer 1–400 stop locations in an automatic restriction                   |
| `leadStops`             | 2        | Integer 0–route stops minus 1 before pattern activation                    |
| `serveEvery`            | 2        | Integer 2–route stop count; serve every Kth pattern location               |
| `restrictionMaxSeconds` | 600      | 1–604,800 from announcement to expiry                                      |

Manual `boarding_limit` additionally accepts zero new passengers. Manual service
spans can be `null` for ongoing bounded service, and `until_recovered` is boolean.
No option reads future demand. Change one physical assumption at a time when
isolating controller effects, and retain the provenance and exact exported recipe.

## Verification and study boundary

Focused tests cover legacy parity, circular invariants/ties/seam, forward-only
recovery, same-time manual ordering, zero doors, overhead, capacity reservation
and reuse, boarding allowances, continuous nonpassing/restart, inclusive demand
cutoff, full demand identity, accounting and rendering-chunk independence.
The controller tests cover cost suppression, bounded/staggered holding, cooldown,
manual preservation, missing history, destination/capacity coverage, safeguards,
expiry and polling/event cadence. New comparison artifacts belong outside the
frozen 15 October holding-versus-skipping package. The report must identify exact
source fingerprints, common cohorts, fresh seeds, uncertainty, incompleteness and
material regressions; structural repair does not imply universal welfare gains.

## Chart inspection and page defaults

Canvas charts retain their renderer. Pointer/tap inspection uses a cached,
incrementally built time/value index with binary lookups, including equal-time
passenger groups. The nearest actual observation is labeled with its own time;
the trailing-average value is the last published step at the pointer time.
No individual values are interpolated. Hidden/out-of-window dots are not borrowed.
Only the crosshair, selected-point marker and text overlay update for pointer
movement, at most once per animation frame; simulation state remains untouched.
Keyboard left/right, Home/End and Escape work on focused charts.

Initial navigation without a valid scenario selects balanced-corrected, named
Balanced · fixed arrivals, with five seconds for each maneuver. Old balanced
and corrected-variance URLs resolve to current canonical lessons without picker
duplicates; saved text/copies retain their own explicit settings. Dispatch history is third by default on both desktop
and mobile; moving a section prevents breakpoint changes from restoring defaults.
Playback adds 240×, 480×, 960× and uses bounded short bursts at every multiplier,
yielding under heavy load without accumulating a backlog after a pause.

The `Elapsed Time` chart readout is an inspection cursor, not a simulation
advance. `tools/audit-scenarios.mjs` checks complete matched passenger cohorts,
pre-drain spatial outcomes, actual bypasses and accounting for the refreshed
catalog. `SCENARIOS.md` records the lesson-specific evidence and its limits.
