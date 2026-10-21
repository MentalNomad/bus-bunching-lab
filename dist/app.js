import { setupModelControls } from './model-ui.js?v=20261021a';
import { Simulation, MAX_SIMULATION_SECONDS } from './engine.js?v=20261021a';
import { Experiment, scenarios } from './experiment.js?v=20261021a';
import { chartData, sharedScale } from './chart-data.js?v=20261021a';
import { updateChartInspection, clearChartInspection } from './chart-inspection.js?v=20261021a';
import { setupLayout } from './layout.js?v=20261021a';
import { loadCustomPresets, setupScenarioLibrary } from './scenario-ui.js?v=20261021a';
import { setupHelp } from './help.js?v=20261021a';
import { scenarioFromSearch } from './scenario-links.js?v=20261021a';
import { advanceMaxSpeed, advanceTimedSpeed } from './playback.js?v=20261021a';
loadCustomPresets();
let refreshHelp = () => {};
let modelControls;
const $ = (id) => document.getElementById(id),
  colors = [
    '#3f7960',
    '#dc7141',
    '#5173bc',
    '#ae668c',
    '#9b8629',
    '#55969a',
    '#8356ad',
    '#cc5656',
    '#53782b',
    '#9e642f',
    '#575ea3',
    '#a7466a',
    '#287887',
    '#786945',
    '#69518b',
    '#945d52',
  ];
const linkedScenario = scenarioFromSearch(location.search);
let experiment = new Experiment({}, linkedScenario.id),
  sim = experiment.sim,
  running = false,
  last = performance.now(),
  lastDraw = 0;
if (linkedScenario.invalid)
  $('message').textContent =
    'Unknown scenario link. Loaded Balanced · fixed arrivals. Choose a built-in scenario from the library below.';
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const duration = (t) => (t >= 60 ? `${(t / 60).toFixed(1)} min` : `${t.toFixed(0)} sec`);
function initialize() {
  clearChartInspection();
  $('bus').innerHTML = sim.buses
    .map((b) => `<option value="${b.id}">Bus ${b.id + 1}</option>`)
    .join('');
  $('busCharts').innerHTML = sim.buses
    .map(
      (b) =>
        `<article class="bus-chart"><h3 style="color:${colors[b.id]}">● Bus ${b.id + 1}</h3><h4>Time stopped per station</h4><p>Service + holding · seconds · sampled on departure</p><div class="chart-numbers" id="dwellNumbers${b.id}"></div><canvas id="dwell${b.id}" role="img" aria-label="Bus ${b.id + 1} dwell time graph"></canvas><h4>Cumulative queue wait per passenger at boarding</h4><p>Initial queue wait · seconds · sampled at boarding</p><div class="chart-numbers" id="waitNumbers${b.id}"></div><canvas id="wait${b.id}" role="img" aria-label="Bus ${b.id + 1} passenger wait graph"></canvas><div class="chart-key">● Observation &nbsp; ━ Trailing average</div></article>`,
    )
    .join('');
  const heading = document.createElement('h2');
  heading.textContent = 'Per-bus statistics';
  heading.style.gridColumn = '1 / -1';
  $('busCharts').prepend(heading);
  $('expressValue').max = sim.c.stops - 1;
  $('patternLead').max = sim.c.stops - 1;
  $('patternLead').value = Math.min(+$('patternLead').value, sim.c.stops - 1);
  $('patternEvery').max = sim.c.stops;
  $('patternEvery').value = Math.min(+$('patternEvery').value, sim.c.stops);
  $('config').elements.ride.max = sim.c.stops - 1;
  render();
}
function setRunning(v) {
  running = v;
  last = performance.now();
  $('run').textContent = running ? 'Ⅱ Pause' : '▶ Run route';
  $('status').textContent = running ? 'Route running' : sim.time ? 'Paused' : 'Ready to run';
  $('statusDot').classList.toggle('running', running);
}
function reset(c = sim.c, scenarioId = experiment.scenarioId) {
  const replacement =
    scenarioId === experiment.scenarioId ? experiment.restart(c) : new Experiment(c, scenarioId);
  experiment = replacement;
  sim = experiment.sim;
  $('setupMessage').textContent = '';
  $('setupMessage').hidden = true;
  setRunning(false);
  $('message').textContent = '';
  syncForm();
  initialize();
}
function syncForm() {
  $('currentScenarioName').textContent = experiment.definition.name;
  $('introHint').textContent =
    ['variance', 'corrected-variance'].includes(experiment.scenarioId) &&
    sim.c.arrival === 'poisson'
      ? 'Hit Run route: random passenger demand gradually disrupts even spacing. Let it run for several simulated laps.'
      : 'Hit Run route to try “' +
        experiment.definition.name +
        '”. Find its setup and scheduled dispatch in the Scenario Library below.';
  for (const [k, v] of Object.entries(sim.c))
    if ($('config').elements[k]) $('config').elements[k].value = v ?? '';
  modelControls?.sync();
  for (const el of document.querySelectorAll('option[value="recovered"]'))
    el.textContent = 'When forward gap recovers';
  $('scenario').value = experiment.scenarioId;
  $('scenario').dispatchEvent(new Event('change'));
  const isTwoGap = experiment.definition.policy === 'two-gap';
  const options = isTwoGap ? experiment.definition.policyOptions : null;
  $('policyStatus').textContent = isTwoGap
    ? `Active: ${options.ahead} gap ahead AND ${options.behind} gap behind → ${options.response.type === 'dropoff' ? 'drop-off-only' : options.response.type === 'pattern' ? 'announced pattern' : 'hold'}.`
    : experiment.definition.policy
      ? experiment.definition.policy === 'temporal'
        ? 'Active: passenger-cost controller. See the event controller and passenger evidence below.'
        : 'Active: spatial polling rule. The spatial editor below creates a polling comparison.'
      : 'Active: automatic dispatch is off.';
  $('policyAction').value = options?.response.type || 'none';
  if (options) {
    $('gapAhead').value = options.ahead;
    $('gapBehind').value = options.behind;
    $('gapSmall').value = options.small * 100;
    $('gapLarge').value = options.large * 100;
    if (options.response.type === 'hold') $('holdValue').value = options.response.value;
    else setServiceFields(options.response.type, options.response.value);
  }
  const schedule = experiment.definition.policySchedule || { start: 1500, end: 3600, interval: 15 };
  $('policyStart').value = schedule.start / 60;
  $('policyEnd').value = schedule.end / 60;
  $('policyInterval').value = schedule.interval;
}
function advance(seconds) {
  experiment.advanceTo(sim.time + seconds);
  sim = experiment.sim;
}
function dispatch(bus, type, value) {
  experiment.action(bus, type, value);
  sim = experiment.sim;
}
function pausedAction(action = () => {}) {
  setRunning(false);
  try {
    action();
  } catch (error) {
    $('message').textContent = error.message;
  } finally {
    sim = experiment.sim;
    setRunning(false);
    render();
  }
}
$('config').elements.stops.oninput = () => {
  $('config').elements.ride.max = +$('config').elements.stops.value - 1;
};
$('config').onsubmit = (e) => {
  e.preventDefault();
  try {
    const c = Object.fromEntries(new FormData(e.target));
    for (const k of ['stops', 'travel', 'buses', 'rate', 'board', 'debark', 'ride', 'seed'])
      c[k] = +c[k];
    reset(modelControls.readConfig(c));
  } catch (e) {
    $('setupMessage').textContent =
      'Setup not applied. ' + e.message + ' The current run is unchanged.';
    $('setupMessage').hidden = false;
  }
};
$('run').onclick = () => (running ? pausedAction() : setRunning(true));
$('step').onclick = () => pausedAction(() => advance(60));
$('reset').onclick = () => pausedAction(() => reset());
for (const id of ['brandExplainer', 'titleExplainer'])
  $(id).onclick = () => {
    const panel = $('problemExplainer');
    panel.hidden = !panel.hidden;
    for (const toggle of ['brandExplainer', 'titleExplainer'])
      $(toggle).setAttribute('aria-expanded', String(!panel.hidden));
  };
$('loadScenario').onclick = () =>
  pausedAction(() => {
    const id = $('scenario').value,
      s = scenarios.find((x) => x.id === id);
    if (!s) throw Error('Choose a scenario first.');
    reset({ ...new Simulation().c, ...s.config }, id);
  });
$('back').onclick = () => pausedAction(() => experiment.seek(sim.time - 60));
let timelineFrame = 0;
$('timeline').oninput = () => {
  setRunning(false);
  cancelAnimationFrame(timelineFrame);
  timelineFrame = requestAnimationFrame(() => {
    timelineFrame = 0;
    pausedAction(() => experiment.seek(+$('timeline').value));
  });
};
$('copy').onclick = () => {
  setRunning(false);
  try {
    render();
    const key = 'bus-lab-copy-' + crypto.randomUUID();
    const payload = JSON.stringify({
      experiment: experiment.export(),
      speed: $('speed').value,
      window: $('window').value,
      charts: {
        mode: $('averageMode').value,
        dwell: $('dwellAxis').value,
        wait: $('waitAxis').value,
        system: $('systemAxis').value,
      },
    });
    localStorage.setItem(key, payload);
    const url = new URL(location.href);
    url.hash = key;
    const child = window.open(url.href, '_blank');
    if (!child) {
      localStorage.removeItem(key);
      throw Error('Allow pop-ups for this site, then try again.');
    }
    $('message').textContent =
      'Opened an independent, paused copy at the same time. You can give each run different interventions.';
  } catch (e) {
    $('message').textContent = e.message;
  }
};
for (const type of ['hold', 'slow', 'express'])
  $(type).onclick = () => {
    try {
      dispatch(+$('bus').value, type, +$(type + 'Value').value);
      $('message').textContent = sim.log[0].message;
      render();
    } catch (e) {
      $('message').textContent = e.message;
    }
  };
function serviceFields(type) {
  const end = $(type + 'End').value;
  return {
    ...(type === 'pattern'
      ? { leadStops: +$('patternLead').value, every: +$('patternEvery').value }
      : {}),
    stops: end === 'fixed' ? +$(type + 'Stops').value : null,
    untilRecovered: end === 'recovered',
    maxSeconds: +$(type + 'Limit').value,
  };
}
function setServiceFields(type, value) {
  $(type + 'End').value = value.untilRecovered
    ? 'recovered'
    : value.stops === null
      ? 'ongoing'
      : 'fixed';
  if (value.stops !== null) $(type + 'Stops').value = value.stops;
  $(type + 'Limit').value = value.maxSeconds;
  if (type === 'pattern') {
    $('patternLead').value = value.leadStops;
    $('patternEvery').value = value.every;
  }
  updateServiceFields(type);
}
function updateServiceFields(type) {
  $(type + 'Stops').disabled = $(type + 'End').value !== 'fixed';
}
for (const type of ['dropoff', 'pattern']) {
  $(type + 'End').onchange = () => updateServiceFields(type);
  $(type).onclick = () => {
    try {
      dispatch(+$('bus').value, type, serviceFields(type));
      $('message').textContent = sim.log[0].message;
      render();
    } catch (error) {
      $('message').textContent = error.message;
    }
  };
}
$('normal').onclick = () => {
  try {
    dispatch(+$('bus').value, 'normal', 1);
    $('message').textContent = sim.log[0].message;
    render();
  } catch (error) {
    $('message').textContent = error.message;
  }
};
$('bus').onchange = () => route();
$('policyAction').onchange = () => {
  const type = $('policyAction').value;
  if (type === 'dropoff' || type === 'pattern') $(type + 'Controls').open = true;
};
$('gapPolicy').onsubmit = (event) => {
  event.preventDefault();
  pausedAction(() => {
    const definition = structuredClone(experiment.definition),
      type = $('policyAction').value;
    definition.id = 'custom-working';
    definition.custom = true;
    definition.config = { ...sim.c };
    definition.name =
      experiment.definition.name.replace(/ · edited dispatch$/, '').slice(0, 80) +
      ' · edited dispatch';
    definition.description =
      'A dispatch experiment using the applied route setup and recorded interventions. Automatic rules are shown in the dispatch desk and included in exported scenario text.';
    definition.events = [...definition.events, ...structuredClone(experiment.commands)];
    delete definition.policy;
    delete definition.policyOptions;
    delete definition.policySchedule;
    if (type !== 'none') {
      definition.policy = 'two-gap';
      definition.policyOptions = {
        ahead: $('gapAhead').value,
        behind: $('gapBehind').value,
        small: +$('gapSmall').value / 100,
        large: +$('gapLarge').value / 100,
        response: { type, value: type === 'hold' ? +$('holdValue').value : serviceFields(type) },
      };
      definition.policySchedule = {
        start: +$('policyStart').value * 60,
        end: +$('policyEnd').value * 60,
        interval: +$('policyInterval').value,
      };
    }
    const replacement = new Experiment(sim.c, definition.id, definition);
    const index = scenarios.findIndex((s) => s.id === definition.id);
    if (index < 0) {
      scenarios.push(definition);
      const option = document.createElement('option');
      option.value = definition.id;
      option.textContent = 'Custom · ' + definition.name;
      $('scenario').append(option);
    } else {
      scenarios[index] = definition;
      $('scenario').querySelector('option[value="custom-working"]').textContent =
        'Custom · ' + definition.name;
    }
    experiment = replacement;
    sim = experiment.sim;
    syncForm();
    initialize();
    $('message').textContent =
      'Dispatch applied and run restarted. Setup and recorded interventions are retained. Export scenario to save this experiment.';
  });
};
$('window').onchange = () => {
  if (!$('window').checkValidity()) $('window').value = 20;
  renderCharts();
};
function route() {
  const n = sim.c.stops,
    cx = 330,
    cy = 275,
    r = 202;
  const xy = (pos, radius = r) => {
    const a = (pos / n) * 2 * Math.PI - Math.PI / 2;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };
  const stopLabel = (stop, waiting, x, y) => {
    const size = n > 16 ? 10 : 15,
      icon = size * 0.85,
      gap = size * 0.25,
      stopWidth = String(stop).length * size * 0.6,
      waitWidth = String(waiting).length * size * 0.6;
    const meeple = (left) =>
      `<use href="#passenger-meeple-icon" x="${left}" y="${-icon / 2}" width="${icon}" height="${icon}"/>`;
    const text = (value, left) =>
      `<text x="${left}" y="0" dominant-baseline="central">${value}</text>`;
    const stopPart = text(stop, 0),
      waitPart = text(waiting, 0) + meeple(waitWidth + gap),
      stopLength = stopWidth,
      waitLength = waitWidth + gap + icon;
    const label =
      n > 16
        ? `<g transform="translate(${-stopLength / 2},${-size * 0.55})">${stopPart}</g><g transform="translate(${-waitLength / 2},${size * 0.75})">${waitPart}</g>`
        : `<g transform="translate(${-(stopLength + size + waitLength) / 2},0)">${stopPart}${text('·', stopLength + size * 0.4)}<g transform="translate(${stopLength + size},0)">${waitPart}</g></g>`;
    return `<g transform="translate(${x},${y})" class="stop-label" style="font-size:${size}px">${label}</g>`;
  };
  let svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e4eadb" stroke-width="24"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#bdcbb2" stroke-width="1.5" stroke-dasharray="5 7"/>`;
  const selectedBus = sim.buses[+$('bus').value] || sim.buses[0];
  for (const s of sim.stops) {
    const [x, y] = xy(s.id),
      [lx, ly] = xy(s.id, r + (n <= 16 ? 46 : n > 20 && s.id % 2 ? 52 : 34));
    const plan = sim.stopPlan(selectedBus, s.id);
    const marker =
      plan === 'protected'
        ? `<circle cx="${x}" cy="${y}" r="18" fill="none" stroke="#b57816" stroke-width="3"/>`
        : plan === 'skip'
          ? `<path d="M${x - 8},${y - 8}l16,16m0,-16l-16,16" stroke="#9b4f45" stroke-width="3"/>`
          : '';
    svg += `<g><title>Stop ${s.id + 1}: ${s.queue.length} waiting${plan === 'normal' ? '' : ` · Bus ${selectedBus.id + 1}: ${plan === 'protected' ? 'protected drop-off' : 'planned skip'}`}</title><circle cx="${x}" cy="${y}" r="${Math.min(15, 8 + s.queue.length / 10)}" class="svg-queue"/><circle cx="${x}" cy="${y}" r="5" class="svg-stop"/>${marker}${stopLabel(s.id + 1, s.queue.length, lx, ly)}</g>`;
  }
  for (const b of sim.buses) {
    const [x, y] = xy(sim.position(b), r - 19 - (b.id % 3) * 5);
    const held = b.phase !== 'travel' && Math.max(b.holdUntil, b.autoHoldUntil ?? 0) > sim.time;
    const badge = held
      ? 'HOLD'
      : b.servicePlan
        ? b.servicePlan.type === 'boarding'
          ? 'LIMIT'
          : b.servicePlan.type === 'dropoff'
            ? 'DROP'
            : b.servicePlan.phase !== 'active'
              ? 'PLAN'
              : `SKIP ${b.servicePlan.every}`
        : b.pendingHold
          ? 'H NEXT'
          : '';
    svg += `<g><title>${badge ? badge + ': ' : ''}Bus ${b.id + 1}: ${b.load.length} onboard, ${b.phase}</title><rect x="${x - 14}" y="${y - 12}" width="28" height="24" rx="7" fill="${colors[b.id]}" stroke="white" stroke-width="2"/><text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="middle" class="bus-label">${b.id + 1}</text>${badge ? `<rect x="${x - 28}" y="${y - 34}" width="56" height="18" rx="4" fill="${held ? '#915b12' : '#25497a'}"/><text x="${x}" y="${y - 22}" text-anchor="middle" fill="white" font-size="11" font-weight="700">${badge}</text>` : ''}</g>`;
  }
  $('route').innerHTML = svg;
  $('planLegend').textContent = selectedBus.servicePlan
    ? `Bus ${selectedBus.id + 1} next-encounter preview: ${selectedBus.servicePlan?.type === 'dropoff' ? 'drop-offs allowed; no new boarding.' : '× planned skip · gold ring protects an accepted drop-off. The plan may end earlier on recovery or its time cap.'}`
    : 'Choose a bus in the dispatch desk to preview its announced pattern and protected drop-offs.';
  $('busList').innerHTML = sim.buses
    .map((b) => {
      let state =
        b.phase === 'travel'
          ? `${b.roadBlocked ? 'Following a slower bus · ' : ''}To stop ${b.target + 1}`
          : b.phase === 'hold' && b.stoppingUntil > sim.time
            ? `Slowing into stop · ${Math.ceil(b.stoppingUntil - sim.time)}s left`
            : b.phase === 'hold' &&
                b.overheadUntil > sim.time &&
                Math.max(b.holdUntil, b.autoHoldUntil ?? 0) <= sim.time
              ? `Stop overhead · ${Math.ceil(b.overheadUntil - sim.time)}s left`
              : b.phase === 'hold'
                ? `Holding · ${Math.ceil(Math.max(0, Math.max(b.holdUntil, b.autoHoldUntil ?? 0) - sim.time))}s left`
                : `${b.service?.kind === 'off' ? 'Debarking' : 'Boarding'} · stop ${b.target + 1}`;
      if (b.holdUntil > sim.time && b.phase !== 'travel' && b.phase !== 'hold')
        state += ` · hold ${Math.ceil(b.holdUntil - sim.time)}s left`;
      if (b.pendingHold) state += ` · hold ${b.pendingHold}s queued`;
      if (b.servicePlan) state += ' · ' + sim.serviceStatus(b);
      const gaps = sim.gaps(b);
      return `<div class="bus-card"><span class="bus-dot" style="background:${colors[b.id]}"></span><div><strong>Bus ${b.id + 1} <span style="font-weight:400">· ${b.load.length + (b.service?.kind === 'on' ? 1 : 0)} riding</span></strong>${state}<small class="bus-gaps" tabindex="0" data-help="Spatial distance in stop intervals. Immediate neighbors retain a full circular gap at tied positions. Target is stops divided by buses. Speeding this bus closes its forward gap and opens its rear gap; holding does the reverse.">Ahead ${gaps.ahead.toFixed(2)} · behind ${gaps.behind.toFixed(2)} · target ${(sim.c.stops / sim.c.buses).toFixed(2)}</small></div></div>`;
    })
    .join('');
}
function chart(canvas, data, view, color, axisMax) {
  const rect = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1,
    w = rect.width,
    h = rect.height;
  if (!w) return;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const left = 49,
    right = w - 13,
    top = 14,
    bottom = h - 30,
    from = Math.max(0, sim.time - 3600),
    to = Math.max(60, sim.time);
  const points = view.raw,
    averagePoints = view.averages,
    max = axisMax;
  canvas.dataset.axisMax = max;
  const x = (t) => left + ((t - from) / (to - from)) * (right - left),
    y = (v) => bottom - (v / max) * (bottom - top);
  ctx.font = '11px DM Sans, sans-serif';
  ctx.fillStyle = '#7a8870';
  ctx.strokeStyle = '#e1e7d9';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = max * (i / 4),
      yy = y(v);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(v), left - 8, yy + 4);
  }
  for (let i = 0; i <= 4; i++) {
    ctx.textAlign = 'center';
    const t = from + ((to - from) * i) / 4;
    ctx.fillText((t / 60).toFixed(0), x(t), h - 10);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = color;
  const pixels = new Set();
  ctx.beginPath();
  for (const p of points) {
    const px = x(p.t),
      py = y(p.v);
    if (py < top || py > bottom) continue;
    const key = Math.round(px) + ':' + Math.round(py);
    if (pixels.has(key)) continue;
    pixels.add(key);
    ctx.moveTo(px + 2, py);
    ctx.arc(px, py, 2, 0, 2 * Math.PI);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  averagePoints.forEach((p, i) => {
    if (i) {
      ctx.lineTo(x(p.t), y(averagePoints[i - 1].v));
      ctx.lineTo(x(p.t), y(p.v));
    } else ctx.moveTo(x(p.t), y(p.v));
  });
  if (averagePoints.length) ctx.lineTo(x(sim.time), y(averagePoints.at(-1).v));
  ctx.stroke();
  ctx.restore();
  if (!points.length) {
    ctx.fillStyle = '#78856f';
    ctx.textAlign = 'center';
    ctx.fillText(
      data.length
        ? 'No observations in the last 60 minutes'
        : 'Observations appear as the route runs',
      (left + right) / 2,
      (top + bottom) / 2,
    );
  }
  updateChartInspection(canvas, data, view, { left, right, top, bottom, from, to, max, color });
}
function renderCharts() {
  const n = Math.max(1, Math.min(500, +$('window').value || 20)),
    mode = $('averageMode').value;
  const axis = (id) => {
    const value = +$(id).value;
    return Number.isFinite(value) && value >= 0 && value <= MAX_SIMULATION_SECONDS ? value : 0;
  };
  const dwellMax = sharedScale(
      sim.buses.map((b) => b.dwell),
      sim.time,
      n,
      mode,
      axis('dwellAxis'),
    ),
    waitMax = sharedScale(
      sim.buses.map((b) => b.wait),
      sim.time,
      n,
      mode,
      axis('waitAxis'),
    ),
    systemMax = sharedScale([sim.series], sim.time, n, mode, axis('systemAxis'));
  const systemView = chartData(sim.series, sim.time, n, mode);
  chart($('systemChart'), sim.series, systemView, '#3f7960', systemMax);
  numbers($('systemNumbers'), systemView, mode);
  $('systemCount').textContent = `${sim.completed.toLocaleString()} completed passengers`;
  for (const b of sim.buses) {
    const dwellView = chartData(b.dwell, sim.time, n, mode),
      waitView = chartData(b.wait, sim.time, n, mode);
    chart($('dwell' + b.id), b.dwell, dwellView, colors[b.id], dwellMax);
    numbers($('dwellNumbers' + b.id), dwellView, mode, true);
    chart($('wait' + b.id), b.wait, waitView, colors[b.id], waitMax);
    numbers($('waitNumbers' + b.id), waitView, mode);
  }
  refreshHelp();
}
function numbers(el, v, mode, dwell = false) {
  const fmt = (x) => (x === null ? '—' : x.toFixed(1) + ' s');
  if (!el.children.length)
    el.innerHTML =
      '<span>Low · last minute<strong></strong></span><span>High · last minute<strong></strong></span><span>Trailing average<strong></strong></span><small></small>';
  [v.low, v.high, v.average].forEach(
    (value, i) => (el.children[i].querySelector('strong').textContent = fmt(value)),
  );
  el.querySelector('small').textContent =
    `${v.recentCount} observations in last minute · average of ${v.averageCount} ${dwell ? 'served-stop observations' : mode === 'batch' ? 'passenger observations in whole stop groups' : 'passenger observations'}${v.averageTime === null ? '' : ` · updated ${clock(v.averageTime)}`}`;
}
function metrics(rows) {
  const root = $('metrics');
  if (!root.children.length)
    for (const [label] of rows) {
      const card = document.createElement('div');
      card.className = 'metric';
      card.innerHTML = '<span></span><strong></strong><small></small>';
      card.querySelector('span').textContent = label;
      root.append(card);
    }
  rows.forEach(([, value, sub], i) => {
    root.children[i].querySelector('strong').textContent = value;
    root.children[i].querySelector('small').textContent = sub;
  });
}
for (const id of ['averageMode', 'dwellAxis', 'waitAxis', 'systemAxis'])
  $(id).onchange = () => {
    if (!$(id).checkValidity()) $(id).value = 0;
    renderCharts();
  };

function render() {
  const s = sim.summary();
  $('back').disabled = sim.time === 0;
  $('timeline').max = experiment.furthest;
  $('timeline').value = sim.time;
  $('timeline').disabled = experiment.furthest === 0;
  $('timelineRange').textContent = clock(sim.time) + ' / ' + clock(experiment.furthest);
  const next = experiment.upcoming();
  $('nextEvent').textContent =
    'Active run: ' +
    experiment.definition.name +
    '. ' +
    (next
      ? (next.type === 'policy' ? 'Next automatic recovery check' : 'Next scheduled dispatch') +
        ' at ' +
        clock(next.t)
      : 'No further scheduled dispatch. You can still intervene manually.');
  $('clock').textContent = clock(s.time);
  $('variation').textContent = `${Math.round(s.gapCV * 100)}%`;
  metrics([
    ['Passengers waiting', s.waiting, 'At all stops'],
    ['Passengers riding', s.onboard, 'Including boarding'],
    ['Trips completed', s.completed, `${s.created} passengers arrived`],
    ['Mean queue wait', duration(s.meanWait), 'Completed passengers'],
    ['Mean system time', duration(s.meanSystem), 'Completed only · includes initial wait'],
    ['Oldest current queue wait', duration(s.oldestWait), 'Longest current queue episode'],
    ['Mean current queue wait', duration(s.meanCurrentWait), 'Everyone waiting right now'],
    [
      'Passed-over passengers',
      s.passedOver,
      `${s.affectedPassengers} unique people · repeated visits count`,
    ],
    [
      'Passenger time accrued',
      `${(s.totalPassengerTime / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} p-min`,
      'Completed + unfinished trips',
    ],
  ]);
  modelControls?.render(!running);
  route();
  renderCharts();
  $('history').innerHTML = sim.log.length
    ? sim.log.map((l) => `<div><time>${clock(l.t)}</time><span>${l.message}</span></div>`).join('')
    : '<p>No interventions yet. Try a 60-second hold on Bus 1.</p>';
  refreshHelp();
}
$('export').onclick = () => {
  const rows = [
    [
      'metric',
      'bus',
      'stop',
      'passenger',
      'simulation_seconds',
      'value_seconds',
      'cumulative_wait_seconds',
      'count',
    ],
  ];
  for (const b of sim.buses) {
    for (const p of b.dwell) rows.push(['dwell', b.id + 1, p.stop + 1, '', p.t, p.v, '']);
    for (const p of b.wait)
      rows.push(['wait_at_boarding', b.id + 1, p.stop + 1, p.id, p.t, p.v, p.v]);
  }
  for (const p of sim.series) rows.push(['system_time', p.bus + 1, '', p.id, p.t, p.v, p.wait]);
  const summary = sim.summary();
  for (const [label, value] of [
    ['oldest_current_queue_wait', summary.oldestWait],
    ['mean_current_queue_wait', summary.meanCurrentWait],
    ['passenger_time_accrued', summary.totalPassengerTime],
  ])
    rows.push([label, '', '', '', sim.time, value, '']);
  rows.push(['passed_over_count', '', '', '', sim.time, '', '', summary.passedOver]);
  rows.push(['unique_passed_over_count', '', '', '', sim.time, '', '', summary.affectedPassengers]);
  const blob = new Blob(
      [rows.map((r) => [...r, ...Array(8 - r.length).fill('')].join(',')).join('\n')],
      { type: 'text/csv' },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = `bus-bunching-${Math.floor(sim.time)}s.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.2, (now - last) / 1000);
  last = now;
  if (!running) return;
  try {
    if ($('speed').value === 'max') {
      if (advanceMaxSpeed(experiment)) {
        setRunning(false);
        $('message').textContent =
          'Seven-day run limit reached. Export the data, then reset to start another run.';
      }
      sim = experiment.sim;
    } else {
      if (advanceTimedSpeed(experiment, elapsed * +$('speed').value)) {
        setRunning(false);
        $('message').textContent =
          'Seven-day run limit reached. Export the data, then reset to start another run.';
      }
      sim = experiment.sim;
    }
    if (!running || now - lastDraw > 120) {
      render();
      lastDraw = now;
    }
  } catch (error) {
    sim = experiment.sim;
    setRunning(false);
    $('message').textContent = error.message;
    try {
      render();
    } catch {}
  }
}
window.addEventListener('resize', () => {
  try {
    renderCharts();
  } catch (error) {
    setRunning(false);
    $('message').textContent = error.message;
  }
});
try {
  const key = location.hash.slice(1);
  if (/^bus-lab-copy-[a-f0-9-]+$/.test(key)) {
    const raw = localStorage.getItem(key);
    if (!raw) throw Error('This copy has expired. Open a new copy from the original experiment.');
    const data = JSON.parse(raw);
    experiment = Experiment.restore(data.experiment);
    sim = experiment.sim;
    if (['1', '10', '30', '60', '120', 'max'].includes(data.speed)) $('speed').value = data.speed;
    if (Number.isInteger(+data.window) && +data.window >= 1 && +data.window <= 500)
      $('window').value = data.window;
    if (data.charts) {
      if (['batch', 'individual'].includes(data.charts.mode))
        $('averageMode').value = data.charts.mode;
      for (const k of ['dwell', 'wait', 'system'])
        if (
          Number.isFinite(+data.charts[k]) &&
          +data.charts[k] >= 0 &&
          +data.charts[k] <= MAX_SIMULATION_SECONDS
        )
          $(k + 'Axis').value = data.charts[k];
    }
    localStorage.removeItem(key);
    history.replaceState(null, '', location.pathname + location.search);
    $('message').textContent = 'Copied experiment restored. Each window runs independently.';
  }
} catch (e) {
  $('message').textContent = e.message;
}
if (!scenarios.some((s) => s.id === experiment.scenarioId))
  scenarios.push({ ...experiment.definition, id: experiment.scenarioId, custom: true });
setupScenarioLibrary(() => experiment);
modelControls = setupModelControls({
  getExperiment: () => experiment,
  pause: () => setRunning(false),
  render: () => {
    sim = experiment.sim;
    setRunning(false);
    render();
  },
  install: (definition) => {
    const replacement = new Experiment(definition.config, definition.id, definition);
    const index = scenarios.findIndex((s) => s.id === definition.id);
    if (index < 0) {
      scenarios.push(definition);
      const option = new Option('Custom · ' + definition.name, definition.id);
      $('scenario').add(option);
    } else {
      scenarios[index] = definition;
      const option = [...$('scenario').options].find((o) => o.value === definition.id);
      if (option) option.textContent = 'Custom · ' + definition.name;
    }
    experiment = replacement;
    sim = experiment.sim;
    syncForm();
    initialize();
  },
});
setupLayout();
syncForm();
setRunning(false);
initialize();
refreshHelp = setupHelp();
requestAnimationFrame(frame);
// Feature-detected WebMCP exposes the same visible experiment actions.
if (document.modelContext?.registerTool) {
  for (const tool of [
    {
      name: 'read_bus_simulation',
      description: 'Read current passenger counts and bus positions.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({
        summary: sim.summary(),
        buses: sim.buses.map((b) => ({
          id: b.id + 1,
          position: sim.position(b),
          phase: b.phase,
          onboard: b.load.length,
          gaps: sim.gaps(b),
          service: sim.serviceStatus(b),
        })),
      }),
    },
    {
      name: 'dispatch_bus_intervention',
      description:
        'Dispatch the visible hold, slowdown, express, dropoff, pattern or normal-service action. Bus numbers begin at 1. dropoff/pattern use the same structured values as the dispatch controls.',
      inputSchema: {
        type: 'object',
        properties: {
          bus: { type: 'integer', minimum: 1 },
          action: { enum: ['hold', 'slow', 'express', 'dropoff', 'pattern', 'boarding', 'normal'] },
          value: {
            oneOf: [
              { type: 'number', exclusiveMinimum: 0 },
              {
                type: 'object',
                properties: {
                  stops: { type: ['integer', 'null'], minimum: 1, maximum: 400 },
                  untilRecovered: { type: 'boolean' },
                  maxSeconds: { type: 'number', minimum: 1, maximum: 604800 },
                  leadStops: { type: 'integer', minimum: 0 },
                  every: { type: 'integer', minimum: 2 },
                  passengers: { type: 'integer', minimum: 0, maximum: 500 },
                },
                required: ['stops', 'untilRecovered', 'maxSeconds'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['bus', 'action', 'value'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (!Number.isInteger(input.bus)) throw Error('Invalid bus');
        dispatch(input.bus - 1, input.action, input.value);
        render();
        return { message: sim.log[0].message, summary: sim.summary() };
      },
    },
  ]) {
    try {
      Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {});
    } catch {}
  }
}
