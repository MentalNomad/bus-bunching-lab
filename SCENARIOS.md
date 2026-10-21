# Built-in lesson review

Reviewed 21 October 2026. Every built-in teaching preset uses a **5-second stopping delay** and a **5-second starting delay**. All lessons and downloadable examples use one scenario language and one simulation model. The old `balanced` and `corrected-variance` URLs remain aliases for current lessons.

Run `npm run audit:scenarios` to reproduce the table, or `node tools/audit-scenarios.mjs --json` for samples, decisions, accounting checks and matched passenger-birth fingerprints. Regression tests cover the advertised successes **and counterexamples**.

## Comparison method

Each lesson is paired with its own uncontrolled copy, keeping its setup, seed and minute-20 disruption. Remove the recovery policy and later recovery actions. Both runs use a cohort boundary at minute 20, an inclusive arrival cutoff at minute 60, and up to four further hours to drain. Everyone already waiting or riding at the boundary belongs to the cohort, retaining their original whole-journey clock. Complete means include initial wait, boarding, travel, holds, later waits and final alighting. Every reported cohort finishes and passes passenger/time accounting checks.

Gap variation is the mean coefficient of variation of circular gaps sampled every 15 seconds during minutes 45–60, before drain. Actual bypasses are counted before cutoff; an announcement alone is not a bypass. Journey-time change is against the lesson's own matching uncontrolled run. Negative is better. Continuous lessons receive a minute-60 cutoff only in this audit.

These are illustrative default outcomes for seed 42, not an optimized policy or universal ranking. Fixed-demand seeds do not change a run. Different demand, rides, bus counts, intervention timing or random seeds can reverse results. Neither a single spacing snapshot nor completed-only passenger averages establish recovery.

| Lesson ID              | Ride length (stops) | Late gap variation | Journey mean, seconds | Matching uncontrolled mean, seconds | Change | Actual bypasses |
| ---------------------- | ------------------- | -----------------: | --------------------: | ----------------------------------: | -----: | --------------: |
| balanced-corrected     | 4 fixed             |              0.000 |                 462.7 |                               462.7 |   0.0% |               0 |
| delay                  | 4 fixed             |              0.987 |                 517.4 |                               517.4 |   0.0% |               0 |
| variance               | 1–7 random          |              1.235 |                 608.0 |                               608.0 |   0.0% |               0 |
| holds                  | 4 fixed             |              0.101 |                 468.6 |                               517.4 |  -9.4% |               0 |
| express                | 4 fixed             |              0.533 |                 509.1 |                               517.4 |  -1.6% |               6 |
| express-count          | 4 fixed             |              0.338 |                 492.3 |                               517.4 |  -4.8% |               2 |
| two-gap-holds          | 4 fixed             |              0.930 |                 512.7 |                               517.4 |  -0.9% |               0 |
| dropoff                | 4 fixed             |              0.060 |                 466.4 |                               517.4 |  -9.9% |               0 |
| announced-express      | 4 fixed             |              1.077 |                 552.5 |                               517.4 |   6.8% |               8 |
| temporal-recovery      | 1 fixed             |              0.573 |                 240.8 |                               288.8 | -16.6% |               0 |
| temporal-boarding      | 4 fixed             |              0.243 |                 475.7 |                               517.4 |  -8.1% |               0 |
| temporal-pattern       | 4 fixed             |              0.686 |                 491.1 |                               517.4 |  -5.1% |               1 |
| physical-assumptions   | 1–7 random          |              0.180 |                1605.7 |                              1605.7 |   0.0% |               0 |
| short-announced-skips  | 4 fixed             |              0.164 |                 471.4 |                               517.4 |  -8.9% |               2 |
| dropoff-overcorrection | 4 fixed             |              0.191 |                 727.0 |                               517.4 |  40.5% |               0 |
| guarded-holds          | 1–7 random          |              1.614 |                 644.5 |                               644.5 |   0.0% |               0 |

**Compare each result with its matching uncontrolled column.** The `temporal-recovery` lesson uses one-stop rides; most other fixed-demand lessons use four-stop rides. Its 240.8-second mean is a 16.6% improvement over its own 288.8-second baseline. Changing only its ride length to four stops gives 522.8 seconds with recovery versus 517.4 without (1.0% slower). These are different teaching conditions, so raw means across those rows do not measure policy superiority. Random ride lengths are uniformly drawn from 1–7 stops in the listed random lessons.

## What changed and why

- **Baseline, delay and random demand:** retain distinct causes of bunching with the new maneuver penalties. The minute-20 fixed delay compounds gradually; show several laps.
- **Coordinated holds:** the former bounded polling preset did not sustain its claimed recovery. The revised `holds` script gives Buses 2–4 a 60-second hold at minute 25 after Bus 1's minute-20 hold. It demonstrates reduced later passenger delay; it is not an adaptive dispatcher or a permanent cure.
- **Alternating and fixed-count express:** both actually bypass stops and provide partial correction. Accepted drop-offs remain protected, with no forced transfers. Descriptions no longer promise full recovery.
- **Two-gap holds:** retain the 30-second action cap, 90-second per-bus budget, cooldown and free convoy leader. Label it limited correction: these budgets do not erase this disturbance.
- **Drop-off-only:** check both gaps every five seconds and restrict one visit at a time. The former three-location restriction ran too long. The new six-location counterexample improves spacing while increasing passenger cost substantially.
- **Announced skips:** keep the requested six-stop lead-in as a tradeoff lesson, since it starts too late to cure this disturbance. The new short pattern announces one lead-in location followed by two active skip/serve locations. Later assignments require another two-gap check. Both lessons actually bypass stops.
- **Event holds:** use short fixed rides to make reduced onboard holding cost observable, with explicit 60-second action/visit caps and a 900-second per-bus budget. The new safeguard lesson preserves the former long random-ride setup as an explicit case where automatic holds are declined.
- **Event boarding and skips:** start at minute 21 on the fixed four-stop route, with six-location limits and destination-eligible following service. Corrections become observable; safeguards still restore service early, and actual event-controlled skips remain few.
- **Physical assumptions:** retain seats, overhead and road order exploration with the maneuver penalties added. Its fairly even spacing hides substantial capacity wait. Change one assumption at a time to identify causes.

The three new picker lessons are **Recover with short announced skips**, **Too much drop-off-only → longer trips**, and **Safeguards · when holds are declined**. Each addresses a distinct teaching question.

## Small sensitivity check

With every other setting fixed, arrivals of 2.7 and 3.3 passengers per stop per minute gave:

| Lesson                 | Mean journey change at 2.7/min | At 3.3/min | Late gap variation at 2.7 / 3.3 |
| ---------------------- | -----------------------------: | ---------: | ------------------------------: |
| Coordinated holds      |                          −7.2% |      −7.9% |                     0.73 / 0.11 |
| One-stop drop-off-only |                         −12.5% |      −6.5% |                     0.07 / 0.32 |
| Short announced skips  |                          −6.0% |      −5.3% |                     0.57 / 0.42 |

All compared cohorts finished. The passenger improvement persisted in these six checks, but the spacing effect changed substantially; the timed hold script is especially sensitive to its fixed-demand phase. Additional random seeds 7 and 1729 also drained completely in the random-demand, guarded-hold and physical-assumption lessons. The guarded-hold controller made no automatic holds with seed 7 but three with seed 1729, so its default-seed refusal is not a universal outcome. These twelve extra comparisons are a bounded sensitivity check, not an exhaustive search.

## Guide and compatibility

The [scenario guide](dist/scenario-guide.html) and all downloads use the same language, without version or model selectors. It distinguishes manual recovery flags from event-control early restoration, true bypasses from protected served stops, timed coordinated holds from automatic dispatch, and option defaults from preset overrides. Additional teaching variants use zero maneuver penalties to isolate service effects; these are explicit settings in the same format.

Built-in URLs identify the current lesson. Export complete scenario text to pin a particular recipe. Research packages outside this repository were not modified and are not evidence for this catalog.
