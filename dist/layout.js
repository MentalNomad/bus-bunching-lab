// Move complete working sections; use buttons so keyboard and touch work too.
export function setupLayout(){
  const main=document.querySelector('main'),workspace=document.querySelector('.workspace'),metrics=document.querySelector('.metrics'),charts=document.querySelector('.charts-panel'),bottom=document.querySelector('.bottom');
  const library=document.querySelector('.scenario-panel');
  const container=document.createElement('div');container.id='sections';main.insertBefore(container,library);
  const system=charts.querySelector('.system-chart'),buses=document.getElementById('busCharts');
  const settings=document.createElement('section');settings.className='panel';settings.append(charts.querySelector('.chart-heading'));
  system.classList.add('panel');buses.classList.add('panel');const h=document.createElement('h2');h.textContent='Per-bus statistics';h.style.gridColumn='1 / -1';buses.prepend(h);
  const sections=[['route','Live route & dispatch',workspace],['summary','System summary',metrics],['chart-settings','Chart settings',settings],['system','System chart',system],['buses','Bus charts',buses],['log','Dispatch history',bottom.children[0]],['definitions','Model definitions',bottom.children[1]],['scenarios','Scenario Library',library]];
  function refresh(){for(const block of container.children){block.querySelector('[data-move="up"]').disabled=block===container.firstElementChild;block.querySelector('[data-move="down"]').disabled=block===container.lastElementChild;}}
  function closeControls(){for(const nav of container.querySelectorAll('.layout-controls')){nav.querySelector('.layout-menu').hidden=true;nav.querySelector('.layout-toggle').setAttribute('aria-expanded','false');}}
  for(const [id,label,content] of sections){
    const block=document.createElement('section');block.className='movable-block';block.dataset.section=id;
    const nav=document.createElement('nav');nav.className='layout-controls';nav.setAttribute('aria-label',`Position ${label}`);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='layout-toggle';toggle.textContent='↕';toggle.title=`Move ${label}`;toggle.setAttribute('aria-label',`Move section: ${label}`);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',`layout-menu-${id}`);
    const menu=document.createElement('div');menu.className='layout-menu';menu.id=`layout-menu-${id}`;menu.hidden=true;
    toggle.onclick=()=>{const opening=menu.hidden;closeControls();menu.hidden=!opening;toggle.setAttribute('aria-expanded',String(opening));};
    nav.addEventListener('keydown',event=>{if(event.key==='Escape'){closeControls();toggle.focus();}});
    for(const [action,text] of [['first','Show first'],['up','↑ Move up'],['down','↓ Move down']]){
      const button=document.createElement('button');button.type='button';button.textContent=text;button.dataset.move=action;button.setAttribute('aria-label',`${text}: ${label}`);
      button.onclick=()=>{if(action==='first')container.prepend(block);else if(action==='up'&&block.previousElementSibling)container.insertBefore(block,block.previousElementSibling);else if(action==='down'&&block.nextElementSibling)container.insertBefore(block.nextElementSibling,block);refresh();closeControls();window.dispatchEvent(new Event('resize'));toggle.focus();};menu.append(button);
    }
    nav.append(toggle,menu);block.append(nav,content);container.append(block);
  }
  document.addEventListener('click',event=>{if(!event.target.closest('.layout-controls'))closeControls();});
  charts.remove();bottom.remove();refresh();
}
