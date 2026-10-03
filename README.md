# Bus Bunching Lab

A dependency-free browser simulation with an event-driven passenger-level model.

Run `npm start` in this directory, then open http://127.0.0.1:8080. Run `npm test` for model tests. The deployable static files are in `dist/`.

## Demonstrating bunching

Use the fixed-arrival example. Advance 20 simulated minutes (or run at 120×). The buses remain evenly spaced. Hold Bus 1 for 60 seconds, then run another 30 minutes. The delay compounds as boarding demand shifts toward the delayed bus.

Use the dispatch desk to hold a trailing bus or send a delayed bus temporary express. Interventions can be repeated across buses and stops. Reset with the same setup and seed to compare interventions. Export CSV records before resetting if you want to retain a run.

## Model

All buses begin evenly spaced along a clockwise loop, in motion, with no passengers. Stops have unlimited FIFO queues and buses have unlimited capacity. Buses may pass one another. A segment takes the configured travel time, except when manually slowed. Stop service is sequential: debark, then board, with arrivals continuing throughout. A hold sets the earliest departure time; boarding may continue past that time if a queue remains.

Fixed arrivals occur at regular synchronized intervals at each stop. Poisson arrivals use independent exponential intervals. Random ride lengths are uniform integers from 1 to min(2 × configured length − 1, stops − 1); clipping near a full loop reduces the actual mean. Seeded random draws make runs reproducible.

Temporary express begins after servicing the current stop, or the next stop if the bus is moving. Riders destined for skipped stops debark there and enter its queue with their original arrival and accumulated wait preserved. The express bus does not board riders destined for skipped stops. Skipped stops have no dwell observation.

## Statistics

- Bus dwell: arrival-to-departure time for each served stop, including holds.
- Bus queue wait: cumulative time in stop queues per passenger, sampled at each boarding. Transfers therefore produce another observation for that rider.
- System time: original arrival to final debark, sampled once per completed passenger; includes boarding, riding, holds, and transfer waits.
- Mean wait and system time cards include completed passengers only. Counts of unfinished passengers are always shown.
- Trailing averages use the last N observations. Graphs display the last 60 simulation minutes. CSV retains all observations from the current run.
- Headway variation is the coefficient of variation of spatial gaps, not a passenger metric. Zero means even spacing.

## Reviewing and comparing experiments

The −1 minute button and review timeline restore the entire earlier simulation state, including queues, riders, random draws, scheduled dispatch and observations. Replay is deterministic. Adding an intervention after rewinding branches the experiment: later manual commands are discarded, while preset dispatch stays scheduled. Reset or reload clears the run.

“New window with this state” opens an independent paused copy with the same model state, observation history, seed, preset schedule and manual-command history. Playback speed and trailing-window size are copied too. The browser may open a tab instead of a separate window. Arrange the copies side by side to compare interventions. Browser local storage carries a one-time copy token; it is removed once the new window restores it. Allow pop-ups if the browser blocks the copy.

## Preset experiments

1. Balanced fixed arrivals: the baseline with no interventions.
2. One delay: a 60-second hold on Bus 1 at minute 20.
3. Random demand: Poisson arrivals, random rides and seed 42, with no imposed delay.
4. Recovery through holds: the same minute-20 delay, followed by automatic dispatch every 30 seconds from minute 25 through minute 60. At service stops, buses with forward gaps below 95% of ideal receive holds proportional to the gap deficit, capped at 120 seconds.
5. Recovery through alternating express: a 60-second hold on Bus 1 at minute 20; checks every 30 seconds from minute 25 through minute 60 activate recovery when a forward gap exceeds 125% of ideal. Serve one stop and skip the next until the gap is at or below ideal, checking at every arrival. Only destinations at the next planned skipped stop require transfer. Active recovery can continue beyond minute 60 until its target is reached.
6. Fixed-count express comparison: the same explicitly scheduled minute-20 hold and minute-25-to-60 dispatch checks, using ceil(forward gap − ideal gap) skipped stops. This heuristic does not guarantee the gap returns to ideal, because skipping saves dwell but not segment travel time.

These are illustrative dispatch rules, not optimized policies. At minute 60 with the default setup, the delay-only run has spatial headway variation of 173%, the hold run about 6%, alternating express 29%, and fixed-count express 28%. Alternating express produces 132 transfers versus 154 for fixed-count express, but has higher completed-passenger mean system time (398 versus 390 seconds). Compare passenger outcomes as well as spacing.

## Chart readouts, averages and layout

Every graph shows its low and high individual values from the last simulated minute and its current trailing-average value, observation count and update time. No observations in that minute displays a dash; the trailing average stays at its last published value.

Dwell axes share one range across all buses; wait axes share another. Auto ranges use the entire run's extremes, so they do not shrink merely because a peak leaves the visible window. Fixed axis ceilings can be set identically across windows, and copy along with the experiment. Observations above a fixed ceiling are clipped visually but remain in statistics and CSV.

Whole-stop mode publishes averages only when a bus departs the stop. It includes complete groups until at least the configured number of passenger observations is covered, avoiding partial-group ordering artifacts. Dwell uses served-stop observations. Each-passenger mode preserves the original exact-N trailing average. Raw passenger values and service order never change.

System time and the mean system time card both include initial queue wait: they measure final debarking time minus first arrival time, including boarding, riding, onboard holds and transfer queues. The mean card includes all completed passengers immediately; only the chart's whole-stop average waits for group departure.

Click the small ↕ indicator to reveal Show first, Move up and Move down to reorder the route, summary, chart controls, system chart, bus charts, dispatch history and definitions within the page. Layout changes are local to the open page.

Browser memory retains the current run. CSV exports preserve its observations outside the browser.

## Sharing educator scenarios

Export scenario opens editable, formatted JSON text for copying. It captures the active scenario definition, the applied route setup and seed, all preset events (including future events), and all manual commands retained in the run history. The exported experiment starts at time zero, rather than saving current passengers or charts. Import scenario validates pasted text and saves a custom preset in browser local storage without replacing the current run. Select Load scenario & reset to run it. Keep exported text for cross-browser sharing and backup; local storage can be cleared by the browser.

Version 1 uses explicit setup units, one-based bus numbers, and `at_seconds` from time zero. `hold` uses `seconds`, `slow` uses `multiplier`, and `express` uses `stops`. Same-time interventions run in listed order. A recovery policy specifies a versioned rule, start/end seconds and check interval. The exported notes and rule explanation document the exact behavior; versioned rule identifiers determine execution. The in-page format reference explains all three recovery rules and their thresholds. Unknown fields, invalid values, unsupported versions and rules are rejected. Imports allow up to 1,000 interventions, 100 saved presets, and a seven-day schedule.

Dotted statistical labels and control text provide explanations on hover, keyboard focus or tap. Escape or clicking elsewhere dismisses an explanation. Metric labels and chart readouts remain stable during playback so keyboard focus and explanations are not lost when values update.
New visitors start with Random demand → bunching (Poisson arrivals and random ride lengths, seed 42). The Scenario Library defaults to the bottom, after statistics and definitions, and remains movable. Both the brand name and main title expand the introductory explanation; links jump to the library.
On mobile (700px or narrower), Live route, Route setup and Dispatch desk each have an independent compact movement control and can move anywhere among the page sections. Desktop groups these three panels again; the simulation is preserved across screen-size changes. Built-in links use ?scenario=balanced, delay, variance, holds, express, or express-count. They load the original preset paused at time zero. Copy scenario link shares the selected built-in preset; custom presets and edited runs use text export. Unknown scenario names show a notice and use the stochastic default. A copied current-state window takes precedence over the URL preset.
