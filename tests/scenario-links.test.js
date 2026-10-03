import test from 'node:test';
import assert from 'node:assert/strict';
import {builtInScenarioIds,scenarioFromSearch,scenarioUrl} from '../dist/scenario-links.js';
import {scenarios,Experiment} from '../dist/experiment.js';

test('each built-in scenario link resolves to its complete original preset',()=>{
  assert.deepEqual(builtInScenarioIds,scenarios.map(s=>s.id));
  for(const id of builtInScenarioIds){const url=scenarioUrl('https://example.com/lab?other=1#old-copy',id);assert.equal(url,`https://example.com/lab?scenario=${id}`);const result=scenarioFromSearch(new URL(url).search);assert.deepEqual(result,{id,invalid:false});const e=new Experiment({},result.id);assert.equal(e.sim.time,0);assert.deepEqual(e.definition.events,scenarios.find(s=>s.id===id).events);}
});
test('no link and invalid scenario names use stochastic default; custom presets require text export',()=>{
  assert.deepEqual(scenarioFromSearch(''),{id:'variance',invalid:false});
  for(const search of ['?scenario=nope','?scenario=','?scenario=custom-123','?scenario=%3Cscript%3E'])assert.deepEqual(scenarioFromSearch(search),{id:'variance',invalid:true});
  assert.throws(()=>scenarioUrl('https://example.com','custom-123'),/Export custom/);
});
