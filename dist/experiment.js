import {Simulation} from './engine.js?v=20261003h';
import {parseScenario,serializeScenario} from './scenario-format.js?v=20261003h';

export const scenarios = [
  {id:'balanced',name:'Balanced · fixed arrivals',description:'An evenly spaced baseline with regular arrivals. No interventions.',config:{},events:[]},
  {id:'delay',name:'One delay → bunching',description:'At minute 20, Bus 1 is held for 60 seconds. Watch its queue grow and the following bus catch up.',config:{},events:[{t:1200,type:'hold',bus:0,value:60}]},
  {id:'variance',name:'Random demand → bunching',description:'Poisson arrivals and varied ride lengths gradually disturb the spacing, without any imposed delay. Seed 42 reproduces the run.',config:{arrival:'poisson',rideMode:'random'},events:[]},
  {id:'holds',name:'Recover with bus holds',description:'12 stops, 4 evenly spaced buses and fixed passenger arrivals. At minute 20, Bus 1 receives a 60-second hold. From minute 25 through 60, dispatch checks every 30 seconds and holds buses at service stops when their forward gap is below 95% of the ideal 3 stops. Holds are proportional to the deficit and capped at 120 seconds. Watch queue waits and onboard delay as spacing recovers.',config:{},events:[{t:1200,type:'hold',bus:0,value:60}],policy:'hold'},
  {id:'express',name:'Recover with temporary express',description:'12 stops, 4 evenly spaced buses and fixed passenger arrivals. At minute 20, Bus 1 receives a 60-second hold. From minute 25 through 60, dispatch activates alternating express when a bus has more than 3.75 stops of forward gap. It serves one stop, skips the next, and rechecks at each stop until its gap is 3 stops or less. Only riders bound for the next planned skipped stop transfer. Compare spacing, transfers and total passenger time.',config:{},events:[{t:1200,type:'hold',bus:0,value:60}],policy:'express'},
  {id:'express-count',name:'Compare · fixed-count express',description:'12 stops, 4 evenly spaced buses and fixed arrivals. Bus 1 is held 60 seconds at minute 20. From minute 25 through 60, dispatch checks every 30 seconds. At a service stop, a bus with more than 3.75 stops of forward gap skips ceil(gap − 3) stops, then resumes service. This is a fixed-count heuristic: skipping avoids dwell, not segment travel, so the gap need not recover to 3. Compare with alternating express.',config:{},events:[{t:1200,type:'hold',bus:0,value:60}],policy:'express-count'},
];

// Replay from the seed and timestamped commands restores passengers, random state,
// active service references, observations and scheduled dispatch exactly.
export class Experiment {
  constructor(config={},scenarioId='balanced',definition=null) {
    const scenario=definition||scenarios.find(x=>x.id===scenarioId);
    if(!scenario)throw Error('Unknown scenario');
    this.definition=structuredClone(scenario);this.scenarioId=scenarioId;this.config=new Simulation({...scenario.config,...config}).c;
    const validation=new Simulation(this.config);
    for(const [index,event] of scenario.events.entries()){
      const context=`Scheduled intervention ${index+1} at ${event.t}s`;
      if(!Number.isFinite(event.t)||event.t<0||event.t>604800)throw Error(`${context}: time must be between 0 and 604,800 seconds.`);
      if(!Number.isInteger(event.bus)||event.bus<0||event.bus>=this.config.buses)throw Error(`${context}: Bus ${event.bus+1} does not exist with ${this.config.buses} ${this.config.buses===1?'bus':'buses'}. Increase the bus count or edit the scenario text.`);
      if(event.type==='express'&&(!Number.isInteger(event.value)||event.value<1||event.value>=this.config.stops))throw Error(`${context}: skipping ${event.value} stops is invalid on a ${this.config.stops}-stop route. Use 1–${this.config.stops-1} skips or edit the scenario text.`);
      try{validation.action(event.bus,event.type,event.value);}catch(error){throw Error(`${context} (Bus ${event.bus+1}): ${error.message}`);}
    }
    this.commands=[];this.furthest=0;this.rebuild(0);
  }
  restart(config=this.config){return new Experiment(config,this.scenarioId,this.definition);}
  static restore(data){
    if(data?.version!==1||!Number.isFinite(data.time)||data.time<0||data.time>604800||!Array.isArray(data.commands)||data.commands.length>10000)throw Error('Invalid experiment copy');
    const e=new Experiment(data.config,data.scenarioId,data.scenarioText?parseScenario(data.scenarioText):null);
    for(const x of data.commands){if(!Number.isFinite(x.t)||x.t<0||x.t>604800)throw Error('Invalid command time');new Simulation(e.config).action(x.bus,x.type,x.value);}
    e.commands=structuredClone(data.commands).sort((a,b)=>a.t-b.t);e.furthest=Math.max(data.time,Number.isFinite(data.furthest)?data.furthest:data.time);e.rebuild(data.time);return e;
  }
  export(){return {version:1,config:this.config,scenarioId:this.scenarioId,scenarioText:serializeScenario(this.definition,this.config),time:this.sim.time,furthest:this.furthest,commands:structuredClone(this.commands)};}
  rebuild(target){this.sim=new Simulation(this.config);const scenario=this.definition;this.events=[...scenario.events.map(x=>({...x,source:'preset'})),...this.commands.map(x=>({...x,source:'manual'}))];
    if(scenario.policy){const {start=1500,end=3600,interval=30}=scenario.policySchedule||{};for(let i=0;start+i*interval<=end;i++)this.events.push({t:start+i*interval,type:'policy',policy:scenario.policy,source:'preset'});}
    this.events.sort((a,b)=>a.t-b.t);this.cursor=0;this.advanceTo(target);
  }
  advanceTo(target){if(!Number.isFinite(target)||target<this.sim.time)throw Error('Invalid target time');
    while(this.cursor<this.events.length&&this.events[this.cursor].t<=target){const event=this.events[this.cursor++];this.sim.advance(event.t-this.sim.time);if(event.type==='policy')this.dispatch(event.policy);else this.sim.action(event.bus,event.type,event.value);}
    this.sim.advance(target-this.sim.time);this.furthest=Math.max(this.furthest,target);
  }
  seek(target){if(!Number.isFinite(target))throw Error('Invalid time');target=Math.max(0,Math.min(this.furthest,target));if(target<this.sim.time)this.rebuild(target);else this.advanceTo(target);}
  action(bus,type,value){new Simulation(this.config).action(bus,type,value);const t=this.sim.time;this.commands=this.commands.filter(x=>x.t<=t);this.commands.push({t,bus,type,value});this.furthest=t;this.rebuild(t);}
  dispatch(policy){const s=this.sim,n=s.c.stops,ideal=n/s.c.buses;
    for(const b of s.buses){if(b.phase==='travel'||b.pendingHold||b.holdUntil>s.time||b.express||b.pendingExpress||b.recoveryExpress)continue;
      const p=s.position(b);let gap=n;for(const other of s.buses)if(other!==b)gap=Math.min(gap,(s.position(other)-p+n)%n);
      if(policy==='hold'&&gap<ideal*.95){s.action(b.id,'hold',Math.min(120,Math.max(1,(ideal-gap)*s.c.travel*2.5)));}
      if(policy==='express'&&gap>ideal*1.25){s.action(b.id,'recovery',1);}
      if(policy==='express-count'&&gap>ideal*1.25){s.action(b.id,'express',Math.min(n-1,Math.max(1,Math.ceil(gap-ideal))));}
    }
  }
  upcoming(){return this.events.slice(this.cursor).find(x=>x.type!=='policy')||this.events.slice(this.cursor).find(x=>x.type==='policy');}
}
