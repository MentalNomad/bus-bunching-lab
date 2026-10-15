import { MAX_SIMULATION_SECONDS } from './engine.js?v=20261015c';

// Leave time for rendering and input between bursts. One simulated second per
// chunk also limits how much event work happens before checking the clock again.
export function advanceMaxSpeed(experiment, now = () => performance.now()) {
  return advanceBounded(experiment, MAX_SIMULATION_SECONDS, now);
}

// Fixed multipliers retain their chosen time target and yield under heavy load.
// There is no accumulated backlog to cause a jump after a pause or speed change.
export function advanceTimedSpeed(experiment, seconds, now = () => performance.now()) {
  if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid playback interval.');
  return advanceBounded(
    experiment,
    Math.min(MAX_SIMULATION_SECONDS, experiment.sim.time + seconds),
    now,
  );
}

function advanceBounded(experiment, target, now) {
  const deadline = now() + 8;
  // The count guard still yields if a browser supplies a coarse clock.
  for (let chunks = 0; chunks < 1000; chunks++) {
    const remaining = target - experiment.sim.time;
    if (remaining <= 0) break;
    experiment.advanceTo(experiment.sim.time + Math.min(1, remaining));
    if (now() >= deadline) break;
  }
  return experiment.sim.time >= MAX_SIMULATION_SECONDS;
}
