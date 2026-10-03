import {Simulation} from './engine.js';

export const scenarios = [
  {id:'balanced',name:'Balanced · fixed arrivals',description:'An evenly spaced baseline with regular arrivals. No interventions.',config:{},events:[]},
  {id:'delay',name:'One delay → bunching',description:'At minute 20, Bus 1 is held for 60 seconds. Watch its queue grow and the following bus catch up.',config:{},events:[{t:1200,type:'hold',bus:0,value:60}]},
  {id:'variance',name:'Random demand → bunching',description:'Poisson arrivals and varied ride lengths gradually disturb the spacing, without any imposed delay. Seed 42 reproduces the run.',config:{arrival:'poisson',rideMode:'random'},events:[]},
  {id:'holds',name:'Recover with bus holds',description:'The same minute-20 delay. From minute 25 to 60, a dispatcher holds buses with small forward gaps at service stops. Compare against “One delay”.',config:{},events:[{t:1200,type:'hold',bus:0,value:60}],policy:'hold'},
  {id:'express',name:'Recover with temporary express',description:'The same minute-20 delay. From minute 25 to 60, buses with large forward gaps skip stops. Transfers and passenger costs remain in the statistics.',config:{},events:[{t:1200,type:'hold',bus:0,value:60}],policy:'express'},
];

// Replay from the seed and timestamped commands restores passengers, random state,
// active service references, observations and scheduled dispatch exactly.
export class Experiment {
  constructor(config={},scenarioId='balanced') {
    const scenario=scenarios.find(x=>x.id===scenarioId);
    if(!scenario)throw Error('Unknown scenario');
    this.scenarioId=scenarioId;this.config=new Simulation({...scenario.config,...config}).c;
    this.commands=[];this.furthest=0;this.rebuild(0);
  }
  static restore(data){
    if(data?.version!==1||!Number.isFinite(data.time)||data.time<0||data.time>604800||!Array.isArray(data.commands)||data.commands.length>10000)throw Error('Invalid experiment copy');
    const e=new Experiment(data.config,data.scenarioId);
    for(const x of data.commands){if(!Number.isFinite(x.t)||x.t<0||x.t>604800)throw Error('Invalid command time');new Simulation(e.config).action(x.bus,x.type,x.value);}
    e.commands=structuredClone(data.commands).sort((a,b)=>a.t-b.t);e.furthest=Math.max(data.time,Number.isFinite(data.furthest)?data.furthest:data.time);e.rebuild(data.time);return e;
  }
  export(){return {version:1,config:this.config,scenarioId:this.scenarioId,time:this.sim.time,furthest:this.furthest,commands:structuredClone(this.commands)};}
  rebuild(target){this.sim=new Simulation(this.config);const scenario=scenarios.find(x=>x.id===this.scenarioId);this.events=[...scenario.events.map(x=>({...x,source:'preset'})),...this.commands.map(x=>({...x,source:'manual'}))];
    if(scenario.policy)for(let t=1500;t<=3600;t+=30)this.events.push({t,type:'policy',policy:scenario.policy,source:'preset'});
    this.events.sort((a,b)=>a.t-b.t);this.cursor=0;this.advanceTo(target);
  }
  advanceTo(target){if(!Number.isFinite(target)||target<this.sim.time)throw Error('Invalid target time');
    while(this.cursor<this.events.length&&this.events[this.cursor].t<=target){const event=this.events[this.cursor++];this.sim.advance(event.t-this.sim.time);if(event.type==='policy')this.dispatch(event.policy);else this.sim.action(event.bus,event.type,event.value);}
    this.sim.advance(target-this.sim.time);this.furthest=Math.max(this.furthest,target);
  }
  seek(target){if(!Number.isFinite(target))throw Error('Invalid time');target=Math.max(0,Math.min(this.furthest,target));if(target<this.sim.time)this.rebuild(target);else this.advanceTo(target);}
  action(bus,type,value){new Simulation(this.config).action(bus,type,value);const t=this.sim.time;this.commands=this.commands.filter(x=>x.t<=t);this.commands.push({t,bus,type,value});this.furthest=t;this.rebuild(t);}
  dispatch(policy){const s=this.sim,n=s.c.stops,ideal=n/s.c.buses;
    for(const b of s.buses){if(b.phase==='travel'||b.pendingHold||b.holdUntil>s.time||b.express||b.pendingExpress)continue;
      const p=s.position(b);let gap=n;for(const other of s.buses)if(other!==b)gap=Math.min(gap,(s.position(other)-p+n)%n);
      if(policy==='hold'&&gap<ideal*.95){s.action(b.id,'hold',Math.min(120,Math.max(1,(ideal-gap)*s.c.travel*2.5)));}
      if(policy==='express'&&gap>ideal*1.25){s.action(b.id,'express',Math.min(n-1,Math.max(1,Math.ceil(gap-ideal))));}
    }
  }
  upcoming(){return this.events.slice(this.cursor).find(x=>x.type!=='policy')||this.events.slice(this.cursor).find(x=>x.type==='policy');}
}
