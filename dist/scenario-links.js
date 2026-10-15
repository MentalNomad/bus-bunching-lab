export const builtInScenarioIds = [
  'balanced',
  'delay',
  'variance',
  'holds',
  'express',
  'express-count',
  'two-gap-holds',
  'dropoff',
  'announced-express',
];
export function scenarioFromSearch(search) {
  const id = new URLSearchParams(search).get('scenario');
  return {
    id: builtInScenarioIds.includes(id) ? id : 'variance',
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
