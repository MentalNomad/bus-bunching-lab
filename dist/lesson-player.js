import { Experiment } from './experiment.js?v=20261118a';
import { MAX_SIMULATION_SECONDS } from './engine.js?v=20261021a';
import { advanceMaxSpeed, advanceTimedSpeed } from './playback.js?v=20261021a';

const busColors = ['#3f7960', '#dc7141', '#5173bc', '#ae668c'];
const stamp = (seconds) =>
  [Math.floor(seconds / 60), Math.floor(seconds % 60)]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

function coordinates(stop, stops, radius) {
  const angle = (stop / stops) * 2 * Math.PI - Math.PI / 2;
  return [170 + radius * Math.cos(angle), 155 + radius * Math.sin(angle)];
}

function prepareMap(player, sim) {
  const svg = player.querySelector('svg');
  const stops = sim.c.stops;
  const stations = sim.stops.map(({ id }) => {
    const [x, y] = coordinates(id, stops, 112);
    const [labelX, labelY] = coordinates(id, stops, 140);
    return `<g class="station"><title></title><circle cx="${x}" cy="${y}" r="5"/><text x="${labelX}" y="${labelY}">${id + 1}</text></g>`;
  });
  const buses = sim.buses.map(
    ({ id }) =>
      `<g class="vehicle"><title></title><rect x="-10" y="-13" width="20" height="26" rx="5" fill="${busColors[id]}" stroke="white" stroke-width="1.5"/><rect x="-6" y="-10" width="12" height="4" rx="1.5" fill="white"/><text y="7">${id + 1}</text></g>`,
  );
  svg.innerHTML = `<circle class="route-track" cx="170" cy="155" r="112"/><circle class="route-thread" cx="170" cy="155" r="112"/>${stations.join('')}${buses.join('')}`;
  player.querySelector('.loads').innerHTML = sim.buses
    .map(
      ({ id }) =>
        `<span style="--bus:${busColors[id]}"><b>Bus ${id + 1}</b><span class="riders"></span></span>`,
    )
    .join('');
  const vehicles = [...svg.querySelectorAll('.vehicle')];
  const stationTitles = [...svg.querySelectorAll('.station title')];
  const loads = [...player.querySelectorAll('.riders')];
  const gap = player.querySelector('.gap');
  return (model) => {
    const positions = model.buses.map((bus) => model.position(bus));
    const neighbors = model.neighborSnapshot();
    gap.textContent = Math.max(...Object.values(neighbors.byId).map((bus) => bus.ahead)).toFixed(2);
    model.stops.forEach((stop) => {
      stationTitles[stop.id].textContent = `Stop ${stop.id + 1}, ${stop.queue.length} waiting`;
    });
    // Stagger close buses inward so their numbers remain visible at a shared stop.
    const lanes = [];
    model.buses.forEach((bus) => {
      const { id } = bus;
      const occupied = new Set();
      for (let earlier = 0; earlier < id; earlier++) {
        const distance = Math.abs(positions[earlier] - positions[id]);
        if (Math.min(distance, stops - distance) < 0.55) occupied.add(lanes[earlier]);
      }
      let lane = 0;
      while (occupied.has(lane)) lane++;
      lanes[id] = lane;
      const [x, y] = coordinates(positions[id], stops, 112 - lane * 18);
      vehicles[id].setAttribute('transform', `translate(${x} ${y})`);
      const count = bus.load.length + (bus.service?.kind === 'on' ? 1 : 0);
      loads[id].textContent = `${count} riding`;
      vehicles[id].firstElementChild.textContent =
        `Bus ${id + 1}, ${count} riding, ${neighbors.byId[id].ahead.toFixed(2)} stops ahead`;
    });
  };
}

function mount(figure) {
  const preset = figure.dataset.preset;
  const player = figure.querySelector('.player');
  player.append(document.querySelector('#playback').content.cloneNode(true));
  const find = (selector) => player.querySelector(selector);
  const play = find('.play'),
    back = find('.back'),
    step = find('.step'),
    reset = find('.reset');
  const speed = find('.speed'),
    slider = find('input'),
    clock = find('.clock'),
    notice = find('.notice');
  let experiment = new Experiment({}, preset);
  const drawMap = prepareMap(player, experiment.sim);
  let frame = 0,
    running = false,
    seekTarget = null,
    previous = 0,
    lastDraw = 0;
  let furthest = 0,
    atLimit = false;

  function draw() {
    const time = experiment.sim.time;
    furthest = Math.max(furthest, time);
    drawMap(experiment.sim);
    clock.textContent = stamp(time);
    slider.max = Math.floor(furthest);
    slider.value = Math.floor(time);
    slider.setAttribute('aria-valuetext', stamp(time));
    slider.disabled = furthest < 1;
    back.disabled = time <= 0;
    step.disabled = atLimit;
    play.disabled = atLimit;
    play.textContent = running || seekTarget !== null ? 'Pause' : 'Play';
  }

  function pause() {
    cancelAnimationFrame(frame);
    running = false;
    seekTarget = null;
  }

  function tick(now) {
    try {
      if (seekTarget !== null) {
        atLimit = advanceTimedSpeed(experiment, seekTarget - experiment.sim.time);
        if (experiment.sim.time >= seekTarget) seekTarget = null;
      } else {
        const seconds = Math.min(0.2, (now - previous) / 1000) * Number(speed.value);
        atLimit =
          speed.value === 'max'
            ? advanceMaxSpeed(experiment)
            : advanceTimedSpeed(experiment, seconds);
      }
      if (atLimit) notice.textContent = 'Run limit reached. Rewind or reset to play again.';
    } catch (error) {
      atLimit = true;
      notice.textContent = error.message + ' Rewind or reset to play again.';
    }
    if (atLimit) pause();
    previous = now;
    if (now - lastDraw >= 60 || (!running && seekTarget === null)) {
      draw();
      lastDraw = now;
    }
    if (running || seekTarget !== null) frame = requestAnimationFrame(tick);
  }

  function seek(seconds) {
    pause();
    const target = Math.max(0, Math.min(MAX_SIMULATION_SECONDS, seconds));
    // Rebuild from the preset seed. Replay in bounded frames, even after hours of play.
    if (target < experiment.sim.time) experiment = new Experiment({}, preset);
    atLimit = false;
    notice.textContent = '';
    if (target > experiment.sim.time) {
      seekTarget = target;
      frame = requestAnimationFrame(tick);
    }
    draw();
  }
  play.onclick = () => {
    if (running || seekTarget !== null) pause();
    else {
      previous = performance.now();
      running = true;
      frame = requestAnimationFrame(tick);
    }
    draw();
  };
  back.onclick = () => seek(experiment.sim.time - 60);
  step.onclick = () => seek(experiment.sim.time + 60);
  reset.onclick = () => {
    furthest = 0;
    seek(0);
  };
  slider.oninput = () => {
    pause();
    clock.textContent = stamp(Number(slider.value));
    slider.setAttribute('aria-valuetext', clock.textContent);
    play.textContent = 'Play';
  };
  slider.onchange = () => seek(Number(slider.value));
  draw();
}

document.querySelectorAll('.inset[data-preset]').forEach(mount);
