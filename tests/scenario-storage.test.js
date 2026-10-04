import test from 'node:test';
import assert from 'node:assert/strict';
import { setupScenarioLibrary } from '../dist/scenario-ui.js';
import { Experiment, scenarios } from '../dist/experiment.js?v=20261004a';
import { serializeScenario } from '../dist/scenario-format.js?v=20261004a';

// Exercise the public save button with only the DOM methods used by the library.
// Browser windows have separate scenario arrays but share the same local storage.
function libraryDocument() {
  const fields = new Map();
  function element() {
    return {
      children: [],
      value: '',
      textContent: '',
      hidden: false,
      disabled: false,
      setAttribute() {},
      addEventListener() {},
      insertBefore() {},
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      querySelector(selector) {
        if (!fields.has(selector)) fields.set(selector, element());
        return fields.get(selector);
      },
      focus() {},
      select() {},
      setSelectionRange() {},
      showModal() {},
      close() {},
    };
  }
  const library = element(),
    select = element();
  return {
    fields,
    document: {
      querySelector: () => library,
      getElementById: (id) => (id === 'scenario' ? select : element()),
      createElement: () => element(),
      body: element(),
    },
  };
}

function browserLocks(t) {
  // Use the browser callback contract instead of Node's experimental LockManager.
  // Node 24 can retain a lock after a throwing callback, hanging a later retry.
  const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name, callback) => callback() },
  });
  t.after(() => {
    if (original) Object.defineProperty(navigator, 'locks', original);
    else delete navigator.locks;
  });
}

test('saving from a preopened window retains a preset saved by another window', async (t) => {
  browserLocks(t);
  const originalDocument = globalThis.document,
    originalStorage = globalThis.localStorage,
    originalWindow = globalThis.window;
  const originalScenarios = scenarios.slice(),
    stored = new Map(),
    firstWindow = libraryDocument(),
    secondWindow = libraryDocument();
  t.after(() => {
    scenarios.splice(0, scenarios.length, ...originalScenarios);
    globalThis.document = originalDocument;
    globalThis.localStorage = originalStorage;
    globalThis.window = originalWindow;
  });
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, value),
  };
  const experiment = new Experiment();
  for (const ui of [firstWindow, secondWindow]) {
    globalThis.document = ui.document;
    setupScenarioLibrary(() => experiment);
  }
  async function save(ui, name) {
    globalThis.document = ui.document;
    const text = JSON.parse(serializeScenario(experiment.definition, experiment.config));
    text.name = name;
    ui.fields.get('textarea').value = JSON.stringify(text);
    await ui.fields.get('#saveScenarioText').onclick();
    assert.match(ui.fields.get('#scenarioTextMessage').textContent, /Saved/);
  }
  await save(firstWindow, 'Window A lesson');
  // Restore the unchanged in-memory inventory held by a second preopened window.
  scenarios.splice(0, scenarios.length, ...originalScenarios);
  await save(secondWindow, 'Window B lesson');
  const names = JSON.parse(stored.get('bus-lab-custom-scenarios-v1')).map(
    (item) => JSON.parse(item.text).name,
  );
  assert.deepEqual(names.sort(), ['Window A lesson', 'Window B lesson']);
});

for (const failure of ['invalid import', 'invalid stored presets', 'storage quota'])
  test(`${failure} preserves the active run and saved data, and allows retry`, async (t) => {
    browserLocks(t);
    const originalDocument = globalThis.document,
      originalStorage = globalThis.localStorage,
      originalWindow = globalThis.window;
    const originalScenarios = scenarios.slice(),
      ui = libraryDocument(),
      experiment = new Experiment({}, 'variance');
    experiment.advanceTo(120);
    experiment.action(0, 'hold', 15);
    const before = structuredClone(experiment.export());
    const valid = serializeScenario(experiment.definition, experiment.config);
    let stored = failure === 'invalid stored presets' ? '{unfinished' : '[]',
      rejectWrite = failure === 'storage quota';
    const initialStorage = stored;
    t.after(() => {
      scenarios.splice(0, scenarios.length, ...originalScenarios);
      globalThis.document = originalDocument;
      globalThis.localStorage = originalStorage;
      globalThis.window = originalWindow;
    });
    globalThis.document = ui.document;
    globalThis.window = { addEventListener() {} };
    globalThis.localStorage = {
      getItem: () => stored,
      setItem: (_key, value) => {
        if (rejectWrite) throw Error('QuotaExceededError');
        stored = value;
      },
    };
    setupScenarioLibrary(() => experiment);
    const input = ui.fields.get('textarea'),
      save = ui.fields.get('#saveScenarioText'),
      message = ui.fields.get('#scenarioTextMessage');
    const submitted = failure === 'invalid import' ? '{not JSON' : valid;
    input.value = submitted;
    await save.onclick();
    assert(message.textContent.length > 0);
    assert.doesNotMatch(message.textContent, /^Saved/);
    assert.equal(save.disabled, false);
    assert.equal(input.value, submitted);
    assert.equal(stored, initialStorage);
    assert.deepEqual(scenarios, originalScenarios);
    assert.deepEqual(experiment.export(), before);
    // Resolve only the injected problem; the same panel remains usable.
    input.value = valid;
    stored = '[]';
    rejectWrite = false;
    await save.onclick();
    assert.match(message.textContent, /^Saved/);
    assert.equal(JSON.parse(stored).length, 1);
    assert.deepEqual(experiment.export(), before);
  });

test('the preset limit uses current stored data rather than a preopened window inventory', async (t) => {
  browserLocks(t);
  const originalDocument = globalThis.document,
    originalStorage = globalThis.localStorage,
    originalWindow = globalThis.window;
  const originalScenarios = scenarios.slice(),
    ui = libraryDocument(),
    experiment = new Experiment();
  const text = serializeScenario(experiment.definition, experiment.config);
  const saved = JSON.stringify(
    Array.from({ length: 100 }, (_, i) => ({ id: 'custom-' + i.toString(16), text })),
  );
  let writes = 0;
  t.after(() => {
    scenarios.splice(0, scenarios.length, ...originalScenarios);
    globalThis.document = originalDocument;
    globalThis.localStorage = originalStorage;
    globalThis.window = originalWindow;
  });
  globalThis.document = ui.document;
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = {
    getItem: () => saved,
    setItem: () => {
      writes++;
    },
  };
  setupScenarioLibrary(() => experiment);
  ui.fields.get('textarea').value = text;
  await ui.fields.get('#saveScenarioText').onclick();
  assert.match(ui.fields.get('#scenarioTextMessage').textContent, /100 custom presets/);
  assert.equal(ui.fields.get('#saveScenarioText').disabled, false);
  assert.equal(writes, 0);
  assert.deepEqual(scenarios, originalScenarios);
});
