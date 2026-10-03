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
5. Recovery through express: the same delay and dispatch period. At service stops, buses with forward gaps above 125% of ideal skip a number of stops based on the gap excess. Affected riders transfer.

These are illustrative dispatch rules, not optimized policies. With the default setup at minute 60, the delay-only run has spatial headway variation of 173%; the hold run reduces it to approximately 6%, and the express run to 28%. The express run produces 154 transfers. Compare passenger outcomes as well as spacing: a better-spaced route can still impose riding time or transfers.

Browser memory retains the current run. CSV exports preserve its observations outside the browser.
