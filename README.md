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

Browser memory retains the current run. Reset or reload clears it; CSV is the retention mechanism.
