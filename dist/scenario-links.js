export const builtInScenarioIds = [
  'balanced-corrected',
  'balanced',
  'delay',
  'variance',
  'holds',
  'express',
  'express-count',
  'two-gap-holds',
  'dropoff',
  'announced-express',
  'corrected-variance',
  'temporal-recovery',
  'temporal-boarding',
  'temporal-pattern',
  'physical-assumptions',
];
export function scenarioFromSearch(search) {
  const id = new URLSearchParams(search).get('scenario');
  return {
    id: builtInScenarioIds.includes(id) ? id : 'balanced-corrected',
    invalid: id !== null && !builtInScenarioIds.includes(id),
  };
}
export function scenarioUrl(base, id) {
  if (!builtInScenarioIds.includes(id))
    throw Error('Only built-in scenarios can be shared by URL. Export custom scenarios as text.');
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('scenario', id);
  return url.href;
}
