// Compatibility boundary. Historical scenarios deliberately keep their numerical
// gap, recovery, polling and express behavior; new scenarios opt into ordered-v3.
import { Simulation as LegacySimulation } from './legacy-engine.js?v=20261015c';
import { CorrectedSimulation } from './corrected-engine.js?v=20261015c';
import { normalizeModelOptions } from './model-options.js?v=20261015c';
export {
  MAX_SIMULATION_SECONDS,
  MAX_COMBINED_DELAY,
  MAX_PASSENGERS,
  MAX_STOP_VISITS,
} from './legacy-engine.js?v=20261015c';
export { LegacySimulation, CorrectedSimulation };
export class Simulation {
  constructor(config = {}) {
    const options = normalizeModelOptions(config);
    return options.semantics === 'ordered-v3'
      ? new CorrectedSimulation(config)
      : new LegacySimulation(config);
  }
}
