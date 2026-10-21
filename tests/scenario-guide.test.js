import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { Experiment } from '../dist/experiment.js';
import { parseScenario, serializeScenario } from '../dist/scenario-format.js';
import { copyExample } from '../dist/scenario-guide.js';

const guideUrl = new URL('../dist/scenario-guide.html', import.meta.url);
const guide = await readFile(guideUrl, 'utf8');
const examples = [
  ...guide.matchAll(/<code\b[^>]*data-example-file="([^"]+)"[^>]*>([\s\S]*?)<\/code>/g),
];

test('each complete guide example matches its downloadable JSON and preserves replay outcomes', async () => {
  assert.equal(examples.length, 2);
  for (const [, path, visibleText] of examples) {
    const downloadedText = await readFile(new URL(path, guideUrl), 'utf8');
    assert.equal(
      visibleText,
      downloadedText,
      `${path}: displayed text and download must match exactly`,
    );
    const scenario = parseScenario(visibleText);
    const first = new Experiment(scenario.config, 'guide-example', scenario);
    const imported = parseScenario(serializeScenario(scenario, first.config));
    const replay = new Experiment(imported.config, 'guide-roundtrip', imported);
    first.advanceTo(3600);
    replay.advanceTo(3600);
    assert.deepEqual(replay.sim.summary(), first.sim.summary(), path);
    assert.deepEqual(replay.sim.completedPassengers, first.sim.completedPassengers, path);
    assert.equal(replay.sim.randomState, first.sim.randomState, path);
    assert(first.sim.completed > 0, `${path}: the lesson must finish passenger trips`);
    assert.equal(
      first.sim.created,
      first.sim.completed + first.sim.summary().waiting + first.sim.summary().onboard,
    );
    assert(
      !first.sim.log.some((entry) => entry.message.startsWith('Skipped ')),
      `${path}: all scheduled actions must be usable`,
    );
    first.seek(600);
    first.advanceTo(3600);
    assert.deepEqual(first.sim.summary(), replay.sim.summary(), `${path}: backstep and replay`);
  }
});

test('the timed lesson demonstrates all three actions and the recovery lesson isolates the shared delay', async () => {
  const timed = parseScenario(
    await readFile(new URL('../dist/examples/timed-actions.json', import.meta.url), 'utf8'),
  );
  const recovery = parseScenario(
    await readFile(new URL('../dist/examples/alternating-recovery.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(timed.events, [
    { t: 1200, bus: 0, type: 'hold', value: 60 },
    { t: 1800, bus: 1, type: 'slow', value: 2 },
    { t: 2400, bus: 0, type: 'express', value: 2 },
  ]);
  assert.equal(timed.policy, undefined);
  assert.deepEqual(recovery.config, timed.config);
  assert.deepEqual(recovery.events, [timed.events[0]]);
  assert.equal(recovery.policy, 'ordered-express');
  const run = new Experiment(recovery.config, 'guide-recovery', recovery);
  const checks = run.events.filter((event) => event.type === 'policy');
  assert.equal(checks.length, 71);
  assert.equal(checks[0].t, 1500);
  assert.equal(checks.at(-1).t, 3600);
  run.advanceTo(3600);
  assert.equal(run.sim.transfers, 0, 'current-model lessons protect accepted drop-offs');
  assert(
    run.sim.passedOver > 0,
    'the recovery example should expose the waiting-passenger tradeoff',
  );
});

test('guide assets, downloads, and navigation work below a hosting subpath', async () => {
  const hostedGuide = new URL('https://example.test/Bus-Bunching/scenario-guide.html');
  const ids = new Set([...guide.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const [, target] of guide.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (target.startsWith('data:')) continue;
    if (target.startsWith('#')) {
      assert(ids.has(target.slice(1)), `missing section ${target}`);
      continue;
    }
    assert(target.startsWith('./'), `asset should be relative to the guide: ${target}`);
    assert(new URL(target, hostedGuide).pathname.startsWith('/Bus-Bunching/'));
    const local = new URL(target, guideUrl);
    local.search = '';
    local.hash = '';
    await access(local);
  }
  assert.match(guide, /href="\.\/index\.html#scenarioLibrary"\s+target="_blank"\s+rel="noopener"/);
  assert.match(guide, /Open a new lab tab/);
});

test('every inline fragment is valid in its declared current or historical model', async () => {
  const historical = JSON.parse(
    await readFile(
      new URL('../dist/examples/historical/announced-skip.json', import.meta.url),
      'utf8',
    ),
  );
  const current = JSON.parse(
    await readFile(new URL('../dist/examples/announced-skip.json', import.meta.url), 'utf8'),
  );
  let checked = 0;
  for (const [, attributes, text] of guide.matchAll(
    /<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g,
  )) {
    if (attributes.includes('data-example-file')) continue;
    const fragment = text.trim();
    const data = structuredClone(
      fragment.includes('-v1') || fragment.includes('two-gap-v2') ? historical : current,
    );
    if (fragment.startsWith('"recovery_policy"')) {
      data.recovery_policy = JSON.parse(`{${fragment}}`).recovery_policy;
      data.interventions = [];
    } else {
      data.interventions = [JSON.parse(fragment)];
      data.recovery_policy = null;
    }
    assert.doesNotThrow(() => parseScenario(JSON.stringify(data)), fragment);
    checked++;
  }
  assert.equal(checked, 8);
});

test('example copy uses exact text and provides a selected, labelled fallback when unavailable', async () => {
  const text = examples[0][2];
  const status = { textContent: '' };
  const fallback = {
    hidden: true,
    value: '',
    focused: false,
    selected: false,
    focus() {
      this.focused = true;
    },
    select() {
      this.selected = true;
    },
  };
  let copied;
  await copyExample(text, {
    clipboard: {
      async writeText(value) {
        copied = value;
      },
    },
    status,
    fallback,
  });
  assert.equal(copied, text);
  assert.match(status.textContent, /copied/);
  assert.equal(fallback.hidden, true);
  for (const clipboard of [
    undefined,
    {
      async writeText() {
        throw Error('Permission denied');
      },
    },
  ]) {
    await copyExample(text, { clipboard, status, fallback });
    assert.equal(fallback.value, text);
    assert.equal(fallback.hidden, false);
    assert.equal(fallback.focused, true);
    assert.equal(fallback.selected, true);
    assert.match(status.textContent, /device’s Copy command/);
  }
  assert.match(guide, /id="timed-example-fallback"\s+aria-label="[^"]+"/);
  assert.match(guide, /id="timed-example-status"\s+role="status"\s+aria-live="polite"/);
});
