import { scenarios } from './scenarios.js?v=20261015g';
export const builtInScenarioIds = scenarios.map((s) => s.id);
export function scenarioFromSearch(search) {
  const id = new URLSearchParams(search).get('scenario');
  const scenario = scenarios.find((s) => s.id === id && builtInScenarioIds.includes(id));
  return {
    id: scenario?.aliasFor ?? scenario?.id ?? 'balanced-corrected',
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
