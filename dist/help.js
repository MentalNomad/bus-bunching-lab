const text = {
  'Passengers waiting':
    'Passengers currently in stop queues, including people waiting again after an express transfer. A person boarding is counted as riding instead.',
  'Passengers riding':
    'Passengers aboard buses, plus passengers currently boarding. Includes riders delayed by holds and riders waiting to transfer while still on board.',
  'Trips completed':
    'Passengers who have finished debarking at their intended destination. A forced transfer does not complete a trip. The arrival count is everyone who has entered the system.',
  'Mean queue wait':
    'Arithmetic mean of cumulative queue wait for completed passengers only. Includes the initial queue and every transfer queue; excludes boarding and time aboard. People still waiting or riding are excluded, so compare this with the current passenger counts.',
  'Mean system time':
    'Arithmetic mean of final debarking time minus first arrival time for completed passengers. Includes initial queue wait, boarding, riding, onboard holds, transfer queues, and debarking. This is the whole-run mean, not the chart’s trailing average.',
  'Forced transfers':
    'Number of times passengers are put off a bus because their destination will be skipped. Each must queue and board a later bus. One passenger can transfer more than once.',
  'HEADWAY VARIATION':
    'Spatial gap standard deviation divided by the ideal gap, shown as a percentage. Ideal gap = stops ÷ buses. 0% means evenly spaced; larger values mean less even spacing. This measures spacing around the route, not minutes between arrivals or passenger welfare.',
  'Total system time per completed passenger':
    'One point per completed trip: seconds from first arrival in a stop queue to final debarking. Includes initial wait, transfer waits, all service time, travel, and holds. Unfinished trips have no point yet.',
  'Time stopped per station':
    'Seconds from arrival at a served stop to departure, including boarding, debarking, and holds. Recorded on departure. Stops passed in express service are not served-stop observations.',
  'Cumulative queue wait per passenger at boarding':
    'Queue wait accumulated by this passenger up to this pickup, including earlier transfer queues. Recorded once boarding finishes, plotted at boarding start. A transferred passenger can appear at multiple pickups; these are observations, not unique passengers.',
  'Low · last minute':
    'Smallest individual observation whose plotted time falls within the last 60 simulated seconds (including the boundary). A dash means none occurred. This is not the lowest value over the whole run.',
  'High · last minute':
    'Largest individual observation whose plotted time falls within the last 60 simulated seconds (including the boundary). A dash means none occurred. This is not the highest value over the whole run.',
  'Trailing average':
    'Mean of the most recent observations, using the Trailing window setting. Whole-stop mode includes complete departed-stop groups, so it may exceed the requested count and remains unchanged until departure. Dwell averages use served stops; passenger averages use pickup or completion observations.',
};
const control = {
  stops: 'Number of stops around the loop. Buses begin evenly spaced. Stops are numbered from 1.',
  buses:
    'Number of buses. Ideal spacing is stops divided by buses; buses have unlimited capacity and may overtake.',
  travel:
    'Normal travel time between adjacent stops. Express buses still travel every segment; they save stop service time.',
  rate: 'Passenger arrival rate at each stop, not across the whole route. Fixed demand arrives every 60 ÷ rate seconds; zero creates no passengers.',
  arrival:
    'Fixed arrivals use regular intervals synchronized across stops. Poisson arrivals use independent random intervals with this mean rate, so demand varies even with identical settings.',
  board:
    'Seconds to board one passenger. Boarding is sequential, after debarking; arrivals continue during service.',
  debark:
    'Seconds to debark one passenger. Debarking is sequential and includes forced express transfers.',
  ride: 'Fixed mode uses this many stops. Random mode chooses a uniform integer from 1 to min(2 × this length − 1, stops − 1).',
  rideMode:
    'Fixed rides all have the configured stop count. Random rides use a uniform range around that count, capped below one full loop.',
  seed: 'Starting value for the repeatable random sequence. Matching settings, seed, and interventions produce matching runs.',
  speed:
    'Simulated seconds per real second. Playback speed changes how fast you watch, not simulation outcomes.',
  window:
    'Number of recent passenger observations for wait and system charts; number of served stops for dwell charts. Whole-stop mode retains entire groups, potentially using more than this number. Early runs use available observations.',
  averageMode:
    'Whole stop groups publish chart averages when the bus departs, avoiding partial boarding or debarking groups. Each passenger updates after each observation with exactly the last N observations. Raw individual points and actual service order remain unchanged.',
  dwellAxis:
    'Vertical ceiling in seconds for all bus dwell charts. Zero chooses a shared automatic range based on the whole run. A positive ceiling clips higher points visually without removing data.',
  waitAxis:
    'Vertical ceiling in seconds for all bus queue-wait charts. Zero chooses a shared automatic range based on the whole run. Set the same positive value across windows to compare scenarios.',
  systemAxis:
    'Vertical ceiling in seconds for the system-time graph. Zero selects an automatic range based on the whole run. Clipped observations remain in statistics and CSV.',
  holdValue:
    'Duration added to a hold at the current stop, or queued for the next stop if moving. Boarding can continue during a hold, and onboard passengers experience the delay.',
  slowValue:
    'Multiply remaining time on this segment if moving, or time on the next segment otherwise. A value of 3 means three times the normal remaining travel time.',
  expressValue:
    'Number of consecutive stops to skip after the current service stop, or after the next stop if moving. Riders bound for skipped stops debark and queue here; passengers for skipped destinations do not board this bus.',
  timeline:
    'Review any earlier simulated second. Rewinding pauses playback. A new manual intervention replaces later manual interventions; scheduled preset interventions remain.',
  back: 'Replay from the same seed to one simulated minute earlier, restoring passengers, observations, and dispatch state.',
  step: 'Advance one simulated minute and pause, including passenger arrivals and scheduled dispatch.',
  copy: 'Open an independent paused copy of the current run, with passengers, history, settings, and chart options. Each window can then receive different interventions.',
  reset:
    'Restart the current setup and preset at time zero; clear manual interventions and observations.',
  export:
    'Download every raw observation from the whole run as CSV. Wait rows represent pickups, so a transferred passenger can have multiple rows.',
  loadScenario:
    'Restart with the selected preset’s saved setup, seed, interventions, and recovery policy. Clears the current run.',
  exportScenario:
    'Export the active scenario with the applied setup and recorded manual interventions, starting from time zero. Includes future preset events, but not current passengers or chart settings.',
  importScenario:
    'Paste a version 1 scenario, validate it, and save it as a custom preset in this browser. Choose Load scenario & reset to run it.',
  copyScenarioLink:
    'Copy a link to the selected built-in preset. It opens that preset’s original settings and scheduled events, paused at time zero. Use Export scenario for custom presets, edited settings or manual interventions.',
};
export function setupHelp() {
  const bubble = document.createElement('div');
  bubble.id = 'explanation-tooltip';
  bubble.className = 'explanation-tooltip';
  bubble.role = 'tooltip';
  bubble.hidden = true;
  document.body.append(bubble);
  let active = null;
  function hide() {
    if (active) active.removeAttribute('aria-describedby');
    active = null;
    bubble.hidden = true;
  }
  function show(target) {
    if (!target?.dataset.help) return;
    hide();
    (target.closest('dialog') || document.body).append(bubble);
    active = target;
    bubble.textContent = target.dataset.help;
    bubble.hidden = false;
    target.setAttribute('aria-describedby', bubble.id);
    const r = target.getBoundingClientRect(),
      b = bubble.getBoundingClientRect();
    bubble.style.left = Math.max(8, Math.min(innerWidth - b.width - 8, r.left)) + 'px';
    bubble.style.top =
      (r.bottom + b.height + 12 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - b.height - 8)) +
      'px';
  }
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-help]');
    if (target && target !== active) show(target);
  });
  document.addEventListener('mouseout', (e) => {
    if (
      active !== document.activeElement &&
      active?.contains(e.target) &&
      !active.contains(e.relatedTarget) &&
      !bubble.contains(e.relatedTarget)
    )
      hide();
  });
  document.addEventListener('focusin', (e) => show(e.target.closest('[data-help]')));
  document.addEventListener('focusout', (e) => {
    if (active?.contains(e.target)) hide();
  });
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-help]');
    if (target) show(target);
    else if (!bubble.contains(e.target)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener(
    'scroll',
    () => {
      if (active === document.activeElement) show(active);
      else hide();
    },
    true,
  );
  window.addEventListener('resize', hide);
  function annotate() {
    for (const el of document.querySelectorAll(
      '.metric>span,.chart-numbers>span,.route-center>span,.system-chart h3,.bus-chart h4',
    )) {
      const label = el.firstChild?.textContent?.trim();
      if (text[label]) {
        el.dataset.help = text[label];
        el.tabIndex = 0;
      }
    }
    for (const el of document.querySelectorAll('.chart-numbers small')) {
      el.dataset.help =
        'Observation count covers the last simulated minute. Average count shows how many observations contribute to the current average. Updated is the simulated time the average was last published; raw values may change before a stop departs.';
      el.tabIndex = 0;
    }
    for (const el of document.querySelectorAll('.chart-key')) {
      el.dataset.help =
        'Dots show individual observations; the solid line shows the trailing average. Horizontal axis: simulated minutes. Vertical axis: seconds. Only the last 60 minutes are drawn; averages can include earlier observations.';
      el.tabIndex = 0;
    }
    for (const el of document.querySelectorAll('canvas')) {
      el.dataset.help =
        'Horizontal axis is simulated minutes; vertical axis is seconds. Dots show individual observations and the solid line shows the trailing average. The last 60 minutes are visible. All bus dwell graphs share one scale, and all bus wait graphs share another. A fixed ceiling can clip high observations visually.';
      el.tabIndex = 0;
    }
    const count = document.getElementById('systemCount');
    count.dataset.help =
      'Number of passengers who have finished their trip. Each completed trip contributes one raw system-time observation. People still waiting or riding do not appear in this graph yet.';
    count.tabIndex = 0;
    for (const el of document.querySelectorAll('input,select,button')) {
      const explanation = control[el.name] || control[el.id];
      if (explanation) el.dataset.help = explanation;
    }
    if (active && !active.isConnected) hide();
  }
  annotate();
  return annotate;
}
