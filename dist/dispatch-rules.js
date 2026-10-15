import { normalizeServiceAction } from './service-plan.js?v=20261015c';

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error(`${label} must be an object.`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw Error(`Unknown ${label} field: ${key}.`);
  for (const key of allowed)
    if (!Object.hasOwn(value, key)) throw Error(`Missing ${label} field: ${key}.`);
}

// Keep direct presets, shared-window copies, imports and the dispatch form on
// the same contract. Ratios are relative to the ideal spatial gap, stops / buses.
export function normalizeGapPolicy(options, config) {
  exactKeys(options, ['ahead', 'behind', 'small', 'large', 'response'], 'two-gap policy');
  for (const direction of ['ahead', 'behind'])
    if (!['small', 'large', 'any'].includes(options[direction]))
      throw Error(`Gap ${direction} must be small, large, or any.`);
  if (options.ahead === 'any' && options.behind === 'any')
    throw Error('A two-gap policy must test at least one gap.');
  if (!Number.isFinite(options.small) || options.small <= 0 || options.small > 1)
    throw Error('Small-gap ratio must be greater than 0 and at most 1.');
  if (!Number.isFinite(options.large) || options.large < 1 || options.large > 10)
    throw Error('Large-gap ratio must be from 1 to 10.');
  if (options.small >= options.large)
    throw Error('Small-gap ratio must be less than large-gap ratio.');
  exactKeys(options.response, ['type', 'value'], 'two-gap response');
  const { type, value } = options.response;
  let normalized;
  if (type === 'hold') {
    if (!Number.isFinite(value) || value <= 0 || value > 3600)
      throw Error('Hold seconds must be greater than 0 and at most 3,600.');
    normalized = value;
  } else if (type === 'dropoff' || type === 'pattern') {
    normalized = normalizeServiceAction(type, value, config);
  } else {
    throw Error('Two-gap response must be hold, dropoff, or pattern.');
  }
  return {
    ahead: options.ahead,
    behind: options.behind,
    small: options.small,
    large: options.large,
    response: { type, value: normalized },
  };
}
