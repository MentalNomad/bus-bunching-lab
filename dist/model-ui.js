import { convertScenario } from './scenario-format.js?v=20261015c';
import {
  normalizeControllerOptions,
  defaultControllerOptions,
} from './controller-options.js?v=20261015c';
import {
  summarizeCohort,
  compareCohorts,
  measurementExport,
  measurementCSV,
} from './measurements.js?v=20261015c';

// All controls go through Experiment, including replay validation. Text from
// imported scenarios is assigned with textContent, never interpreted as markup.
export function setupModelControls({ getExperiment, install, pause, render }) {
  const $ = (id) => document.getElementById(id);
  const cohortHelp = {
    'Cohort passengers':
      'People present just before the cohort boundary, including riders aboard and completions exactly then, plus births through the inclusive cutoff. Full original journey clocks are retained.',
    Completed:
      'Cohort passengers who reached their final destination. Earlier completed passengers outside the cohort are excluded.',
    Unfinished:
      'Cohort passengers still waiting, boarding, riding or alighting. Their elapsed cost remains in accrued time; complete outcomes stay unavailable until all finish.',
    'Accrued passenger-seconds':
      'Sum of each cohort passenger’s completed journey time or elapsed time since original birth. Includes initial queue wait. Compare incomplete runs only at the same horizon and matched demand.',
    'Queue passenger-seconds':
      'Sum of original queue waiting across the cohort. Queue time ends when boarding starts; transferring never resets the original journey clock.',
    'Onboard passenger-seconds':
      'Accrued cohort time outside queues: boarding, road travel, onboard holds and final alighting. Includes work already in progress at the observation time.',
    'Complete-cohort mean':
      'Average full journey seconds, including initial wait, for the entire matched cohort. Available only after cutoff and complete drain.',
    'Complete-cohort p95':
      'Nearest-rank 95th percentile of full cohort journey seconds. Five percent of journeys can be longer. Available only after complete drain.',
    'Complete-cohort maximum':
      'Longest full journey among every cohort rider, including initial wait. Available only after cutoff and complete drain; unfinished costly riders cannot disappear from this statistic.',
  };
  const details = document.createElement('details');
  details.id = 'modelControls';
  details.innerHTML = `<summary>Model, assumptions & observation horizon</summary>
    <p id="modelRevision" class="hint"></p><button type="button" id="convertModel">Make a corrected copy & reset</button>
    <p class="hint">Old scenarios retain historical behavior. Conversion makes a new lesson. Physical settings below require the corrected model.</p>
    <label>Stop overhead <span>seconds before doors, 0–120</span><input name="stopOverhead" type="number" min="0" max="120" step="any" value="0" required></label>
    <label>Bus capacity <span>seats; blank = unlimited</span><input name="capacity" type="number" min="1" max="500" step="1"></label>
    <label>Road overtaking<select name="overtaking"><option value="true">Allowed</option><option value="false">Prevent overtaking</option></select></label>
    <label>Arrival cutoff <span>simulation seconds; blank = continuous</span><input name="arrivalCutoff" type="number" min="0" max="604800" step="any"></label>
    <label>Cohort boundary <span>simulation seconds, before every intervention</span><input name="cohortStart" type="number" min="0" max="604800" step="any" value="0" required></label>
    <label>Input provenance <span>1,000 characters max</span><textarea name="provenance" maxlength="1000" rows="3"></textarea></label>
    <p class="hint">Overhead occurs once per served visit, even when empty, before door service; holds overlap it. Seats are reserved when boarding starts. Preventing overtaking constrains road motion; several buses may still serve a stop. With no overtaking, the temporal controller conservatively keeps normal service because a reliable joint road forecast is unavailable. Manual controls still work. Example values are illustrative, not measured calibration.</p>`;
  $('config').insertBefore(details, $('config').querySelector('button[type="submit"]'));
  $('config').insertBefore($('modelRevision'), details);
  $('enableManeuvers').onclick = () => $('convertModel').click();

  const controller = document.createElement('details');
  controller.id = 'temporalControls';
  controller.innerHTML = `<summary>Event-based passenger-cost controller</summary><p class="hint">Use observed usable-service history and predicted eligible followers. Missing evidence keeps normal service. Bounded holds and service restrictions are teaching heuristics; they can increase passenger time.</p><form id="temporalPolicy"><div class="two"><label>Start <span>simulation seconds, inclusive</span><input id="temporalStart" type="number" min="0" max="604800" value="1500" required></label><label>End <span>simulation seconds, exclusive</span><input id="temporalEnd" type="number" min="0" max="604800" value="7200" required></label></div><div id="temporalFields"></div><button type="submit">Apply event controller & reset</button></form><p><a href="scenario-guide.html#corrected" target="_blank" rel="noopener">Model and controller guide ↗</a></p>`;
  document.querySelector('.dispatch').insertBefore(controller, $('message'));
  const labels = {
    response: [
      'Response',
      'Choose a bounded hold, boarding allowance, drop-off-only service or announced pattern.',
    ],
    decisionMode: [
      'Decision cadence',
      'Events includes short and zero dwell visits. Polling uses the same heuristic at the interval below for comparison.',
    ],
    pollSeconds: [
      'Polling interval · seconds',
      'Used only in polling mode; no demand is sampled by prediction.',
    ],
    maxHold: [
      'Hold per action · seconds',
      'Additional deadline requested at one decision; service may absorb part of it. Fully absorbed requests are suppressed without spending budget.',
    ],
    maxVisitHold: [
      'Hold per visit · seconds',
      'Maximum cumulative automatic request at this visit.',
    ],
    repeatBudget: [
      'Hold budget per bus · seconds over run',
      'Persists across stops and activations; it does not reset each lap.',
    ],
    cooldownStops: ['Hold cooldown · visits', 'Following visits without new automatic holding.'],
    benefitFactor: [
      'Benefit / cost threshold',
      'Estimated queue benefit must cover onboard additional delay times this factor.',
    ],
    targetSeconds: [
      'Target service interval · seconds; 0 = estimate',
      'Uses observed eligible-service intervals when available; otherwise a labeled model estimate.',
    ],
    maxFollowerEta: [
      'Maximum eligible-follower ETA · seconds',
      'Restrictions need a plausible follower for affected destinations within this horizon.',
    ],
    maxDenials: [
      'Maximum repeated policy denials per person',
      'Automatic service restores before a further denial would exceed this number. Capacity and manual restrictions may still prevent service and are reported.',
    ],
    maxServiceGap: [
      'Maximum usable-service gap · seconds',
      'Destination-specific safeguard; prediction is uncertain, so breaches are reported.',
    ],
    boardingPassengers: [
      'New boardings allowed per visit · people',
      'A count, not a fraction: first eligible people in queue order, including later arrivals until the allowance is spent. Boarding already underway finishes.',
    ],
    restrictionStops: [
      'Restricted active locations',
      'Bounded number of locations for a new restriction.',
    ],
    leadStops: [
      'Pattern notice · future locations',
      'Normal future locations before the active pattern; boarding already respects the announced destinations.',
    ],
    serveEvery: [
      'Pattern · serve every Nth location',
      'Skip N minus 1 locations, then serve one. Protected accepted drop-offs override skips.',
    ],
    restrictionMaxSeconds: [
      'Restriction duration cap · seconds',
      'Includes notice, holds and travel; normal service restores by expiry.',
    ],
  };
  for (const [key, value] of Object.entries(defaultControllerOptions())) {
    const label = document.createElement('label');
    label.textContent = labels[key]?.[0] ?? key;
    label.dataset.help = labels[key]?.[1] ?? key;
    const field = ['response', 'decisionMode'].includes(key)
      ? document.createElement('select')
      : document.createElement('input');
    field.name = key;
    if (field.tagName === 'SELECT') {
      const choices =
        key === 'response'
          ? [
              ['hold', 'Hold followers'],
              ['boarding', 'Boarding allowance'],
              ['dropoff', 'Drop-off-only'],
              ['pattern', 'Announced skip pattern'],
            ]
          : [
              ['events', 'Stop events'],
              ['polling', 'Scheduled polling comparison'],
            ];
      for (const [v, text] of choices) field.add(new Option(text, v));
    } else {
      field.type = 'number';
      field.step = 'any';
      field.required = true;
    }
    field.value = value;
    label.append(field);
    $('temporalFields').append(label);
  }

  const boarding = document.createElement('details');
  boarding.innerHTML = `<summary>Manual bounded boarding</summary><p class="hint">Accepted drop-offs and boarding in progress finish. Manual restrictions can breach service safeguards; inspect the decision report.</p><label>New riders per visit<input id="boardingCount" type="number" min="0" max="500" value="5" required></label><label>Stop locations<input id="boardingLocations" type="number" min="1" max="400" value="3" required></label><label>Maximum seconds<input id="boardingDuration" type="number" min="1" max="604800" value="600" required></label><button type="button" id="manualBoarding">Limit boarding on selected bus</button>`;
  document.querySelector('.dispatch').insertBefore(boarding, controller);

  const panel = document.createElement('section');
  panel.className = 'panel comparison-panel';
  panel.id = 'passengerComparison';
  panel.innerHTML = `<h2>Complete passenger comparisons</h2><p class="hint">Cohort: everyone present just before the boundary, including riders aboard, plus arrivals through the inclusive cutoff. Original whole-journey clocks include the initial queue wait. A completed-only average can hide unfinished riders.</p><p id="cohortStatus" role="status"></p><div id="cohortNumbers" class="cohort-numbers"></div><div class="toolbar"><button id="drainRun" type="button">Run to cutoff & drain</button><button id="cancelDrain" type="button" hidden>Pause drain</button><button id="captureComparison" type="button">Keep this observation for comparison</button><button id="compareObservation" type="button">Compare with kept observation</button><button id="exportMeasurement" type="button">Export passenger record JSON ↓</button><button id="exportPassengerCSV" type="button">Export passenger record CSV ↓</button></div><p id="comparisonStatus" role="status"></p><details><summary>Controller evidence & safeguards</summary><p id="controllerStatus"></p><pre id="controllerEvidence" class="decision-evidence"></pre><p>Full decision contexts, passenger birth records and input provenance are included in the JSON export.</p></details>`;
  document.querySelector('main').insertBefore(panel, document.querySelector('.metrics'));
  let kept = null,
    drainToken = 0,
    observedTime = -1,
    observedSim = null,
    observedWall = -Infinity;
  const act = (fn) => {
    pause();
    try {
      fn();
    } catch (e) {
      $('message').textContent = e.message;
    }
    render();
  };
  function editedDefinition() {
    const e = getExperiment(),
      d = structuredClone(e.definition);
    d.id = 'custom-working';
    d.custom = true;
    d.config = { ...e.config };
    d.events.push(...structuredClone(e.commands));
    return d;
  }
  $('convertModel').onclick = () =>
    act(() => {
      const e = getExperiment(),
        d = convertScenario(editedDefinition(), e.config);
      install(d);
      $('message').textContent = 'Created a corrected copy. The original scenario is retained.';
    });
  $('temporalPolicy').onsubmit = (event) => {
    event.preventDefault();
    act(() => {
      const e = getExperiment();
      if (e.config.semantics !== 'ordered-v3')
        throw Error('Make a corrected copy first to use event control.');
      const raw = Object.fromEntries(new FormData(event.target));
      for (const key of Object.keys(raw))
        if (!['response', 'decisionMode'].includes(key)) raw[key] = Number(raw[key]);
      const d = editedDefinition();
      d.policy = 'temporal-v3';
      d.formatVersion = 3;
      d.policyOptions = normalizeControllerOptions(raw, e.config);
      d.policySchedule = {
        start: Number($('temporalStart').value),
        end: Number($('temporalEnd').value),
      };
      d.name = 'Passenger-cost controller · edited lesson';
      d.description =
        'Illustrative bounded passenger-cost controller. The exported rule records the exact options, observation boundary and physical assumptions.';
      install(d);
      $('message').textContent =
        'Controller applied and run restarted. Export the scenario to save this lesson.';
    });
  };
  $('manualBoarding').onclick = () =>
    act(() =>
      getExperiment().action(Number($('bus').value), 'boarding', {
        passengers: Number($('boardingCount').value),
        stops: Number($('boardingLocations').value),
        untilRecovered: false,
        maxSeconds: Number($('boardingDuration').value),
      }),
    );
  $('captureComparison').onclick = () =>
    act(() => {
      const e = getExperiment();
      kept = {
        sim: structuredClone(e.sim),
        definition: structuredClone(e.definition),
        commands: structuredClone(e.commands),
      };
      $('comparisonStatus').textContent =
        `Kept “${e.definition.name}” at ${e.sim.time.toFixed(1)} seconds. Reset or load another policy with the same demand and boundaries, then compare.`;
    });
  $('compareObservation').onclick = () =>
    act(() => {
      if (!kept) throw Error('Keep an observation first.');
      const e = getExperiment(),
        starts = (d, commands) =>
          [...d.events, ...commands]
            .map((x) => x.t)
            .concat(d.policy ? [d.policySchedule?.start ?? 1500] : []);
      const result = compareCohorts(kept.sim, e.sim, {
        treatmentStarts: [
          ...starts(kept.definition, kept.commands),
          ...starts(e.definition, e.commands),
        ],
      });
      if (!result.matched) {
        $('comparisonStatus').textContent =
          'Comparison rejected: full ordered passenger births, cohort membership or intervention boundaries differ. Use the same setup, demand seed and arrival cutoff, with no treatment before the cohort boundary.';
        return;
      }
      $('comparisonStatus').textContent = result.complete
        ? `Matched complete cohorts: current mean ${result.right.completeMean?.toFixed(1) ?? '—'} seconds; kept mean ${result.left.completeMean?.toFixed(1) ?? '—'} seconds. Current minus kept: ${result.meanDifference?.toFixed(1) ?? '—'} seconds per passenger.`
        : result.accruedDifference !== null
          ? `Matched cohorts at the same horizon; current minus kept accrued cost: ${result.accruedDifference.toFixed(1)} passenger-seconds. Complete journey outcomes remain unavailable until both drain.`
          : 'Demand and cohort match, but horizons differ and at least one cohort is unfinished. Drain both, or compare at the same observation time.';
    });
  function download(text, type, name) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('exportMeasurement').onclick = () =>
    act(() => {
      const e = getExperiment();
      download(
        JSON.stringify(
          {
            ...measurementExport(e.sim),
            experiment: e.export(),
            denials: {
              policy: e.sim.policyDenials ?? null,
              capacity: e.sim.capacityDenials ?? null,
            },
            automaticHolding: {
              requested: e.sim.autoHoldRequested ?? null,
              realized: e.sim.autoHoldRealized ?? null,
            },
          },
          null,
          2,
        ),
        'application/json',
        `passenger-observation-${Math.floor(e.sim.time)}s.json`,
      );
    });
  $('exportPassengerCSV').onclick = () =>
    act(() =>
      download(
        measurementCSV(getExperiment().sim),
        'text/csv',
        `passengers-${Math.floor(getExperiment().sim.time)}s.csv`,
      ),
    );
  $('cancelDrain').onclick = () => {
    drainToken++;
    $('cancelDrain').hidden = true;
    $('drainRun').disabled = false;
  };
  $('drainRun').onclick = () => {
    pause();
    const e = getExperiment(),
      cutoff = e.config.arrivalCutoff;
    if (cutoff == null) {
      $('comparisonStatus').textContent =
        'Set an arrival cutoff in Route setup and apply it before draining.';
      return;
    }
    const token = ++drainToken,
      end = Math.min(
        604800,
        Math.max(cutoff, e.sim.time) + (e.definition.drainMaxSeconds ?? 86400),
      );
    $('cancelDrain').hidden = false;
    $('drainRun').disabled = true;
    let expectedTime = e.sim.time,
      expectedSim = e.sim;
    function tick() {
      if (
        token !== drainToken ||
        getExperiment() !== e ||
        e.sim !== expectedSim ||
        e.sim.time !== expectedTime
      ) {
        $('cancelDrain').hidden = true;
        $('drainRun').disabled = false;
        return;
      }
      let error = null;
      try {
        e.advanceTo(Math.min(end, e.sim.time + 60));
      } catch (err) {
        error = err.message;
      }
      expectedTime = e.sim.time;
      expectedSim = e.sim;
      render();
      const complete = e.sim.time >= cutoff && e.sim.created === e.sim.completed;
      if (error || complete || e.sim.time >= end) {
        $('cancelDrain').hidden = true;
        $('drainRun').disabled = false;
        $('comparisonStatus').textContent = error
          ? `Drain incomplete: ${error}`
          : complete
            ? 'Drain complete. All passengers through the cutoff reached their destinations.'
            : 'Drain bound reached; unfinished passengers remain. Complete-cohort outcomes are unavailable.';
        return;
      }
      setTimeout(tick, 0);
    }
    tick();
  };
  function sync() {
    const e = getExperiment(),
      c = e.config,
      ordered = c.semantics === 'ordered-v3';
    $('modelRevision').textContent = ordered
      ? 'Model: ordered-v3 · deterministic circular neighbors and corrected recovery.'
      : 'Model: legacy-v2 · historical gaps, recovery and polling preserved.';
    for (const key of [
      'stopOverhead',
      'stoppingDelay',
      'startingDelay',
      'capacity',
      'overtaking',
      'arrivalCutoff',
      'cohortStart',
      'provenance',
    ]) {
      const field = $('config').elements[key];
      field.value =
        c[key] ??
        {
          stopOverhead: 0,
          stoppingDelay: 0,
          startingDelay: 0,
          capacity: '',
          overtaking: true,
          arrivalCutoff: '',
          cohortStart: 0,
          provenance: 'Illustrative teaching model; not empirically calibrated.',
        }[key];
      field.disabled =
        !ordered &&
        ['stopOverhead', 'stoppingDelay', 'startingDelay', 'capacity', 'overtaking'].includes(key);
    }
    $('convertModel').disabled = ordered;
    $('legacyManeuverHint').hidden = ordered;
    $('temporalPolicy').querySelector('button').disabled = !ordered;
    $('manualBoarding').disabled = !ordered;
    const options =
      e.definition.policy === 'temporal-v3'
        ? e.definition.policyOptions
        : defaultControllerOptions();
    for (const [key, value] of Object.entries(options))
      if ($('temporalPolicy').elements[key]) $('temporalPolicy').elements[key].value = value;
    $('temporalStart').value = e.definition.policySchedule?.start ?? 1500;
    $('temporalEnd').value = e.definition.policySchedule?.end ?? c.arrivalCutoff ?? 7200;
    observedSim = null;
  }
  function readConfig(c) {
    const e = getExperiment();
    return {
      ...c,
      semantics: e.config.semantics ?? 'legacy-v2',
      stopOverhead: Number(c.stopOverhead ?? 0),
      stoppingDelay: Number(c.stoppingDelay ?? 0),
      startingDelay: Number(c.startingDelay ?? 0),
      capacity: c.capacity ? Number(c.capacity) : null,
      overtaking: c.overtaking !== 'false',
      arrivalCutoff: c.arrivalCutoff === '' ? null : Number(c.arrivalCutoff),
      cohortStart: Number(c.cohortStart),
      provenance: c.provenance,
    };
  }
  function update(force = false) {
    const s = getExperiment().sim;
    // Rendering paused frames must not scan the passenger ledger repeatedly.
    if (observedSim === s && observedTime === s.time) return;
    if (!force && observedSim === s && performance.now() - observedWall < 500) return;
    observedSim = s;
    observedTime = s.time;
    observedWall = performance.now();
    const m = summarizeCohort(s),
      fmt = (x) => (x === null ? 'Unavailable' : `${x.toFixed(1)} s`);
    $('cohortStatus').textContent =
      `Observed through ${m.horizon.toFixed(1)} s · cohort boundary ${m.cohortStart} s · ${m.arrivalCutoff === null ? 'continuous arrivals' : `inclusive cutoff ${m.arrivalCutoff} s`} · ${m.complete ? 'COMPLETE COHORT' : 'INCOMPLETE COHORT'}`;
    $('cohortNumbers').replaceChildren();
    for (const [label, value] of [
      ['Cohort passengers', m.created],
      ['Completed', m.completed],
      ['Unfinished', m.unfinished],
      ['Accrued passenger-seconds', m.accruedPassengerSeconds.toFixed(1)],
      ['Queue passenger-seconds', m.queuePassengerSeconds.toFixed(1)],
      ['Onboard passenger-seconds', m.onboardPassengerSeconds.toFixed(1)],
      ['Complete-cohort mean', fmt(m.completeMean)],
      ['Complete-cohort p95', fmt(m.completeP95)],
      ['Complete-cohort maximum', fmt(m.completeMax)],
    ]) {
      const row = document.createElement('p'),
        strong = document.createElement('strong');
      row.textContent = `${label}: `;
      row.dataset.help = cohortHelp[label];
      row.tabIndex = 0;
      strong.textContent = value;
      row.append(strong);
      $('cohortNumbers').append(row);
    }
    const checks = m.diagnostics;
    $('controllerStatus').textContent =
      `Conservation ${checks.conserved ? 'passes' : 'FAILED'}; independent time integrals ${checks.passengerTimeIntegral && checks.queueTimeIntegral && checks.onboardTimeIntegral ? 'agree' : 'FAILED'}. Policy denials: ${s.policyDenials ?? 'historical combined counts'}; capacity denials: ${s.capacityDenials ?? 0}. Automatic holding requested ${s.autoHoldRequested ?? 0} s; realized extra dwell ${s.autoHoldRealized ?? 0} s. ${s.controller ? `Denial safeguard breaches: ${s.controller.metrics.serviceGapBreaches}; completed destination-service intervals above the configured gap limit: ${s.controller.metrics.observedServiceGapBreaches ?? 0}; maximum repeated denials ${s.controller.metrics.maximumRepeatedDenials}; longest observed destination-eligible service gap ${s.controller.metrics.maximumObservedEligibleServiceGap.toFixed(1)} s.` : 'No temporal controller active.'}`;
    $('controllerEvidence').textContent =
      s.controller?.decisions
        .slice(-12)
        .reverse()
        .map(
          (d) =>
            `${d.t.toFixed(1)}s · Bus ${d.bus + 1} · stop ${d.stop + 1}${d.destination == null ? '' : ` → destination ${d.destination + 1}`}${d.gap == null ? '' : ` · gap ${d.gap.toFixed(1)}s`} · ${d.kind}: ${d.reason}`,
        )
        .join('\n') || 'No controller decisions yet.';
  }
  return { sync, readConfig, render: update };
}
