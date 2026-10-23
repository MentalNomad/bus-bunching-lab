// Move complete working sections; use buttons so keyboard and touch work too.
function collapsible(panel) {
  const disclosure = document.createElement('details'),
    summary = document.createElement('summary'),
    heading = panel.querySelector('h2, h3'),
    headingRow = heading.parentElement;
  disclosure.className = 'panel section-disclosure';
  if (panel.classList.contains('dispatch')) disclosure.classList.add('dispatch-disclosure');
  summary.className = 'section-disclosure-title';
  summary.append(heading);
  if (headingRow.classList.contains('section-title')) headingRow.remove();
  const state = document.createElement('span');
  state.className = 'section-disclosure-state';
  state.setAttribute('aria-hidden', 'true');
  state.innerHTML =
    '<span class="disclosure-show">Show</span><span class="disclosure-hide">Hide</span>';
  summary.append(state);
  panel.replaceWith(disclosure);
  disclosure.append(summary, panel);
  // A canvas needs its expanded dimensions, including when playback is paused.
  disclosure.addEventListener('toggle', () => window.dispatchEvent(new Event('resize')));
  return disclosure;
}

export function setupLayout() {
  const main = document.querySelector('main'),
    workspace = document.querySelector('.workspace'),
    metrics = document.querySelector('.metrics'),
    charts = document.querySelector('.charts-panel'),
    bottom = document.querySelector('.bottom');
  const library = document.querySelector('.scenario-panel');
  const setup = collapsible(workspace.querySelector('.settings')),
    live = workspace.querySelector('.route-panel'),
    dispatch = collapsible(workspace.querySelector('.dispatch'));
  // Playback errors and intervention feedback must remain visible with Dispatch closed.
  live.querySelector('.toolbar').after(document.getElementById('message'));
  const container = document.createElement('div');
  container.id = 'sections';
  main.insertBefore(container, library);
  const system = charts.querySelector('.system-chart'),
    buses = document.getElementById('busCharts');
  const settings = document.createElement('section');
  settings.className = 'panel';
  settings.append(charts.querySelector('.chart-heading'));
  system.classList.add('panel');
  buses.classList.add('panel');
  const h = document.createElement('h2');
  h.textContent = 'Per-bus statistics';
  buses.prepend(h);
  const sections = [
    ['route', 'Live route & dispatch', workspace],
    ['summary', 'System summary', metrics],
    ['log', 'Dispatch history', collapsible(bottom.children[0])],
    ['comparison', 'Passenger comparisons', document.querySelector('.comparison-panel')],
    ['chart-settings', 'Chart settings', collapsible(settings)],
    ['system', 'System chart', collapsible(system)],
    ['buses', 'Bus charts', collapsible(buses)],
    ['definitions', 'Model definitions', bottom.children[1]],
    ['scenarios', 'Scenario Library', library],
  ];
  let layoutChanged = false;
  function refresh() {
    for (const block of container.children) {
      block.querySelector('[data-move="up"]').disabled = block === container.firstElementChild;
      block.querySelector('[data-move="down"]').disabled = block === container.lastElementChild;
    }
  }
  function closeControls() {
    for (const nav of container.querySelectorAll('.layout-controls')) {
      nav.querySelector('.layout-menu').hidden = true;
      nav.querySelector('.layout-toggle').setAttribute('aria-expanded', 'false');
    }
  }
  function createBlock(id, label, content) {
    const block = document.createElement('section');
    block.className = 'movable-block';
    block.dataset.section = id;
    const nav = document.createElement('nav');
    nav.className = 'layout-controls';
    nav.setAttribute('aria-label', `Position ${label}`);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'layout-toggle';
    toggle.textContent = '↕';
    toggle.title = `Move ${label}`;
    toggle.setAttribute('aria-label', `Move section: ${label}`);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `layout-menu-${id}`);
    const menu = document.createElement('div');
    menu.className = 'layout-menu';
    menu.id = `layout-menu-${id}`;
    menu.hidden = true;
    toggle.onclick = () => {
      const opening = menu.hidden;
      closeControls();
      menu.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
    };
    nav.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeControls();
        toggle.focus();
      }
    });
    for (const [action, text] of [
      ['first', 'Show first'],
      ['up', '↑ Move up'],
      ['down', '↓ Move down'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.dataset.move = action;
      button.setAttribute('aria-label', `${text}: ${label}`);
      button.onclick = () => {
        layoutChanged = true;
        if (action === 'first') container.prepend(block);
        else if (action === 'up' && block.previousElementSibling)
          container.insertBefore(block, block.previousElementSibling);
        else if (action === 'down' && block.nextElementSibling)
          container.insertBefore(block.nextElementSibling, block);
        refresh();
        closeControls();
        window.dispatchEvent(new Event('resize'));
        toggle.focus();
      };
      menu.append(button);
    }
    nav.append(toggle, menu);
    block.append(nav, content);
    return block;
  }
  for (const [id, label, content] of sections) container.append(createBlock(id, label, content));
  const desktopBlock = container.querySelector('[data-section="route"]');
  const mobileBlocks = [
    createBlock('live-route', 'Live route', document.createElement('div')),
    createBlock('setup', 'Route setup', document.createElement('div')),
    createBlock('dispatch', 'Dispatch desk', document.createElement('div')),
  ];
  const mobile = window.matchMedia('(max-width:700px)');
  function adaptLayout(redraw = true) {
    closeControls();
    if (mobile.matches && desktopBlock.parentElement === container) {
      for (const [i, content] of [live, setup, dispatch].entries()) {
        const block = mobileBlocks[i];
        block.lastElementChild.remove();
        block.append(content);
        container.insertBefore(block, desktopBlock);
      }
      desktopBlock.remove();
    } else if (!mobile.matches && mobileBlocks.some((block) => block.parentElement === container)) {
      const first = Array.from(container.children).find((block) => mobileBlocks.includes(block));
      container.insertBefore(desktopBlock, first);
      workspace.append(setup, live, dispatch);
      for (const block of mobileBlocks) {
        block.append(document.createElement('div'));
        block.remove();
      }
    }
    if (!layoutChanged) {
      const order = mobile.matches
        ? [
            'live-route',
            'setup',
            'log',
            'dispatch',
            ...sections.map(([id]) => id).filter((id) => !['route', 'log'].includes(id)),
          ]
        : sections.map(([id]) => id);
      for (const id of order) container.append(container.querySelector(`[data-section="${id}"]`));
    }
    refresh();
    if (redraw) window.dispatchEvent(new Event('resize'));
  }
  mobile.addEventListener('change', adaptLayout);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.layout-controls')) closeControls();
  });
  charts.remove();
  bottom.remove();
  adaptLayout(false);
}
