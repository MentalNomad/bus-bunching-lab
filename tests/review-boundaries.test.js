import test from 'node:test';
import assert from 'node:assert/strict';
import {Experiment} from '../dist/experiment.js';
import {parseScenario,serializeScenario} from '../dist/scenario-format.js';

test('the last allowed intervention remains shareable and one more leaves the run unchanged',()=>{
  const original=new Experiment();
  const text=JSON.parse(serializeScenario(original.definition,original.config));
  text.interventions=Array.from({length:1000},(_,i)=>({at_seconds:100+i*10,bus:1,action:'hold',seconds:1}));
  const definition=parseScenario(JSON.stringify(text)),e=new Experiment({},'custom',definition);
  const before=structuredClone(e.sim);
  assert.throws(()=>e.action(0,'hold',1),/1,000/);
  assert.deepEqual(structuredClone(e.sim),before);
  assert.equal(e.commands.length,0);
  assert.equal(parseScenario(serializeScenario(e.definition,e.config,e.commands)).events.length,1000);
});

test('a failed rewind preserves the model, timeline and recorded interventions',()=>{
  const e=new Experiment();e.advanceTo(180);e.action(0,'hold',10);e.advanceTo(240);
  const sim=e.sim,before=structuredClone(e),prototype=Object.getPrototypeOf(sim),advance=prototype.advance;
  prototype.advance=function(){throw Error('Simulated replay failure');};
  try{assert.throws(()=>e.seek(60),/replay failure/);}finally{prototype.advance=advance;}
  assert.equal(e.sim,sim);
  assert.deepEqual(structuredClone(e),before);
});

test('restored timeline bounds cannot exceed the supported run duration',()=>{
  const copy=new Experiment().export();
  for(const furthest of [-1,Infinity,604801])assert.throws(()=>Experiment.restore({...copy,furthest}),/copy|timeline/i);
});

test('manual dispatch operates on the current model without replaying its history',()=>{
  const e=new Experiment({},'variance');e.advanceTo(3600);
  const sim=e.sim,prototype=Object.getPrototypeOf(sim),advance=prototype.advance;
  prototype.advance=function(seconds){if(seconds>0)throw Error('Dispatch must not replay');return advance.call(this,seconds);};
  try{e.action(0,'hold',30);}finally{prototype.advance=advance;}
  assert.equal(e.sim,sim);assert.equal(e.commands.length,1);
  const copy=Experiment.restore(e.export());assert.deepEqual(structuredClone(copy.sim),structuredClone(sim));
});

test('manual dispatch at an automatic recovery check replays and shares the same outcome',()=>{
  const definition={name:'Policy tie',description:'A delayed leading bus creates a short forward gap.',config:{},
    events:[{t:0,bus:1,type:'slow',value:10}],policy:'hold',policySchedule:{start:40,end:40,interval:30}};
  const e=new Experiment({},'custom-policy-tie',definition);e.advanceTo(40);
  // Bus 1 is boarding at the check; slowed Bus 2 is close enough to trigger a hold.
  assert(e.sim.buses[0].holdUntil>41,'the automatic check must apply a material hold');
  e.action(0,'hold',1);
  const expected=structuredClone(e.sim);
  assert.deepEqual(structuredClone(Experiment.restore(e.export()).sim),expected);
  const lesson=parseScenario(serializeScenario(e.definition,e.config,e.commands));
  const imported=new Experiment(lesson.config,'custom-roundtrip',lesson);imported.advanceTo(40);
  assert.deepEqual(structuredClone(imported.sim),expected);
  e.seek(20);e.advanceTo(40);assert.deepEqual(structuredClone(e.sim),expected);
});
