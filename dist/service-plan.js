// Shared validation for manual dispatch, scenario import and scheduled policies.
// Values are copied so an imported or edited object cannot mutate a running plan.
export const MAX_SERVICE_LOCATIONS = 400;
export const MAX_SERVICE_SECONDS = 604800;

export function normalizeServiceAction(type, value, config) {
  if (type === 'normal') {
    if (value !== 1) throw Error('Normal service takes the value 1.');
    return 1;
  }
  if (!['dropoff', 'pattern', 'boarding'].includes(type)) throw Error('Unknown service action.');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Service instructions must be an object.');
  const fields = ['stops', 'untilRecovered', 'maxSeconds'];
  if (type === 'pattern') fields.push('leadStops', 'every');
  if (type === 'boarding') fields.push('passengers');
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw Error('Unknown service instruction field.');
  if (fields.some((key) => !Object.hasOwn(value, key)))
    throw Error('Service instructions are missing a required field.');
  if (
    value.stops !== null &&
    (!Number.isInteger(value.stops) || value.stops < 1 || value.stops > MAX_SERVICE_LOCATIONS)
  )
    throw Error(
      `Service span must be 1–${MAX_SERVICE_LOCATIONS} stop locations, or null for ongoing service.`,
    );
  if (typeof value.untilRecovered !== 'boolean')
    throw Error('untilRecovered must be true or false.');
  if (
    !Number.isFinite(value.maxSeconds) ||
    value.maxSeconds < 1 ||
    value.maxSeconds > MAX_SERVICE_SECONDS
  )
    throw Error('Service time limit must be 1–604,800 seconds.');
  if (type === 'pattern') {
    if (
      !Number.isInteger(value.leadStops) ||
      value.leadStops < 0 ||
      value.leadStops >= config.stops
    )
      throw Error('Lead-in must be 0 to the route stop count minus 1.');
    if (!Number.isInteger(value.every) || value.every < 2 || value.every > config.stops)
      throw Error('Pattern must serve every 2nd through route-count stop.');
  }
  if (
    type === 'boarding' &&
    (!Number.isInteger(value.passengers) || value.passengers < 0 || value.passengers > 500)
  )
    throw Error('Boarding allowance must be 0–500 new passengers per visit.');
  return Object.fromEntries(fields.map((key) => [key, value[key]]));
}
