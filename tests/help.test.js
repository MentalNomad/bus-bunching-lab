import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHelp } from '../dist/help.js';

// Exercise the delegated event/timer contract without installing a DOM package.
function fixture(t) {
  const makeElement = (control = false) =>
    Object.assign(new EventTarget(), {
      dataset: {},
      style: {},
      attributes: {},
      isConnected: true,
      closest(selector) {
        if (selector === '[data-help]') return this.dataset.help ? this : null;
        return control && selector.includes('input') ? this : null;
      },
      contains(other) {
        return other === this;
      },
      append() {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      getBoundingClientRect() {
        return { left: 20, top: 20, bottom: 50, width: 100, height: 40 };
      },
    });
  const bubble = makeElement(),
    count = makeElement(),
    document = Object.assign(new EventTarget(), {
      body: makeElement(),
      activeElement: null,
      createElement: () => bubble,
      querySelectorAll: () => [],
      getElementById: () => count,
    }),
    window = new EventTarget(),
    original = {};
  for (const [name, value] of Object.entries({
    document,
    window,
    innerWidth: 800,
    innerHeight: 600,
  })) {
    original[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  t.after(() => {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  let now = 0,
    next = 0;
  const timers = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++next;
    timers.set(id, { callback, at: now + delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));
  function tick(ms) {
    now += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= now && timers.delete(id)) timer.callback();
  }
  function emit(type, target, extra = {}, owner = document) {
    const event = new Event(type);
    for (const [name, value] of Object.entries({ target, buttons: 0, ...extra }))
      Object.defineProperty(event, name, { value });
    owner.dispatchEvent(event);
  }
  setupHelp();
  const control = makeElement(true),
    metric = makeElement();
  control.dataset.help = 'Control explanation';
  metric.dataset.help = 'Metric explanation';
  return { bubble, control, metric, document, window, emit, tick };
}

test('help waits for a sustained hover and leaving early cancels the pending tooltip', (t) => {
  const f = fixture(t);
  f.emit('mouseover', f.control);
  f.tick(599);
  assert.equal(f.bubble.hidden, true);
  f.tick(1);
  assert.equal(f.bubble.hidden, false);
  assert.equal(f.control.attributes['aria-describedby'], 'explanation-tooltip');
  f.emit('mouseout', f.control, { relatedTarget: null });
  assert.equal(f.bubble.hidden, true);
  assert.equal(f.control.attributes['aria-describedby'], undefined);
  f.emit('mouseover', f.control);
  f.tick(300);
  f.emit('mouseout', f.control, { relatedTarget: null });
  f.tick(1000);
  assert.equal(f.bubble.hidden, true);
});

test('using a control cancels pending help, suppresses pointer focus, and does not reopen during drag', (t) => {
  const f = fixture(t);
  f.emit('mouseover', f.control);
  f.tick(300);
  f.emit('pointerdown', f.control, { pointerType: 'mouse' });
  f.document.activeElement = f.control;
  f.emit('focusin', f.control);
  f.emit('mouseover', f.metric);
  f.tick(1000);
  assert.equal(f.bubble.hidden, true);
  f.emit('pointerup', f.control);
  f.emit('click', f.control);
  f.tick(1000);
  assert.equal(f.bubble.hidden, true);
});

test('keyboard focus can read help; keys, edits, scrolling and resize dismiss it', (t) => {
  const f = fixture(t);
  for (const action of ['keydown', 'input', 'change', 'scroll', 'resize']) {
    f.emit('keydown', f.control, { key: 'Tab' });
    f.document.activeElement = f.control;
    f.emit('focusin', f.control);
    f.tick(600);
    assert.equal(f.bubble.hidden, false);
    f.emit(action, f.control, {}, ['scroll', 'resize'].includes(action) ? f.window : f.document);
    assert.equal(f.bubble.hidden, true, action);
    f.tick(1000);
    assert.equal(f.bubble.hidden, true, `${action} must not re-open help`);
  }
});

test('touch offers delayed help for read-only metrics without opening it when operating controls', (t) => {
  const f = fixture(t);
  for (const target of [f.control, f.metric]) {
    f.emit('pointerdown', target, { pointerType: 'touch' });
    f.emit('pointerup', target);
    f.emit('click', target);
    assert.equal(f.bubble.hidden, true);
    f.tick(600);
    assert.equal(f.bubble.hidden, target === f.control);
  }
});
