import { MAX_SIMULATION_SECONDS } from './engine.js?v=20261015a';

// Leave time for rendering and input between bursts. One simulated second per
// chunk also limits how much event work happens before checking the clock again.
export function advanceMaxSpeed(experiment, now = () => performance.now()) {
  const deadline = now() + 8;
  // The count guard still yields if a browser supplies a coarse clock.
  for (let chunks = 0; chunks < 1000; chunks++) {
    const remaining = MAX_SIMULATION_SECONDS - experiment.sim.time;
    if (remaining <= 0) return true;
    experiment.advanceTo(experiment.sim.time + Math.min(1, remaining));
    if (now() >= deadline) break;
  }
  return experiment.sim.time >= MAX_SIMULATION_SECONDS;
}
