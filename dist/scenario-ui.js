import { scenarios } from './experiment.js?v=20261015g';
import {
  parseScenario,
  serializeScenario,
  ruleDescriptions,
  correctedRuleDescriptions,
} from './scenario-format.js?v=20261015g';
import { builtInScenarioIds, scenarioUrl } from './scenario-links.js?v=20261015g';
const storageKey = 'bus-lab-custom-scenarios-v1';
function readCustomPresets() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (!Array.isArray(saved) || saved.length > 100)
    throw Error('Saved presets could not be read. Existing browser data has been kept.');
  const presets = new Map();
  for (const item of saved) {
    if (!item || typeof item.id !== 'string' || !/^custom-[a-f0-9-]+$/.test(item.id))
      throw Error('A saved preset is invalid. Existing browser data has been kept.');
    const preset = parseScenario(item.text);
    preset.id = item.id;
    preset.custom = true;
    presets.set(item.id, preset);
  }
  return [...presets.values()];
}
function mergeCustomPresets(saved) {
  for (const preset of saved) {
    const index = scenarios.findIndex((s) => s.id === preset.id);
    if (index < 0) scenarios.push(preset);
    else scenarios[index] = preset;
  }
}
export function loadCustomPresets() {
  try {
    mergeCustomPresets(readCustomPresets());
  } catch {}
}
export function setupScenarioLibrary(getExperiment) {
  const library = document.querySelector('.scenario-panel'),
    select = document.getElementById('scenario');
  const actions = library.querySelector('.scenario-actions');
  function refresh() {
    const value = getExperiment().scenarioId;
    select.replaceChildren();
    for (const s of scenarios) {
      if (s.aliasFor && s.id !== value) continue;
      const option = document.createElement('option');
      option.value = s.id;
      option.textContent = (s.custom ? 'Custom · ' : '') + s.name;
      select.append(option);
    }
    select.value = value;
  }
  refresh();
  const linkButton = document.createElement('button');
  linkButton.type = 'button';
  linkButton.id = 'copyScenarioLink';
  linkButton.textContent = 'Copy scenario link';
  const linkStatus = document.createElement('p');
  linkStatus.className = 'hint';
  linkStatus.id = 'scenarioLinkStatus';
  linkStatus.setAttribute('role', 'status');
  linkStatus.setAttribute('aria-live', 'polite');
  actions.append(linkButton);
  library.append(linkStatus);
  function updateLink() {
    linkButton.disabled = !builtInScenarioIds.includes(select.value);
    linkStatus.textContent = linkButton.disabled
      ? 'Custom presets: load the preset, then use Export scenario to share its setup.'
      : '';
    document.getElementById('scenarioDescription').textContent =
      scenarios.find((s) => s.id === select.value)?.description || '';
  }
  select.addEventListener('change', updateLink);
  updateLink();
  const guideLink = document.createElement('a');
  guideLink.className = 'scenario-guide-link';
  guideLink.href = './scenario-guide.html';
  guideLink.target = '_blank';
  guideLink.rel = 'noopener';
  guideLink.textContent = 'Scenario writing guide ↗';
  guideLink.setAttribute('aria-label', 'Scenario writing guide (opens in a new tab)');
  actions.append(guideLink);
  linkButton.onclick = async () => {
    try {
      const url = scenarioUrl(location.href, select.value);
      try {
        await navigator.clipboard.writeText(url);
        linkStatus.textContent =
          'Scenario link copied. Opens the selected built-in preset, paused at time zero.';
      } catch {
        linkStatus.replaceChildren('Copy this scenario link: ');
        const input = document.createElement('input');
        input.readOnly = true;
        input.value = url;
        input.setAttribute('aria-label', 'Scenario link');
        linkStatus.append(input);
        input.focus();
        input.select();
      }
    } catch (e) {
      linkStatus.textContent = e.message;
    }
  };
  const dialog = document.createElement('dialog');
  dialog.className = 'scenario-dialog';
  dialog.setAttribute('aria-labelledby', 'scenarioDialogTitle');
  dialog.innerHTML =
    '<div class="dialog-heading"><h2 id="scenarioDialogTitle"></h2><button type="button" id="closeScenarioDialog" aria-label="Close scenario text">×</button></div><p id="scenarioTextHelp"></p><p class="guide-intro"><a href="./scenario-guide.html" target="_blank" rel="noopener">Read the scenario writing guide ↗</a> — complete examples, action reference and recovery rules. Opens in a new tab so this run stays open.</p><label for="scenarioText">Scenario text</label><textarea id="scenarioText" spellcheck="false"></textarea><details class="format-guide"><summary>Text format & recovery-rule reference</summary><p>This is JSON: keep field names and quotes, use numbers without quotes, and avoid trailing commas. Edit name and description for your lesson. Times are seconds from time zero; bus numbers start at 1. Actions: hold uses seconds, slow uses multiplier (1–10), express uses stops. Events at the same time run in listed order, after any recovery check at that time. The setup and seed reproduce arrivals. Imports support up to 1,000 interventions and a seven-day schedule.</p><p>Ideal gap = stops ÷ buses. Forward gap is the distance to the nearest bus ahead, in stop units. recovery_policy can be null, or specify a versioned rule and start_seconds, end_seconds (inclusive), and check_every_seconds. The rule defines the following exact behavior:</p><div id="ruleReference"></div><p>Scenarios start empty with evenly spaced buses. Export includes all preset events and manual interventions recorded in the current run, including later events retained while reviewing history. It excludes current passengers, observations, chart settings, playback speed, and page layout. Imported presets are saved in this browser; keep exported text to share or back up.</p></details><p id="scenarioTextMessage" role="status" aria-live="polite"></p><div class="dialog-actions"><button type="button" id="copyScenarioText">Copy text</button><button type="button" id="saveScenarioText" class="primary">Save as preset</button></div>';
  document.body.append(dialog);
  const v2Reference = document.createElement('p');
  v2Reference.textContent =
    'Version 1 files remain supported. Version 2 adds drop_off_only (stops, until_recovered, max_seconds), announced_skip (lead_stops, serve_every, for_stops, until_recovered, max_seconds), and normal_service (no parameters). A null stop span means ongoing service until canceled or capped. New service modes preserve accepted drop-offs. The two-gap-v2 rule adds condition and response objects; use the guide’s complete examples for their exact fields. Apply dispatch & reset in the dispatch desk can create and export a policy without editing JSON.';
  dialog
    .querySelector('.format-guide')
    .insertBefore(v2Reference, dialog.querySelector('#ruleReference'));
  const textarea = dialog.querySelector('textarea'),
    message = dialog.querySelector('#scenarioTextMessage'),
    save = dialog.querySelector('#saveScenarioText'),
    copy = dialog.querySelector('#copyScenarioText');
  for (const [rule, description] of Object.entries({
    ...ruleDescriptions,
    ...correctedRuleDescriptions,
  })) {
    const p = document.createElement('p'),
      strong = document.createElement('strong');
    strong.textContent = rule + ': ';
    p.append(strong, description);
    dialog.querySelector('#ruleReference').append(p);
  }
  let opener;
  function close() {
    dialog.close();
    opener?.focus();
  }
  dialog.querySelector('#closeScenarioDialog').onclick = close;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        close();
    }
  });
  function open(mode, button) {
    opener = button;
    const exporting = mode === 'export';
    dialog.querySelector('h2').textContent = exporting ? 'Export scenario' : 'Import scenario';
    dialog.querySelector('#scenarioTextHelp').textContent = exporting
      ? 'Copy this complete text to share the active run’s setup and interventions. You can edit its name and description before sharing.'
      : 'Paste the complete exported text. Saving adds a custom preset; it does not replace your current run.';
    message.textContent = '';
    try {
      textarea.value = exporting
        ? serializeScenario(
            getExperiment().definition,
            getExperiment().config,
            getExperiment().commands,
          )
        : '';
    } catch (error) {
      textarea.value = '';
      message.textContent = error.message;
    }
    save.hidden = exporting;
    copy.hidden = !exporting;
    dialog.showModal();
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    textarea.scrollTop = 0;
  }
  for (const [mode, label] of [
    ['export', 'Export scenario'],
    ['import', 'Import scenario'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = mode + 'Scenario';
    button.textContent = label;
    button.onclick = () => open(mode, button);
    actions.append(button);
  }
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      message.textContent = 'Scenario text copied.';
    } catch {
      textarea.focus();
      textarea.select();
      message.textContent = 'Text selected. Use your device’s Copy command.';
    }
  };
  save.onclick = async () => {
    if (save.disabled) return;
    save.disabled = true;
    try {
      const scenario = parseScenario(textarea.value);
      scenario.id = 'custom-' + crypto.randomUUID();
      scenario.custom = true;
      const persist = () => {
        // Read inside the lock: comparison windows can have stale in-memory lists.
        const custom = readCustomPresets();
        if (custom.length >= 100) throw Error('This browser already has 100 custom presets.');
        const saved = [...custom, scenario];
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify(saved.map((s) => ({ id: s.id, text: serializeScenario(s, s.config) }))),
          );
        } catch {
          throw Error(
            'Unable to save in this browser. Browser storage may be full or disabled. Keep the text and try another browser.',
          );
        }
        mergeCustomPresets(saved);
      };
      if (navigator.locks?.request) await navigator.locks.request(storageKey, persist);
      else persist();
      refresh();
      select.value = scenario.id;
      updateLink();
      message.textContent = `Saved “${scenario.name}”. Close this panel, then choose Load scenario & reset to run it.`;
    } catch (error) {
      message.textContent = error.message;
      save.disabled = false;
    }
  };
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey) return;
    const selected = select.value;
    try {
      mergeCustomPresets(readCustomPresets());
      refresh();
      if (scenarios.some((s) => s.id === selected)) select.value = selected;
      updateLink();
    } catch {}
  });
  textarea.addEventListener('input', () => {
    save.disabled = false;
    message.textContent = '';
  });
  dialog.addEventListener('close', () => {
    save.disabled = false;
  });
}
